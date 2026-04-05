// models/Pricing.js
const mongoose = require("mongoose");

const PricingSchema = new mongoose.Schema({
  wasteType: { type: String, required: true, trim: true },
  pricePerKg: { type: Number, required: true, default: 0 },
}, {
  timestamps: true,
});

module.exports = mongoose.models?.Pricing || mongoose.model("Pricing", PricingSchema);