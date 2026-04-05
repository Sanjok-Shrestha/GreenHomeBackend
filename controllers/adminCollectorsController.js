// backend/controllers/adminCollectorsController.js
const mongoose = require("mongoose");

const User = (() => {
  try { return require("../models/User"); } catch (e) { return mongoose.models?.User || null; }
})();
const Pickup = (() => {
  try { return require("../models/Pickup"); } catch (e) { return mongoose.models?.Pickup || null; }
})();
const Withdrawal = (() => {
  try { return require("../models/Withdrawal"); } catch (e) { return null; }
})();

if (!User) console.warn("adminCollectorsController: User model not found - adjust require path if needed");
if (!Pickup) console.warn("adminCollectorsController: Pickup model not found - adjust require path if needed");

// helper: normalize a lean() result
function normalizeUserDoc(u) {
  if (!u) return u;
  try { u._id = String(u._id); } catch (e) {}
  u.active = Boolean(u.active);
  u.status = typeof u.status === "string" ? u.status : (u.active ? "approved" : "pending");
  u.isApproved = String(u.status || "").toLowerCase() === "approved" || u.active === true;
  if (!u.approvedAt && u.isApproved) u.approvedAt = u.approvedAt || new Date();
  return u;
}

function setNoCache(res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

/**
 * GET /api/admin/collectors?limit=...
 * Only returns users whose role exactly equals "collector" (case-insensitive).
 */
exports.getCollectors = async (req, res) => {
  try {
    setNoCache(res);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || "100"), 10)));

    if (!User) return res.json([]);

    // Exact, case-insensitive match for "collector" role
    const roleQuery = { role: { $regex: /^collector$/i } };

    const users = await User.find(roleQuery)
      .select("name email phone active status createdAt role")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // get earnings per collector (sum of price for collected/completed pickups)
    let earningsAgg = [];
    if (Pickup) {
      earningsAgg = await Pickup.aggregate([
        { $match: { status: { $in: ["Collected", "collected", "Completed", "completed"] }, collector: { $exists: true, $ne: null } } },
        { $group: { _id: "$collector", totalEarnings: { $sum: { $ifNull: ["$price", 0] } } } },
      ]).allowDiskUse(true);
    }

    const earningsMap = {};
    (earningsAgg || []).forEach((r) => {
      earningsMap[String(r._id)] = r.totalEarnings || 0;
    });

    const result = (users || []).map((u) => {
      const norm = normalizeUserDoc(u);
      return {
        _id: norm._id,
        name: norm.name,
        email: norm.email,
        phone: norm.phone,
        active: norm.active,
        status: norm.status,
        isApproved: norm.isApproved,
        createdAt: norm.createdAt,
        earnings: earningsMap[String(norm._id)] || 0,
      };
    });

    return res.json(result);
  } catch (err) {
    console.error("getCollectors error", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Failed to load collectors" });
  }
};

/**
 * PATCH /api/admin/collectors/:id/active
 * Body: { active: boolean }
 */
exports.setActive = async (req, res) => {
  try {
    setNoCache(res);
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid id" });

    const active = typeof req.body.active !== "undefined" ? Boolean(req.body.active) : undefined;
    const update = {};
    if (typeof active !== "undefined") update.active = active;

    if (active === true) update.status = "approved";
    if (active === false && !update.status) update.status = "disabled";

    const u = await User.findByIdAndUpdate(id, { $set: update }, { new: true })
      .select("name email phone active status createdAt approvedAt")
      .lean();
    if (!u) return res.status(404).json({ message: "Collector not found" });

    const normalized = normalizeUserDoc(u);
    return res.json({ ok: true, collector: normalized });
  } catch (err) {
    console.error("setActive error", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Failed to update collector" });
  }
};

/**
 * POST /api/admin/collectors/:id/approve
 */
exports.approveCollector = async (req, res) => {
  try {
    setNoCache(res);
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid id" });

    const u = await User.findByIdAndUpdate(
      id,
      { $set: { active: true, status: "approved", approvedAt: new Date(), isApproved: true } },
      { new: true }
    )
      .select("name email phone active status createdAt approvedAt")
      .lean();
    if (!u) return res.status(404).json({ message: "Collector not found" });

    const normalized = normalizeUserDoc(u);
    return res.json({ ok: true, collector: normalized });
  } catch (err) {
    console.error("approveCollector error", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Failed to approve collector" });
  }
};

/**
 * POST /api/admin/collectors/:id/reject
 */
exports.rejectCollector = async (req, res) => {
  try {
    setNoCache(res);
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid id" });

    const u = await User.findByIdAndUpdate(id, { $set: { active: false, status: "rejected", isApproved: false } }, { new: true })
      .select("name email phone active status createdAt")
      .lean();
    if (!u) return res.status(404).json({ message: "Collector not found" });

    const normalized = normalizeUserDoc(u);
    return res.json({ ok: true, collector: normalized });
  } catch (err) {
    console.error("rejectCollector error", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Failed to reject collector" });
  }
};

/**
 * DELETE /api/admin/collectors/:id
 */
exports.deleteCollector = async (req, res) => {
  try {
    setNoCache(res);
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid id" });

    const u = await User.findByIdAndDelete(id).lean();
    if (!u) return res.status(404).json({ message: "Collector not found" });

    // Optionally cascade delete pickups — implement carefully
    return res.json({ ok: true });
  } catch (err) {
    console.error("deleteCollector error", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Failed to delete collector" });
  }
};