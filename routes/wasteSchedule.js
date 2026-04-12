// routes/wasteSchedule.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

let ObjectId;
try {
  ObjectId = mongoose.Types.ObjectId;
} catch (e) {
  try { ObjectId = require("mongodb").ObjectId; } catch (e2) { ObjectId = null; }
}

/**
 * Schedule endpoints used by the frontend scheduler.
 * Mount this router at /api/waste (app.js already mounts /api/waste).
 *
 * Supported endpoints (relative to mount):
 *   PATCH  /:id/schedule       { pickupDate }
 *   PATCH  /schedule/:id       { pickupDate }
 *   POST   /:id/schedule       { pickupDate }
 *   DELETE /schedule/:id
 *   POST   /:id/cancel
 *
 * The router attempts to update a Mongoose model (Waste, pickup) if available,
 * falls back to raw collection updates, and finally uses an in-memory map.
 */

// Try common model names
let Model = null;
try { Model = require("../models/Waste"); } catch (e1) {
  try { Model = require("../models/waste"); } catch (e2) {
    try { Model = require("../models/Pickup"); } catch (e3) { Model = null; }
  }
}

// in-memory fallback
const memoryStore = new Map();

// convert id to query-friendly id
function toQueryId(id) {
  if (!id) return id;
  if (typeof id === "string" && ObjectId && ObjectId.isValid && ObjectId.isValid(id)) {
    try { return new ObjectId(id); } catch (e) { return id; }
  }
  return id;
}

async function updateDoc(id, update) {
  // Use Mongoose model if present
  if (Model && typeof Model.findByIdAndUpdate === "function") {
    try {
      const updated = await Model.findByIdAndUpdate(id, update, { new: true, lean: true }).exec();
      if (updated) return updated;
    } catch (e) {
      // ignore and fallback
    }
  }

  // Try raw collection updates
  const candidateCollections = ["wastes", "wasteitems", "pickups", "posts"];
  for (const name of candidateCollections) {
    try {
      const coll = mongoose.connection.collection(name);
      if (!coll) continue;
      const qid = (typeof id === "string" && ObjectId && ObjectId.isValid && ObjectId.isValid(id)) ? new ObjectId(id) : id;
      const res = await coll.findOneAndUpdate(
        { _id: qid },
        { $set: update },
        { returnDocument: "after" }
      ).catch(() => null);
      const doc = res && (res.value || res);
      if (doc) return doc;
    } catch (e) {
      // ignore and try next
    }
  }

  // Memory fallback
  const key = String(id);
  const existing = memoryStore.get(key) || null;
  if (existing) {
    const merged = { ...existing, ...update };
    memoryStore.set(key, merged);
    return merged;
  }
  const created = { _id: key, ...update };
  memoryStore.set(key, created);
  return created;
}

async function setPickupField(id, pickupDateIso) {
  return updateDoc(id, { pickupDate: pickupDateIso, status: "scheduled" });
}

async function clearPickupField(id) {
  return updateDoc(id, { pickupDate: null, status: "pending" });
}

/* PATCH /:id/schedule */
router.patch("/:id/schedule", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pickupDate } = req.body || {};
    if (!pickupDate) return res.status(400).json({ ok: false, message: "pickupDate required" });
    const qid = toQueryId(id);
    const updated = await setPickupField(qid, pickupDate);
    if (!updated) return res.status(404).json({ ok: false, message: "Not found" });
    return res.json({ ok: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/* PATCH /schedule/:id */
router.patch("/schedule/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pickupDate } = req.body || {};
    if (!pickupDate) return res.status(400).json({ ok: false, message: "pickupDate required" });
    const qid = toQueryId(id);
    const updated = await setPickupField(qid, pickupDate);
    if (!updated) return res.status(404).json({ ok: false, message: "Not found" });
    return res.json({ ok: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/* POST /:id/schedule */
router.post("/:id/schedule", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pickupDate } = req.body || {};
    if (!pickupDate) return res.status(400).json({ ok: false, message: "pickupDate required" });
    const qid = toQueryId(id);
    const updated = await setPickupField(qid, pickupDate);
    if (!updated) return res.status(404).json({ ok: false, message: "Not found" });
    return res.status(201).json({ ok: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/* DELETE /schedule/:id -> cancel schedule */
router.delete("/schedule/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const qid = toQueryId(id);
    const updated = await clearPickupField(qid);
    if (!updated) return res.status(404).json({ ok: false, message: "Not found" });
    return res.json({ ok: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/* POST /:id/cancel -> alias for cancel */
router.post("/:id/cancel", async (req, res, next) => {
  try {
    const { id } = req.params;
    const qid = toQueryId(id);
    const updated = await clearPickupField(qid);
    if (!updated) return res.status(404).json({ ok: false, message: "Not found" });
    return res.json({ ok: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/* GET /:id (debug) */
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (Model && typeof Model.findById === "function") {
      const doc = await Model.findById(id).lean().exec();
      if (doc) return res.json({ ok: true, data: doc });
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    const candidateCollections = ["wastes", "wasteitems", "pickups", "posts"];
    for (const name of candidateCollections) {
      try {
        const coll = mongoose.connection.collection(name);
        if (!coll) continue;
        const qid = (typeof id === "string" && ObjectId && ObjectId.isValid && ObjectId.isValid(id)) ? new ObjectId(id) : id;
        const doc = await coll.findOne({ _id: qid });
        if (doc) return res.json({ ok: true, data: doc });
      } catch (e) {
        // ignore
      }
    }

    if (memoryStore.has(String(id))) return res.json({ ok: true, data: memoryStore.get(String(id)) });
    return res.status(404).json({ ok: false, message: "Not found" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;