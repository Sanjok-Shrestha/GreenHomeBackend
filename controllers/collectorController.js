const mongoose = require("mongoose");
const Pickup = require("../models/Pickup");

// Minimal stats (if you already have a more complete version, merge)
async function getCollectorStats(req, res) {
  try {
    const collectorId = req.user?.id || req.user?._id;
    if (!collectorId) return res.status(401).json({ message: "Not authenticated" });

    // Prefer creating an ObjectId only when valid — avoids "Class constructor ObjectId" errors
    const oid = mongoose.Types.ObjectId.isValid(String(collectorId))
      ? new mongoose.Types.ObjectId(String(collectorId))
      : collectorId;

    const assigned = await Pickup.countDocuments({ collector: oid, status: { $in: ["pending", "scheduled", "picked"] } });
    const completedMonth = await Pickup.countDocuments({
      collector: oid,
      status: { $in: ["collected", "completed"] },
      updatedAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    });
    const kgAgg = await Pickup.aggregate([
      { $match: { collector: oid, status: { $in: ["collected", "completed"] } } },
      { $group: { _id: null, totalKg: { $sum: "$quantity" } } },
    ]);
    const kgCollected = (kgAgg[0] && kgAgg[0].totalKg) || 0;

    res.json({ assigned, completedMonth, kgCollected });
  } catch (err) {
    console.error("getCollectorStats error", err);
    res.status(500).json({ message: "Failed to fetch stats" });
  }
}

// GET /api/collector/history (paginated)
// This implementation returns pickups that:
//  - are assigned to the collector AND are final (Collected/Completed), OR
//  - include a history entry where history.by === collectorId
async function getCollectorHistory(req, res) {
  try {
    const collectorId = req.user?.id || req.user?._id;
    // optional public test fallback
    if (!collectorId && req.query._public === "1") {
      return res.json({
        data: [
          {
            _id: "sample1",
            wasteType: "metal",
            quantity: 34,
            status: "Collected",
            createdAt: new Date().toISOString(),
            location: "Tokha",
            user: { name: "Test" },
          },
        ],
      });
    }
    if (!collectorId) return res.status(401).json({ message: "Not authenticated" });

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const oid = mongoose.Types.ObjectId.isValid(String(collectorId))
      ? new mongoose.Types.ObjectId(String(collectorId))
      : collectorId;

    const match = {
      $or: [
        { collector: oid, status: { $in: ["Collected", "Completed"] } },
        { "history.by": oid }, // picks up records where this collector performed an action
      ],
    };

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
    console.error("getCollectorHistory error", err);
    res.status(500).json({ message: "Failed to load history" });
  }
}

// GET /api/collector/history/:id
async function getCollectorHistoryById(req, res) {
  try {
    const collectorId = req.user?.id || req.user?._id;
    if (!collectorId) return res.status(401).json({ message: "Not authenticated" });

    const id = req.params.id;
    const pickup = await Pickup.findById(id).populate("user", "name phone address").lean();
    if (!pickup) return res.status(404).json({ message: "Pickup not found" });

    // allow access if collector on record or admin; otherwise forbidden
    if (String(pickup.collector) !== String(collectorId) && req.user.role !== "admin") {
      // also allow if history.by contains the collector id (in case collector was not set)
      const historyHasBy = Array.isArray(pickup.history) && pickup.history.some((h) => String(h.by) === String(collectorId));
      if (!historyHasBy) return res.status(403).json({ message: "Forbidden" });
    }

    res.json({ data: pickup });
  } catch (err) {
    console.error("getCollectorHistoryById error", err);
    res.status(500).json({ message: "Failed to load pickup" });
  }
}

// GET /api/collector/analytics
async function getCollectorAnalytics(req, res) {
  try {
    const collectorId = req.user?.id || req.user?._id;
    if (!collectorId) return res.status(401).json({ message: "Not authenticated" });

    const rangeDays = parseInt(req.query.range, 10) || 30;
    const since = new Date();
    since.setDate(since.getDate() - rangeDays);

    const oid = mongoose.Types.ObjectId.isValid(String(collectorId))
      ? new mongoose.Types.ObjectId(String(collectorId))
      : collectorId;

    const kpiMatch = { collector: oid };

    const [assigned, completedMonthAgg, kgAgg, earningsAgg] = await Promise.all([
      Pickup.countDocuments({ ...kpiMatch, status: { $in: ["pending", "scheduled", "picked"] } }),
      Pickup.countDocuments({
        ...kpiMatch,
        status: { $in: ["collected", "completed"] },
        updatedAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      }),
      Pickup.aggregate([
        { $match: { ...kpiMatch, status: { $in: ["collected", "completed"] } } },
        { $group: { _id: null, totalKg: { $sum: "$quantity" } } },
      ]),
      Pickup.aggregate([
        { $match: { ...kpiMatch, status: { $in: ["collected", "completed"] } } },
        { $group: { _id: null, totalEarnings: { $sum: "$price" } } },
      ]),
    ]);

    const kgCollected = (kgAgg[0] && kgAgg[0].totalKg) || 0;
    const earnings = (earningsAgg[0] && earningsAgg[0].totalEarnings) || 0;

    const seriesAgg = await Pickup.aggregate([
      { $match: { ...kpiMatch, createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" },
          },
          date: { $first: "$createdAt" },
          pickups: { $sum: 1 },
          kg: { $sum: "$quantity" },
          earnings: { $sum: "$price" },
        },
      },
      { $sort: { date: 1 } },
    ]);

    const series = seriesAgg.map((s) => ({ date: s.date, pickups: s.pickups, kg: s.kg, earnings: s.earnings }));

    const statusCountsAgg = await Pickup.aggregate([
      { $match: { ...kpiMatch } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    const statusCounts = {};
    (statusCountsAgg || []).forEach((r) => {
      statusCounts[r._id || "unknown"] = r.count;
    });

    const topZonesAgg = await Pickup.aggregate([
      { $match: { ...kpiMatch } },
      { $group: { _id: "$location", pickups: { $sum: 1 }, kg: { $sum: "$quantity" } } },
      { $sort: { kg: -1 } },
      { $limit: 8 },
    ]);
    const topZones = topZonesAgg.map((t) => ({ zone: t._id || "Unknown", pickups: t.pickups, kg: t.kg }));

    let avgPickupTimeMinutes = null;
    try {
      const timesAgg = await Pickup.aggregate([
        { $match: { ...kpiMatch, pickedAt: { $exists: true }, completedAt: { $exists: true } } },
        {
          $project: {
            diffMinutes: {
              $divide: [{ $subtract: ["$completedAt", "$pickedAt"] }, 1000 * 60],
            },
          },
        },
        { $group: { _id: null, avgMinutes: { $avg: "$diffMinutes" } } },
      ]);
      avgPickupTimeMinutes = timesAgg[0] ? Number(timesAgg[0].avgMinutes) : null;
    } catch (e) {
      avgPickupTimeMinutes = null;
    }

    return res.json({
      kpis: { assigned, completedMonth: completedMonthAgg, kgCollected, earnings },
      series,
      statusCounts,
      topZones,
      avgPickupTimeMinutes,
    });
  } catch (err) {
    console.error("getCollectorAnalytics error", err);
    return res.status(500).json({ message: "Failed to compute analytics" });
  }
}

module.exports = {
  getCollectorStats,
  getCollectorHistory,
  getCollectorHistoryById,
  getCollectorAnalytics,
};