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
  // middleware missing — keep defaults so routes can be tested without auth
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
router.get("/stats", protect, authorize("collector", "admin"), getCollectorStats);
router.get("/history", protect, authorize("collector", "admin"), getCollectorHistory);
router.get("/history/:id", protect, authorize("collector", "admin"), getCollectorHistoryById);
router.get("/analytics", protect, authorize("collector", "admin"), getCollectorAnalytics);

module.exports = router;