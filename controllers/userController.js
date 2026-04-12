// controllers/userController.js
const mongoose = require("mongoose");
const User = require("../models/User");
const WastePost = require("../models/WastePost");

/**
 * Helper: try to coerce id to ObjectId when possible
 */
function toObjectIdMaybe(v) {
  try {
    return mongoose.Types.ObjectId(String(v));
  } catch {
    return v;
  }
}

/**
 * GET /api/users/profile
 * - Protected: expects auth middleware to set req.user (Mongoose doc or plain object)
 * - Returns safe profile fields + aggregates:
 *   - totalEarnings (collector)
 *   - rewards (kept for backward compatibility -> same as totalEarnings)
 *   - assignedCount (collector)
 *   - completedThisMonth (collector)
 *   - kgCollected (collector)
 *   - postCount (user)
 */
exports.getProfile = async (req, res) => {
  try {
    const provided = req.user;
    if (!provided) return res.status(404).json({ message: "User not found" });

    // Normalize to plain object and remove sensitive fields
    let u;
    try {
      if (typeof provided.toObject === "function") {
        u = provided.toObject();
      } else {
        u = { ...provided };
      }
    } catch {
      u = { ...provided };
    }
    if (u.password) delete u.password;

    const userId = toObjectIdMaybe(u._id ?? u.id);
    if (!userId) return res.status(400).json({ message: "Invalid user id" });

    // Defaults
    let totalEarnings = 0;
    let assignedCount = 0;
    let completedThisMonth = 0;
    let kgCollected = 0;
    let postCount = 0;

    // Always compute postCount (posts created by this user)
    const postCountP = WastePost.countDocuments({ user: userId });

    if (String(u.role) === "collector") {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Match completed posts for this collector
      const completedMatch = {
        collector: userId,
        status: { $in: ["Collected", "Completed"] },
      };

      // Earnings aggregation: sum price (fallback to 0)
      const earningsAggP = WastePost.aggregate([
        { $match: completedMatch },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$price", 0] } } } },
      ]).exec();

      // kg collected aggregation: sum quantity
      const kgAggP = WastePost.aggregate([
        { $match: completedMatch },
        { $group: { _id: null, kg: { $sum: { $ifNull: ["$quantity", 0] } } } },
      ]).exec();

      // assignedCount: pickups assigned/in-progress (adjust statuses as needed)
      const assignedCountP = WastePost.countDocuments({
        collector: userId,
        status: { $in: ["Scheduled", "Picked", "Pending"] },
      }).exec();

      // completedThisMonth: completed posts since startOfMonth
      const completedThisMonthP = WastePost.countDocuments({
        collector: userId,
        status: { $in: ["Collected", "Completed"] },
        completedAt: { $gte: startOfMonth },
      }).exec();

      // Run in parallel
      const [earningsAgg, kgAgg, assignedCt, completedMonth, postCt] = await Promise.all([
        earningsAggP,
        kgAggP,
        assignedCountP,
        completedThisMonthP,
        postCountP,
      ]);

      totalEarnings = (earningsAgg && earningsAgg[0] && earningsAgg[0].total) ? earningsAgg[0].total : 0;
      kgCollected = (kgAgg && kgAgg[0] && kgAgg[0].kg) ? kgAgg[0].kg : 0;
      assignedCount = assignedCt ?? 0;
      completedThisMonth = completedMonth ?? 0;
      postCount = postCt ?? 0;
    } else {
      // Non-collector: compute only postCount
      postCount = await postCountP;
    }

    // Build response profile (safe) and include rewards for backward compatibility
    const profile = {
      id: u._id ?? u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      points: u.points ?? 0,
      isApproved: u.isApproved ?? false,
      createdAt: u.createdAt,
      avatarUrl: u.avatarUrl ?? u.avatar ?? null,

      // aggregates
      totalEarnings,
      // keep backward compatibility: expose earnings also under `rewards`
      rewards: totalEarnings ?? (u.rewards ?? 0),

      assignedCount,
      completedThisMonth,
      kgCollected,
      postCount,
    };

    return res.json(profile);
  } catch (err) {
    console.error("getProfile error:", err && (err.stack || err.message));
    return res.status(500).json({ message: "Server error" });
  }
};