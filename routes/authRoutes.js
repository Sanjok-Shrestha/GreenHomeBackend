// backend/routes/auth.js
const express = require("express");
const router = express.Router();
const authCtrl = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");

router.post("/register", authCtrl.register);
router.post("/login", authCtrl.login);
router.get("/me", protect, authCtrl.me);

module.exports = router;