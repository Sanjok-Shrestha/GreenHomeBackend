// routes/posts.js
const express = require("express");
const router = express.Router();

// Example in-memory sample data (replace with real DB calls)
const SAMPLE_POSTS = [
  {
    _id: "m1",
    wasteType: "plastic",
    quantity: 3.2,
    price: 120,
    location: "Kathmandu",
    description: "Assorted plastic bottles, cleaned and bundled. Mostly PET bottles.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    user: { name: "Sita", verified: true },
    tags: ["bottles","clean"],
    comments: 2,
    distanceKm: 1.2,
  },
  // ...add more sample items as needed
];

router.get("/recent", (req, res) => {
  try {
    // Parse query params
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const perPage = 12; // change as needed
    const type = req.query.type ? String(req.query.type).toLowerCase() : null;
    const q = req.query.q ? String(req.query.q).toLowerCase() : null;

    // Query simulation (filter, search)
    let items = SAMPLE_POSTS.slice();
    if (type) items = items.filter((p) => (p.wasteType || "").toLowerCase() === type);
    if (q) items = items.filter((p) => ((p.description||"")+ " " + (p.wasteType||"") + " " + (p.location||"")).toLowerCase().includes(q));

    // Pagination
    const start = (page - 1) * perPage;
    const paged = items.slice(start, start + perPage);

    // Return consistent shape expected by frontend
    return res.json({ posts: paged, page, perPage, total: items.length });
  } catch (err) {
    console.error("posts.recent error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;