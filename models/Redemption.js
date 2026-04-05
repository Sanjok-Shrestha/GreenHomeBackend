// models/Redemption.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const RedemptionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    rewardId: { type: String, required: true },
    title: { type: String, required: true },
    cost: { type: Number, required: true },
    status: { type: String, enum: ["requested", "pending", "processed", "rejected"], default: "requested" },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = mongoose.models?.Redemption || mongoose.model("Redemption", RedemptionSchema);