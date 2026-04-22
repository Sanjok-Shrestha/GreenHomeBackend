// models/Redemption.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const RedemptionSchema = new Schema(
  {
    // Who redeemed this
    user: { 
      type: Schema.Types.ObjectId, 
      ref: "User", 
      required: true,
      index: true 
    },
    collector: { 
      type: Schema.Types.ObjectId, 
      ref: "User",
      index: true 
    },

    // What was redeemed
    rewardId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    cost: { type: Number, required: true, min: 0 },

    //  FIX: Added "used" to enum + cleaned up status flow
    status: { 
      type: String, 
      enum: ["requested", "approved", "rejected", "used"], // Added "used", removed ambiguous "pending"/"processed"
      default: "requested",
      index: true
    },

    // Timestamps for status transitions
    requestedAt: { type: Date, default: Date.now },
    approvedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    rejectedAt: { type: Date },
    rejectedBy: { type: Schema.Types.ObjectId, ref: "User" },
    rejectReason: { type: String },
    usedAt: { type: Date }, //  When reward was consumed

    // Metadata (flexible key-value store)
    meta: { 
      type: Schema.Types.Mixed,
      default: {}
    },

    // Optional: link to related documents for audit trail
    pickup: { type: Schema.Types.ObjectId, ref: "WastePost" },
    payment: { type: Schema.Types.ObjectId, ref: "Payment" },
  },
  { 
    timestamps: true, // createdAt, updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ─────────────────────────────────────
// Indexes for common queries
// ─────────────────────────────────────
RedemptionSchema.index({ user: 1, status: 1, createdAt: -1 });
RedemptionSchema.index({ collector: 1, status: 1, createdAt: -1 });
RedemptionSchema.index({ rewardId: 1, status: 1 });

// ─────────────────────────────────────
// Virtual: Is this redemption actionable (can be used)?
// ─────────────────────────────────────
RedemptionSchema.virtual('isActionable').get(function() {
  return (this.status === "approved" || this.status === "requested") && this.status !== "used";
});

// ─────────────────────────────────────
// Instance methods
// ─────────────────────────────────────

// Mark as used (with validation)
RedemptionSchema.methods.markAsUsed = async function() {
  if (this.status === "used") {
    throw new Error("Redemption already used");
  }
  if (this.status !== "approved" && this.status !== "requested") {
    throw new Error(`Cannot use redemption with status: ${this.status}`);
  }
  
  this.status = "used";
  this.usedAt = new Date();
  return this.save();
};

// Mark as approved (admin only)
RedemptionSchema.methods.markAsApproved = async function(adminId) {
  if (this.status !== "requested") {
    throw new Error(`Cannot approve redemption with status: ${this.status}`);
  }
  
  this.status = "approved";
  this.approvedAt = new Date();
  this.approvedBy = adminId;
  return this.save();
};

// Mark as rejected (admin only)
RedemptionSchema.methods.markAsRejected = async function(adminId, reason) {
  if (this.status === "used") {
    throw new Error("Cannot reject already-used redemption");
  }
  
  this.status = "rejected";
  this.rejectedAt = new Date();
  this.rejectedBy = adminId;
  this.rejectReason = reason || "Rejected by admin";
  return this.save();
};

// ─────────────────────────────────────
// Static methods for common queries
// ─────────────────────────────────────
RedemptionSchema.statics.findByUser = function(userId, options = {}) {
  const { status, limit = 50 } = options;
  const query = { user: userId };
  if (status) query.status = status;
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("user", "name email")
    .populate("collector", "name email");
};

// ─────────────────────────────────────
// Export with safe fallback
// ─────────────────────────────────────
module.exports = mongoose.models?.Redemption || mongoose.model("Redemption", RedemptionSchema);