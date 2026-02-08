const User = require("../models/User");

// Public Dashboard
exports.publicDashboard = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: "user" });
    const totalCollectors = await User.countDocuments({ role: "collector" });

    res.json({
      totalUsers,
      totalCollectors,
      totalWasteCollected: 1250,
      co2Reduction: "2.5 Tons",
    });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};

// User Dashboard
exports.userDashboard = async (req, res) => {
  res.json({
    message: "User Dashboard Data",
    totalPosts: 5,
    pendingPickups: 2,
    rewardPoints: 120,
  });
};

// Collector Dashboard
exports.collectorDashboard = async (req, res) => {
  res.json({
    message: "Collector Dashboard Data",
    assignedPickups: 4,
    completedPickups: 10,
    earnings: "Rs 4500",
  });
};

// Admin Dashboard
exports.adminDashboard = async (req, res) => {
  const totalUsers = await User.countDocuments();
  res.json({
    message: "Admin Dashboard Data",
    totalUsers,
    totalWasteCollected: 1250,
    activePickups: 8,
  });
};

