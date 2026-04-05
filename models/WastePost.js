// models/WastePost.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const HistorySchema = new Schema({
  status: { type: String, required: true },
  by: { type: Schema.Types.ObjectId, ref: "User" }, // who changed it
  at: { type: Date, default: Date.now },
  note: { type: String },
});

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
    wasteType: {
      type: String,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
    },
    price: {
      type: Number,
    },
    pickupDate: {
      type: Date,
    },
    location: {
      type: String,
    },
    description: {
      type: String,
    },
    imageUrl: {
      type: String,
    },
    status: {
      // expanded enum to include intermediate states
      type: String,
      enum: ["Pending", "Scheduled", "Picked", "Collected", "Completed"],
      default: "Pending",
    },
    pickedAt: { type: Date },
    completedAt: { type: Date },
    history: { type: [HistorySchema], default: [] },

    // flag to avoid double-awarding points for the same post
    processedForPoints: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/**
 * Post-save hook: award points when a post becomes Collected and hasn't been processed.
 * This runs asynchronously and will not throw if models are missing or an error occurs.
 */
WastePostSchema.post("save", function (doc) {
  try {
    // only run when status is Collected and not already processed
    if (!doc) return;
    if (String(doc.status) !== "Collected") return;
    if (doc.processedForPoints) return;

    // run async background job (do not block save)
    (async () => {
      const POINTS = Number(process.env.POINTS_PER_PICKUP_COLLECTOR ?? 10);

      // Load models defensively (in case require order differs)
      const Payment = (() => {
        try {
          return require("../models/Payment");
        } catch (e) {
          return mongoose.models?.Payment || null;
        }
      })();

      const User = (() => {
        try {
          return require("../models/User");
        } catch (e) {
          return mongoose.models?.User || null;
        }
      })();

      const WastePostModel = mongoose.models?.WastePost || mongoose.model("WastePost", WastePostSchema);

      if (!doc.collector) {
        console.warn(`WastePost ${doc._id} has no collector; skipping auto-award.`);
        return;
      }

      try {
        // create payment record if Payment model exists
        if (Payment && typeof Payment.create === "function") {
          await Payment.create({
            collectorId: doc.collector,
            user: doc.collector,
            amount: POINTS,
            date: new Date(),
            method: "auto",
            note: `Auto-award for wastepost ${doc._id}`,
          });
        } else {
          console.warn("Payment model not available; skipping inserting payment doc.");
        }

        // increment user points if User model exists
        if (User && typeof User.updateOne === "function") {
          await User.updateOne({ _id: doc.collector }, { $inc: { points: POINTS } });
        } else {
          console.warn("User model not available; skipping incrementing points.");
        }

        // mark processed so we don't award twice
        await WastePostModel.updateOne({ _id: doc._id }, { $set: { processedForPoints: true } });
        console.log(`Auto-awarded ${POINTS} pts for wastepost ${doc._id} to collector ${doc.collector}`);
      } catch (err) {
        console.warn("Auto-award background job failed for wastepost", doc._id, err && (err.stack || err.message));
        // We do not rethrow — do not block the main flow.
      }
    })();
  } catch (err) {
    console.warn("Post-save hook error (ignored):", err && (err.stack || err.message));
  }
});

module.exports = mongoose.models?.WastePost || mongoose.model("WastePost", WastePostSchema);