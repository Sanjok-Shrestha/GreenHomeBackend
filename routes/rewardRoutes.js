// routes/rewardRoutes.js
const express = require("express");
const router = express.Router();
const rewardController = require("../controllers/rewardController");
const rateLimit = require("express-rate-limit");

// ─────────────────────────────────────
// Auth middleware loader (with fallback)
// ─────────────────────────────────────
const auth = (() => {
  try {
    const { protect } = require("../middleware/authMiddleware");
    return protect;
  } catch (e) {
    try {
      return require("../middleware/auth");
    } catch (e2) {
      // Dev fallback: allow all requests (NOT for production!)
      console.warn('[routes] ⚠ Using dev fallback auth - all requests allowed');
      return (req, res, next) => next();
    }
  }
})();

// ─────────────────────────────────────
// Role guard helpers
// ─────────────────────────────────────
const requireRole = (role) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not authenticated" });
  if ((req.user.role || "").toString().toLowerCase() !== role) {
    return res.status(403).json({ message: "Forbidden" });
  }
  return next();
};

const requireRoles = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not authenticated" });
  const role = (req.user.role || "").toString().toLowerCase();
  const allowed = roles.map((r) => r.toString().toLowerCase());
  if (!allowed.includes(role)) return res.status(403).json({ message: "Forbidden" });
  return next();
};

// Rate limiter for earnings endpoint
const earningsLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 10,
  message: { message: "Too many requests - slow down" },
});

// ─────────────────────────────────────
// ROUTES
// ─────────────────────────────────────

// ✅ FIX: Add auth middleware so req.user is populated for points lookup
router.get("/rewards/catalog", auth, (req, res, next) => {
  try {
    return rewardController.getCatalog(req, res, next);
  } catch (e) {
    return next(e);
  }
});

// User redeem (only role "user")
router.post("/rewards/redeem", auth, requireRole("user"), (req, res, next) => {
  try {
    return rewardController.redeemUser(req, res, next);
  } catch (e) {
    return next(e);
  }
});

// User "use" redeemed reward (user or collector)
router.post("/rewards/use", auth, requireRoles("user", "collector"), (req, res, next) => {
  try {
    return rewardController.useReward(req, res, next);
  } catch (e) {
    return next(e);
  }
});

// Collector earnings & redeem
router.get("/waste/collector/earnings", auth, requireRole("collector"), earningsLimiter, (req, res, next) => {
  try {
    return rewardController.getEarnings(req, res, next);
  } catch (e) {
    return next(e);
  }
});

router.post("/waste/collector/redeem", auth, requireRole("collector"), (req, res, next) => {
  try {
    return rewardController.redeemCollector(req, res, next);
  } catch (e) {
    return next(e);
  }
});

// ─────────────────────────────────────
// Admin endpoints
// ─────────────────────────────────────

router.get("/admin/redemptions", auth, requireRole("admin"), (req, res, next) => {
  try {
    return rewardController.adminListRedemptions(req, res, next);
  } catch (e) {
    return next(e);
  }
});

router.post("/admin/redemptions/:id/approve", auth, requireRole("admin"), (req, res, next) => {
  try {
    return rewardController.adminApproveRedemption(req, res, next);
  } catch (e) {
    return next(e);
  }
});

router.post("/admin/redemptions/:id/reject", auth, requireRole("admin"), (req, res, next) => {
  try {
    return rewardController.adminRejectRedemption(req, res, next);
  } catch (e) {
    return next(e);
  }
});

module.exports = router;