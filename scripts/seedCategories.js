// scripts/seedCategories.js
// Usage: node scripts/seedCategories.js
require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  const dbName = process.env.DB_NAME || undefined;
  if (!uri) {
    console.error("MONGODB_URI (or MONGO_URI) is not set in .env");
    process.exit(1);
  }

  // load Category model (ensure models/Category.js exists)
  const Category = require(path.join(__dirname, "..", "models", "Category"));

  await mongoose.connect(uri, { ...(dbName ? { dbName } : {}) });
  console.log("Connected to MongoDB");

  // candidate collections to read wastes from
  const colCandidates = ["wastes", "wasteitems", "waste_categories", "wastecategories", "waste"];
  const db = mongoose.connection.db;

  let docs = [];
  for (const c of colCandidates) {
    try {
      const collection = db.collection(c);
      const count = await collection.countDocuments().catch(() => 0);
      if (count > 0) {
        console.log(`Reading ${count} docs from collection: ${c}`);
        const sample = await collection.find({}).toArray();
        docs = docs.concat(sample);
      } else {
        console.log(`Collection ${c} exists but empty (or read failed).`);
      }
    } catch (e) {
      // collection may not exist, ignore
    }
  }

  // extract name-like fields if any
  const names = docs.length
    ? docs
        .map((d) => {
          if (!d) return "";
          return d.name ?? d.wasteType ?? d.type ?? d.label ?? d.title ?? "";
        })
        .map((s) => (typeof s === "string" ? s.trim() : String(s)))
        .filter(Boolean)
    : [];

  // dedupe case-insensitively, keep original casing of first occurrence
  const lowerToOriginal = {};
  for (const n of names) {
    const lk = n.toLowerCase();
    if (!lowerToOriginal[lk]) lowerToOriginal[lk] = n;
  }
  let unique = Object.values(lowerToOriginal).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  // FALLBACK: if no names found, seed a sensible sample set
  if (!unique.length) {
    console.warn("No waste documents found in candidate collections. Falling back to sample categories.");
    const SAMPLE = ["Plastic", "Glass", "Paper", "Metal", "Organic"];
    unique = SAMPLE;
  }

  console.log(`Found ${unique.length} unique category names to seed.`);

  // Upsert each category
  let upserted = 0;
  for (const name of unique) {
    try {
      const doc = await Category.findOneAndUpdate(
        { name: name },
        { $setOnInsert: { name, description: "", active: true } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean().exec();
      if (doc) upserted++;
    } catch (e) {
      console.error("Upsert failed for", name, e && (e.message || e));
    }
  }

  console.log(`Upsert complete. Processed ${unique.length} names, upserted ${upserted} category documents.`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err && (err.stack || err.message || err));
  process.exit(1);
});