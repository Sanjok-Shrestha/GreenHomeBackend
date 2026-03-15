const User = require("../models/User");

exports.getProfile = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(404).json({ message: "User not found" });

    return res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      points: user.points ?? 0,
      isApproved: user.isApproved,
      createdAt: user.createdAt,
      avatarUrl: user.avatarUrl,
    });
  } catch (err) {
    console.error("getProfile error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// keep your existing getLeaderboard below (if present)
exports.getLeaderboard = async (req, res) => {
  try {
    const users = await User.find({ role: "user" }).select("name points").sort({ points: -1 }).limit(10);
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Error fetching leaderboard" });
  }
};