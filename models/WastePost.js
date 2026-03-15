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
  },
  { timestamps: true }
);

module.exports = mongoose.models?.WastePost || mongoose.model("WastePost", WastePostSchema);