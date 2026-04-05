// src/routes/collectorAnalytics.js
const express = require("express");
const router = express.Router();
const controller = require("../controllers/collectorAnalyticsController");

// Auth middleware - adapt to your project
let protect = (req, res, next) => next();
let authorize = () => (req, res, next) => next();
try {
  const auth = require("../middleware/authMiddleware");
  protect = auth.protect || protect;
  authorize = auth.authorize || (() => (req, res, next) => next());
} catch (e) {
  console.warn("authMiddleware not found; collector analytics route unprotected for local testing.");
}

// GET /api/collector/analytics
router.get("/analytics", protect, authorize("collector"), controller.getAnalytics);

module.exports = router;