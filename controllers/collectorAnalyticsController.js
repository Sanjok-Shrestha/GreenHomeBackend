// src/controllers/collectorAnalyticsController.js
const mongoose = require("mongoose");
const Pickup = (() => {
  try { return require("../models/Pickup"); } catch (e) { return require("../../models/Pickup"); }
})();

/**
 * GET /api/collector/analytics?range=30
 * Protected: req.user.id must be present (collector id)
 */
exports.getAnalytics = async (req, res) => {
  try {
    const collectorId = req.user?.id || req.user?._id;
    if (!collectorId) return res.status(401).json({ message: "Not authenticated" });

    const rangeDays = parseInt(String(req.query.range || "30"), 10) || 30;
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - (rangeDays - 1)); // inclusive

    const oid = mongoose.Types.ObjectId(collectorId);

    // Common status considered "completed"
    const completedStatuses = ["Collected", "collected", "Completed", "completed"];

    // 1) KPIs:
    // - assigned: pickups assigned to this collector and not in final states (pending/scheduled/assigned)
    // - completedMonth: completed pickups within last 30 days (we can use 30-day window)
    // - kgCollected: sum of quantity for completed statuses (all time or range? we'll do rangeDays window)
    // - earnings: sum of price for completed statuses (rangeDays window)
    const rangeMatch = {
      collector: oid,
      createdAt: { $gte: startDate, $lte: now },
    };

    // KPIs aggregated in multiple pipelines for clarity
    const kpiAgg = await Pickup.aggregate([
      { $match: { collector: oid } },
      {
        $facet: {
          assigned: [
            { $match: { status: { $in: ["Pending", "pending", "Assigned", "assigned", "Scheduled", "scheduled"] } } },
            { $count: "count" },
          ],
          completedMonth: [
            { $match: { status: { $in: completedStatuses }, completedAt: { $gte: new Date(new Date().setDate(new Date().getDate() - 30)) } } },
            { $count: "count" },
          ],
          kgCollected: [
            { $match: { status: { $in: completedStatuses }, createdAt: { $gte: startDate, $lte: now } } },
            { $group: { _id: null, totalKg: { $sum: { $ifNull: ["$quantity", 0] } } } },
          ],
          earnings: [
            { $match: { status: { $in: completedStatuses }, createdAt: { $gte: startDate, $lte: now } } },
            { $group: { _id: null, totalEarnings: { $sum: { $ifNull: ["$price", 0] } } } },
          ],
        },
      },
    ]);

    const kp = kpiAgg[0] || {};
    const kpis = {
      assigned: (kp.assigned && kp.assigned[0] && kp.assigned[0].count) || 0,
      completedMonth: (kp.completedMonth && kp.completedMonth[0] && kp.completedMonth[0].count) || 0,
      kgCollected: (kp.kgCollected && kp.kgCollected[0] && kp.kgCollected[0].totalKg) || 0,
      earnings: (kp.earnings && kp.earnings[0] && kp.earnings[0].totalEarnings) || 0,
    };

    // 2) Series: build a date series grouped by day between startDate and now
    // We'll aggregate by day using $dateToString
    const seriesAgg = await Pickup.aggregate([
      { $match: { collector: oid, createdAt: { $gte: startDate, $lte: now } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          pickups: { $sum: 1 },
          kg: { $sum: { $ifNull: ["$quantity", 0] } },
          earnings: { $sum: { $ifNull: ["$price", 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // fill missing days with zeroes
    const seriesMap = (seriesAgg || []).reduce((acc, r) => {
      acc[r._id] = { date: r._id, pickups: r.pickups, kg: r.kg, earnings: r.earnings };
      return acc;
    }, {});

    const series = [];
    for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      series.push(seriesMap[key] || { date: key, pickups: 0, kg: 0, earnings: 0 });
    }

    // 3) statusCounts (all-time or for range? we'll compute within rangeDate to reflect recent statuses)
    const statusAgg = await Pickup.aggregate([
      { $match: { collector: oid, createdAt: { $gte: startDate, $lte: now } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    const statusCounts = {};
    (statusAgg || []).forEach((r) => {
      statusCounts[r._id || "unknown"] = r.count;
    });

    // 4) topZones: best-effort grouping by a 'zone' field, fallback to city or location string
    // adjust the field names to what your model stores (e.g., pickup.location.zone, pickup.address.city)
    const topZonesAgg = await Pickup.aggregate([
      { $match: { collector: oid, createdAt: { $gte: startDate, $lte: now } } },
      {
        $project: {
          zone: {
            $ifNull: [
              "$location.zone",
              { $ifNull: ["$address.city", "$location"] }, // fallback
            ],
          },
          kg: { $ifNull: ["$quantity", 0] },
        },
      },
      { $group: { _id: "$zone", pickups: { $sum: 1 }, kg: { $sum: "$kg" } } },
      { $sort: { kg: -1, pickups: -1 } },
      { $limit: 10 },
    ]);

    const topZones = (topZonesAgg || []).map((r) => ({ zone: r._id || "Unknown", pickups: r.pickups, kg: r.kg }));

    // 5) avgPickupTimeMinutes: average time between pickedAt (or assignedAt) and completedAt for completed statuses, within range
    const timeAgg = await Pickup.aggregate([
      { $match: { collector: oid, status: { $in: completedStatuses }, createdAt: { $gte: startDate, $lte: now }, pickedAt: { $exists: true }, completedAt: { $exists: true } } },
      {
        $project: {
          diffMinutes: {
            $divide: [{ $subtract: ["$completedAt", "$pickedAt"] }, 1000 * 60],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgMinutes: { $avg: "$diffMinutes" },
        },
      },
    ]);
    const avgPickupTimeMinutes = timeAgg && timeAgg[0] ? Number((timeAgg[0].avgMinutes || 0).toFixed(2)) : undefined;

    // Response
    return res.json({
      kpis,
      series,
      statusCounts,
      topZones,
      avgPickupTimeMinutes,
    });
  } catch (err) {
    console.error("collector analytics error", err);
    return res.status(500).json({ message: "Failed to compute analytics" });
  }
};