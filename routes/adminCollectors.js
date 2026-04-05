// routes/adminCollectors.js
const express = require("express");
const router = express.Router();
const controller = require("../controllers/adminCollectorsController");

// Protect & authorize middleware (if available)
let protect = (req,res,next)=>next();
let authAuthorize = null;
try {
  const auth = require("../middleware/authMiddleware");
  protect = auth.protect || protect;
  authAuthorize = auth.authorize || null;
} catch (e) {
  console.warn("authMiddleware not found, admin routes will be unprotected for local testing.");
}

function ensureRoles(...roles) {
  const allowed = (roles || []).map(r => String(r || "").toLowerCase());
  return (req, res, next) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ message: "Not authorized (no user)" });
      const role = String(user.role || "").toLowerCase();
      if (!allowed.length || allowed.includes(role)) return next();
      return res.status(403).json({ message: "Forbidden" });
    } catch (err) {
      console.error("ensureRoles error", err);
      return res.status(500).json({ message: "Authorization check failed" });
    }
  };
}

function useAuthorize(...roles) {
  if (typeof authAuthorize === "function") {
    try {
      const mw = authAuthorize(...roles);
      if (typeof mw === "function") return mw;
    } catch (e) {
      console.warn("auth.authorize invocation failed; falling back to local ensureRoles:", e.message);
    }
  }
  return ensureRoles(...roles);
}

router.get("/collectors", protect, useAuthorize("admin"), controller.getCollectors);
router.patch("/collectors/:id/active", protect, useAuthorize("admin"), controller.setActive);
router.post("/collectors/:id/approve", protect, useAuthorize("admin"), controller.approveCollector);
router.post("/collectors/:id/reject", protect, useAuthorize("admin"), controller.rejectCollector);
router.delete("/collectors/:id", protect, useAuthorize("admin"), controller.deleteCollector);

module.exports = router;