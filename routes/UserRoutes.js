const express = require("express");
const router = express.Router();

// Adjust the middleware import to match your file name:
// use "../middleware/auth" if the file is auth.js, or "../middleware/authMiddleware" if that's the filename.
const { protect } = require("../middleware/authMiddleware"); 

const { getProfile, getLeaderboard } = require("../controllers/userController");

// GET /api/users/profile (protected)
router.get("/profile", protect, getProfile);

// GET /api/users/leaderboard (public)
router.get("/leaderboard", getLeaderboard);

module.exports = router;