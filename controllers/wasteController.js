// controllers/wasteController.js
const mongoose = require("mongoose");
const WastePost = require("../models/WastePost");
const User = require("../models/User");
const Pickup = (function tryRequirePickup() {
  try { return require("../models/Pickup"); } catch (e) { try { return require("../src/models/Pickup"); } catch (e2) { return null; } }
})();
const Pricing = (function tryRequirePricing() {
  try { return require("../models/Pricing"); } catch (e) { try { return require("../src/models/Pricing"); } catch (e2) { return null; } }
})();

// Helper to push a history entry
function pushHistory(doc, status, userId, note) {
  doc.history = doc.history || [];
  doc.history.push({
    status,
    by: userId ? new mongoose.Types.ObjectId(userId) : undefined,
    at: new Date(),
    note: note || "",
  });
}

// small helper to escape regex special chars
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * DEBUG: List all pickups for the current collector (any status)
 * GET /api/waste/collector/all-mine
 */
exports.debugListAllMyPickups = async (req, res) => {
  try {
    const collectorId = req.user?.id || req.user?._id;
    if (!collectorId) return res.status(401).json({ message: "Not authorized" });

    const items = await require("../models/WastePost").find({ collector: collectorId })
      .sort({ createdAt: -1 })
      .populate("user", "name email phone address")
      .lean();

    return res.json({ count: items.length, data: items });
  } catch (err) {
    console.error("debugListAllMyPickups error", err);
    return res.status(500).json({ message: "Failed to fetch pickups" });
  }
};

/**
 * Create Waste Post
 * - snapshots pricePerKg and price (total) from Pricing collection when possible
 */
exports.createWastePost = async (req, res) => {
  try {
    if (process.env.NODE_ENV !== "production") {
      console.debug("createWastePost: body=", req.body, "file=", !!req.file);
    }

    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ message: "Not authorized" });

    const { wasteType, quantity, location, description } = req.body;
    const qty = Number(quantity);
    if (!wasteType || Number.isNaN(qty) || qty <= 0) {
      return res.status(400).json({ message: "wasteType and a valid quantity are required" });
    }

    const type = String(wasteType).trim();

    // Attempt to look up live pricing from Pricing collection (case-insensitive)
    let pricePerKg = null;
    try {
      if (Pricing) {
        const p = await Pricing.findOne({ wasteType: new RegExp("^" + escapeRegex(type) + "$", "i") }).lean();
        if (p && typeof p.pricePerKg === "number") pricePerKg = Number(p.pricePerKg);
      }
    } catch (err) {
      console.warn("Pricing lookup failed:", err && (err.message || err));
    }

    // Fallback to legacy map if no pricing document found
    if (pricePerKg === null) {
      const PRICE_PER_KG = {
        plastic: 40,
        paper: 15,
        metal: 80,
        glass: 10,
        organic: 5,
        electronic: 200,
      };
      pricePerKg = PRICE_PER_KG[type.toLowerCase()] ?? 20;
    }

    const totalPrice = Math.round(pricePerKg * qty);

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : undefined;

    const waste = await WastePost.create({
      user: userId,
      wasteType: type,
      quantity: qty,
      price: totalPrice,
      pricePerKg,               // snapshot per-kg price used at creation
      location: location ?? "",
      description: description ?? "",
      imageUrl,
      status: "Pending",
    });

    return res.status(201).json({
      success: true,
      estimatedPrice: totalPrice,
      waste,
    });
  } catch (error) {
    console.error("createWastePost error:", error);
    return res.status(500).json({ message: error.message || "Error creating waste post" });
  }
};

/**
 * Schedule Pickup (owner)
 */
exports.schedulePickup = async (req, res) => {
  try {
    const { pickupDate } = req.body;
    const waste = await WastePost.findById(req.params.id);
    if (!waste) return res.status(404).json({ message: "Waste post not found" });

    if (String(waste.user) !== String(req.user.id)) return res.status(403).json({ message: "Not authorized" });

    waste.pickupDate = pickupDate;
    waste.status = "Scheduled";
    pushHistory(waste, "Scheduled", req.user.id, "User scheduled pickup");
    await waste.save();

    res.json({ message: "Pickup Scheduled", waste });
  } catch (error) {
    console.error("schedulePickup error:", error);
    res.status(500).json({ message: "Error scheduling pickup" });
  }
};

/**
 * Get User Waste Posts
 */
exports.getUserWastePosts = async (req, res) => {
  try {
    const wastes = await WastePost.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(wastes);
  } catch (error) {
    console.error("getUserWastePosts error:", error);
    res.status(500).json({ message: "Error fetching waste posts" });
  }
};

/**
 * Track Pickup (owner, collector, admin)
 */
exports.trackPickup = async (req, res) => {
  try {
    const waste = await WastePost.findById(req.params.id)
      .populate("collector", "name email role")
      .populate("user", "name email phone address role");

    if (!waste) return res.status(404).json({ message: "Pickup not found" });

    const currentUserId = String(req.user?.id ?? req.user?._id ?? "");
    const currentRole = String(req.user?.role ?? "").toLowerCase();

    const ownerId = String(waste.user?._id ?? waste.user);
    const collectorId = String(waste.collector?._id ?? waste.collector);

    const isOwner = ownerId && ownerId === currentUserId;
    const isAssignedCollector = collectorId && collectorId === currentUserId;
    const isAdmin = currentRole === "admin";

    if (!isOwner && !isAssignedCollector && !isAdmin) {
      return res.status(403).json({ message: "Not authorized to view this pickup" });
    }

    if (isAssignedCollector && !isOwner && !isAdmin) {
      const safe = waste.toObject ? waste.toObject() : JSON.parse(JSON.stringify(waste));
      if (safe.user) {
        delete safe.user.email;
      }
      return res.json(safe);
    }

    return res.json(waste);
  } catch (error) {
    console.error("trackPickup error:", error);
    res.status(500).json({ message: "Error tracking pickup" });
  }
};

/**
 * Generic status update handler
 * Supports PATCH /:id/status, PATCH /:id, POST /:id/status
 */
exports.updateStatus = async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;
    const userId = req.user?.id || req.user?._id;

    if (!status) return res.status(400).json({ message: "Missing status" });

    const waste = await WastePost.findById(id);
    if (!waste) return res.status(404).json({ message: "Waste not found" });

    // guard: only assigned collector or admin can change status (if collector set)
    if (waste.collector && String(waste.collector) !== String(userId) && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not allowed to update this pickup" });
    }

    const s = String(status).toLowerCase();
    waste.status = status;

    if (!waste.collector && userId) {
      waste.collector = userId;
    }

    if (s === "picked") {
      waste.pickedAt = waste.pickedAt || new Date();
      pushHistory(waste, "Picked", userId, "Marked picked by collector");
    } else if (s === "collected" || s === "completed") {
      waste.completedAt = waste.completedAt || new Date();
      if (!waste.pickedAt) waste.pickedAt = new Date();
      pushHistory(waste, "Collected", userId, "Marked collected — job complete");

      // reward points to owner
      try {
        const owner = await User.findById(waste.user);
        if (owner) {
          const rewardPoints = Math.round((waste.quantity || 0) * 10);
          owner.points = (owner.points || 0) + rewardPoints;
          await owner.save();
        }
      } catch (err) {
        console.error("Failed to award points:", err);
      }

      // --- SYNC TO PICKUP COLLECTION ---
      // Upsert Pickup document for this completed WastePost
      try {
        await Pickup.findOneAndUpdate(
          { user: waste.user, collector: waste.collector, wasteType: waste.wasteType, description: waste.description },
          {
            wasteType: waste.wasteType,
            quantity: waste.quantity,
            price: waste.price,
            pricePerKg: waste.pricePerKg,
            status: status,
            user: waste.user,
            collector: waste.collector,
            location: waste.location,
            address: waste.address,
            imageUrl: waste.imageUrl,
            description: waste.description,
            pickedAt: waste.pickedAt,
            completedAt: waste.completedAt,
            history: waste.history,
          },
          { upsert: true, new: true }
        );
      } catch (syncErr) {
        console.error("Failed to upsert Pickup on collect:", syncErr);
      }
      // --- END SYNC ---
    } else {
      pushHistory(waste, status, userId);
    }

    await waste.save();

    const populated = await WastePost.findById(waste._id)
      .populate("user", "name email phone address")
      .populate("collector", "name email");

    return res.json({ ok: true, pickup: populated });
  } catch (err) {
    console.error("updateStatus error", err);
    return res.status(500).json({ message: "Failed to update status" });
  }
};

/**
 * markAsCollected (compatibility wrapper)
 */
exports.markAsCollected = async (req, res) => {
  try {
    req.body = req.body || {};
    req.body.status = "Collected";
    return exports.updateStatus(req, res);
  } catch (err) {
    console.error("markAsCollected error", err);
    return res.status(500).json({ message: "Error completing pickup" });
  }
};

/**
 * Get assigned pickups for collector (not collected)
 */
exports.getAssignedPickups = async (req, res) => {
  try {
    const pickups = await WastePost.find({
      collector: req.user.id,
      status: { $ne: "Collected" },
    }).populate("user", "name email phone address");

    res.json(pickups);
  } catch (error) {
    console.error("getAssignedPickups error:", error);
    res.status(500).json({ message: "Error fetching assigned pickups" });
  }
};

/**
 * Collector earnings (collected)
 */
exports.getCollectorEarnings = async (req, res) => {
  try {
    const collected = await WastePost.find({
      collector: req.user.id,
      status: "Collected",
    });

    const totalEarnings = collected.reduce((sum, waste) => sum + (waste.price || 0), 0);

    res.json({
      totalPickups: collected.length,
      totalEarnings,
    });
  } catch (error) {
    console.error("getCollectorEarnings error:", error);
    res.status(500).json({ message: "Error calculating earnings" });
  }
};

/**
 * Get collector history — pickups completed/collected by this collector
 */
exports.getCollectorHistory = async (req, res) => {
  try {
    const collectorId = req.user?.id || req.user?._id;
    if (!collectorId) return res.status(401).json({ message: "Not authorized" });

    const { from, to } = req.query;
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const pageSize = Math.min(500, Math.max(1, parseInt(String(req.query.pageSize || "100"), 10)));

    // Case-insensitive matches for "collected" or "completed"
    const statusOr = [{ status: /^collected$/i }, { status: /^completed$/i }];

    const and = [{ collector: collectorId }, { $or: statusOr }];

    // date filters on completedAt if provided
    if (from || to) {
      const completedAtFilter = {};
      if (from) completedAtFilter.$gte = new Date(String(from));
      if (to) completedAtFilter.$lte = new Date(String(to));
      and.push({ completedAt: completedAtFilter });
    }

    const filter = { $and: and };

    const total = await WastePost.countDocuments(filter);
    const items = await WastePost.find(filter)
      .sort({ completedAt: -1, updatedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate("user", "name phone address")
      .populate("collector", "name email")
      .lean();

    return res.json({
      total,
      page,
      pageSize,
      data: items,
    });
  } catch (err) {
    console.error("getCollectorHistory error", err);
    return res.status(500).json({ message: "Failed to fetch history" });
  }
};

/**
 * Get available (unassigned) pickups
 */
exports.getAvailablePickups = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
    const query = {
      $and: [
        { collector: null },
        { status: { $nin: ["Collected", "Completed"] } },
      ],
    };

    const items = await WastePost.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("user", "name phone address email");

    return res.status(200).json(items);
  } catch (error) {
    console.error("getAvailablePickups error", error);
    return res.status(500).json({ message: "Failed to load available pickups" });
  }
};

/**
 * Assign pickup to authenticated collector (atomic)
 */
exports.assignPickup = async (req, res) => {
  try {
    const { id } = req.params;
    const collectorId = req.user?.id || req.user?._id;
    if (!collectorId) return res.status(401).json({ message: "Not authorized" });

    const updated = await WastePost.findOneAndUpdate(
      { _id: id, collector: null },
      { collector: collectorId, status: "Scheduled" },
      { new: true }
    ).populate("user", "name phone address email");

    if (!updated) {
      const existing = await WastePost.findById(id).populate("collector", "name");
      if (!existing) {
        return res.status(404).json({ message: "Pickup not found" });
      }
      if (existing.collector) {
        return res.status(409).json({ message: "Already assigned to another collector" });
      }
      return res.status(400).json({ message: "Unable to assign pickup" });
    }

    // push history entry for assignment
    try {
      const doc = await WastePost.findById(updated._id);
      pushHistory(doc, "Assigned", collectorId, "Collector assigned");
      await doc.save();
    } catch (err) {
      console.error("Failed to push assign history:", err);
    }

    return res.status(200).json({ message: "Assigned", data: updated });
  } catch (error) {
    console.error("assignPickup error", error);
    return res.status(500).json({ message: "Failed to assign pickup" });
  }
};