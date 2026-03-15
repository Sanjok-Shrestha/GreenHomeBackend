const mongoose = require("mongoose");
const User = require("../models/User");
const RewardRedemption = require("../models/RewardRedemption"); // optional tracking model

// POST /api/rewards/redeem
// Body: { rewardId: string }
// Simple redeem flow:
// - Ensure authenticated user (req.user provided by auth middleware)
// - Validate rewardId (map to a cost in server-side catalog, do NOT trust client)
// - Check user.points >= cost
// - Deduct points, persist user
// - Create a small redemption record for audit (optional)
// - Return updated profile (user) so frontend can update state
const SERVER_CATALOG = {
  v100: { title: "Rs100 Voucher", cost: 100 },
  pickup: { title: "Free Pickup", cost: 200 },
  discount: { title: "5% Off", cost: 50 },
};

exports.redeemReward = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    const { rewardId } = req.body || {};
    if (!rewardId || typeof rewardId !== "string") {
      return res.status(400).json({ message: "Missing rewardId" });
    }

    const catalogItem = SERVER_CATALOG[rewardId];
    if (!catalogItem) return res.status(400).json({ message: "Unknown reward" });

    // Transaction (best-effort) so we don't accidentally overdraft points
    session.startTransaction();
    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ message: "User not found" });
    }

    const currentPoints = Number(user.points || 0);
    if (currentPoints < catalogItem.cost) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Insufficient points" });
    }

    // Deduct
    user.points = currentPoints - catalogItem.cost;
    await user.save({ session });

    // Record redemption for audit (optional)
    let redemption = null;
    try {
      redemption = await RewardRedemption.create(
        [
          {
            user: user._id,
            rewardId,
            title: catalogItem.title,
            cost: catalogItem.cost,
            redeemedAt: new Date(),
          },
        ],
        { session }
      );
      // RewardRedemption.create returns an array when passed array; take first
      redemption = Array.isArray(redemption) ? redemption[0] : redemption;
    } catch (e) {
      // non-fatal: if tracking table doesn't exist, don't fail the redeem
      console.warn("reward redemption logging failed:", e?.message ?? e);
    }

    await session.commitTransaction();
    session.endSession();

    // Return updated profile (avoid returning sensitive fields)
    const safeProfile = {
      id: user._id,
      name: user.name,
      email: user.email,
      points: user.points,
      role: user.role,
    };

    return res.json({ success: true, profile: safeProfile, redemption });
  } catch (err) {
    await session.abortTransaction().catch(() => {});
    session.endSession();
    console.error("redeemReward error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Failed to redeem reward", detail: err?.message });
  }
};