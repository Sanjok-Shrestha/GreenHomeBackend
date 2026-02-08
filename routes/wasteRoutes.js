const express = require("express");
const router = express.Router();

const {
  createWastePost,
  schedulePickup,
  getUserWastePosts,
} = require("../controllers/wasteController");

const { protect, authorize } = require("../middleware/authMiddleware");

router.post("/", protect, authorize("user"), createWastePost);

router.put("/schedule/:id", protect, authorize("user"), schedulePickup);

router.get("/my-posts", protect, authorize("user"), getUserWastePosts);

module.exports = router;
