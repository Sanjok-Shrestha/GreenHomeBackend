const express = require("express");
const router = express.Router();

const {
  publicDashboard,
  userDashboard,
  collectorDashboard,
  adminDashboard,
} = require("../controllers/dashboardController");

const { protect, authorize } = require("../middleware/authMiddleware");

// Public
router.get("/public", publicDashboard);

// User
router.get("/user", protect, authorize("user"), userDashboard);

// Collector
router.get("/collector", protect, authorize("collector"), collectorDashboard);

// Admin
router.get("/admin", protect, authorize("admin"), adminDashboard);

module.exports = router;
