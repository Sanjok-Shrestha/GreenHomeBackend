// controllers/pickupController.js

const mongoose = require("mongoose");
const WastePost = (function tryRequire() {
  try { return require("../models/WastePost"); } catch (e) { try { return require("../src/models/WastePost"); } catch (e2) { return null; } }
})();
const User = (function tryUser() {
  try { return require("../models/User"); } catch (e) { try { return require("../src/models/User"); } catch (e2) { return null; } }
})();
const Pickup = (function tryRequirePickup() {
  try { return require("../models/Pickup"); } catch (e) { try { return require("../src/models/Pickup"); } catch (e2) { return null; } }
})();
const Pricing = (function tryRequirePricing() {
  try { return require("../models/Pricing"); } catch (e) { try { return require("../src/models/Pricing"); } catch (e2) { return null; } }
})();
const Notification = (function tryNotify() {
  try { return require("../models/Notification"); } catch (e) { try { return require("../src/models/Notification"); } catch (e2) { return null; } }
})();
const { awardPointsForPickup } = require("./pointsController");

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

// ... all your other controller logic (shortened here for brevity) ... 

/**
 * Admin approves a pickup as completed
 */
exports.approveCompletion = async (req, res) => {
  try {
    if ((req.user?.role || "").toLowerCase() !== "admin")
      return res.status(403).json({ message: "Admin only" });
    const id = req.params.id;
    const note = req.body?.note || "Admin approved completion";

    const now = new Date();
    const waste = await WastePost.findById(id);
    if (!waste) return res.status(404).json({ message: "Not found" });

    if (waste.status === "Completed" && waste.pointsAwarded) {
      return res.status(400).json({ message: "Already completed and rewarded!" });
    }

    // Mark the waste as completed
    waste.status = "Completed";
    waste.completedAt = waste.completedAt || now;
    waste.approvedAt = waste.approvedAt || now;
    waste.approvedBy = waste.approvedBy || req.user._id;
    pushHistory(waste, "Completed", req.user._id, note);
    await waste.save();

    // 👇 AWARD POINTS USING pointsController
    const pointsResult = await awardPointsForPickup(waste, {
      awardToCollector: true,
      awardToUser: true,
    });

    try {
      if (Notification) {
        if (waste.user) {
          await Notification.create({
            user: waste.user,
            title: "Pickup approved",
            message: `Your pickup ${waste._id} was approved by admin.`,
            type: "pickup_approved",
            meta: { wasteId: waste._id },
          });
        }
        if (waste.collector) {
          await Notification.create({
            user: waste.collector,
            title: "Pickup approved",
            message: `Pickup ${waste._id} has been approved and completed.`,
            type: "pickup_approved_collector",
            meta: { wasteId: waste._id },
          });
        }
      }
    } catch (notifyErr) {
      console.error("[notifications] approveCompletion:", notifyErr && (notifyErr.stack || notifyErr.message));
    }

    const populated = await WastePost.findById(waste._id).populate("user", "name email phone address").populate("collector", "name email");
    return res.json({ data: populated, points: pointsResult });
  } catch (err) {
    console.error("approveCompletion error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * Generic status update handler (collector/admin)
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

    if (waste.collector && String(waste.collector) !== String(userId) && role !== "admin") {
      return res.status(403).json({ message: "Not allowed to update this pickup" });
    }

    const s = String(status).trim();
    const lowered = s.toLowerCase();

    let awardedPoints = null;

    if (lowered === "collected" && role === "admin") {
      // Admin marks as final collected/completed (award points!)
      waste.status = "Completed";
      const now = new Date();
      waste.completedAt = waste.completedAt || now;
      waste.approvedAt = waste.approvedAt || now;
      waste.approvedBy = waste.approvedBy || userId;
      if (!waste.pickedAt) waste.pickedAt = now;
      pushHistory(waste, "Completed", userId, note || "Admin marked completed");
      await waste.save();

      // Award points if not yet done
      awardedPoints = await awardPointsForPickup(waste, {
        awardToCollector: true,
        awardToUser: true,
      });
    } else if (lowered === "completed" && role === "admin") {
      // Explicit completed (admin only)
      waste.status = "Completed";
      const now = new Date();
      waste.completedAt = waste.completedAt || now;
      waste.approvedAt = waste.approvedAt || now;
      waste.approvedBy = waste.approvedBy || userId;
      if (!waste.pickedAt) waste.pickedAt = now;
      pushHistory(waste, "Completed", userId, note || "Admin marked completed");
      await waste.save();

      // Award points if not yet done
      awardedPoints = await awardPointsForPickup(waste, {
        awardToCollector: true,
        awardToUser: true,
      });
    } else if (lowered === "collected") {
      // Collector marking collected: set to pending for admin approval
      waste.status = "CollectedPending";
      waste.collectedAt = waste.collectedAt || new Date();
      if (!waste.collector && userId) waste.collector = userId;
      pushHistory(waste, "CollectedPending", userId, note || "Collector marked collected (pending approval)");
    } else if (lowered === "picked") {
      waste.status = "Picked";
      waste.pickedAt = waste.pickedAt || new Date();
      pushHistory(waste, "Picked", userId, note || "Marked picked by collector");
    } else {
      waste.status = s;
      pushHistory(waste, s, userId, note || "Status updated");
    }

    // Assign collector if none
    if (!waste.collector && role === "collector" && userId) {
      waste.collector = userId;
    }

    await waste.save();

    const populated = await WastePost.findById(waste._id)
      .populate("user", "name email phone address")
      .populate("collector", "name email");

    return res.json({ ok: true, pickup: populated, points: awardedPoints });
  } catch (err) {
    console.error("updateStatus error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to update status" });
  }
};

/**
 * Rejection (no points awarded)
 */
exports.rejectCompletion = async (req, res) => {
  try {
    if ((req.user?.role || "").toLowerCase() !== "admin") return res.status(403).json({ message: "Admin only" });
    const id = req.params.id;
    const reason = req.body?.reason || "Rejected by admin";
    const waste = await WastePost.findById(id);
    if (!waste) return res.status(404).json({ message: "Not found" });

    // Revert to 'Picked'
    waste.status = "Picked";
    pushHistory(waste, "Rejected", req.user._id, reason);
    await waste.save();

    const populated = await WastePost.findById(waste._id).populate("user", "name email phone address").populate("collector", "name email");
    return res.json({ data: populated });
  } catch (err) {
    console.error("rejectCompletion error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Server error" });
  }
};

// ...other existing controller functions remain, unchanged unless you want to centralize more logic...