// backend/routes/adminUsers.js
console.log("Loading route: ./routes/adminUsers.js");

const express = require("express");
const router = express.Router();
const ctl = require("../controllers/adminUsersController");

let protect = (req, res, next) => next();
let authorize = () => (req, res, next) => next();
try {
  const auth = require("../middleware/authMiddleware");
  protect = auth.protect || protect;
  authorize = auth.authorize || (() => (req, res, next) => next());
} catch (e) {
  console.warn("authMiddleware not found; adminUsers route will be unprotected for dev");
}

// List users
router.get("/users", protect, authorize("admin"), ctl.listUsers);

// Toggle active state
router.patch("/users/:id/active", protect, authorize("admin"), ctl.setActive);

// Change role
router.patch("/users/:id/role", protect, authorize("admin"), ctl.setRole);

// Delete user
router.delete("/users/:id", protect, authorize("admin"), ctl.deleteUser);

module.exports = router;