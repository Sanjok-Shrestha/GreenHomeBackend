// backend/routes/userRoutes.js
const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const { protect } = require("../middleware/authMiddleware");

// GET /api/users/profile
router.get("/profile", protect, userController.getProfile);

// PUT /api/users/profile
router.put("/profile", protect, userController.updateProfile);

// optional quick ping (no auth) to verify router mounting
router.get("/ping", (req, res) => res.json({ ok: true, path: "/api/users/ping" }));

module.exports = router;