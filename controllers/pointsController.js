// controllers/pointsController.js
const mongoose = require("mongoose");
const Payment = require("../models/Payment");
const User = (() => {
  try { return require("../models/User"); }
  catch (e) { return mongoose.models?.User || null; }
})();

/**
 * Config (use .env to override)
 * - Collector: either POINTS_PER_PICKUP_COLLECTOR or POINTS_PER_KG_COLLECTOR
 * - User: either POINTS_PER_PICKUP_USER or POINTS_PER_KG_USER
 */
const POINTS_PER_PICKUP_COLLECTOR = Number(process.env.POINTS_PER_PICKUP_COLLECTOR ?? 10);
const POINTS_PER_KG_COLLECTOR     = process.env.POINTS_PER_KG_COLLECTOR ? Number(process.env.POINTS_PER_KG_COLLECTOR) : null;

const POINTS_PER_PICKUP_USER      = Number(process.env.POINTS_PER_PICKUP_USER ?? 0); // default 0 (no user award)
const POINTS_PER_KG_USER          = process.env.POINTS_PER_KG_USER ? Number(process.env.POINTS_PER_KG_USER) : null;

/**
 * Compute points given a policy and pickup doc.
 */
function computePointsForPickup(pickup, perPickup, perKg) {
  if (perKg && typeof pickup.quantity === "number") {
    return Math.max(0, Math.round((pickup.quantity || 0) * perKg));
  }
  return Math.max(0, Math.round(perPickup || 0));
}

/**
 * Award points for a completed pickup.
 * pickup: mongoose document (must contain _id, collectorId (or assignedTo), user (requester) and quantity optional)
 * options: { awardToCollector: true|false, awardToUser: true|false }
 *
 * Returns:
 * { awardedCollector: number, awardedUser: number, errors: { general?: Error } }
 */
async function awardPointsForPickup(pickup, options = {}) {
  const awardToCollector = options.awardToCollector !== false; // default true
  const awardToUser = options.awardToUser === true; // default false

  if (!pickup || !pickup._id) {
    return { awardedCollector: 0, awardedUser: 0, errors: { general: new Error("Missing pickup") } };
  }

  const collectorId = pickup.collectorId || pickup.assignedTo || pickup.collector || null;
  const userId = pickup.user || pickup.requester || pickup.requesterId || null;

  const result = { awardedCollector: 0, awardedUser: 0, errors: {} };

  // compute amounts
  const pointsCollector = awardToCollector
    ? computePointsForPickup(pickup, POINTS_PER_PICKUP_COLLECTOR, POINTS_PER_KG_COLLECTOR)
    : 0;

  const pointsUser = awardToUser
    ? computePointsForPickup(pickup, POINTS_PER_PICKUP_USER, POINTS_PER_KG_USER)
    : 0;

  // nothing to do
  if ((pointsCollector <= 0 || !collectorId) && (pointsUser <= 0 || !userId)) {
    return result;
  }

  // Try transaction when possible
  let session;
  try {
    if (typeof mongoose.startSession === "function") {
      session = await mongoose.startSession();
      session.startTransaction();
    }

    const operations = [];

    if (pointsCollector > 0 && collectorId) {
      // increment collector points on User doc
      operations.push(
        User.findByIdAndUpdate(collectorId, { $inc: { points: pointsCollector } }, { session, upsert: false })
      );

      // create Payment ledger entry for collector
      operations.push(
        Payment.create([{
          collectorId,
          user: collectorId,
          amount: pointsCollector,
          date: new Date(),
          method: "points-award",
          note: `Awarded ${pointsCollector} pts for pickup ${pickup._id} (collector)`
        }], { session })
      );
      result.awardedCollector = pointsCollector;
    }

    if (pointsUser > 0 && userId) {
      // increment user points on User doc
      operations.push(
        User.findByIdAndUpdate(userId, { $inc: { points: pointsUser } }, { session, upsert: false })
      );

      // create Payment ledger entry for user (no collectorId)
      operations.push(
        Payment.create([{
          user: userId,
          amount: pointsUser,
          date: new Date(),
          method: "points-award",
          note: `Awarded ${pointsUser} pts for pickup ${pickup._id} (user)`
        }], { session })
      );
      result.awardedUser = pointsUser;
    }

    // run ops in parallel
    await Promise.all(operations);

    if (session) await session.commitTransaction();
    if (session) session.endSession();

    return result;
  } catch (err) {
    // try aborting if session started
    try { if (session) { await session.abortTransaction(); session.endSession(); } } catch (e) {}
    console.error("awardPointsForPickup error:", err && (err.stack || err.message || err));
    // assign errors
    result.errors.general = err;
    return result;
  }
}

module.exports = {
  awardPointsForPickup,
  computePointsForPickup,
  POINTS_PER_PICKUP_COLLECTOR,
  POINTS_PER_KG_COLLECTOR,
  POINTS_PER_PICKUP_USER,
  POINTS_PER_KG_USER
};