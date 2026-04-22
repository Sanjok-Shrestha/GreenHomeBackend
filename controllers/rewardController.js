// controllers/rewardController.js
const mongoose = require("mongoose");
const { Types } = mongoose;

// ─────────────────────────────────────
// Helper: Safe module requiring
// ─────────────────────────────────────
function tryRequire(p) {
  try { return require(p); } catch (e) { return null; }
}

// ─────────────────────────────────────
// Load rewards config from utils (fallback to empty)
// ─────────────────────────────────────
const utilsRewards = tryRequire("../utils/rewards") || tryRequire("../../utils/rewards") || null;
const COLLECTOR_REWARDS = Array.isArray(utilsRewards?.REWARDS) ? utilsRewards.REWARDS : [];
const findReward = typeof utilsRewards?.findReward === "function" ? utilsRewards.findReward : null;

// ─────────────────────────────────────
// Load models with safe fallbacks
// ─────────────────────────────────────
const Payment = tryRequire("../models/Payment") || mongoose.models?.Payment || null;
const Redemption = tryRequire("../models/Redemption") || mongoose.models?.Redemption || null;
const User = tryRequire("../models/User") || mongoose.models?.User || null;
const Pickup = tryRequire("../models/Pickup") || mongoose.models?.Pickup || null;

// ─────────────────────────────────────
// Points Configuration (sync with pointsController.js)
// Use .env to override; fallback to sensible defaults
// ─────────────────────────────────────
const POINTS_PER_PICKUP_COLLECTOR = Number(process.env.POINTS_PER_PICKUP_COLLECTOR ?? 10);
const POINTS_PER_PICKUP_USER = Number(process.env.POINTS_PER_PICKUP_USER ?? 10);
const POINTS_PER_KG_COLLECTOR = process.env.POINTS_PER_KG_COLLECTOR
  ? Number(process.env.POINTS_PER_KG_COLLECTOR)
  : null;
const POINTS_PER_KG_USER = process.env.POINTS_PER_KG_USER
  ? Number(process.env.POINTS_PER_KG_USER)
  : null;

// ─────────────────────────────────────
// User Rewards Catalog (static fallback)
// ─────────────────────────────────────
const USER_REWARDS = [
  { id: "v100", title: "Rs 100 Voucher", cost: 100, description: "Redeemable at partner stores" },
  { id: "pickup", title: "Free Pickup", cost: 200, description: "One free scheduled pickup" },
  { id: "discount", title: "5% Off", cost: 50, description: "Discount on next order" },
];

function findUserReward(id) { 
  return USER_REWARDS.find(r => String(r.id) === String(id)); 
}

function findCollectorReward(id) {
  if (typeof findReward === "function") {
    const r = findReward(id);
    if (r) return r;
  }
  return COLLECTOR_REWARDS.find((r) => String(r.id) === String(id));
}

// ─────────────────────────────────────
// Admin guard helper
// ─────────────────────────────────────
function adminGuard(req) {
  if (!req.user) return { ok: false, status: 401, message: "Not authenticated" };
  const role = String(req.user.role || "").toLowerCase();
  if (role !== "admin") return { ok: false, status: 403, message: "Forbidden" };
  return { ok: true };
}

// ─────────────────────────────────────
// Helper: Get user ID from request (consistent handling)
// ─────────────────────────────────────
function getUserId(req) {
  return req.user?.id || req.user?._id || req.userId;
}

// ─────────────────────────────────────
// GET /rewards/catalog - Return rewards + policy + user points
// ─────────────────────────────────────
exports.getCatalog = async (req, res) => {
  try {
    // Debug: Log auth state
    console.log('[getCatalog] req.user:', req.user ? { 
      id: getUserId(req), 
      role: req.user.role 
    } : 'MISSING');

    // Build policy object for frontend
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

    // Fetch user's current points (if authenticated)
    let userProfile = null;
    if (User && req.user) {
      const userId = getUserId(req);
      console.log(`[getCatalog] Fetching profile for user: ${userId}`);
      
      userProfile = await User.findById(userId).select('points name email role').lean();
      console.log(`[getCatalog] userProfile result:`, userProfile 
        ? { points: userProfile.points, name: userProfile.name } 
        : 'NOT FOUND');
    }

    //  FIX: Return 0 instead of null for userPoints
    const userPoints = userProfile?.points ?? 0;

    return res.json({
      user: USER_REWARDS,
      collector: COLLECTOR_REWARDS,
      policy,
      userPoints, // ← Now always a number, never null
      // Optional: include user info for debugging (remove in prod)
      // debug: { hasUser: !!User, hasProfile: !!userProfile }
    });
  } catch (err) {
    console.error("rewardController.getCatalog error:", err?.stack || err?.message || err);
    return res.status(500).json({ 
      message: "Failed to load catalog",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─────────────────────────────────────
// POST /rewards/redeem - User redeems a reward
// ─────────────────────────────────────
exports.redeemUser = async (req, res) => {
  try {
    if (!User) {
      console.error('[redeemUser] User model not available');
      return res.status(500).json({ message: "User model not available on server" });
    }

    const userId = getUserId(req);
    if (!userId) {
      console.warn('[redeemUser] Unauthenticated request');
      return res.status(401).json({ message: "Not authenticated" });
    }

    const { rewardId, meta } = req.body || {};
    if (!rewardId) {
      return res.status(400).json({ message: "Missing rewardId" });
    }

    const reward = findUserReward(rewardId);
    if (!reward) {
      console.warn(`[redeemUser] Unknown reward requested: ${rewardId}`);
      return res.status(400).json({ message: "Unknown reward" });
    }

    console.log(`[redeemUser] User ${userId} redeeming ${reward.title} (${reward.cost} pts)`);

    // Atomically deduct points only if user has enough
    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, points: { $gte: reward.cost } },
      { $inc: { points: -reward.cost } },
      { new: true, runValidators: true }
    ).select("name email points role").lean();

    if (!updatedUser) {
      const exists = await User.exists({ _id: userId });
      if (!exists) {
        console.warn(`[redeemUser] User ${userId} not found`);
        return res.status(404).json({ message: "User not found" });
      }
      console.warn(`[redeemUser] User ${userId} has insufficient points for ${reward.title}`);
      return res.status(400).json({ message: "Insufficient points" });
    }

    console.log(`[redeemUser] ✓ Points deducted. Remaining: ${updatedUser.points}`);

    // If Redemption model unavailable, return success without record
    if (!Redemption) {
      console.warn('[redeemUser] Redemption model not available - skipping DB record');
      return res.json({ 
        ok: true, 
        redemption: null, 
        profile: updatedUser, 
        pointsLeft: updatedUser.points ?? 0 
      });
    }

    // Create redemption record
    const redemption = await Redemption.create({
      user: userId,
      rewardId: reward.id,
      title: reward.title,
      cost: reward.cost,
      status: "requested",
      meta: { 
        requestedFrom: req.ip, 
        clientData: meta ?? {},
        userAgent: req.get('User-Agent')
      },
    });

    console.log(`[redeemUser] Redemption record created: ${redemption._id}`);

    return res.json({ 
      ok: true, 
      redemption, 
      profile: updatedUser, 
      pointsLeft: updatedUser.points ?? 0 
    });
  } catch (err) {
    console.error("rewardController.redeemUser error:", err?.stack || err?.message || err);
    return res.status(500).json({ 
      message: "Failed to redeem",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─────────────────────────────────────
// GET /waste/collector/earnings - Collector views earnings
// ─────────────────────────────────────
exports.getEarnings = async (req, res) => {
  try {
    if (!User) {
      console.error('[getEarnings] User model not available');
      return res.status(500).json({ message: "User model not available on server" });
    }

    const userId = getUserId(req);
    if (!userId) {
      console.warn('[getEarnings] Unauthenticated request');
      return res.status(401).json({ message: "Unauthenticated" });
    }

    const objId = Types.ObjectId(String(userId));
    const { from, to, limit } = req.query;

    // Build payment query
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

    // Fetch payments
    const payments = Payment
      ? await Payment.find(paymentQuery).sort({ date: -1 }).limit(Number(limit) || 200).lean()
      : [];

    // Count completed pickups (fallback if Pickup model missing)
    let totalPickups = 0;
    try {
      if (Pickup && typeof Pickup.countDocuments === "function") {
        totalPickups = await Pickup.countDocuments({
          $or: [{ collectorId: objId }, { collector: objId }],
          status: { $in: ["completed", "Completed", "COMPLETED"] },
        });
      }
    } catch (err) {
      console.warn("Pickup count failed:", err?.stack || err?.message);
      totalPickups = 0;
    }

    // Fetch fresh user data for accurate points
    const freshUser = await User.findById(objId).select("points name email role").lean();
    const totalPoints = Number(freshUser?.points ?? 0);

    console.log(`[getEarnings] Collector ${userId}: ${totalPickups} pickups, ${totalPoints} points`);

    return res.json({ 
      totalPickups, 
      totalPoints, 
      payments,
      // Optional debug info
      // debug: { paymentCount: payments.length, hasPaymentModel: !!Payment }
    });
  } catch (err) {
    console.error("rewardController.getEarnings error:", err?.stack || err?.message || err);
    return res.status(500).json({ 
      message: "Failed to load earnings",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─────────────────────────────────────
// POST /waste/collector/redeem - Collector redeems reward
// ─────────────────────────────────────
exports.redeemCollector = async (req, res) => {
  try {
    if (!User) {
      console.error('[redeemCollector] User model not available');
      return res.status(500).json({ message: "User model not available on server" });
    }

    const collectorId = getUserId(req);
    if (!collectorId) {
      console.warn('[redeemCollector] Unauthenticated request');
      return res.status(401).json({ message: "Not authenticated" });
    }

    const { rewardId, meta } = req.body || {};
    if (!rewardId) {
      return res.status(400).json({ message: "Missing rewardId" });
    }

    const reward = findCollectorReward(rewardId);
    if (!reward) {
      console.warn(`[redeemCollector] Unknown collector reward: ${rewardId}`);
      return res.status(400).json({ message: "Unknown collector reward" });
    }

    console.log(`[redeemCollector] Collector ${collectorId} redeeming ${reward.title} (${reward.cost} pts)`);

    // Atomically deduct points
    const updatedCollector = await User.findOneAndUpdate(
      { _id: collectorId, points: { $gte: reward.cost } },
      { $inc: { points: -reward.cost } },
      { new: true, runValidators: true }
    ).select("name email points role").lean();

    if (!updatedCollector) {
      const exists = await User.exists({ _id: collectorId });
      if (!exists) {
        console.warn(`[redeemCollector] Collector ${collectorId} not found`);
        return res.status(404).json({ message: "Collector not found" });
      }
      console.warn(`[redeemCollector] Insufficient points for ${reward.title}`);
      return res.status(400).json({ message: "Insufficient collector points" });
    }

    console.log(`[redeemCollector]Points deducted. Remaining: ${updatedCollector.points}`);

    // Create redemption record (optional)
    let redemption = null;
    if (Redemption) {
      redemption = await Redemption.create({
        collector: collectorId,
        rewardId: reward.id,
        title: reward.title,
        cost: reward.cost,
        status: "requested",
        meta: { 
          requestedFrom: req.ip, 
          clientData: meta ?? {},
          userAgent: req.get('User-Agent')
        },
      });
      console.log(`[redeemCollector]  Redemption record: ${redemption._id}`);
    }

    // Create payment audit entry (optional)
    let paymentEntry = null;
    if (Payment) {
      try {
        paymentEntry = await Payment.create({
          collectorId: collectorId,
          user: collectorId,
          amount: -reward.cost, // negative = deduction
          date: new Date(),
          method: "redeem",
          note: `Redeemed ${reward.title}`,
          redemption: redemption?._id
        });
      } catch (payErr) {
        console.warn("Payment create failed (non-fatal):", payErr?.message);
      }
    }

    return res.json({ 
      ok: true, 
      redemption, 
      paymentEntry, 
      pointsLeft: updatedCollector.points ?? 0 
    });
  } catch (err) {
    console.error("rewardController.redeemCollector error:", err?.stack || err?.message || err);
    return res.status(500).json({ 
      message: "Failed to process collector redemption",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─────────────────────────────────────
// POST /rewards/use - User consumes a redeemed reward
// ─────────────────────────────────────
exports.useReward = async (req, res) => {
  try {
    if (!User) {
      console.error('[useReward] User model not available');
      return res.status(500).json({ message: "User model not available on server" });
    }

    const userId = getUserId(req);
    if (!userId) {
      console.warn('[useReward] Unauthenticated request');
      return res.status(401).json({ message: "Not authenticated" });
    }

    const { rewardId, meta } = req.body || {};
    if (!rewardId) {
      return res.status(400).json({ message: "Missing rewardId" });
    }

    console.log(`[useReward] User ${userId} using reward: ${rewardId}`);

    // If Redemption model unavailable, return success without DB update
    if (!Redemption) {
      console.warn('[useReward] Redemption model not available - implicit success');
      const updatedProfile = await User.findById(userId).select("name email points role").lean();
      return res.json({
        ok: true,
        redemption: null,
        profile: updatedProfile,
        message: "Redemption model not available; reward marked as used implicitly.",
      });
    }

    // Find the most recent eligible redemption
    const redemption = await Redemption.findOne({
      user: userId,
      rewardId: String(rewardId),
      status: { $in: ["requested", "approved"] }
    }).sort({ createdAt: -1 });

    if (!redemption) {
      console.warn(`[useReward] No eligible redemption found for ${rewardId}`);
      return res.status(404).json({ 
        message: "No redeemed reward found to use. Please redeem it first." 
      });
    }

    if (String(redemption.status) === "used") {
      console.warn(`[useReward] Reward ${rewardId} already used`);
      return res.status(400).json({ message: "Reward already used" });
    }

    // Mark as used
    redemption.status = "used";
    redemption.usedAt = new Date();
    redemption.meta = {
      ...(redemption.meta || {}),
      usedFrom: req.ip,
      clientData: meta ?? {},
      userAgent: req.get('User-Agent'),
    };

    await redemption.save();
    console.log(`[useReward]  Marked redemption ${redemption._id} as used`);

    const updatedProfile = await User.findById(userId).select("name email points role").lean();
    
    return res.json({ 
      ok: true, 
      redemption, 
      profile: updatedProfile,
      message: "Reward used successfully"
    });
  } catch (err) {
    console.error("rewardController.useReward error:", err?.stack || err?.message || err);
    return res.status(500).json({ 
      message: "Failed to use reward",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─────────────────────────────────────
// GET /admin/redemptions - Admin lists all redemptions
// ─────────────────────────────────────
exports.adminListRedemptions = async (req, res) => {
  try {
    const guard = adminGuard(req);
    if (!guard.ok) return res.status(guard.status).json({ message: guard.message });
    
    if (!Redemption) {
      console.error('[adminListRedemptions] Redemption model not available');
      return res.status(500).json({ message: "Redemption model not available on server" });
    }

    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));
    const status = req.query.status ? String(req.query.status) : null;

    const query = {};
    if (status) query.status = status;

    console.log(`[adminListRedemptions] Query: status=${status || 'any'}, limit=${limit}`);

    const items = await Redemption.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("user", "name email role points")
      .populate("collector", "name email role points")
      .lean();

    console.log(`[adminListRedemptions] Found ${items.length} redemptions`);

    return res.json({ ok: true, data: items, count: items.length });
  } catch (err) {
    console.error("rewardController.adminListRedemptions error:", err?.stack || err?.message || err);
    return res.status(500).json({ 
      message: "Failed to list redemptions",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─────────────────────────────────────
// POST /admin/redemptions/:id/approve - Admin approves redemption
// ─────────────────────────────────────
exports.adminApproveRedemption = async (req, res) => {
  try {
    const guard = adminGuard(req);
    if (!guard.ok) return res.status(guard.status).json({ message: guard.message });
    
    if (!Redemption) {
      console.error('[adminApproveRedemption] Redemption model not available');
      return res.status(500).json({ message: "Redemption model not available on server" });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      console.warn(`[adminApproveRedemption] Invalid redemption ID: ${id}`);
      return res.status(400).json({ message: "Invalid redemption id" });
    }

    const redemption = await Redemption.findById(id);
    if (!redemption) {
      console.warn(`[adminApproveRedemption] Redemption not found: ${id}`);
      return res.status(404).json({ message: "Redemption not found" });
    }

    if (String(redemption.status) === "used") {
      console.warn(`[adminApproveRedemption] Cannot approve already-used redemption: ${id}`);
      return res.status(400).json({ message: "Cannot approve: already used" });
    }

    console.log(`[adminApproveRedemption] Admin ${getUserId(req)} approving redemption ${id}`);

    redemption.status = "approved";
    redemption.approvedAt = new Date();
    redemption.approvedBy = getUserId(req);
    await redemption.save();

    console.log(`[adminApproveRedemption]  Redemption ${id} approved`);

    return res.json({ ok: true, redemption });
  } catch (err) {
    console.error("rewardController.adminApproveRedemption error:", err?.stack || err?.message || err);
    return res.status(500).json({ 
      message: "Failed to approve redemption",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─────────────────────────────────────
// POST /admin/redemptions/:id/reject - Admin rejects + refunds points
// ─────────────────────────────────────
exports.adminRejectRedemption = async (req, res) => {
  try {
    const guard = adminGuard(req);
    if (!guard.ok) return res.status(guard.status).json({ message: guard.message });
    
    if (!Redemption) {
      console.error('[adminRejectRedemption] Redemption model not available');
      return res.status(500).json({ message: "Redemption model not available on server" });
    }
    if (!User) {
      console.error('[adminRejectRedemption] User model not available');
      return res.status(500).json({ message: "User model not available on server" });
    }

    const { id } = req.params;
    const reason = String(req.body?.reason || "Rejected by admin");

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      console.warn(`[adminRejectRedemption] Invalid redemption ID: ${id}`);
      return res.status(400).json({ message: "Invalid redemption id" });
    }

    const redemption = await Redemption.findById(id);
    if (!redemption) {
      console.warn(`[adminRejectRedemption] Redemption not found: ${id}`);
      return res.status(404).json({ message: "Redemption not found" });
    }

    console.log(`[adminRejectRedemption] Admin ${getUserId(req)} rejecting redemption ${id}: ${reason}`);

    // Determine who to refund
    const refundToUserId = redemption.user || redemption.collector;
    const refundCost = Number(redemption.cost || 0);

    // Update redemption status
    redemption.status = "rejected";
    redemption.rejectedAt = new Date();
    redemption.rejectedBy = getUserId(req);
    redemption.rejectReason = reason;
    await redemption.save();

    // Refund points if applicable
    let refundedProfile = null;
    if (refundToUserId && refundCost > 0) {
      console.log(`[adminRejectRedemption] Refunding ${refundCost} pts to user ${refundToUserId}`);
      
      refundedProfile = await User.findByIdAndUpdate(
        refundToUserId, 
        { $inc: { points: refundCost } }, 
        { new: true }
      ).select("name email role points").lean();
      
      console.log(`[adminRejectRedemption]  Refund complete. New balance: ${refundedProfile?.points}`);
    }

    return res.json({ 
      ok: true, 
      redemption, 
      refundedProfile,
      message: refundCost > 0 ? `Refunded ${refundCost} points` : "No points to refund"
    });
  } catch (err) {
    console.error("rewardController.adminRejectRedemption error:", err?.stack || err?.message || err);
    return res.status(500).json({ 
      message: "Failed to reject redemption",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ─────────────────────────────────────
// Export config values for testing/debugging
// ─────────────────────────────────────
module.exports = {
  getCatalog: exports.getCatalog,
  redeemUser: exports.redeemUser,
  getEarnings: exports.getEarnings,
  redeemCollector: exports.redeemCollector,
  useReward: exports.useReward,
  adminListRedemptions: exports.adminListRedemptions,
  adminApproveRedemption: exports.adminApproveRedemption,
  adminRejectRedemption: exports.adminRejectRedemption,
  // Export config for external use/testing
  CONFIG: {
    POINTS_PER_PICKUP_COLLECTOR,
    POINTS_PER_PICKUP_USER,
    POINTS_PER_KG_COLLECTOR,
    POINTS_PER_KG_USER,
  }
};