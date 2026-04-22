const express = require("express");
const router = express.Router();

// Defensive auth middleware
let protect = (req, res, next) => next();
let authorize = () => (req, res, next) => next();

try {
  const auth = require("../middleware/authMiddleware");
  protect = auth.protect || protect;
  authorize = auth.authorize || (() => (req, res, next) => next());
} catch (e) {
  console.warn("authMiddleware not found - admin routes will be accessible for testing");
}

// Import core controllers
const {
  getOverview,
  getTopCollectors,
  approveCollector,
  setCollectorActive,
  getReports,
  getRedemptions,
} = require("../controllers/adminController");

// Import Pickup/points awarding
const Pickup = require("../models/Pickup");
const { awardPointsForPickup } = require("../controllers/pointsController");

// Healthchecker
router.get("/_public_test", (req, res) => res.json({ ok: true, msg: "admin routes mounted" }));
router.get("/collectors", protect, authorize("admin"), getTopCollectors);
router.post("/collectors/:id/approve", protect, authorize("admin"), approveCollector);
router.patch("/collectors/:id/active", protect, authorize("admin"), setCollectorActive);

router.get("/reports", protect, authorize("admin"), getReports);
router.get("/redemptions", protect, authorize("admin"), getRedemptions);

// ⭐️ Admin approves/completes a pickup (awards points)
router.patch(
  "/pickups/:id/approve",
  protect,
  authorize("admin"),
  async (req, res) => {
    try {
      // Find and update the pickup
      const pickup = await Pickup.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            status: "completed",
            completedAt: new Date(),
            pointsAwarded: false, // Reset so controller can safely award points
          },
          $push: {
            history: {
              status: "completed",
              by: req.user?._id, // ensure req.user from auth middleware if available
              at: new Date(),
              note: "Approved/completed by admin",
            },
          },
        },
        { new: true }
      );
      if (!pickup) return res.status(404).json({ message: "Pickup not found" });

      // Call points awarding logic
      const pointsResult = await awardPointsForPickup(pickup);

      // Get updated pickup (with updated pointsAwarded flag)
      const updatedPickup = await Pickup.findById(pickup._id);

      res.json({ pickup: updatedPickup, pointsAwarded: pointsResult });
    } catch (err) {
      console.error("Admin approve error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

module.exports = router;