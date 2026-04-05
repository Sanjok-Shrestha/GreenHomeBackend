const express = require("express");
const router = express.Router();
const controller = require("../controllers/certificatesController");

// Optional auth middleware detection (use your project's middleware if present)
let protect = (req,res,next)=>next();
let authorize = (role)=> (req,res,next)=> next();
try {
  const auth = require("../middleware/authMiddleware");
  protect = auth.protect || protect;
  authorize = auth.authorize || authorize;
} catch (e) {
  console.warn("authMiddleware not found; certificate admin endpoints unprotected for local testing.");
}

// Public list & get endpoints
router.get("/certificates", controller.listCertificates);
router.get("/certificates/:id", controller.getCertificate);

// Admin endpoints (protect these in production)
router.post("/certificates", protect, authorize("admin"), controller.createCertificate);
router.delete("/certificates/:id", protect, authorize("admin"), controller.deleteCertificate);

module.exports = router;