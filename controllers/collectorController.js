// controllers/collectorController.js
/**
 * Collector controller (points-based analytics)
 * - Uses WastePost model (falls back to Pickup if needed)
 * - Sums Payment.amount as "points" (falls back to user.points when available)
 * - Regex-status matching (case-insensitive)
 * - Pagination + meta for history
 */

const mongoose = require("mongoose");

// Prefer WastePost model (your schema). Fall back to Pickup if present.
const Pickup = (() => {
  try { return require("../models/WastePost"); }
  catch (e) {
    try { return require("../models/Pickup"); } catch (e2) { return null; }
  }
})();

// Payment model (optional)
const Payment = (() => {
  try { return require("../models/Payment"); } catch (e) { return mongoose.models?.Payment || null; }
})();

// User model (for reading current points if available)
const User = (() => {
  try { return require("../models/User"); } catch (e) { return mongoose.models?.User || null; }
})();

// Utilities
function parseIntParam(v, def) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isNaN(n) ? def : n;
}
function toObjectIdIfValid(id) {
  if (!id) return null;
  if (mongoose.Types.ObjectId.isValid(String(id))) {
    try { return new mongoose.Types.ObjectId(String(id)); } catch { return String(id); }
  }
  return String(id);
}

// Ensure indexes (best-effort)
async function ensureIndexes() {
  if (!Pickup || !Pickup.collection) return;
  try {
    await Pickup.collection.createIndex({ collector: 1, status: 1, completedAt: -1 });
    await Pickup.collection.createIndex({ collector: 1, status: 1, createdAt: -1 });
    await Pickup.collection.createIndex({ collector: 1, createdAt: -1 });
  } catch (err) {
    console.warn("ensureIndexes warning:", err && err.message ? err.message : err);
  }
}
ensureIndexes().catch(() => {});

/* -------------------- Controllers -------------------- */

async function getCollectorStats(req, res) {
  try {
    const collectorIdRaw = req.user?.id ?? req.user?._id;
    if (!collectorIdRaw) return res.status(401).json({ message: "Not authenticated" });
    if (!Pickup) return res.status(500).json({ message: "Server model missing" });

    const collectorId = toObjectIdIfValid(collectorIdRaw);

    const inProgressRegex = [/^pending$/i, /^scheduled$/i, /^picked$/i];
    const completedRegex = [/^collected$/i, /^completed$/i];

    const assigned = await Pickup.countDocuments({ collector: collectorId, status: { $in: inProgressRegex } });

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const completedMonth = await Pickup.countDocuments({
      collector: collectorId,
      status: { $in: completedRegex },
      updatedAt: { $gte: monthStart },
    });

    // aggregate kg collected for completed pickups
    const kgAgg = await Pickup.aggregate([
      { $match: { collector: collectorId, status: { $in: completedRegex } } },
      { $group: { _id: null, totalKg: { $sum: { $ifNull: ["$quantity", 0] } } } },
    ]);
    const kgCollected = (kgAgg[0] && kgAgg[0].totalKg) || 0;

    // Points: prefer to sum payment.amounts for this collector (payments may represent points)
    let points = 0;
    try {
      if (Payment) {
        const payAgg = await Payment.aggregate([
          { $match: { $or: [{ collectorId: collectorId }, { user: collectorId }] } },
          { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } },
        ]);
        points = (payAgg[0] && Number(payAgg[0].total)) || 0;
      } else if (User) {
        const u = await User.findById(collectorId).select("points").lean();
        points = u?.points ?? 0;
      }
    } catch (e) {
      console.warn("getCollectorStats: points aggregation failed", e && (e.stack || e.message));
      points = 0;
    }

    res.json({ assigned, completedMonth, kgCollected, points });
  } catch (err) {
    console.error("getCollectorStats error", err && (err.stack || err.message || err));
    res.status(500).json({ message: "Failed to fetch stats" });
  }
}

/**
 * getCollectorHistory
 * GET /api/collector/history
 */
async function getCollectorHistory(req, res) {
  try {
    const collectorIdRaw = req.user?.id ?? req.user?._id;
    if (!collectorIdRaw && req.query._public === "1") {
      return res.json({
        data: [{ _id: "sample1", wasteType: "metal", quantity: 34, status: "Collected", createdAt: new Date().toISOString(), location: "Sample Location", user: { name: "Test User" } }],
        meta: { page: 1, limit: 1, total: 1 },
      });
    }
    if (!collectorIdRaw) return res.status(401).json({ message: "Not authenticated" });
    if (!Pickup) return res.status(500).json({ message: "Server model missing" });

    const page = Math.max(1, parseIntParam(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, parseIntParam(req.query.limit, 20)));
    const skip = (page - 1) * limit;
    const collectorId = toObjectIdIfValid(collectorIdRaw);

    const match = {
      $or: [
        {
          collector: collectorId,
          $or: [
            { status: { $regex: "^collected$", $options: "i" } },
            { status: { $regex: "^completed$", $options: "i" } }
          ]
        },
        { "history.by": collectorId },
      ],
    };

    if (req.query.from || req.query.to) {
      match.completedAt = {};
      if (req.query.from) match.completedAt.$gte = new Date(String(req.query.from));
      if (req.query.to) match.completedAt.$lte = new Date(String(req.query.to));
    }

    const [items, total] = await Promise.all([
      Pickup.find(match)
        .sort({ completedAt: -1, updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("user", "name phone address")
        .populate("collector", "name email")
        .lean(),
      Pickup.countDocuments(match),
    ]);

    res.json({ data: items, meta: { page, limit, total } });
  } catch (err) {
    console.error("getCollectorHistory error", err && (err.stack || err.message || err));
    res.status(500).json({ message: "Failed to load history" });
  }
}

/**
 * getCollectorHistoryById
 * GET /api/collector/history/:id
 */
async function getCollectorHistoryById(req, res) {
  try {
    const collectorIdRaw = req.user?.id ?? req.user?._id;
    if (!collectorIdRaw) return res.status(401).json({ message: "Not authenticated" });
    if (!Pickup) return res.status(500).json({ message: "Server model missing" });

    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(String(id))) return res.status(400).json({ message: "Invalid id" });

    const pickup = await Pickup.findById(id)
      .populate("user", "name phone address email")
      .populate("collector", "name email")
      .lean();

    if (!pickup) return res.status(404).json({ message: "Pickup not found" });

    const collectorId = toObjectIdIfValid(collectorIdRaw);
    const isCollector = String(pickup.collector?._id ?? pickup.collector) === String(collectorId);
    const isAdmin = String(req.user?.role ?? "").toLowerCase() === "admin";
    const historyHasBy = Array.isArray(pickup.history) && pickup.history.some((h) => String(h.by) === String(collectorId));

    if (!isCollector && !isAdmin && !historyHasBy) {
      return res.status(403).json({ message: "Forbidden" });
    }

    res.json({ data: pickup });
  } catch (err) {
    console.error("getCollectorHistoryById error", err && (err.stack || err.message || err));
    res.status(500).json({ message: "Failed to load pickup" });
  }
}

/**
 * getCollectorAnalytics (points-based)
 * GET /api/collector/analytics?range=30
 */
async function getCollectorAnalytics(req, res) {
  try {
    const collectorIdRaw = req.user?.id ?? req.user?._id;
    if (!collectorIdRaw) return res.status(401).json({ message: "Not authenticated" });
    if (!Pickup) return res.status(500).json({ message: "Server model missing" });

    const days = Math.min(90, Math.max(7, parseIntParam(req.query.range ?? req.query.days, 30)));
    const since = new Date(); since.setDate(since.getDate() - (days - 1)); since.setHours(0,0,0,0);

    const collectorId = toObjectIdIfValid(collectorIdRaw);
    const kpiMatch = { collector: collectorId };

    const assigned = await Pickup.countDocuments({
      ...kpiMatch,
      status: { $nin: [/^collected$/i, /^completed$/i] },
    });

    const completedDocs = await Pickup.find({
      ...kpiMatch,
      status: { $in: [/^collected$/i, /^completed$/i] },
    }).select("price quantity completedAt");

    const completedMonth = completedDocs.length;

    // Points aggregation: sum payments.amount grouped by day
    let series = [];
    let totalPoints = 0;
    if (Payment) {
      const paymentAgg = await Payment.aggregate([
        {
          $match: {
            $or: [{ collectorId: collectorId }, { user: collectorId }],
            date: { $gte: since },
          },
        },
        { $project: { day: { $dateToString: { format: "%Y-%m-%d", date: "$date" } }, amount: { $ifNull: ["$amount", 0] } } },
        { $group: { _id: "$day", points: { $sum: "$amount" } } },
        { $sort: { _id: 1 } },
      ]);

      // map into dateMap
      const dateMap = {};
      paymentAgg.forEach((r) => { dateMap[r._id] = { date: r._id, points: r.points, pickups: 0, kg: 0 }; totalPoints += Number(r.points || 0); });

      // Fill pickups/kg per day from Pickup completed docs
      const pickupsAgg = await Pickup.aggregate([
        { $match: { collector: collectorId, status: { $in: [/^collected$/i, /^completed$/i] }, completedAt: { $gte: since } } },
        { $project: { day: { $dateToString: { format: "%Y-%m-%d", date: "$completedAt" } }, qty: { $ifNull: ["$quantity", 0] } } },
        { $group: { _id: "$day", pickups: { $sum: 1 }, kg: { $sum: "$qty" } } },
        { $sort: { _id: 1 } },
      ]);
      pickupsAgg.forEach((p) => {
        if (!dateMap[p._id]) dateMap[p._id] = { date: p._id, points: 0, pickups: p.pickups, kg: p.kg };
        else { dateMap[p._id].pickups = p.pickups; dateMap[p._id].kg = p.kg; }
      });

      // build full series for 'days' window
      for (let i = 0; i < days; i++) {
        const d = new Date(since);
        d.setDate(since.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        const entry = dateMap[key] ?? { date: key, points: 0, pickups: 0, kg: 0 };
        series.push({ date: entry.date, pickups: entry.pickups, kg: entry.kg, points: entry.points });
      }
    } else {
      // fallback: compute series from completed pickups and approximate points via env POINTS_PER_PICKUP_COLLECTOR
      const POINTS_PER_PICKUP = Number(process.env.POINTS_PER_PICKUP_COLLECTOR ?? 10);
      const pickupsAgg = await Pickup.aggregate([
        { $match: { collector: collectorId, status: { $in: [/^collected$/i, /^completed$/i] }, completedAt: { $gte: since } } },
        { $project: { day: { $dateToString: { format: "%Y-%m-%d", date: "$completedAt" } }, qty: { $ifNull: ["$quantity", 0] } } },
        { $group: { _id: "$day", pickups: { $sum: 1 }, kg: { $sum: "$qty" } } },
        { $sort: { _id: 1 } },
      ]);
      const dateMap = {};
      pickupsAgg.forEach((p) => { dateMap[p._id] = { date: p._id, pickups: p.pickups, kg: p.kg, points: (p.pickups * POINTS_PER_PICKUP) }; totalPoints += p.pickups * POINTS_PER_PICKUP; });
      for (let i = 0; i < days; i++) {
        const d = new Date(since);
        d.setDate(since.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        const entry = dateMap[key] ?? { date: key, pickups: 0, kg: 0, points: 0 };
        series.push({ date: entry.date, pickups: entry.pickups, kg: entry.kg, points: entry.points });
      }
    }

    // status counts
    const statusCountsAgg = await Pickup.aggregate([{ $match: kpiMatch }, { $group: { _id: "$status", count: { $sum: 1 } } }]);
    const statusCounts = {};
    (statusCountsAgg || []).forEach((r) => { statusCounts[r._id || "unknown"] = r.count; });

    // top zones by kg
    const topZonesAgg = await Pickup.aggregate([
      { $match: kpiMatch },
      { $group: { _id: "$location", pickups: { $sum: 1 }, kg: { $sum: { $ifNull: ["$quantity", 0] } } } },
      { $sort: { kg: -1 } },
      { $limit: 8 },
    ]);
    const topZones = topZonesAgg.map((t) => ({ zone: t._id || "Unknown", pickups: t.pickups, kg: t.kg }));

    // avg pickup completion time minutes
    let avgPickupTimeMinutes = null;
    try {
      const timesAgg = await Pickup.aggregate([
        { $match: { ...kpiMatch, pickedAt: { $exists: true }, completedAt: { $exists: true } } },
        { $project: { diffMinutes: { $divide: [{ $subtract: ["$completedAt", "$pickedAt"] }, 1000 * 60] } } },
        { $group: { _id: null, avgMinutes: { $avg: "$diffMinutes" } } },
      ]);
      avgPickupTimeMinutes = timesAgg[0] ? Number(timesAgg[0].avgMinutes) : null;
    } catch (e) {
      avgPickupTimeMinutes = null;
    }

    // read current points from user if available
    let currentUserPoints = null;
    try {
      if (User) {
        const u = await User.findById(collectorId).select("points").lean();
        currentUserPoints = u?.points ?? null;
      }
    } catch (e) {
      currentUserPoints = null;
    }

    return res.json({
      kpis: {
        assigned,
        completedMonth,
        kgCollected: completedDocs.reduce((s, d) => s + (d.quantity || 0), 0),
        points: currentUserPoints ?? totalPoints,
      },
      series,
      statusCounts,
      topZones,
      avgPickupTimeMinutes,
    });
  } catch (err) {
    console.error("getCollectorAnalytics error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to compute analytics" });
  }
}

/* Exports */
module.exports = {
  getCollectorStats,
  getCollectorHistory,
  getCollectorHistoryById,
  getCollectorAnalytics,
};