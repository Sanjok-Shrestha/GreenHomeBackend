const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const RewardRedemptionSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  rewardId: { type: String, required: true },
  title: { type: String },
  cost: { type: Number, required: true },
  redeemedAt: { type: Date, default: Date.now },
  metadata: { type: Schema.Types.Mixed }, // store extra info if needed
});

module.exports =
  mongoose.models?.RewardRedemption || mongoose.model("RewardRedemption", RewardRedemptionSchema);