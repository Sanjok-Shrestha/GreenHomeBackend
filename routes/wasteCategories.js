// routes/wasteCategories.js
// Returns a deduplicated array of waste type names at GET /api/waste/categories
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

let WasteModel = null;
try {
  // Try common model filenames
  WasteModel = require("../models/Waste");
} catch (e) {
  try {
    WasteModel = require("../models/waste");
  } catch (e2) {
    WasteModel = null;
  }
}

router.get("/categories", async (req, res, next) => {
  try {
    let docs = [];

    if (WasteModel && typeof WasteModel.find === "function") {
      docs = await WasteModel.find().lean().exec();
    } else {
      // Fallback: read the 'wastes' collection directly (if present)
      const colNameCandidates = ["wastes", "wasteitems", "waste_categories", "wastecategories"];
      let col = null;
      for (const c of colNameCandidates) {
        try {
          const collection = mongoose.connection.collection(c);
          // check if collection exists & has documents
          const count = await collection.countDocuments().catch(() => 0);
          if (count > 0) { col = collection; break; }
        } catch {}
      }
      if (col) {
        docs = await col.find({}).toArray();
      } else {
        // nothing found -> return empty list
        return res.json([]);
      }
    }

    // Extract name-like fields from docs
    const names = docs
      .map((d) => {
        if (!d) return "";
        return d.name ?? d.wasteType ?? d.type ?? d.label ?? d.title ?? "";
      })
      .map((s) => (typeof s === "string" ? s.trim() : String(s)))
      .filter(Boolean);

    // dedupe & sort
    const unique = Array.from(new Set(names.map((n) => n.toLowerCase())))
      .map((lk) => {
        // pick original-cased name from first match
        const match = names.find((n) => n.toLowerCase() === lk);
        return match || lk;
      })
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    res.json(unique);
  } catch (err) {
    next(err);
  }
});

module.exports = router;