// backend/routes/adminReports.js
console.log("Loading route: ./routes/adminReports.js");

const express = require("express");
const router = express.Router();
const ctl = require("../controllers/adminReportsController");

let protect = (req, res, next) => next();
let authorize = () => (req, res, next) => next();
try {
  const auth = require("../middleware/authMiddleware");
  protect = auth.protect || protect;
  authorize = auth.authorize || (() => (req, res, next) => next());
} catch (e) {
  console.warn("authMiddleware not found; adminReports route will be unprotected for dev");
}

// GET /api/admin/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=50&status=open
router.get("/reports", protect, authorize("admin"), ctl.list);

module.exports = router;