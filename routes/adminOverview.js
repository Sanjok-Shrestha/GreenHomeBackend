// routes/adminOverview.js
const express = require("express");
const router = express.Router();

// GET /api/admin/overview
router.get("/overview", async (req, res, next) => {
  try {
    // TODO: replace with real DB aggregations
    const payload = {
      usersCount: 123,
      collectorsCount: 12,
      totalWasteKg: 4567.8,
      totalEarnings: 98765.43,
      ts: Date.now(),
    };
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;