// scripts/backfill-award-wasteposts.js
require("dotenv").config();
const mongoose = require("mongoose");

const URI = process.env.MONGODB_URI;
if (!URI) {
  console.error("Set MONGODB_URI in .env");
  process.exit(1);
}

async function run() {
  await mongoose.connect(URI, { useNewUrlParser: true, useUnifiedTopology: true, dbName: process.env.DB_NAME });
  const db = mongoose.connection.db;
  const wasteposts = db.collection("wasteposts");
  const payments = db.collection("payments");
  const users = db.collection("users");

  // adjust policy as needed / or read from env
  const POINTS_PER_PICKUP = Number(process.env.POINTS_PER_PICKUP_COLLECTOR ?? 10);

  const cursor = wasteposts.find({
    collector: { $exists: true, $ne: null },
    status: { $regex: /collec/i },
    processedForPoints: { $ne: true }
  });

  let processed = 0;
  while (await cursor.hasNext()) {
    const post = await cursor.next();
    const collectorId = post.collector;
    if (!collectorId) continue;

    try {
      await payments.insertOne({
        collectorId: collectorId,
        user: collectorId,
        amount: POINTS_PER_PICKUP,
        date: new Date(),
        method: "backfill",
        note: `Backfill points for wastepost ${post._id}`
      });

      await users.updateOne({ _id: collectorId }, { $inc: { points: POINTS_PER_PICKUP } });
      await wasteposts.updateOne({ _id: post._1d || post._id }, { $set: { processedForPoints: true } }); // support different drivers

      // If above update fails due to driver, try:
      // await wasteposts.updateOne({ _id: post._id }, { $set: { processedForPoints: true } });

      console.log(`Awarded ${POINTS_PER_PICKUP} pts to ${collectorId} for ${post._id}`);
      processed++;
    } catch (e) {
      console.error("Failed for", post._id, e && (e.stack || e.message));
    }
  }

  console.log(`Backfill complete. Processed ${processed} wasteposts.`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err && (err.stack || err.message)); process.exit(1); });