const mongoose = require("mongoose");
const Schema = mongoose.Schema;

/* ── History subdocument ── */
const HistorySchema = new Schema({
  status: { type: String, required: true },
  by: { type: Schema.Types.ObjectId, ref: "User" }, // who changed it
  at: { type: Date, default: Date.now },
  note: { type: String },
}, { _id: false });

/* ── Collector location subdocument ── */
const CollectorLocationSchema = new Schema({
  lat: { type: Number },
  lng: { type: Number },
  updatedAt: { type: Date },
}, { _id: false });

/* ── Main schema ── */
const WastePostSchema = new Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    collector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // core fields
    wasteType: { type: String, required: true },
    quantity: { type: Number, required: true },
    price: { type: Number },            // total price snapshot (quantity * pricePerKg)
    pricePerKg: { type: Number, default: 0 }, // snapshot of per-kg price used at creation

    // scheduling / location
    pickupDate: { type: Date },         // scheduled pickup time (optional)
    location: { type: String },         // address string
    address: { type: String, default: "" }, // alias if you prefer
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },

    description: { type: String },
    imageUrl: { type: String },

    status: {
      type: String,
      enum: [
        "Pending",
        "Scheduled",
        "Picked",
        "CollectedPending", // collector marked collected, awaiting admin approval
        "Collected",        // (if you ever want direct collected without approval)
        "Completed",
      ],
      default: "Pending",
    },

    pickedAt: { type: Date },
    collectedAt: { type: Date },
    completedAt: { type: Date },

    // admin approval audit
    approvedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    history: { type: [HistorySchema], default: [] },

    // flag to avoid double-awarding points for the same post
    processedForPoints: { type: Boolean, default: false },

    // NEW: last known collector location (optional) — used for live tracking
    collectorLocation: {
      type: CollectorLocationSchema,
      default: null,
    },

    // NEW: per-post opt-in to allow collector to share live location
    shareLocation: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/* ── Utility: safe lazy require for Payment/User models ── */
function getModel(name) {
  try {
    return require(`../models/${name}`);
  } catch (e) {
    return mongoose.models?.[name] || null;
  }
}

/* ── Internal: award points/payments to collector (runs only once) ── */
async function awardPointsIfNeeded(doc) {
  try {
    if (!doc) return;
    if (doc.processedForPoints) return;
    // Only award when final completed
    if (String(doc.status) !== "Completed") return;
    if (!doc.collector) {
      console.warn(`WastePost ${doc._id} has no collector; skipping auto-award.`);
      return;
    }

    const POINTS = Number(process.env.POINTS_PER_PICKUP_COLLECTOR ?? 10);

    const Payment = getModel("Payment");
    const User = getModel("User");
    const WastePostModel = mongoose.models?.WastePost || mongoose.model("WastePost", WastePostSchema);

    // Create a payment/award record if Payment model present
    if (Payment && typeof Payment.create === "function") {
      try {
        await Payment.create({
          collectorId: doc.collector,
          user: doc.collector,
          amount: POINTS,
          date: new Date(),
          method: "auto",
          note: `Auto-award for wastepost ${doc._id}`,
        });
      } catch (err) {
        console.warn("Failed to create Payment record for auto-award:", err && err.message);
      }
    } else {
      console.warn("Payment model not available; skipping inserting payment doc.");
    }

    // Increment user points if User model present
    if (User && typeof User.updateOne === "function") {
      try {
        await User.updateOne({ _id: doc.collector }, { $inc: { points: POINTS } });
      } catch (err) {
        console.warn("Failed to increment User points for auto-award:", err && err.message);
      }
    } else {
      console.warn("User model not available; skipping incrementing points.");
    }

    // mark processedForPoints to avoid double-award
    try {
      await WastePostModel.updateOne({ _id: doc._id }, { $set: { processedForPoints: true } });
    } catch (err) {
      console.warn("Failed to set processedForPoints:", err && err.message);
    }

    console.log(`Auto-awarded ${POINTS} pts for wastepost ${doc._id} to collector ${doc.collector}`);
  } catch (err) {
    console.warn("awardPointsIfNeeded error:", err && (err.stack || err.message));
  }
}

/* ── Instance helper to push history entry ── */
WastePostSchema.methods.pushHistory = async function (status, by, note) {
  this.history = this.history || [];
  this.history.push({ status, by: by || null, at: new Date(), note: note || "" });
  // not saving here intentionally; calling code should save the doc or use update operator
  return this;
};

/* ── Static: mark collected by collector (creates CollectedPending state + collectedAt + history) ── */
WastePostSchema.statics.markCollectedPending = async function (id, collectorId, note) {
  const now = new Date();
  const update = {
    $set: {
      status: "CollectedPending",
      collectedAt: now,
      collector: collectorId,
      updatedAt: now,
    },
    $push: {
      history: { status: "CollectedPending", by: collectorId, at: now, note: note || "Collector marked collected (pending approval)" },
    },
  };
  // use findByIdAndUpdate with $push to be atomic
  const updated = await mongoose.models?.WastePost?.findByIdAndUpdate(id, update, { new: true });
  return updated;
};

/* ── Static: admin approves completion (sets Completed, approvedAt, approvedBy, completedAt, pushes history, then awards points) ── */
WastePostSchema.statics.approveCompletion = async function (id, adminId, note) {
  const now = new Date();
  const update = {
    $set: {
      status: "Completed",
      approvedAt: now,
      approvedBy: adminId,
      completedAt: now,
      updatedAt: now,
    },
    $push: {
      history: { status: "Completed", by: adminId, at: now, note: note || "Admin approved completion" },
    },
  };
  const updated = await mongoose.models?.WastePost?.findByIdAndUpdate(id, update, { new: true });
  if (updated) {
    // Do award in background (no need to block response)
    setImmediate(() => awardPointsIfNeeded(updated).catch(() => {}));
  }
  return updated;
};

/* ── Static: admin rejects completion (sets back to 'Picked' or another status and records history) ── */
WastePostSchema.statics.rejectCompletion = async function (id, adminId, reason) {
  const now = new Date();
  const update = {
    $set: {
      status: "Picked", // revert to picked (adjust to your preferred fallback)
      updatedAt: now,
    },
    $push: {
      history: { status: "Rejected", by: adminId, at: now, note: reason || "Admin rejected completion" },
    },
  };
  const updated = await mongoose.models?.WastePost?.findByIdAndUpdate(id, update, { new: true });
  return updated;
};

/* ── Static: generic status update (server authoritative timestamps + history) ──
   Use this when you want server to determine timestamps consistently.
   role param is optional string to help with role-specific behavior.
*/
WastePostSchema.statics.updateStatus = async function (id, newStatus, byUserId = null, note = "", role = "") {
  const now = new Date();
  const $set = { status: newStatus, updatedAt: now };
  const $push = { history: { status: newStatus, by: byUserId, at: now, note: note || "" } };

  // Role-aware timestamping
  const lower = String(newStatus).toLowerCase();
  if (lower === "picked" || lower === "picked") $set.pickedAt = now;
  if (lower === "collectedpending" || lower === "collected_pending" || lower === "collectedpending") {
    $set.collectedAt = now;
  }
  if (lower === "completed") {
    $set.completedAt = now;
    $set.approvedAt = now;
    if (byUserId) $set.approvedBy = byUserId;
  }

  const update = { $set, $push };
  const updated = await mongoose.models?.WastePost?.findByIdAndUpdate(id, update, { new: true });

  // If completed: trigger award
  if (updated && String(updated.status) === "Completed") {
    setImmediate(() => awardPointsIfNeeded(updated).catch(() => {}));
  }

  return updated;
};

/* ── post-save fallback: if document is directly saved and reaches Completed, award points (keeps original behavior safe) ── */
WastePostSchema.post("save", function (doc) {
  try {
    // run award in next tick (do not block save response)
    setImmediate(() => awardPointsIfNeeded(doc).catch(() => {}));
  } catch (err) {
    console.warn("post-save award scheduling error:", err && err.message);
  }
});

/* ── Export model ── */
module.exports = mongoose.models?.WastePost || mongoose.model("WastePost", WastePostSchema);