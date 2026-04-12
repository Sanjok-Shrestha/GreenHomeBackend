// backend/models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: String,

  email: {
    type: String,
    unique: true,
    required: true,
  },

  password: String,
  address:String,
  phone: String,
  role: {
    type: String,
    enum: ["user", "collector", "admin"],
    default: "user",
  },

  isApproved: {
    type: Boolean,
    default: false, // collectors need approval
  },

  // fields used by admin controller / UI
  active: {
    type: Boolean,
    default: false,
  },

  status: {
    type: String,
    enum: ["pending", "applied", "approved", "rejected", "disabled"],
    default: "pending",
  },

  approvedAt: {
    type: Date,
    default: null,
  },

  phone: {
    type: String,
    default: "",
  },

  // ✅ ADD THIS FOR REWARDS
  points: {
    type: Number,
    default: 0,
  },

}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);