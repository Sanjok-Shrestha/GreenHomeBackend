const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/authMiddleware");
const rewardsController = require("../controllers/rewardsController");

router.post("/redeem", protect, authorize("user", "collector", "admin"), rewardsController.redeemReward);

// export
module.exports = router;