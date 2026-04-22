// backend/controllers/adminReportsController.js
console.log("Loading controller: ./controllers/adminReportsController.js");

const mongoose = require("mongoose");

// try to load optional models (safe fallback if absent)
const Report = (() => { try { return require("../models/Report"); } catch (e) { return mongoose.models?.Report || null; } })();
const User = (() => { try { return require("../models/User"); } catch (e) { return mongoose.models?.User || null; } })();
const Post = (() => { try { return require("../models/Post"); } catch (e) { return mongoose.models?.Post || null; } })(); // generic post model
const WastePost = (() => { try { return require("../models/WastePost"); } catch (e) { return mongoose.models?.WastePost || null; } })(); // alternative name
const Pickup = (() => { try { return require("../models/Pickup"); } catch (e) { return mongoose.models?.Pickup || null; } })();
const Payment = (() => { try { return require("../models/Payment"); } catch (e) { return mongoose.models?.Payment || null; } })();

function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Map a Report document (whatever shape it has) to the frontend Row shape:
 * { id, date, user, wasteType, quantity, price, status }
 */
function mapDocToRow(d) {
  return {
    id: d._id ?? d.id ?? "",
    date: (d.createdAt ?? d.reportDate ?? d.date) ? new Date(d.createdAt ?? d.reportDate ?? d.date).toISOString() : new Date().toISOString(),
    user:
      (d.user && (d.user.name || d.user.email)) ??
      d.userName ??
      d.initiatorName ??
      d.initiator ??
      (typeof d.initiator === "string" ? d.initiator : "") ??
      "—",
    wasteType: d.wasteType ?? d.type ?? d.title ?? "—",
    quantity: Number(d.quantity ?? d.qty ?? d.weight ?? 0),
    price: Number(d.price ?? d.amount ?? d.cost ?? 0),
    status: d.status ?? "—",
  };
}

exports.list = async (req, res) => {
  try {
    // Prevent caching so browser/proxies don't return 304 with empty body
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.set("Surrogate-Control", "no-store");

    // If Report model not present, return sample shaped response (helps frontend dev)
    if (!Report) {
      console.warn("Report model not found - returning sample data for admin reports");
      const sampleRows = Array.from({ length: 6 }).map((_, i) => ({
        id: `sample-${i+1}`,
        date: new Date(Date.now() - i * 86400000).toISOString(),
        user: `User ${i+1}`,
        wasteType: ["Plastic", "Metal", "Paper", "Glass", "E-waste"][i % 5],
        quantity: (i + 1) * 2,
        price: (i + 1) * 30,
        status: i % 2 === 0 ? "completed" : "pending",
      }));

      const sampleSummary = {
        totalUsers: sampleRows.length,
        totalPosts: 0,
        totalPickups: sampleRows.length,
        totalEarnings: sampleRows.reduce((s, r) => s + (r.price || 0), 0),
      };

      return res.json({ summary: sampleSummary, rows: sampleRows });
    }

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const status = req.query.status ? String(req.query.status).trim() : null;

    const q = {};
    if (from || to) {
      const dateFilter = {};
      if (from) dateFilter.$gte = from;
      if (to) {
        const toEnd = new Date(to);
        toEnd.setHours(23, 59, 59, 999);
        dateFilter.$lte = toEnd;
      }
      q.$or = [{ reportDate: dateFilter }, { createdAt: dateFilter }];
    }

    if (status) q.status = status;

    // fetch docs (populate user if possible)
    let docs;
    if (typeof Report.find === "function") {
      if (Report.schema && Report.schema.path && Report.schema.path("user")) {
        // if user is a ref, populate name/email
        docs = await Report.find(q).sort({ createdAt: -1 }).limit(limit).populate("user", "name email").lean();
      } else {
        docs = await Report.find(q).sort({ createdAt: -1 }).limit(limit).lean();
      }
    } else {
      docs = [];
    }

    const rows = (docs || []).map(mapDocToRow);

    // compute summary fields (try to use models if present)
    const summary = {
      totalUsers: null,
      totalPosts: null,
      totalPickups: null,
      totalEarnings: null,
    };

    // parallel computation with safe fallbacks
    const tasks = [];

    // totalUsers - count Users if model exists
    tasks.push(
      (async () => {
        try {
          if (User && User.countDocuments) return await User.countDocuments({}).catch(() => null);
        } catch (e) {}
        return null;
      })()
    );

    // totalPosts - try Post, else WastePost
    tasks.push(
      (async () => {
        try {
          if (Post && Post.countDocuments) return await Post.countDocuments({}).catch(() => null);
          if (WastePost && WastePost.countDocuments) return await WastePost.countDocuments({}).catch(() => null);
        } catch (e) {}
        return null;
      })()
    );

    // totalPickups - try Pickup else use rows length
    tasks.push(
      (async () => {
        try {
          if (Pickup && Pickup.countDocuments) return await Pickup.countDocuments({}).catch(() => null);
        } catch (e) {}
        return null;
      })()
    );

    // totalEarnings - try Payment aggregate else sum row.price
    tasks.push(
      (async () => {
        try {
          if (Payment && Payment.aggregate) {
            const start = from || new Date(0);
            const match = {};
            if (from || to) match.date = {};
            if (from) match.date.$gte = from;
            if (to) {
              const toEnd = new Date(to);
              toEnd.setHours(23, 59, 59, 999);
              match.date.$lte = toEnd;
            }
            const agg = await Payment.aggregate([
              { $match: match },
              { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } },
            ]);
            return agg[0] ? Number(agg[0].total) : 0;
          }
        } catch (e) {}
        return null;
      })()
    );

    const [uCount, pCount, pickupCount, paymentTotal] = await Promise.all(tasks);

    summary.totalUsers = Number.isFinite(Number(uCount)) ? uCount : null;
    summary.totalPosts = Number.isFinite(Number(pCount)) ? pCount : (rows.length ? rows.length : 0);
    summary.totalPickups = Number.isFinite(Number(pickupCount)) ? pickupCount : rows.length;
    summary.totalpoints = Number.isFinite(Number(paymentTotal)) ? paymentTotal : rows.reduce((s, r) => s + (r.price || 0), 0);

    // ensure numbers are numbers (no nulls if possible)
    summary.totalUsers = summary.totalUsers ?? 0;
    summary.totalPosts = summary.totalPosts ?? 0;
    summary.totalPickups = summary.totalPickups ?? 0;
    summary.totalpoints = summary.totalpoints ?? 0;

    console.log(`adminReportsController.list: returning ${rows.length} rows (limit=${limit}) summary: users=${summary.totalUsers} posts=${summary.totalPosts} pickups=${summary.totalPickups} earnings=${summary.totalEarnings}`);

    return res.json({ summary, rows });
  } catch (err) {
    console.error("adminReportsController.list error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to list reports" });
  }
};