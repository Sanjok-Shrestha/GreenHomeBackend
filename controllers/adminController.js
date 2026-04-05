// controllers/adminController.js
/**
 * Defensive admin controller with safe fallbacks.
 * - Returns sample data if corresponding Mongoose models are not present.
 * - Endpoints:
 *   GET  /api/admin/overview
 *   GET  /api/admin/collectors
 *   POST /api/admin/collectors/:id/approve
 *   PATCH /api/admin/collectors/:id/active
 *   GET  /api/admin/reports
 *   GET  /api/admin/redemptions
 */

const mongoose = require("mongoose");

// Try to load real models (if present)
const Collector = (() => { try { return require("../models/Collector"); } catch { return null; } })();
const User = (() => { try { return require("../models/User"); } catch { return null; } })();
const Report = (() => { try { return require("../models/Report"); } catch { return null; } })();
const Redemption = (() => { try { return require("../models/Redemption"); } catch { return null; } })();

function safeNumber(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * GET /api/admin/overview
 */
async function getOverview(req, res) {
  try {
    let collectorsPending = 0, reportsOpen = 0, activeUsers = 0, revenueThisMonth = 0;

    if (Collector && Collector.countDocuments) {
      collectorsPending = await Collector.countDocuments({ status: "pending" }).catch(() => 0);
    } else collectorsPending = 3;

    if (Report && Report.countDocuments) {
      reportsOpen = await Report.countDocuments({ status: "open" }).catch(() => 0);
    } else reportsOpen = 7;

    if (User && User.countDocuments) {
      activeUsers = await User.countDocuments({ active: true }).catch(() => 1200);
    } else activeUsers = 1200;

    // Try to compute revenueThisMonth from Payment model if available (optional)
    try {
      const Payment = (() => { try { return require("../models/Payment"); } catch { return null; } })();
      if (Payment && Payment.aggregate) {
        const start = new Date(); start.setDate(1); start.setHours(0,0,0,0);
        const agg = await Payment.aggregate([
          { $match: { date: { $gte: start } } },
          { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } },
        ]);
        revenueThisMonth = agg[0] ? safeNumber(agg[0].total, 0) : 0;
      } else {
        revenueThisMonth = 0;
      }
    } catch (e) {
      revenueThisMonth = 0;
    }

    return res.json({ collectorsPending, reportsOpen, activeUsers, revenueThisMonth });
  } catch (err) {
    console.error("admin.getOverview error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to load overview" });
  }
}

/**
 * GET /api/admin/collectors
 * Query: ?limit=6
 */
async function getTopCollectors(req, res) {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 6));
    if (Collector && Collector.find) {
      const docs = await Collector.find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .select("name email phone earnings active status createdAt")
        .lean();
      return res.json(Array.isArray(docs) ? docs : { data: docs });
    }

    // sample fallback
    const sample = Array.from({ length: limit }).map((_, i) => ({
      _id: `c${i + 1}`,
      name: `Collector ${i + 1}`,
      email: `collector${i + 1}@example.com`,
      phone: `+9112345678${i}`,
      earnings: (i + 1) * 120,
      active: i % 2 === 0,
      status: i % 2 === 0 ? "active" : "pending",
      createdAt: new Date(Date.now() - i * 86400000).toISOString(),
    }));
    return res.json(sample);
  } catch (err) {
    console.error("admin.getTopCollectors error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to fetch collectors" });
  }
}

/**
 * POST /api/admin/collectors/:id/approve
 */
async function approveCollector(req, res) {
  try {
    const id = req.params.id;
    if (Collector && Collector.findByIdAndUpdate) {
      const c = await Collector.findByIdAndUpdate(id, { status: "active", active: true }, { new: true }).lean();
      return res.json({ collector: c });
    }
    return res.json({ collector: { _id: id, status: "active", active: true } });
  } catch (err) {
    console.error("admin.approveCollector error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to approve collector" });
  }
}

/**
 * PATCH /api/admin/collectors/:id/active
 * Body: { active: boolean }
 */
async function setCollectorActive(req, res) {
  try {
    const id = req.params.id;
    const active = !!req.body?.active;
    if (Collector && Collector.findByIdAndUpdate) {
      const c = await Collector.findByIdAndUpdate(id, { active }, { new: true }).lean();
      return res.json({ collector: c });
    }
    return res.json({ collector: { _id: id, active } });
  } catch (err) {
    console.error("admin.setCollectorActive error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to update collector" });
  }
}

/**
 * GET /api/admin/reports
 */
async function getReports(req, res) {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 6));
    if (Report && Report.find) {
      const docs = await Report.find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("user", "name email")
        .lean();
      return res.json(Array.isArray(docs) ? docs : { data: docs });
    }

    const sample = Array.from({ length: limit }).map((i) => ({
      _id: `r${i+1}`,
      title: `Report ${i+1}`,
      status: i % 3 === 0 ? "open" : "resolved",
      createdAt: new Date(Date.now() - i * 3600 * 1000).toISOString(),
      user: { name: `User ${i+1}`, email: `user${i+1}@example.com` },
    }));
    return res.json(sample);
  } catch (err) {
    console.error("admin.getReports error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to load reports" });
  }
}

/**
 * GET /api/admin/redemptions
 */
async function getRedemptions(req, res) {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 6));
    if (Redemption && Redemption.find) {
      const docs = await Redemption.find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("user", "name email")
        .lean();
      return res.json(Array.isArray(docs) ? docs : { data: docs });
    }

    const sample = Array.from({ length: limit }).map((i) => ({
      _id: `rd${i+1}`,
      title: `Voucher ${i+1}`,
      cost: (i+1) * 50,
      status: i % 2 === 0 ? "completed" : "pending",
      createdAt: new Date(Date.now() - i * 86400000).toISOString(),
      user: { name: `User ${i+1}`, email: `user${i+1}@example.com` },
    }));
    return res.json(sample);
  } catch (err) {
    console.error("admin.getRedemptions error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to fetch redemptions" });
  }
}

module.exports = {
  getOverview,
  getTopCollectors,
  approveCollector,
  setCollectorActive,
  getReports,
  getRedemptions,
};