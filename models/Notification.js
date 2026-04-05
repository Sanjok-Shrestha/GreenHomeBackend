const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const NotificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, required: true }, // e.g. 'pickup_reminder', 'new_reward'
    title: { type: String, required: true },
    body: { type: String },
    channel: { type: String, enum: ["inapp", "email", "sms", "all"], default: "inapp" },
    data: { type: Schema.Types.Mixed },
    read: { type: Boolean, default: false },
    sentAt: { type: Date },
    deliveredAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.models?.Notification || mongoose.model("Notification", NotificationSchema);