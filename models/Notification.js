const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String },          // e.g. "waste_submitted", "pickup_scheduled"
    read: { type: Boolean, default: false },
    meta: { type: Object },          // extra JSON data
  },
  { timestamps: true }               // createdAt, updatedAt
);

module.exports =
  mongoose.models.Notification || mongoose.model("Notification", notificationSchema);