// controllers/rewardController.js (safer require pattern)
const mongoose = require("mongoose");
const { Types } = mongoose;
const { REWARDS: COLLECTOR_REWARDS, findReward } = require("../utils/rewards");

// tryRequire helper
function tryRequire(p) {
  try { return require(p); } catch (e) { return null; }
}

// Load models with fallbacks to mongoose.models (so missing files do not throw)
const Payment = tryRequire("../models/Payment") || mongoose.models?.Payment || null;
const Redemption = tryRequire("../models/Redemption") || mongoose.models?.Redemption || null;
const User = tryRequire("../models/User") || mongoose.models?.User || null;
const Pickup = tryRequire("../models/Pickup") || mongoose.models?.Pickup || null;

// policy defaults — override from pointsController if present
let POINTS_PER_PICKUP_COLLECTOR = Number(process.env.POINTS_PER_PICKUP_COLLECTOR ?? 10);
let POINTS_PER_KG_COLLECTOR = process.env.POINTS_PER_KG_COLLECTOR ? Number(process.env.POINTS_PER_KG_COLLECTOR) : null;
let POINTS_PER_PICKUP_USER = Number(process.env.POINTS_PER_PICKUP_USER ?? 0);
let POINTS_PER_KG_USER = process.env.POINTS_PER_KG_USER ? Number(process.env.POINTS_PER_KG_USER) : null;
try {
  const pointsCtrl = tryRequire("./pointsController");
  if (pointsCtrl) {
    POINTS_PER_PICKUP_COLLECTOR = pointsCtrl.POINTS_PER_PICKUP_COLLECTOR ?? POINTS_PER_PICKUP_COLLECTOR;
    POINTS_PER_KG_COLLECTOR = pointsCtrl.POINTS_PER_KG_COLLECTOR ?? POINTS_PER_KG_COLLECTOR;
    POINTS_PER_PICKUP_USER = pointsCtrl.POINTS_PER_PICKUP_USER ?? POINTS_PER_PICKUP_USER;
    POINTS_PER_KG_USER = pointsCtrl.POINTS_PER_KG_USER ?? POINTS_PER_KG_USER;
  }
} catch (e) { /* ignore */ }

/* Server-side user/collector reward definitions (kept local) */
const USER_REWARDS = [
  { id: "v100", title: "Rs 100 Voucher", cost: 100, description: "Redeemable at partner stores" },
  { id: "pickup", title: "Free Pickup", cost: 200, description: "One free scheduled pickup" },
  { id: "discount", title: "5% Off", cost: 50, description: "Discount on next order" },
];

const COLLECTOR_REWARDS_LOCAL = COLLECTOR_REWARDS || [
  { id: "meal", title: "Free Meal", cost: 100, description: "Meal voucher for collectors" },
  { id: "helmet", title: "Free Helmet", cost: 500, description: "Safety helmet (admin-approved)" },
  { id: "voucher100", title: "₹100 Voucher", cost: 120, description: "Gift voucher worth ₹100" },
];

function findUserReward(id) {
  return USER_REWARDS.find((r) => String(r.id) === String(id));
}
function findCollectorReward(id) {
  // prefer utils/rewards if available
  return (typeof findReward === "function" && findReward(id)) || COLLECTOR_REWARDS_LOCAL.find((r) => String(r.id) === String(id));
}

/* -------------------- Catalog -------------------- */
exports.getCatalog = async (req, res) => {
  try {
    const policy = {
      collector: {
        pointsPerPickup: POINTS_PER_PICKUP_COLLECTOR,
        pointsPerKg: POINTS_PER_KG_COLLECTOR,
      },
      user: {
        pointsPerPickup: POINTS_PER_PICKUP_USER,
        pointsPerKg: POINTS_PER_KG_USER,
      },
    };
    return res.json({ user: USER_REWARDS, collector: COLLECTOR_REWARDS_LOCAL, policy });
  } catch (err) {
    console.error("rewardController.getCatalog error:", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to load catalog" });
  }
};

/* -------------------- User redeem -------------------- */
exports.redeemUser = async (req, res) => {
  try {
    if (!User) return res.status(500).json({ message: "User model not available on server" });

    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    const { rewardId, meta } = req.body || {};
    if (!rewardId) return res.status(400).json({ message: "Missing rewardId" });

    const reward = findUserReward(rewardId);
    if (!reward) return res.status(400).json({ message: "Unknown reward" });

    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, points: { $gte: reward.cost } },
      { $inc: { points: -reward.cost } },
      { new: true }
    ).select("name email points").lean();

    if (!updatedUser) {
      const exists = await User.exists({ _id: userId });
      if (!exists) return res.status(404).json({ message: "User not found" });
      return res.status(400).json({ message: "Insufficient points" });
    }

    if (!Redemption) {
      // create fallback info if Redemption model missing
      return res.json({ ok: true, redemption: null, profile: updatedUser, pointsLeft: updatedUser.points ?? 0 });
    }

    const redemption = await Redemption.create({
      user: userId,
      rewardId: reward.id,
      title: reward.title,
      cost: reward.cost,
      status: "requested",
      meta: { requestedFrom: req.ip, clientData: meta ?? {} },
    });

    return res.json({ ok: true, redemption, profile: updatedUser, pointsLeft: updatedUser.points ?? 0 });
  } catch (err) {
    console.error("rewardController.redeemUser error:", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to redeem" });
  }
};

/* -------------------- Collector earnings -------------------- */
exports.getEarnings = async (req, res) => {
  try {
    if (!User) return res.status(500).json({ message: "User model not available on server" });

    const userId = req.user?._id || req.user?.id || req.userId;
    if (!userId) return res.status(401).json({ message: "Unauthenticated" });

    const objId = Types.ObjectId(String(userId));
    const { from, to, limit } = req.query;

    const paymentQuery = { $or: [{ collectorId: objId }, { user: objId }] };
    if (from || to) {
      paymentQuery.date = {};
      if (from) paymentQuery.date.$gte = new Date(String(from));
      if (to) {
        const t = new Date(String(to));
        t.setHours(23, 59, 59, 999);
        paymentQuery.date.$lte = t;
      }
    }

    const payments = Payment ? await Payment.find(paymentQuery).sort({ date: -1 }).limit(Number(limit) || 200).lean() : [];

    let totalPickups = 0;
    try {
      if (Pickup && typeof Pickup.countDocuments === "function") {
        totalPickups = await Pickup.countDocuments({
          collectorId: objId,
          status: "completed"
        });
      }
    } catch (err) {
      console.warn("Pickup count failed:", err && (err.stack || err.message));
      totalPickups = 0;
    }

    const freshUser = await User.findById(objId).lean();
    const totalPoints = typeof freshUser?.points === "number"
      ? freshUser.points
      : payments.reduce((s, p) => s + (p.amount || 0), 0);

    return res.json({ totalPickups, totalPoints, payments });
  } catch (err) {
    console.error("rewardController.getEarnings error:", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to load earnings" });
  }
};

/* -------------------- Collector redeem -------------------- */
exports.redeemCollector = async (req, res) => {
  try {
    if (!User) return res.status(500).json({ message: "User model not available on server" });

    const collectorId = req.user?.id || req.user?._id;
    if (!collectorId) return res.status(401).json({ message: "Not authenticated" });

    const { rewardId, meta } = req.body || {};
    if (!rewardId) return res.status(400).json({ message: "Missing rewardId" });

    const reward = findCollectorReward(rewardId);
    if (!reward) return res.status(400).json({ message: "Unknown collector reward" });

    const updatedCollector = await User.findOneAndUpdate(
      { _id: collectorId, points: { $gte: reward.cost } },
      { $inc: { points: -reward.cost } },
      { new: true }
    ).select("name email points").lean();

    if (!updatedCollector) {
      const exists = await User.exists({ _id: collectorId });
      if (!exists) return res.status(404).json({ message: "Collector not found" });
      return res.status(400).json({ message: "Insufficient collector points" });
    }

    let redemption = null;
    if (Redemption) {
      redemption = await Redemption.create({
        collector: collectorId,
        rewardId: reward.id,
        title: reward.title,
        cost: reward.cost,
        status: "requested",
        meta: { requestedFrom: req.ip, clientData: meta ?? {} },
      });
    }

    let paymentEntry = null;
    if (Payment) {
      try {
        paymentEntry = await Payment.create({
          collectorId: collectorId,
          user: collectorId,
          amount: -reward.cost,
          date: new Date(),
          method: "redeem",
          note: `Redeemed ${reward.title}`,
        });
      } catch (payErr) {
        console.warn("Payment create failed:", payErr && (payErr.stack || payErr.message));
      }
    }

    return res.json({ ok: true, redemption, paymentEntry, pointsLeft: updatedCollector.points ?? 0 });
  } catch (err) {
    console.error("rewardController.redeemCollector error:", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to process collector redemption" });
  }
};