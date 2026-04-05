// routes/pricing.js
const express = require("express");
const router = express.Router();
const Pricing = require("../models/Pricing");
const mongoose = require("mongoose");

// Try to load WastePost and Pickup models (common paths)
let WastePost = null;
let Pickup = null;
try { WastePost = require("../models/WastePost"); } catch (e) { try { WastePost = require("../src/models/WastePost"); } catch (e2) { WastePost = null; } }
try { Pickup = require("../models/Pickup"); } catch (e) { try { Pickup = require("../src/models/Pickup"); } catch (e2) { Pickup = null; } }

// Helper to escape regex special chars
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* GET /api/pricing/ -> list all */
router.get("/", async (req, res, next) => {
  try {
    const items = await Pricing.find().sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (err) {
    next(err);
  }
});

/* POST /api/pricing/ -> create */
router.post("/", async (req, res, next) => {
  try {
    const { wasteType, pricePerKg } = req.body;
    if (!wasteType || typeof pricePerKg !== "number") {
      return res.status(400).json({ message: "wasteType (string) and pricePerKg (number) are required" });
    }
    const created = await Pricing.create({ wasteType: String(wasteType).trim(), pricePerKg });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

/* PATCH /api/pricing/:id -> partial update + propagate to pending WastePost & Pickup */
router.patch("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const patch = {};
    if (req.body.pricePerKg !== undefined) patch.pricePerKg = Number(req.body.pricePerKg);
    if (req.body.wasteType !== undefined) patch.wasteType = String(req.body.wasteType).trim();

    const updated = await Pricing.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true }).lean();
    if (!updated) return res.status(404).json({ message: "Not found" });

    // Only propagate when pricePerKg changed
    if (patch.pricePerKg !== undefined) {
      const newPrice = Number(patch.pricePerKg);
      const targetWasteType = (patch.wasteType || updated.wasteType || "").trim();

      // If wasteType couldn't be determined, try to use updated.wasteType
      const wasteTypeToMatch = targetWasteType || (updated && updated.wasteType ? String(updated.wasteType).trim() : "");
      if (wasteTypeToMatch) {
        const pendingStatuses = ["pending", "created", "scheduled", "assigned", "open"]; // adapt to your app's statuses
        const filter = {
          status: { $in: pendingStatuses },
          wasteType: { $regex: new RegExp("^" + escapeRegex(wasteTypeToMatch) + "$", "i") },
        };

        // 1) Update WastePost collection (your posted waste items)
        if (WastePost) {
          try {
            // Try pipeline update (MongoDB 4.2+)
            await WastePost.updateMany(
              filter,
              [
                { $set: { pricePerKg: newPrice } },
                { $set: { price: { $multiply: ["$quantity", newPrice] } } }
              ]
            );
            console.log(`Propagated price ${newPrice} -> WastePost (pipeline) for "${wasteTypeToMatch}"`);
          } catch (errPipeline) {
            // Fallback: find and bulkWrite
            try {
              const docs = await WastePost.find(filter).select("_id quantity").lean();
              if (docs && docs.length) {
                const ops = docs.map(d => {
                  const qty = Number(d.quantity || 0);
                  return {
                    updateOne: {
                      filter: { _id: d._id },
                      update: { $set: { pricePerKg: newPrice, price: Math.round(qty * newPrice) } }
                    }
                  };
                });
                if (ops.length) {
                  await WastePost.bulkWrite(ops);
                  console.log(`Propagated price ${newPrice} -> WastePost (bulkWrite) for ${ops.length} documents`);
                }
              } else {
                console.log("No matching pending WastePost docs to update for", wasteTypeToMatch);
              }
            } catch (bulkErr) {
              console.error("Fallback update for WastePost failed:", bulkErr);
            }
          }
        } else {
          console.log("WastePost model not found; skipping propagation to posts.");
        }

        // 2) Update Pickup collection (if present) to keep them in sync as well
        if (Pickup) {
          try {
            await Pickup.updateMany(
              filter,
              [
                { $set: { pricePerKg: newPrice } },
                { $set: { price: { $multiply: ["$quantity", newPrice] } } }
              ]
            );
            console.log(`Propagated price ${newPrice} -> Pickup (pipeline) for "${wasteTypeToMatch}"`);
          } catch (errP) {
            try {
              const docs2 = await Pickup.find(filter).select("_id quantity").lean();
              if (docs2 && docs2.length) {
                const ops2 = docs2.map(d => {
                  const qty = Number(d.quantity || 0);
                  return {
                    updateOne: {
                      filter: { _id: d._id },
                      update: { $set: { pricePerKg: newPrice, price: Math.round(qty * newPrice) } }
                    }
                  };
                });
                if (ops2.length) {
                  await Pickup.bulkWrite(ops2);
                  console.log(`Propagated price ${newPrice} -> Pickup (bulkWrite) for ${ops2.length} documents`);
                }
              } else {
                console.log("No matching pending Pickup docs to update for", wasteTypeToMatch);
              }
            } catch (bulkErr2) {
              console.error("Fallback update for Pickup failed:", bulkErr2);
            }
          }
        } else {
          console.log("Pickup model not found; skipping propagation to Pickup collection.");
        }
      } else {
        console.log("No wasteType available on pricing update; skipping propagation.");
      }
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/* DELETE /api/pricing/:id */
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const removed = await Pricing.findByIdAndDelete(id).lean();
    if (!removed) return res.status(404).json({ message: "Not found" });
    res.json(removed);
  } catch (err) {
    next(err);
  }
});

module.exports = router;