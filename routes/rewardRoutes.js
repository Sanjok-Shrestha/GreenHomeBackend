// routes/rewardRoutes.js
const express = require("express");
const router = express.Router();
const rewardController = require("../controllers/rewardController");
const rateLimit = require("express-rate-limit");

// Try to load real auth middleware (falls back to noop for dev)
const auth = (() => {
  try { return require("../middleware/auth"); }
  catch (e) { return (req, res, next) => next(); }
})();

// Simple role guard (replace with your project's guard if you have one)
const requireRole = (role) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not authenticated" });
  if ((req.user.role || "").toString().toLowerCase() !== role) return res.status(403).json({ message: "Forbidden" });
  return next();
};

const earningsLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 10,
  message: { message: "Too many requests - slow down" },
});

/**
 * Routes are defined with full paths so that app.js mounting at "/api"
 * produces the final endpoints your frontend expects:
 *   GET  /api/rewards/catalog
 *   POST /api/rewards/redeem
 *   GET  /api/waste/collector/earnings
 *   POST /api/waste/collector/redeem
 */

// Public catalog
router.get("/rewards/catalog", (req, res, next) => {
  try { return rewardController.getCatalog(req, res, next); }
  catch (e) { return next(e); }
});

// User redeem
router.post("/rewards/redeem", auth, requireRole("user"), (req, res, next) => {
  try { return rewardController.redeemUser(req, res, next); }
  catch (e) { return next(e); }
});

// Collector earnings & redeem
router.get("/waste/collector/earnings", auth, requireRole("collector"), earningsLimiter, (req, res, next) => {
  try { return rewardController.getEarnings(req, res, next); }
  catch (e) { return next(e); }
});
router.post("/waste/collector/redeem", auth, requireRole("collector"), (req, res, next) => {
  try { return rewardController.redeemCollector(req, res, next); }
  catch (e) { return next(e); }
});

module.exports = router;