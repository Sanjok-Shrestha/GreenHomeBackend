const mongoose = require("mongoose");

const wastePostSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
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
  status: {
    type: String,
    enum: ["Pending", "Scheduled", "Collected"],
    default: "Pending",
  },
}, { timestamps: true });

module.exports = mongoose.model("WastePost", wastePostSchema);
