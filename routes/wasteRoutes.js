// routes/wasteRoutes.js
const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");

/* -------------------------
   Sample / fallback dataset
   ------------------------- */
const SAMPLE = [
  {
    _id: "m1",
    wasteType: "plastic",
    quantity: 3.2,
    price: 120,
    location: "Kathmandu",
    description: "Assorted plastic bottles, cleaned and bundled. Mostly PET bottles.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    user: { name: "Sita", verified: true },
    tags: ["bottles", "clean"],
    comments: 2,
    distanceKm: 1.2,
  },
  {
    _id: "m2",
    wasteType: "paper",
    quantity: 8,
    price: 80,
    location: "Lalitpur",
    description: "Cardboard boxes and old newspapers, flattened and dry.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    user: { name: "Ram", verified: false },
    tags: ["cardboard", "newspaper"],
    comments: 0,
    distanceKm: 3.6,
  },
  {
    _id: "m3",
    wasteType: "metal",
    quantity: 5,
    price: 250,
    location: "Bhaktapur",
    description: "Aluminum cans collected from event; packed in sacks.",
    createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
    user: { name: "Collector Joe", verified: true },
    tags: ["cans"],
    comments: 5,
    distanceKm: 0.5,
  },
];

/* -------------------------
   Helper: attempt to resolve a model from common paths
   ------------------------- */
function tryLoadModel(candidates = []) {
  for (const p of candidates) {
    try {
      const resolved = require.resolve(path.join(__dirname, "..", p));
      const mod = require(resolved);
      // If module exports a model (e.g., module.exports = mongoose.model('Waste', schema))
      if (mod && (typeof mod.find === "function" || typeof mod.countDocuments === "function")) {
        return mod;
      }
      // If it exports an object containing a model
      if (mod && mod.default && (typeof mod.default.find === "function")) {
        return mod.default;
      }
    } catch (e) {
      // ignore and try next
    }
  }
  return null;
}

/* -------------------------
   GET /recent
   Returns: { posts: [...], page, perPage, total }
   Supports query: page (default 1), type, q
   ------------------------- */
router.get("/recent", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const perPage = 12;
    const type = req.query.type ? String(req.query.type).toLowerCase() : null;
    const q = req.query.q ? String(req.query.q).toLowerCase() : null;

    // Try to load a DB model (common candidate paths)
    const Model = tryLoadModel([
      "models/Waste",
      "models/Post",
      "models/waste",
      "models/post",
      "src/models/Waste",
      "src/models/Post",
      "src/models/waste",
      "src/models/post",
    ]);

    if (Model) {
      // Build query filter
      const filter = {};
      if (type) filter.wasteType = type;
      // If q provided and text index is present, you might want to use $text; use fallback to $regex
      if (q) {
        // prefer text search if available
        filter.$or = [
          { description: { $regex: q, $options: "i" } },
          { wasteType: { $regex: q, $options: "i" } },
          { location: { $regex: q, $options: "i" } },
        ];
      }

      // Query DB
      const items = await Model.find(filter).sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage).lean();
      const total = await Model.countDocuments(filter);

      return res.json({ posts: items, page, perPage, total });
    }

    // No DB model found — fallback to SAMPLE in-memory data
    let items = SAMPLE.slice();
    if (type) items = items.filter((p) => (p.wasteType || "").toLowerCase() === type);
    if (q) {
      items = items.filter((p) => {
        const hay = `${p.description || ""} ${p.wasteType || ""} ${p.location || ""}`.toLowerCase();
        return hay.includes(q);
      });
    }

    const total = items.length;
    const start = (page - 1) * perPage;
    const paged = items.slice(start, start + perPage);

    return res.json({ posts: paged, page, perPage, total });
  } catch (err) {
    console.error("Error in GET /api/waste/recent:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/* -------------------------
   Existing router content (your original file)
   Keep your controllers, auth middleware, multer setup, other routes
   ------------------------- */

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
  getCollectorHistory,
  debugListAllMyPickups,
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

// Collector history (completed/collected pickups for authenticated collector)
router.get("/collector/history", protect, authorize("collector"), getCollectorHistory);

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

// DEBUG: List all pickups for the current collector (any status)
router.get("/collector/all-mine", protect, authorize("collector"), debugListAllMyPickups);

// Export router
module.exports = router;