const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: String,

  email: { 
    type: String, 
    unique: true 
  },

  password: String,

  role: {
    type: String,
    enum: ["user", "collector", "admin"],
    default: "user",
  },

  isApproved: {
    type: Boolean,
    default: false, // collectors need approval
  },

  // ✅ ADD THIS FOR REWARDS
  points: {
    type: Number,
    default: 0,
  },

}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
