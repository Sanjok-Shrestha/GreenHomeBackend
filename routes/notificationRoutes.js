// backend/routes/notificationRoutes.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware").protect || require("../middleware/authMiddleware");
const notificationController = require("../controllers/notificationController");

// GET /api/notifications
router.get("/", auth, notificationController.listNotifications);

// POST /api/notifications/:id/read
router.post("/:id/read", auth, notificationController.markRead);

// POST /api/notifications/mark-all-read
router.post("/mark-all-read", auth, notificationController.markAllRead);

module.exports = router;