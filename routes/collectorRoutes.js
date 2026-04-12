// routes/collectorRoutes.js
const express = require("express");
const router = express.Router();
const path = require("path");

// auth middlewares (optional — try to load)
let protect = (req, res, next) => next();
let authorize = () => (req, res, next) => next();

try {
  const auth = require("../middleware/authMiddleware");
  if (auth.protect) protect = auth.protect;
  if (auth.authorize) authorize = auth.authorize;
} catch (e) {
  console.warn("authMiddleware not found — collector routes will work without auth for testing");
}

const {
  getCollectorStats,
  getCollectorHistory,
  getCollectorHistoryById,
  getCollectorAnalytics,
} = (() => {
  try { return require("../controllers/collectorController"); } catch (e) { return {}; }
})();

/* ---------- Public test ---------- */
router.get("/_public_test", (req, res) => res.json({ ok: true, msg: "collector routes are mounted" }));

/* ---------- Real endpoints (protected) ---------- */
router.get("/stats", protect, authorize("collector", "admin"), getCollectorStats);
router.get("/history", protect, authorize("collector", "admin"), getCollectorHistory);
router.get("/history/:id", protect, authorize("collector", "admin"), getCollectorHistoryById);
router.get("/analytics", protect, authorize("collector", "admin"), getCollectorAnalytics);

/* ---------- NEW: Collector location update (fallback REST) ---------- */
/**
 * POST /api/collector/waste/:id/location
 * Body: { lat: number, lng: number }
 * Auth: collector (must be assigned to the pickup)
 */
router.post("/waste/:id/location", protect, authorize("collector"), async (req, res) => {
  try {
    const collectorId = req.user?.id || req.user?._id;
    const { id } = req.params;
    const { lat, lng } = req.body;

    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(400).json({ message: "Invalid coordinates" });
    }

    // load model flexibly
    let WastePost = null;
    try { WastePost = require("../models/WastePost"); } catch (e) { try { WastePost = require("../models/Pickup"); } catch (e2) { WastePost = null; } }

    if (!WastePost) return res.status(500).json({ message: "Model not available" });

    const waste = await WastePost.findById(id);
    if (!waste) return res.status(404).json({ message: "Pickup not found" });

    if (!waste.collector || String(waste.collector) !== String(collectorId)) {
      return res.status(403).json({ message: "Not authorized to update location for this pickup" });
    }

    waste.collectorLocation = { lat, lng, updatedAt: new Date() };
    await waste.save();

    // emit socket event if socket server present
    try {
      if (global.io) {
        global.io.to(`waste:${id}`).emit("collector-location", { wasteId: id, lat, lng, updatedAt: waste.collectorLocation.updatedAt });
      }
    } catch (e) { /* ignore */ }

    return res.json({ ok: true, wasteId: id, lat, lng, updatedAt: waste.collectorLocation.updatedAt });
  } catch (err) {
    console.error("/collector/waste/:id/location error", err && (err.stack || err.message));
    return res.status(500).json({ message: "Server error" });
  }
});

/* -------------------- DEBUG endpoints (optional) -------------------- */
const WastePost = (() => {
  try { return require("../models/WastePost"); }
  catch (e) {
    try { return require("../models/Pickup"); } catch (e2) { return null; }
  }
})();

router.post("/debug/set-collected/:id", protect, authorize("collector", "admin"), async (req, res) => {
  try {
    const collectorId = req.user?.id || req.user?._id;
    if (!collectorId) return res.status(401).json({ message: "Not authorized" });
    const pickupId = req.params.id;
    if (!WastePost) return res.status(500).json({ message: "Model not available" });

    const pickup = await WastePost.findOne({ _id: pickupId, collector: collectorId });
    if (!pickup) return res.status(404).json({ message: "Pickup not found or not assigned to you" });

    pickup.status = "Collected";
    pickup.completedAt = new Date();
    pickup.history = pickup.history || [];
    pickup.history.push({ status: "Collected", by: collectorId, at: new Date(), note: "Marked collected (debug)" });
    await pickup.save();

    return res.json({ message: "Pickup status set to 'Collected'", pickup });
  } catch (err) {
    console.error("debug/set-collected error", err && (err.stack || err.message));
    return res.status(500).json({ message: "Failed to update pickup status" });
  }
});

router.get("/debug/all-my-pickups", protect, authorize("collector", "admin"), async (req, res) => {
  try {
    const collectorId = req.user?.id || req.user?._id;
    if (!collectorId) return res.status(401).json({ message: "Not authorized" });
    if (!WastePost) return res.status(500).json({ message: "Model not available" });

    const items = await WastePost.find({ collector: collectorId })
      .sort({ createdAt: -1 })
      .select("_id status collector completedAt createdAt wasteType quantity collectorLocation")
      .lean();
    return res.json({ count: items.length, data: items });
  } catch (err) {
    console.error("debug/all-my-pickups error", err && (err.stack || err.message));
    return res.status(500).json({ message: "Failed to fetch pickups" });
  }
});

module.exports = router;