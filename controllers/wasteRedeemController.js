// controllers/wasteRedeemController.js
const mongoose = require("mongoose");
const User = (() => { try { return require("../models/User"); } catch (e) { return mongoose.models?.User || null; } })();
const Redemption = (() => { try { return require("../models/Redemption"); } catch (e) { return mongoose.models?.Redemption || null; } })();
const notificationService = (() => {
  try { return require("../services/notificationService"); } catch (e) { return null; }
})();

const REWARDS = [
  { id: "meal", title: "Free Meal", cost: 100 },
  { id: "helmet", title: "Free Helmet", cost: 500 },
  { id: "voucher100", title: "₹100 Voucher", cost: 120 },
];

function findReward(rewardId) {
  return REWARDS.find((r) => r.id === String(rewardId));
}

exports.redeem = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    const { rewardId, cost: clientCost } = req.body || {};
    if (!rewardId) return res.status(400).json({ message: "Missing rewardId" });

    const reward = findReward(rewardId);
    if (!reward) return res.status(400).json({ message: "Unknown reward" });

    // Use server-side cost (ignore clientCost)
    const cost = reward.cost;

    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, points: { $gte: cost } },
      { $inc: { points: -cost } },
      { new: true }
    ).select("name email points").lean();

    if (!updatedUser) {
      const exists = await User.exists({ _id: userId });
      if (!exists) return res.status(404).json({ message: "User not found" });
      return res.status(400).json({ message: "Insufficient points" });
    }

    const redemption = await Redemption.create({
      user: userId,
      rewardId: reward.id,
      title: reward.title,
      cost,
      status: "requested",
      meta: { requestedFrom: req.ip },
    });

    try {
      if (notificationService && typeof notificationService.createNotification === "function") {
        await notificationService.createNotification(userId, {
          type: "collector_redeem",
          title: `Redeemed: ${reward.title}`,
          body: `Your redemption request for ${reward.title} (${cost} pts) was received.`,
          channel: "all",
          data: { redemptionId: redemption._id, rewardId: reward.id, cost },
        });
      }
    } catch (e) {
      console.warn("notify failed after collector redeem:", e && e.message ? e.message : e);
    }

    return res.json({ ok: true, redemption, pointsLeft: updatedUser.points ?? 0, profile: updatedUser });
  } catch (err) {
    console.error("wasteRedeemController.redeem error", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Failed to redeem" });
  }
};