// routes/wasteRoutes.js
const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const {
  debugListAllMyPickups,
  createWastePost,
  schedulePickup,
  cancelSchedule,
  getUserWastePosts,
  trackPickup,
  markAsCollected,
  getAssignedPickups,
  getCollectorEarnings,
  getAvailablePickups,
  assignPickup,
  updateStatus,
  getCollectorHistory,
  // admin handlers
  getPendingApprovals,
  approveCompletion,
  rejectCompletion,
} = require("../controllers/wasteController");
const { protect, authorize } = require("../middleware/authMiddleware");

// Prepare uploads folder
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Multer storage (dev)
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

// Sample in-memory fallback dataset used earlier by your client if DB missing (keeps /recent working)
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
   GET /recent
   Returns: { posts: [...], page, perPage, total }
   Query: page (default 1), type, q
   ------------------------- */
router.get("/recent", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const perPage = 12;
    const type = req.query.type ? String(req.query.type).toLowerCase() : null;
    const q = req.query.q ? String(req.query.q).toLowerCase() : null;

    function tryLoadModel(candidates = []) {
      for (const p of candidates) {
        try {
          const resolved = require.resolve(path.join(__dirname, "..", p));
          const mod = require(resolved);
          if (mod && (typeof mod.find === "function" || typeof mod.countDocuments === "function")) return mod;
          if (mod && mod.default && (typeof mod.default.find === "function")) return mod.default;
        } catch (e) {}
      }
      return null;
    }

    const Model = tryLoadModel([
      "models/WastePost",
      "models/Waste",
      "models/Post",
      "models/waste",
      "models/post",
      "src/models/WastePost",
      "src/models/Waste",
      "src/models/Post",
    ]);

    if (Model) {
      const filter = {};
      if (type) filter.wasteType = type;
      if (q) {
        filter.$or = [
          { description: { $regex: q, $options: "i" } },
          { wasteType: { $regex: q, $options: "i" } },
          { location: { $regex: q, $options: "i" } },
        ];
      }
      const items = await Model.find(filter).sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage).lean();
      const total = await Model.countDocuments(filter);
      return res.json({ posts: items, page, perPage, total });
    }

    let items = SAMPLE.slice();
    if (type) items = items.filter((p) => (p.wasteType || "").toLowerCase() === type);
    if (q)
      items = items.filter((p) => {
        const hay = `${p.description || ""} ${p.wasteType || ""} ${p.location || ""}`.toLowerCase();
        return hay.includes(q);
      });

    const total = items.length;
    const start = (page - 1) * perPage;
    const paged = items.slice(start, start + perPage);
    return res.json({ posts: paged, page, perPage, total });
  } catch (err) {
    console.error("Error in GET /api/waste/recent:", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Internal server error" });
  }
});

// Create waste post (accepts optional image field named "image")
router.post("/post", protect, authorize("user"), upload.single("image"), createWastePost);

// Schedule pickup (owner)
router.put("/schedule/:id", protect, authorize("user"), schedulePickup);
router.delete("/schedule/:id", protect, authorize("user"), cancelSchedule);

// Track pickup (owner, assigned collector, or admin)
router.get("/track/:id", protect, authorize("user", "collector", "admin"), trackPickup);

// Get current user's posts
router.get("/my-posts", protect, authorize("user"), getUserWastePosts);

// Admin routes for pending approvals
router.get("/admin/pending-approvals", protect, authorize("admin"), getPendingApprovals);
router.post("/:id/approve", protect, authorize("admin"), approveCompletion);
router.post("/:id/reject", protect, authorize("admin"), rejectCompletion);

// Collector & admin
router.get("/collector/assigned", protect, authorize("collector"), getAssignedPickups);
router.get("/collector/earnings", protect, authorize("collector"), getCollectorEarnings);
router.get("/collector/history", protect, authorize("collector"), getCollectorHistory);

router.put("/complete/:id", protect, authorize("collector", "admin"), markAsCollected);
router.post("/complete/:id", protect, authorize("collector", "admin"), markAsCollected);

// Get available (unassigned) pickups
router.get("/available", protect, authorize("collector", "admin"), getAvailablePickups);

// Assign pickup (collector OR admin)
router.post("/:id/assign", protect, authorize("collector", "admin"), assignPickup);

// Status updates (collector/admin) with several shapes supported
router.patch("/:id/status", protect, authorize("collector", "admin"), updateStatus);
router.patch("/:id", protect, authorize("collector", "admin"), updateStatus);
router.post("/:id/status", protect, authorize("collector", "admin"), updateStatus);

// Debug listing
router.get("/collector/all-mine", protect, authorize("collector"), debugListAllMyPickups);

module.exports = router;