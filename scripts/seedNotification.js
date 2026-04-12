// scripts/seedNotification.js
require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGODB_URI not set");
    process.exit(1);
  }

  await mongoose.connect(uri, {});

  // Adjust path if your Notification model is in a different place
  const Notification = (() => {
    try { return require(path.join(__dirname, "..", "models", "Notification")); } catch (e) { /* ignore */ }
    try { return require(path.join(__dirname, "models", "Notification")); } catch (e) { /* ignore */ }
    return mongoose.models?.Notification || null;
  })();

  if (!Notification) {
    console.error("Notification model not found. Adjust the require path.");
    await mongoose.disconnect();
    process.exit(1);
  }

  const userId = process.env.TEST_USER_ID || "69ad060a241a31383dec3440";
  const doc = new Notification({
    user: mongoose.Types.ObjectId(String(userId)),
    type: "test",
    title: "Seeded test notification",
    body: "Inserted by seed script",
    channel: "inapp",
    data: { seeded: true },
    read: false
  });

  await doc.save();
  console.log("Inserted notification id =", doc._id.toString());
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });