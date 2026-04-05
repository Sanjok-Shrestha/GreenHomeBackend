// routes/adminRedemptions.js
const express = require("express");
const router = express.Router();

// Example sample data — replace with DB calls
const exampleRedemptions = [
  { _id: "r1", user: "user1", amount: 100, status: "completed", createdAt: new Date().toISOString() },
  { _id: "r2", user: "user2", amount: 250, status: "pending", createdAt: new Date().toISOString() },
  { _id: "r3", user: "user3", amount: 50, status: "completed", createdAt: new Date().toISOString() },
];

// GET /api/admin/redemptions?limit=6
router.get("/redemptions", async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 10));
    const items = exampleRedemptions.slice(0, limit);
    res.json({ data: items, total: exampleRedemptions.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;