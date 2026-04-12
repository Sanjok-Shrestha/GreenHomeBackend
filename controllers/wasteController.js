// server/controllers/wasteController.js
const path = require("path");
const mongoose = require("mongoose");
const WastePost = require("../models/WastePost");
const User = (function tryUser() {
  try { return require("../models/User"); } catch (e) { try { return require("../src/models/User"); } catch (e2) { return null; } }
})();
const Pickup = (function tryRequirePickup() {
  try { return require("../models/Pickup"); } catch (e) { try { return require("../src/models/Pickup"); } catch (e2) { return null; } }
})();
const Pricing = (function tryRequirePricing() {
  try { return require("../models/Pricing"); } catch (e) { try { return require("../src/models/Pricing"); } catch (e2) { return null; } }
})();

const Notification = require("../models/Notification");
const { notifyCollectorPlaceholder } = require("../utils/notify");

// Helper to push history entry (safe)
function pushHistory(doc, status, userId, note) {
  doc.history = doc.history || [];
  const entry = {
    status,
    at: new Date(),
    note: note || "",
  };
  if (userId) {
    try {
      entry.by = new mongoose.Types.ObjectId(userId);
    } catch (e) {
      entry.by = userId;
    }
  }
  doc.history.push(entry);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const FALLBACK_PRICE_PER_KG = {
  plastic: 40,
  paper: 15,
  metal: 80,
  glass: 10,
  organic: 5,
  electronic: 200,
};

// Socket/notification helpers (adapt to your app)
function emitToAdmins(event, payload) {
  try { if (global.io) global.io.to("admins").emit(event, payload); } catch (e) {}
}
function emitToUser(userId, event, payload) {
  try { if (global.io && userId) global.io.to(`user:${String(userId)}`).emit(event, payload); } catch (e) {}
}

/**
 * DEBUG: List all pickups for the current collector (any status)
 * GET /api/waste/collector/all-mine
 */
exports.debugListAllMyPickups = async (req, res) => {
  try {
    const collectorId = req.user?.id || req.user?._id;
    if (!collectorId) return res.status(401).json({ message: "Not authorized" });

    const items = await WastePost.find({ collector: collectorId })
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
 */
exports.createWastePost = async (req, res) => {
  try {
    if (process.env.NODE_ENV !== "production") {
      console.debug("createWastePost: body=", req.body, "file=", !!req.file);
    }

    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ message: "Not authorized" });

    const { wasteType, quantity, location, description, lat, lng } = req.body;
    const qty = Number(quantity);
    if (!wasteType || Number.isNaN(qty) || qty <= 0) {
      return res.status(400).json({ message: "wasteType and a valid quantity are required" });
    }

    const type = String(wasteType).trim();

    // Attempt to look up live pricing (case-insensitive)
    let pricePerKg = null;
    try {
      if (Pricing) {
        const p = await Pricing.findOne({ wasteType: new RegExp("^" + escapeRegex(type) + "$", "i") }).lean();
        if (p && typeof p.pricePerKg === "number") pricePerKg = Number(p.pricePerKg);
      }
    } catch (err) {
      console.warn("Pricing lookup failed:", err && (err.message || err));
    }

    if (pricePerKg === null) {
      pricePerKg = FALLBACK_PRICE_PER_KG[type.toLowerCase()] ?? 20;
    }

    const totalPrice = Math.round(pricePerKg * qty);

    const imageUrl = req.file ? `/api/uploads/${req.file.filename}` : undefined;

    const payload = {
      user: userId,
      wasteType: type,
      quantity: qty,
      price: totalPrice,
      pricePerKg,
      location: location ?? "",
      address: location ?? "",
      lat: lat ? Number(lat) : null,
      lng: lng ? Number(lng) : null,
      description: description ?? "",
      imageUrl,
      status: "Pending",
    };

    const waste = await WastePost.create(payload);

    // optional: notify collector pool about new available pickup (non-blocking)
    try { notifyCollectorPlaceholder(waste); } catch (e) {}

    // 🔔 Notification: user submitted waste
    try {
      await Notification.create({
        user: userId,
        title: "Waste submitted",
        message: `Your ${waste.wasteType || "waste"} post has been created and is pending pickup.`,
        type: "waste_submitted",
        meta: {
          wasteId: waste._id,
          quantity: waste.quantity,
          price: waste.price,
          location: waste.location,
        },
      });
    } catch (notifyErr) {
      console.error("[notifications] createWastePost:", notifyErr && (notifyErr.stack || notifyErr.message));
    }

    return res.status(201).json({
      success: true,
      estimatedPrice: totalPrice,
      waste,
    });
  } catch (error) {
    console.error("createWastePost error:", error && (error.stack || error.message || error));
    return res.status(500).json({ message: error.message || "Error creating waste post" });
  }
};

/**
 * Schedule Pickup (owner)
 * Accepts body.pickupDate (ISO string)
 */
exports.schedulePickup = async (req, res) => {
  try {
    const { pickupDate } = req.body;
    if (!pickupDate) {
      return res.status(400).json({ message: "pickupDate required" });
    }

    const d = new Date(pickupDate);
    if (isNaN(d.getTime())) return res.status(400).json({ message: "Invalid pickupDate" });
    if (d <= new Date()) return res.status(400).json({ message: "Pickup date must be in the future" });

    const hour = d.getHours();
    if (hour < 8 || hour >= 18) return res.status(400).json({ message: "Choose a time between 08:00 and 18:00" });

    const waste = await WastePost.findById(req.params.id);
    if (!waste) return res.status(404).json({ message: "Waste post not found" });

    if (String(waste.user) !== String(req.user.id) && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized" });
    }

    waste.pickupDate = d.toISOString();
    waste.status = "Scheduled";
    pushHistory(waste, "Scheduled", req.user.id, "User scheduled pickup");
    await waste.save();

    // 🔔 Notification: pickup scheduled
    try {
      await Notification.create({
        user: waste.user,
        title: "Pickup scheduled",
        message: `Your pickup for ${waste.wasteType || "waste"} has been scheduled on ${d.toLocaleString()}.`,
        type: "pickup_scheduled",
        meta: {
          wasteId: waste._id,
          pickupDate: waste.pickupDate,
        },
      });
    } catch (notifyErr) {
      console.error("[notifications] schedulePickup:", notifyErr && (notifyErr.stack || notifyErr.message));
    }

    return res.json({ message: "Pickup Scheduled", waste });
  } catch (error) {
    console.error("schedulePickup error:", error && (error.stack || error.message || error));
    return res.status(500).json({ message: "Error scheduling pickup" });
  }
};

/**
 * cancelSchedule - clear pickupDate and set status back to Pending
 */
exports.cancelSchedule = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ message: "id required" });

    const waste = await WastePost.findById(id);
    if (!waste) return res.status(404).json({ message: "Waste post not found" });

    if (String(waste.user) !== String(req.user.id) && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized" });
    }

    waste.pickupDate = null;
    waste.status = "Pending";
    pushHistory(waste, "Cancelled", req.user.id, "User cancelled pickup");
    await waste.save();

    return res.json({ message: "Cancelled", waste });
  } catch (err) {
    console.error("cancelSchedule error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Error cancelling schedule" });
  }
};

/**
 * Get User Waste Posts
 */
exports.getUserWastePosts = async (req, res) => {
  try {
    const wastes = await WastePost.find({ user: req.user.id }).sort({ createdAt: -1 }).lean();
    return res.json(wastes);
  } catch (error) {
    console.error("getUserWastePosts error:", error && (error.stack || error.message || error));
    return res.status(500).json({ message: "Error fetching waste posts" });
  }
};

/**
 * Track Pickup (owner, collector, admin)
 */
exports.trackPickup = async (req, res) => {
  try {
    const waste = await WastePost.findById(req.params.id)
      .populate("collector", "name email role")
      .populate("user", "name email phone address");

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
    console.error("trackPickup error:", error && (error.stack || error.message || error));
    return res.status(500).json({ message: "Error tracking pickup" });
  }
};

/**
 * Generic status update handler (collector/admin)
 *
 * Role-aware:
 * - collector marking 'Collected' => becomes 'CollectedPending' (no points)
 * - admin marking 'Completed' => finalizes and awards points
 */
exports.updateStatus = async (req, res) => {
  try {
    const id = req.params.id;
    let { status, note } = req.body || {};
    const userId = req.user?.id || req.user?._id;
    const role = (req.user?.role || "").toLowerCase();

    if (!status) return res.status(400).json({ message: "Missing status" });

    const waste = await WastePost.findById(id);
    if (!waste) return res.status(404).json({ message: "Waste not found" });

    // Only assigned collector (or admin) can update assigned pickup
    if (waste.collector && String(waste.collector) !== String(userId) && role !== "admin") {
      return res.status(403).json({ message: "Not allowed to update this pickup" });
    }

    const s = String(status).trim();
    const lowered = s.toLowerCase();

    // Role-aware handling
    if (lowered === "picked") {
      waste.status = "Picked";
      waste.pickedAt = waste.pickedAt || new Date();
      pushHistory(waste, "Picked", userId, note || "Marked picked by collector");
    } else if (lowered === "collected") {
      // If admin triggers 'collected', treat as final Completed.
      if (role === "admin") {
        waste.status = "Completed";
        const now = new Date();
        waste.completedAt = waste.completedAt || now;
        waste.approvedAt = waste.approvedAt || now;
        waste.approvedBy = waste.approvedBy || userId;
        if (!waste.pickedAt) waste.pickedAt = now;
        pushHistory(waste, "Completed", userId, note || "Admin marked completed");
        // award points to collector (if present)
        if (waste.collector) {
          try {
            if (User) {
              const coll = await User.findById(waste.collector);
              if (coll) {
                const rewardPoints = Math.round((waste.quantity || 0) * (Number(process.env.POINTS_PER_KG ?? 10)));
                coll.points = (coll.points || 0) + rewardPoints;
                await coll.save();
              }
            }
          } catch (e) {
            console.error("award points error (admin final):", e && e.message);
          }
        }
      } else {
        // Collector marking collected -> set to CollectedPending (awaiting admin)
        waste.status = "CollectedPending";
        waste.collectedAt = waste.collectedAt || new Date();
        if (!waste.collector && userId) waste.collector = userId;
        pushHistory(waste, "CollectedPending", userId, note || "Collector marked collected (pending approval)");
        // notify admins
        emitToAdmins("pickup-awaiting-approval", { id: waste._id, status: waste.status });
      }
    } else if (lowered === "completed") {
      // Admin finalizes completion (only allow admin)
      if (role !== "admin") {
        return res.status(403).json({ message: "Only admin can finalize completion" });
      }
      waste.status = "Completed";
      const now = new Date();
      waste.completedAt = waste.completedAt || now;
      waste.approvedAt = waste.approvedAt || now;
      waste.approvedBy = waste.approvedBy || userId;
      if (!waste.pickedAt) waste.pickedAt = now;
      pushHistory(waste, "Completed", userId, note || "Admin marked completed");

      // award points to collector (background best)
      if (waste.collector) {
        try {
          if (User) {
            const coll = await User.findById(waste.collector);
            if (coll) {
              const rewardPoints = Math.round((waste.quantity || 0) * (Number(process.env.POINTS_PER_KG ?? 10)));
              coll.points = (coll.points || 0) + rewardPoints;
              await coll.save();
            }
          }
        } catch (e) {
          console.error("award points error (completed):", e && e.message);
        }
      }
    } else {
      // Generic other statuses
      waste.status = s;
      pushHistory(waste, s, userId, note || "Status updated");
    }

    // ensure collector assigned if updater is collector
    if (!waste.collector && role === "collector" && userId) {
      waste.collector = userId;
    }

    await waste.save();

    // sync to Pickup collection if model exists and status is final-ish
    try {
      if (Pickup && (waste.status === "Completed" || waste.status === "CollectedPending" || waste.status === "Picked")) {
        await Pickup.findOneAndUpdate(
          { user: waste.user, collector: waste.collector, wasteType: waste.wasteType, description: waste.description },
          {
            wasteType: waste.wasteType,
            quantity: waste.quantity,
            price: waste.price,
            pricePerKg: waste.pricePerKg,
            status: waste.status,
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
      }
    } catch (syncErr) {
      console.error("Failed to upsert Pickup on status update:", syncErr && (syncErr.stack || syncErr.message || syncErr));
    }

    // notifications
    try {
      await Notification.create({
        user: waste.user,
        title: "Pickup status changed",
        message: `Pickup ${waste._id} status changed to ${waste.status}.`,
        type: "pickup_status_changed",
        meta: { wasteId: waste._id, status: waste.status },
      });
      if (waste.collector) {
        await Notification.create({
          user: waste.collector,
          title: "Pickup status changed",
          message: `Pickup ${waste._id} status changed to ${waste.status}.`,
          type: "pickup_status_changed_collector",
          meta: { wasteId: waste._id, status: waste.status },
        });
      }
    } catch (notifyErr) {
      console.error("[notifications] updateStatus:", notifyErr && (notifyErr.stack || notifyErr.message));
    }

    const populated = await WastePost.findById(waste._id)
      .populate("user", "name email phone address")
      .populate("collector", "name email");

    return res.json({ ok: true, pickup: populated });
  } catch (err) {
    console.error("updateStatus error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to update status" });
  }
};

/**
 * markAsCollected (compat wrapper)
 *
 * Collector -> sets CollectedPending
 * Admin -> finalizes Completed
 */
exports.markAsCollected = async (req, res) => {
  try {
    const id = req.params.id;
    const role = (req.user?.role || "").toLowerCase();

    if (role === "admin") {
      // admin finalizes completion
      req.body = req.body || {};
      req.body.status = "Completed";
      return exports.updateStatus(req, res);
    }

    // collector path -> mark collected (pending approval)
    req.body = req.body || {};
    // set to 'Collected' but updateStatus will convert to CollectedPending for collectors
    req.body.status = "Collected";
    return exports.updateStatus(req, res);
  } catch (err) {
    console.error("markAsCollected error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Error completing pickup" });
  }
};

/**
 * Get assigned pickups for collector (not final/completed)
 * Return items including CollectedPending so collector sees awaiting-approval
 */
exports.getAssignedPickups = async (req, res) => {
  try {
    const pickups = await WastePost.find({
      collector: req.user.id,
      // include CollectedPending and Picked, exclude final Completed
      status: { $ne: "Completed" },
    }).populate("user", "name email phone address");

    res.json(pickups);
  } catch (error) {
    console.error("getAssignedPickups error", error && (error.stack || error.message || error));
    res.status(500).json({ message: "Error fetching assigned pickups" });
  }
};

/**
 * Collector earnings (Completed only)
 */
exports.getCollectorEarnings = async (req, res) => {
  try {
    const collected = await WastePost.find({
      collector: req.user.id,
      status: "Completed",
    });

    const totalEarnings = collected.reduce((sum, waste) => sum + (waste.price || 0), 0);

    res.json({
      totalPickups: collected.length,
      totalEarnings,
    });
  } catch (error) {
    console.error("getCollectorEarnings error", error && (error.stack || error.message || error));
    return res.status(500).json({ message: "Error calculating earnings" });
  }
};

/**
 * Get collector history — pickups completed/collected by this collector (Completed)
 */
exports.getCollectorHistory = async (req, res) => {
  try {
    const collectorId = req.user?.id || req.user?._id;
    if (!collectorId) return res.status(401).json({ message: "Not authorized" });

    const { from, to } = req.query;
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const pageSize = Math.min(500, Math.max(1, parseInt(String(req.query.pageSize || "100"), 10)));

    const and = [{ collector: collectorId }, { status: "Completed" }];

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
    console.error("getCollectorHistory error", err && (err.stack || err.message || err));
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
        { status: { $nin: ["CollectedPending", "Completed"] } },
      ],
    };

    const items = await WastePost.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("user", "name phone address email");

    return res.status(200).json(items);
  } catch (error) {
    console.error("getAvailablePickups error", error && (error.stack || error.message || error));
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
      { collector: collectorId, status: "Picked", updatedAt: new Date() },
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

    try {
      const doc = await WastePost.findById(updated._id);
      pushHistory(doc, "Assigned", collectorId, "Collector assigned");
      await doc.save();
    } catch (err) {
      console.error("Failed to push assign history:", err && (err.stack || err.message || err));
    }

    // 🔔 Notifications after assignment
    try {
      await Notification.create({
        user: updated.user._id,
        title: "Collector assigned",
        message: "A collector has been assigned to your pickup request.",
        type: "collector_assigned",
        meta: {
          wasteId: updated._id,
          collectorId: collectorId,
        },
      });

      await Notification.create({
        user: collectorId,
        title: "Pickup assigned to you",
        message: `You have been assigned a pickup for ${updated.wasteType || "waste"}.`,
        type: "pickup_assigned",
        meta: {
          wasteId: updated._id,
          userId: updated.user._id,
        },
      });
    } catch (notifyErr) {
      console.error("[notifications] assignPickup:", notifyErr && (notifyErr.stack || notifyErr.message));
    }

    return res.status(200).json({ message: "Assigned", data: updated });
  } catch (error) {
    console.error("assignPickup error", error && (error.stack || error.message || error));
    return res.status(500).json({ message: "Failed to assign pickup" });
  }
};

/* -------------------------
   Admin helpers: pending approvals, approve, reject
   ------------------------- */

/**
 * GET /waste/admin/pending-approvals
 * Returns pickups where collectors marked collected and are awaiting admin approval
 */
exports.getPendingApprovals = async (req, res) => {
  try {
    // Only admin should call this — route middleware should enforce, but double-check
    if ((req.user?.role || "").toLowerCase() !== "admin") {
      return res.status(403).json({ message: "Admin only" });
    }

    const items = await WastePost.find({ status: "CollectedPending" })
      .sort({ collectedAt: -1, createdAt: -1 })
      .populate("user", "name email phone address")
      .populate("collector", "name email")
      .lean();

    return res.json({ data: items });
  } catch (err) {
    console.error("getPendingApprovals error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to load pending approvals" });
  }
};

/**
 * POST /waste/:id/approve
 * Admin approves a collected pickup and finalizes it to Completed.
 * Awards points to collector (guarded by processedForPoints if model has it).
 */
exports.approveCompletion = async (req, res) => {
  try {
    if ((req.user?.role || "").toLowerCase() !== "admin") return res.status(403).json({ message: "Admin only" });
    const id = req.params.id;

    // Prefer model static if available
    if (typeof WastePost.approveCompletion === "function") {
      const updated = await WastePost.approveCompletion(id, req.user._id, req.body?.note || "Admin approved");
      if (!updated) return res.status(404).json({ message: "Not found" });

      // send notifications
      try {
        if (updated.user) {
          await Notification.create({
            user: updated.user,
            title: "Pickup approved",
            message: `Your pickup ${updated._id} was approved by admin.`,
            type: "pickup_approved",
            meta: { wasteId: updated._id },
          });
          emitToUser(updated.user, "notification", { title: "Pickup approved", targetId: updated._id });
        }
        if (updated.collector) {
          await Notification.create({
            user: updated.collector,
            title: "Pickup approved",
            message: `Pickup ${updated._id} has been approved and completed.`,
            type: "pickup_approved_collector",
            meta: { wasteId: updated._id },
          });
          emitToUser(updated.collector, "notification", { title: "Pickup approved", targetId: updated._id });
        }
        emitToAdmins("pickup-approved", { id: updated._id, status: updated.status });
      } catch (notifyErr) {
        console.error("[notifications] approveCompletion:", notifyErr && (notifyErr.stack || notifyErr.message));
      }

      return res.json({ data: updated });
    }

    // Fallback inline update if model static not present
    const now = new Date();
    const waste = await WastePost.findById(id);
    if (!waste) return res.status(404).json({ message: "Not found" });

    waste.status = "Completed";
    waste.completedAt = waste.completedAt || now;
    waste.approvedAt = waste.approvedAt || now;
    waste.approvedBy = waste.approvedBy || req.user._id;
    pushHistory(waste, "Completed", req.user._id, req.body?.note || "Admin approved completion");

    // award points (guard processedForPoints if available)
    try {
      if (!waste.processedForPoints && waste.collector && User) {
        const coll = await User.findById(waste.collector);
        if (coll) {
          const rewardPoints = Math.round((waste.quantity || 0) * (Number(process.env.POINTS_PER_KG ?? 10)));
          coll.points = (coll.points || 0) + rewardPoints;
          await coll.save();
          waste.processedForPoints = true;
        }
      }
    } catch (e) {
      console.error("award points error (approve fallback):", e && e.message);
    }

    await waste.save();

    // notifications
    try {
      if (waste.user) {
        await Notification.create({
          user: waste.user,
          title: "Pickup approved",
          message: `Your pickup ${waste._id} was approved by admin.`,
          type: "pickup_approved",
          meta: { wasteId: waste._id },
        });
        emitToUser(waste.user, "notification", { title: "Pickup approved", targetId: waste._id });
      }
      if (waste.collector) {
        await Notification.create({
          user: waste.collector,
          title: "Pickup approved",
          message: `Pickup ${waste._id} has been approved and completed.`,
          type: "pickup_approved_collector",
          meta: { wasteId: waste._id },
        });
        emitToUser(waste.collector, "notification", { title: "Pickup approved", targetId: waste._id });
      }
      emitToAdmins("pickup-approved", { id: waste._id, status: waste.status });
    } catch (notifyErr) {
      console.error("[notifications] approveCompletion fallback:", notifyErr && (notifyErr.stack || notifyErr.message));
    }

    const populated = await WastePost.findById(waste._id).populate("user", "name email phone address").populate("collector", "name email");
    return res.json({ data: populated });
  } catch (err) {
    console.error("approveCompletion error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /waste/:id/reject
 * Admin rejects a collected pickup -> reverts to Picked (or other chosen status) and saves reason
 */
exports.rejectCompletion = async (req, res) => {
  try {
    if ((req.user?.role || "").toLowerCase() !== "admin") return res.status(403).json({ message: "Admin only" });
    const id = req.params.id;
    const reason = req.body?.reason || "Rejected by admin";

    // Prefer model static if available
    if (typeof WastePost.rejectCompletion === "function") {
      const updated = await WastePost.rejectCompletion(id, req.user._id, reason);
      if (!updated) return res.status(404).json({ message: "Not found" });

      // notifications
      try {
        if (updated.user) {
          await Notification.create({
            user: updated.user,
            title: "Pickup rejected",
            message: `Admin rejected completion for pickup ${updated._id}. Reason: ${reason}`,
            type: "pickup_rejected",
            meta: { wasteId: updated._id, reason },
          });
          emitToUser(updated.user, "notification", { title: "Pickup rejected", targetId: updated._id });
        }
        if (updated.collector) {
          await Notification.create({
            user: updated.collector,
            title: "Pickup rejected",
            message: `Admin rejected completion for pickup ${updated._id}. Reason: ${reason}`,
            type: "pickup_rejected_collector",
            meta: { wasteId: updated._id, reason },
          });
          emitToUser(updated.collector, "notification", { title: "Pickup rejected", targetId: updated._id });
        }
        emitToAdmins("pickup-rejected", { id: updated._id });
      } catch (notifyErr) {
        console.error("[notifications] rejectCompletion:", notifyErr && (notifyErr.stack || notifyErr.message));
      }

      return res.json({ data: updated });
    }

    // Fallback inline
    const waste = await WastePost.findById(id);
    if (!waste) return res.status(404).json({ message: "Not found" });

    // Revert to 'Picked' (you can change to another fallback)
    waste.status = "Picked";
    pushHistory(waste, "Rejected", req.user._id, reason);
    await waste.save();

    // notifications
    try {
      if (waste.user) {
        await Notification.create({
          user: waste.user,
          title: "Pickup rejected",
          message: `Admin rejected completion for pickup ${waste._id}. Reason: ${reason}`,
          type: "pickup_rejected",
          meta: { wasteId: waste._id, reason },
        });
        emitToUser(waste.user, "notification", { title: "Pickup rejected", targetId: waste._id });
      }
      if (waste.collector) {
        await Notification.create({
          user: waste.collector,
          title: "Pickup rejected",
          message: `Admin rejected completion for pickup ${waste._id}. Reason: ${reason}`,
          type: "pickup_rejected_collector",
          meta: { wasteId: waste._id, reason },
        });
        emitToUser(waste.collector, "notification", { title: "Pickup rejected", targetId: waste._id });
      }
      emitToAdmins("pickup-rejected", { id: waste._id });
    } catch (notifyErr) {
      console.error("[notifications] rejectCompletion fallback:", notifyErr && (notifyErr.stack || notifyErr.message));
    }

    const populated = await WastePost.findById(waste._id).populate("user", "name email phone address").populate("collector", "name email");
    return res.json({ data: populated });
  } catch (err) {
    console.error("rejectCompletion error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Server error" });
  }
};

/* Optional admin endpoints (approve / reject) implemented above */