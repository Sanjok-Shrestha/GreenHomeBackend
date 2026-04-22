// scripts/migrate-redemption-status.js
require("dotenv").config();
const mongoose = require("mongoose");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
  console.log(" Connected to MongoDB");

  const Redemption = require("../models/Redemption");

  // Map old statuses to new ones
  const statusMap = {
    "pending": "approved",      // pending → approved (ready to use)
    "processed": "used",        // processed → used (already consumed)
    // "requested" and "rejected" stay the same
  };

  let updatedCount = 0;

  for (const [oldStatus, newStatus] of Object.entries(statusMap)) {
    const result = await Redemption.updateMany(
      { status: oldStatus },
      { $set: { status: newStatus } }
    );
    
    if (result.modifiedCount > 0) {
      console.log(` Migrated ${result.modifiedCount} redemptions: "${oldStatus}" → "${newStatus}"`);
      updatedCount += result.modifiedCount;
    }
  }

  console.log(`\n Migration complete: ${updatedCount} redemptions updated`);
  
  // Verify
  const stats = await Redemption.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } }
  ]);
  console.log(" Current status distribution:", stats);

  await mongoose.disconnect();
  console.log(" Disconnected");
}

run().catch(err => {
  console.error("Migration failed:", err.stack || err.message);
  process.exit(1);
});