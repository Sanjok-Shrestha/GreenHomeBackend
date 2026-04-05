// routes/wasteCollector.js
const express = require("express");
const router = express.Router();
const ctl = require("../controllers/wasteRedeemController");

let protect = (req,res,next)=>next();
try {
  const auth = require("../middleware/authMiddleware");
  protect = auth.protect || protect;
} catch (e) {
  console.warn("authMiddleware not found; collector routes unprotected in dev");
}

// POST /api/waste/collector/redeem
router.post("/collector/redeem", protect, ctl.redeem);

module.exports = router;