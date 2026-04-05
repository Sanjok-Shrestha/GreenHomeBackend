// routes/adminRoutes.js
const express = require("express");
const router = express.Router();

// defensive auth middleware - works without auth for local testing
let protect = (req, res, next) => next();
let authorize = () => (req, res, next) => next();

try {
  const auth = require("../middleware/authMiddleware");
  protect = auth.protect || protect;
  authorize = auth.authorize || (() => (req, res, next) => next());
} catch (e) {
  console.warn("authMiddleware not found - admin routes will be accessible for testing");
}

const {
  getOverview,
  getTopCollectors,
  approveCollector,
  setCollectorActive,
  getReports,
  getRedemptions,
} = require("../controllers/adminController");

// health/test
router.get("/_public_test", (req, res) => res.json({ ok: true, msg: "admin routes mounted" }));

router.get("/overview", protect, authorize("admin"), getOverview);
router.get("/collectors", protect, authorize("admin"), getTopCollectors);
router.post("/collectors/:id/approve", protect, authorize("admin"), approveCollector);
router.patch("/collectors/:id/active", protect, authorize("admin"), setCollectorActive);

router.get("/reports", protect, authorize("admin"), getReports);
router.get("/redemptions", protect, authorize("admin"), getRedemptions);

module.exports = router;