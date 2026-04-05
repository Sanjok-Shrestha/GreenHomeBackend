// routes/collectorRoutes.js
const express = require("express");
const router = express.Router();

// If your auth middleware path differs adjust this require
let protect = (req, res, next) => next();
let authorize = () => (req, res, next) => next();

try {
  const auth = require("../middleware/authMiddleware");
  protect = auth.protect || protect;
  authorize = auth.authorize || (() => (req, res, next) => next());
} catch (e) {
  console.warn("authMiddleware not found or failed to require — routes will work without auth for testing:", e.message);
}

const {
  getCollectorStats,
  getCollectorHistory,
  getCollectorHistoryById,
  getCollectorAnalytics,
} = require("../controllers/collectorController");

// Temporary public test (safe to leave while debugging)
router.get("/_public_test", (req, res) => res.json({ ok: true, msg: "collector routes are mounted" }));

// Real endpoints (protected in production)
// Note: app.js mounts this router at /api/collector (so final URL is /api/collector/history etc.)
router.get("/stats", protect, authorize("collector", "admin"), getCollectorStats);
router.get("/history", protect, authorize("collector", "admin"), getCollectorHistory);
router.get("/history/:id", protect, authorize("collector", "admin"), getCollectorHistoryById);
router.get("/analytics", protect, authorize("collector", "admin"), getCollectorAnalytics);

module.exports = router;

/* -------------------- DEBUG endpoints (optional) -------------------- */
// Mount debug endpoints after export so they won't affect import order in some setups.
// If you prefer include them above before module.exports.

const WastePost = (() => {
  try { return require("../models/WastePost"); }
  catch (e) {
    try { return require("../models/Pickup"); } catch (e2) { return null; }
  }
})();

// DEBUG: Set the status of a pickup to 'Collected' for testing
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
    // push history entry if schema supports it
    pickup.history = pickup.history || [];
    pickup.history.push({ status: "Collected", by: collectorId, at: new Date(), note: "Marked collected (debug)" });
    await pickup.save();

    return res.json({ message: "Pickup status set to 'Collected'", pickup });
  } catch (err) {
    console.error("debug/set-collected error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to update pickup status" });
  }
});

// DEBUG: List all pickups for the current collector (any status, for troubleshooting)
router.get("/debug/all-my-pickups", protect, authorize("collector", "admin"), async (req, res) => {
  try {
    const collectorId = req.user?.id || req.user?._id;
    if (!collectorId) return res.status(401).json({ message: "Not authorized" });
    if (!WastePost) return res.status(500).json({ message: "Model not available" });

    const items = await WastePost.find({ collector: collectorId })
      .sort({ createdAt: -1 })
      .select("_id status collector completedAt createdAt wasteType quantity")
      .lean();
    return res.json({ count: items.length, data: items });
  } catch (err) {
    console.error("debug/all-my-pickups error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to fetch pickups" });
  }
});