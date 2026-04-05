// controllers/userController.js
const User = require("../models/User");

/**
 * GET /api/users/profile
 * - Requires auth middleware (protect) to have set req.user.
 * - Returns a safe profile object (no password).
 */
exports.getProfile = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(404).json({ message: "User not found" });

    // If req.user is a Mongoose document, ensure plain object and remove sensitive fields
    let u = user;
    try {
      if (typeof user.toObject === "function") {
        u = user.toObject();
        delete u.password;
      } else {
        u = { ...user };
        delete u.password;
      }
    } catch (e) {
      u = { ...user };
      delete u.password;
    }

    return res.json({
      id: u._id ?? u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      points: u.points ?? 0,
      isApproved: u.isApproved ?? false,
      createdAt: u.createdAt,
      avatarUrl: u.avatarUrl,
    });
  } catch (err) {
    console.error("getProfile error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

