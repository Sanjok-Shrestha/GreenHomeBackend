// controllers/pointsController.js
const mongoose = require("mongoose");
const Payment = require("../models/Payment");

// ─────────────────────────────────────
// Safe model loaders with fallbacks
// ─────────────────────────────────────
const User = (() => {
  try { return require("../models/User"); }
  catch (e) { return mongoose.models?.User || null; }
})();

const WastePost = (() => {
  try { return require("../models/WastePost"); }
  catch (e) { return mongoose.models?.WastePost || null; }
})();

// ─────────────────────────────────────
// Config (use .env to override)
// ─────────────────────────────────────
const POINTS_PER_PICKUP_COLLECTOR = Number(process.env.POINTS_PER_PICKUP_COLLECTOR ?? 10);
const POINTS_PER_KG_COLLECTOR = process.env.POINTS_PER_KG_COLLECTOR
  ? Number(process.env.POINTS_PER_KG_COLLECTOR)
  : null;

// FIX: Default to 10, not 0
const POINTS_PER_PICKUP_USER = Number(process.env.POINTS_PER_PICKUP_USER ?? 10);
const POINTS_PER_KG_USER = process.env.POINTS_PER_KG_USER
  ? Number(process.env.POINTS_PER_KG_USER)
  : null;

// ─────────────────────────────────────
// Compute points for a pickup
// ─────────────────────────────────────
function computePointsForPickup(pickup, perPickup, perKg) {
  if (perKg && typeof pickup.quantity === "number" && pickup.quantity > 0) {
    return Math.max(0, Math.round(pickup.quantity * perKg));
  }
  return Math.max(0, Math.round(perPickup || 0));
}

// ─────────────────────────────────────
// MAIN FUNCTION: Award points after pickup is completed & approved
// Call this from pickupController.approveCompletion or updateStatus
// ─────────────────────────────────────
async function awardPointsForPickup(pickup, options = {}) {
  //  FIX: Log function call at very start for debugging
  console.log(`[awardPoints] 🚀 FUNCTION CALLED for waste=${pickup?._id}`, {
    hasPickup: !!pickup,
    options: { awardToCollector: options.awardToCollector, awardToUser: options.awardToUser }
  });

  //  FIX: Default awardToUser to true (household users get points by default)
  const awardToCollector = options.awardToCollector !== false; // default: true
  const awardToUser = options.awardToUser !== false;           //  FIXED: was === true (default false)

  // Validate input
  if (!pickup || !pickup._id) {
    console.error("[awardPoints]  Missing pickup or _id");
    return { awardedCollector: 0, awardedUser: 0, errors: { general: new Error("Missing pickup") } };
  }

  // Debug log at start
  console.log(`[awardPoints] ▶ START waste=${pickup._id}`, {
    status: pickup.status,
    pointsAwarded: pickup.pointsAwarded,
    userId: pickup.user?.toString?.() || pickup.user,
    collectorId: (pickup.collector || pickup.collectorId)?.toString?.() || pickup.collector,
    quantity: pickup.quantity,
    awardToUser,
    awardToCollector
  });

  // IMPORTANT: Prevent duplicate awards using the pointsAwarded flag
  if (pickup.pointsAwarded === true) {
    console.log(`[awardPoints] ⏭ SKIP waste=${pickup._id}: already awarded`);
    return { awardedCollector: 0, awardedUser: 0, skipped: true };
  }

  // Normalize ID fields (handle different naming conventions)
  const collectorId = pickup.collectorId || pickup.assignedTo || pickup.collector;
  const userId = pickup.user || pickup.requester || pickup.requesterId;

  const result = { awardedCollector: 0, awardedUser: 0, errors: {} };

  // Calculate points for each role
  const pointsCollector = awardToCollector
    ? computePointsForPickup(pickup, POINTS_PER_PICKUP_COLLECTOR, POINTS_PER_KG_COLLECTOR)
    : 0;

  const pointsUser = awardToUser
    ? computePointsForPickup(pickup, POINTS_PER_PICKUP_USER, POINTS_PER_KG_USER)
    : 0;

  console.log(`[awardPoints] Computed points: user=${pointsUser}, collector=${pointsCollector}`);

  // Early exit if nothing to award
  if ((pointsCollector <= 0 || !collectorId) && (pointsUser <= 0 || !userId)) {
    console.log(`[awardPoints] ⏭ SKIP waste=${pickup._id}: no points to award or missing IDs`);
    return result;
  }

  let session = null;

  try {
    // Start MongoDB transaction if supported
    if (typeof mongoose.startSession === "function") {
      session = await mongoose.startSession();
      session.startTransaction();
      console.log(`[awardPoints]  Started transaction for waste=${pickup._id}`);
    }

    const operations = [];

    // ─────────────────────────────────────
    // Award points to COLLECTOR
    // ─────────────────────────────────────
    if (pointsCollector > 0 && collectorId) {
      console.log(`[awardPoints]  Collector ${collectorId}: +${pointsCollector} pts`);
      
      // Increment user points
      operations.push(
        User.findByIdAndUpdate(
          collectorId,
          { $inc: { points: pointsCollector } },
          { session, new: false }
        )
      );

      // Create payment audit log
      if (Payment && typeof Payment.create === "function") {
        operations.push(
          Payment.create([{
            collectorId,
            user: collectorId,
            amount: pointsCollector,
            date: new Date(),
            method: "points-award",
            note: `Awarded ${pointsCollector} pts for pickup ${pickup._id}`,
            pickup: pickup._id
          }], { session })
        );
      }

      result.awardedCollector = pointsCollector;
    }

    // ─────────────────────────────────────
    // Award points to USER (household) -  THIS IS WHAT WAS MISSING!
    // ─────────────────────────────────────
    if (pointsUser > 0 && userId) {
      console.log(`[awardPoints]  User ${userId}: +${pointsUser} pts`);
      
      // Increment user points
      operations.push(
        User.findByIdAndUpdate(
          userId,
          { $inc: { points: pointsUser } },
          { session, new: false }
        )
      );

      // Create payment audit log
      if (Payment && typeof Payment.create === "function") {
        operations.push(
          Payment.create([{
            user: userId,
            amount: pointsUser,
            date: new Date(),
            method: "points-award",
            note: `Awarded ${pointsUser} pts for pickup ${pickup._id}`,
            pickup: pickup._id
          }], { session })
        );
      }

      result.awardedUser = pointsUser;
    }

    // Execute all operations in parallel within transaction
    if (operations.length > 0) {
      console.log(`[awardPoints]  Executing ${operations.length} operations...`);
      await Promise.all(operations);
      console.log(`[awardPoints]  Operations completed`);
    }

    // ─────────────────────────────────────
    // Mark pickup as points-awarded (CRITICAL)
    // ─────────────────────────────────────
    try {
      if (WastePost) {
        // Prefer schema method if available (participates in transaction)
        if (typeof WastePost.findById === "function") {
          const wasteDoc = await WastePost.findById(pickup._id).session(session);
          if (wasteDoc) {
            if (typeof wasteDoc.markPointsAwarded === "function") {
              // Use schema instance method (recommended)
              await wasteDoc.markPointsAwarded(session);
              console.log(`[awardPoints] Marked waste=${pickup._id} via schema method`);
            } else {
              // Fallback: direct update
              await WastePost.findByIdAndUpdate(
                pickup._id,
                { $set: { pointsAwarded: true } },
                { session }
              );
              console.log(`[awardPoints]  Marked waste=${pickup._id} via direct update`);
            }
          }
        }
      } else {
        console.warn(`[awardPoints] WastePost model not available - flag not saved`);
      }
    } catch (flagErr) {
      // Don't fail the whole transaction for flag update - points were already awarded
      console.warn(`[awardPoints]  Could not mark pointsAwarded for waste=${pickup._id}:`, flagErr.message);
      result.errors.flagUpdate = flagErr;
    }

    // Commit transaction
    if (session) {
      await session.commitTransaction();
      console.log(`[awardPoints]  Transaction committed for waste=${pickup._id}`);
    }

    console.log(`[awardPoints] ◀ END waste=${pickup._id} ✓`, result);
    return result;

  } catch (err) {
    // Rollback on error
    if (session) {
      try {
        await session.abortTransaction();
        console.log(`[awardPoints]  Transaction aborted for waste=${pickup._id}`);
      } catch (abortErr) {
        console.error(`[awardPoints]  Abort failed:`, abortErr.message);
      } finally {
        session.endSession();
      }
    }

    console.error(`[awardPoints]  ERROR waste=${pickup._id}:`, err.stack || err.message);
    result.errors.general = err;
    return result;
  }
}

// ─────────────────────────────────────
// Export public API
// ─────────────────────────────────────
module.exports = {
  awardPointsForPickup,
  computePointsForPickup,
  // Export config for testing/debugging
  POINTS_PER_PICKUP_COLLECTOR,
  POINTS_PER_KG_COLLECTOR,
  POINTS_PER_PICKUP_USER,
  POINTS_PER_KG_USER
};