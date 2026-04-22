// Run this only if your DB currently has a unique index on users.name and you want to remove it.
// Usage:
//   MONGO_URI="mongodb://user:pass@host:27017/dbname" node backend/scripts/drop-name-index.js

const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/your-db-name";

async function run() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const coll = mongoose.connection.collection("users");
  try {
    const indexes = await coll.indexes();
    console.log("Existing indexes:", indexes.map(i => i.name));
    const nameIndex = indexes.find(i => i.key && (i.key.name === 1 || i.key.name === "name"));
    if (!nameIndex) {
      console.log("No index on 'name' found, nothing to drop.");
    } else {
      console.log("Found index on 'name':", nameIndex.name, " — dropping it now.");
      await coll.dropIndex(nameIndex.name);
      console.log("Dropped index:", nameIndex.name);
    }
  } catch (err) {
    console.error("Error while dropping index:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((e) => { console.error(e); process.exitCode = 1; });