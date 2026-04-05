// models/Payment.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const PaymentSchema = new Schema(
  {
    // Some projects use collectorId, some use user; include both for compatibility
    collectorId: { type: Schema.Types.ObjectId, ref: "User" },
    user: { type: Schema.Types.ObjectId, ref: "User" },

    // points earned (positive) or spent (negative)
    amount: { type: Number, required: true },

    method: { type: String, default: "points" },
    note: { type: String, default: "" },

    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Prevent model overwrite in dev/hot reload
module.exports = mongoose.models?.Payment || mongoose.model("Payment", PaymentSchema);