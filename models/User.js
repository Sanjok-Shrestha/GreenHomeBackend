const mongoose = require("mongoose");

function normalizePhone(p = "") {
  if (!p) return "";
  return String(p).replace(/\D/g, "");
}

function normalizeAddressValue(a) {
  if (!a) return null;
  // If given a string -> use as line1
  if (typeof a === "string") {
    const s = String(a).trim();
    return s ? { line1: s, line2: null, city: null, state: null, postalCode: null, country: null } : null;
  }
  // If object -> normalize fields
  if (typeof a === "object") {
    return {
      line1: a.line1 ? String(a.line1).trim() : null,
      line2: a.line2 ? String(a.line2).trim() : null,
      city: a.city ? String(a.city).trim() : null,
      state: a.state ? String(a.state).trim() : null,
      postalCode: a.postalCode ? String(a.postalCode).trim() : null,
      country: a.country ? String(a.country).trim() : null,
    };
  }
  return null;
}

const userSchema = new mongoose.Schema({
  name: { type: String, trim: true }, // allow duplicate display names

  // optional unique username (sparse = allows nulls)
  username: { type: String, trim: true, sparse: true, unique: true },

  email: {
    type: String,
    unique: true,
    required: true,
    trim: true,
    lowercase: true,
  },

  password: String,

  // Allow mixed input (string or object) but normalize to structured object on save
  address: { type: mongoose.Schema.Types.Mixed, default: null },

  phone: {
    // normalized digits-only phone; unique for non-empty values
    type: String,
    default: "",
    unique: true,
    sparse: true,
  },

  role: {
    type: String,
    enum: ["user", "collector", "admin"],
    default: "user",
  },

  isApproved: { type: Boolean, default: false },
  active: { type: Boolean, default: false },

  status: {
    type: String,
    enum: ["pending", "applied", "approved", "rejected", "disabled"],
    default: "pending",
  },

  approvedAt: { type: Date, default: null },

  points: { type: Number, default: 0 },

}, { timestamps: true });

// Normalize phone & address before save
userSchema.pre("save", async function () {
  if (!this) return;
  if (this.email) this.email = String(this.email).toLowerCase().trim();
  if (this.name) this.name = String(this.name).trim();

  if (this.phone) this.phone = normalizePhone(this.phone);

  try {
    const norm = normalizeAddressValue(this.address);
    this.address = norm;
  } catch (e) {
    this.address = null;
  }
});

module.exports = mongoose.models?.User || mongoose.model("User", userSchema);