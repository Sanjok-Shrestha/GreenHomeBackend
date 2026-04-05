// models/Category.js
const mongoose = require("mongoose");

const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  description: { type: String, default: "" },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.models.Category || mongoose.model("Category", CategorySchema);