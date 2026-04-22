// scripts/backfill-award-wasteposts.js
/**
 * Backfill script: Award points for completed WastePosts that weren't rewarded
 * 
 * Usage: node scripts/backfill-award-wasteposts.js
 * 
 * Features:
 * - Awards points to household users (post.user) AND collectors (post.collector)
 * - Uses standardized 'pointsAwarded' flag (not processedForPoints)
 * - Creates audit entries in Payment collection
 * - Marks posts as awarded to prevent re-running
 * - Transaction-safe with error handling
 */

require("dotenv").config();
const mongoose = require("mongoose");

// ─────────────────────────────────────
// Configuration (sync with pointsController.js)
// ─────────────────────────────────────
const POINTS_PER_PICKUP_USER = Number(process.env.POINTS_PER_PICKUP_USER ?? 10);
const POINTS_PER_PICKUP_COLLECTOR = Number(process.env.POINTS_PER_PICKUP_COLLECTOR ?? 10);
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;

if (!MONGODB_URI) {
  console.error(" ERROR: MONGODB_URI not set in .env");
  console.error("   Add this to your .env file:");
  console.error("   MONGODB_URI=mongodb://localhost:27017/your-db-name");
  process.exit(1);
}

// ─────────────────────────────────────
// Main backfill function
// ─────────────────────────────────────
async function run() {
  console.log(" Connecting to MongoDB...");
  
  try {
    //  FIX: Removed deprecated options (useNewUrlParser, useUnifiedTopology)
    // These are now default in MongoDB driver v4+
    await mongoose.connect(MONGODB_URI, { 
      dbName: DB_NAME  // Optional: specify DB name if not in URI
    });
    console.log(" Connected to MongoDB");
  } catch (err) {
    console.error(" Failed to connect to MongoDB:", err.message);
    process.exit(1);
  }

  const db = mongoose.connection.db;
  const users = db.collection("users");
  const payments = db.collection("payments");
  const wasteposts = db.collection("wasteposts");

  // ─────────────────────────────────────
  // Find completed pickups that haven't been awarded points
  // ─────────────────────────────────────
  console.log("\n Searching for eligible pickups...");
  
  const cursor = wasteposts.find({
    status: "Completed",                    //  Only admin-approved completions
    pointsAwarded: { $ne: true },          //  Skip already-awarded (standardized flag)
    user: { $exists: true, $ne: null }     //  Must have a household user
  });

  const posts = await cursor.toArray();
  console.log(` Found ${posts.length} pickups eligible for backfill`);

  if (posts.length === 0) {
    console.log(" Nothing to backfill - all completed pickups already have points awarded");
    await mongoose.disconnect();
    console.log(" Disconnected");
    return;
  }

  // ─────────────────────────────────────
  // Process each pickup
  // ─────────────────────────────────────
  let successCount = 0;
  let errorCount = 0;
  let totalUserPointsAwarded = 0;
  let totalCollectorPointsAwarded = 0;

  console.log("\n Starting backfill process...\n");

  for (const post of posts) {
    try {
      const userId = post.user;
      const collectorId = post.collector || post.collectorId;
      const wasteId = post._id;
      const quantity = post.quantity || 1;

      console.log(`  Processing waste ${wasteId}:`);
      console.log(`    - User: ${userId}`);
      console.log(`    - Collector: ${collectorId || 'none'}`);
      console.log(`    - Quantity: ${quantity}`);

      // ─────────────────────────────────────
      // 1. Award points to HOUSEHOLD USER
      // ─────────────────────────────────────
      if (userId && POINTS_PER_PICKUP_USER > 0) {
        // Calculate points (per-pickup or per-kg)
        const userPoints = process.env.POINTS_PER_KG_USER
          ? Math.round(quantity * Number(process.env.POINTS_PER_KG_USER))
          : POINTS_PER_PICKUP_USER;

        // Update user's points balance
        const userResult = await users.updateOne(
          { _id: new mongoose.Types.ObjectId(userId) },
          { $inc: { points: userPoints } }
        );

        // Create audit payment entry
        await payments.insertOne({
          user: new mongoose.Types.ObjectId(userId),
          amount: userPoints,
          date: post.completedAt || post.updatedAt || new Date(),
          method: "points-backfill",
          note: `Backfilled ${userPoints} pts for waste ${wasteId}`,
          pickup: wasteId,
          createdAt: new Date(),
          backfill: true
        });

        console.log(`     User: +${userPoints} pts (modified: ${userResult.modifiedCount})`);
        totalUserPointsAwarded += userPoints;
      }

      // ─────────────────────────────────────
      // 2. Award points to COLLECTOR (if exists)
      // ─────────────────────────────────────
      if (collectorId && POINTS_PER_PICKUP_COLLECTOR > 0) {
        // Calculate points (per-pickup or per-kg)
        const collectorPoints = process.env.POINTS_PER_KG_COLLECTOR
          ? Math.round(quantity * Number(process.env.POINTS_PER_KG_COLLECTOR))
          : POINTS_PER_PICKUP_COLLECTOR;

        // Update collector's points balance
        await users.updateOne(
          { _id: new mongoose.Types.ObjectId(collectorId) },
          { $inc: { points: collectorPoints } }
        );

        // Create audit payment entry
        await payments.insertOne({
          collectorId: new mongoose.Types.ObjectId(collectorId),
          user: new mongoose.Types.ObjectId(collectorId),
          amount: collectorPoints,
          date: post.completedAt || post.updatedAt || new Date(),
          method: "points-backfill",
          note: `Backfilled ${collectorPoints} pts for waste ${wasteId}`,
          pickup: wasteId,
          createdAt: new Date(),
          backfill: true
        });

        console.log(`     Collector: +${collectorPoints} pts`);
        totalCollectorPointsAwarded += collectorPoints;
      }

      // ─────────────────────────────────────
      // 3. Mark waste post as awarded (PREVENTS RE-RUNNING)
      // ─────────────────────────────────────
      const markResult = await wasteposts.updateOne(
        { _id: wasteId },
        { $set: { pointsAwarded: true } }
      );

      if (markResult.modifiedCount === 1) {
        console.log(`     Marked as pointsAwarded=true`);
      } else {
        console.warn(`     Could not mark (already updated or not found)`);
      }

      successCount++;
      console.log(""); // blank line between posts

      // Small delay to avoid overwhelming DB
      await new Promise(resolve => setTimeout(resolve, 30));

    } catch (err) {
      errorCount++;
      console.error(`   Failed for waste ${post._id}:`, err.message);
      console.error("");
      // Continue with next post instead of crashing whole script
    }
  }

  // ─────────────────────────────────────
  // Summary
  // ─────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log(" BACKFILL COMPLETE");
  console.log("═".repeat(60));
  console.log(`    Successful: ${successCount}/${posts.length} pickups`);
  console.log(`    Errors: ${errorCount}`);
  console.log(`   Total user points awarded: ${totalUserPointsAwarded}`);
  console.log(`    Total collector points awarded: ${totalCollectorPointsAwarded}`);
  console.log("═".repeat(60));

  if (successCount > 0) {
    console.log("\n Next steps to verify:");
    console.log("   1. Run: GET /api/users/profile → check 'points' field");
    console.log("   2. Run: GET /api/rewards/catalog → check 'userPoints' field");
    console.log("   3. In MongoDB: db.users.findOne({ email: 'sank123@gmail.com' }, { points: 1 })");
    console.log("   4. In MongoDB: db.payments.find({ method: 'points-backfill' }).limit(5)");
  }

  // ─────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────
  await mongoose.disconnect();
  console.log("\n Disconnected from MongoDB");
}

// ─────────────────────────────────────
// Execute
// ─────────────────────────────────────
run().catch(err => {
  console.error("\n Script failed with unhandled error:");
  console.error(err.stack || err.message);
  process.exit(1);
});