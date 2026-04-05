// routes/users.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { getProfile, getLeaderboard } = require("../controllers/userController");

// GET /api/users/profile (protected)
router.get("/profile", protect, getProfile);


module.exports = router;