const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const HistorySchema = new Schema({
  status: { type: String, required: true },
  by: { type: Schema.Types.ObjectId, ref: "User" }, // who changed the status
  at: { type: Date, default: Date.now },
  note: { type: String },
});

const PickupSchema = new Schema({
  wasteType: { type: String, required: true },
  quantity: { type: Number, default: 0 },
  price: { type: Number, default: 0 },
  status: { type: String, default: "pending" },
  user: { type: Schema.Types.ObjectId, ref: "User" },        // requester
  collector: { type: Schema.Types.ObjectId, ref: "User" },   // assigned collector
  location: { type: String },
  address: { type: String },
  imageUrl: { type: String },
  description: { type: String },
  pickedAt: { type: Date },
  completedAt: { type: Date },
  history: { type: [HistorySchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

PickupSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.models?.Pickup || mongoose.model("Pickup", PickupSchema);