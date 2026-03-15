const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");

// Controllers
const {
  createWastePost,
  schedulePickup,
  getUserWastePosts,
  trackPickup,
  markAsCollected,
  getAssignedPickups,
  getCollectorEarnings,
  getAvailablePickups,
  assignPickup,
  updateStatus,
} = require("../controllers/wasteController");

// Auth middleware
const { protect, authorize } = require("../middleware/authMiddleware");

// ----------------- multer setup -----------------
const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});
// ------------------------------------------------

// ================= USER ROUTES =================

// Create waste post  (accepts optional image field named "image")
router.post("/post", protect, authorize("user"), upload.single("image"), createWastePost);

// Schedule pickup (owner)
router.put("/schedule/:id", protect, authorize("user"), schedulePickup);

// Track pickup (owner, assigned collector, or admin)
router.get("/track/:id", protect, authorize("user", "collector", "admin"), trackPickup);

// Get current user's posts
router.get("/my-posts", protect, authorize("user"), getUserWastePosts);

// ===============================================
// COLLECTOR & ADMIN ROUTES
// ===============================================

// Get assigned pickups for collector (not collected)
router.get("/collector/assigned", protect, authorize("collector"), getAssignedPickups);

// Collector earnings (collected)
router.get("/collector/earnings", protect, authorize("collector"), getCollectorEarnings);

// Mark as collected (existing endpoint kept for compatibility)
router.put("/complete/:id", protect, authorize("collector", "admin"), markAsCollected);
router.post("/complete/:id", protect, authorize("collector", "admin"), markAsCollected);

// Get available (unassigned) pickups
router.get("/available", protect, authorize("collector", "admin"), getAvailablePickups);

// Assign pickup to authenticated collector (atomic)
router.post("/:id/assign", protect, authorize("collector"), assignPickup);

// ================= Status update endpoints =================
// Frontend tries multiple variants: support PATCH/POST/PUT fallbacks

// Primary: PATCH /api/waste/:id/status
router.patch("/:id/status", protect, authorize("collector", "admin"), updateStatus);

// Fallbacks:
router.patch("/:id", protect, authorize("collector", "admin"), updateStatus);
router.post("/:id/status", protect, authorize("collector", "admin"), updateStatus);

// Export router
module.exports = router;