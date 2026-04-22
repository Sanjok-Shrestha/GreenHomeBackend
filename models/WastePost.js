// models/WastePost.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

/* History Subdocument */
const HistorySchema = new Schema({
  status: { type: String, required: true },
  by: { type: Schema.Types.ObjectId, ref: "User" },
  at: { type: Date, default: Date.now },
  note: { type: String },
}, { _id: false });

/* Collector Location Subdocument */
const CollectorLocationSchema = new Schema({
  lat: { type: Number },
  lng: { type: Number },
  updatedAt: { type: Date },
}, { _id: false });

/* Main WastePost Schema */
const WastePostSchema = new Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true,
    index: true 
  },
  collector: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    default: null,
    index: true 
  },

  wasteType: { type: String, required: true, index: true },
  quantity: { type: Number, required: true, min: 0 },
  price: { type: Number, min: 0 },
  pricePerKg: { type: Number, default: 0, min: 0 },

  pickupDate: { type: Date },
  location: { type: String },
  address: { type: String, default: "" },
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },

  description: { type: String },
  imageUrl: { type: String },

  status: {
    type: String,
    enum: [
      "Pending", "Scheduled", "Picked",
      "CollectedPending", "Collected", "Completed", "Rejected"
    ],
    default: "Pending",
    index: true
  },

  pickedAt: { type: Date },
  collectedAt: { type: Date },
  completedAt: { type: Date },
  approvedAt: { type: Date },
  approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

  //  Standardized flag name - matches pointsController.js
  pointsAwarded: { type: Boolean, default: false, index: true },

  history: { type: [HistorySchema], default: [] },
  collectorLocation: { type: CollectorLocationSchema, default: null },
  shareLocation: { type: Boolean, default: false },
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for computed total value (optional helper)
WastePostSchema.virtual('totalValue').get(function() {
  return (this.quantity || 0) * (this.pricePerKg || this.price || 0);
});

// Index for common queries
WastePostSchema.index({ status: 1, completedAt: -1 });
WastePostSchema.index({ user: 1, status: 1 });
WastePostSchema.index({ collector: 1, status: 1 });

//  Static method for admin approval - DOES NOT award points
// Points are awarded explicitly in pickupController.approveCompletion
WastePostSchema.statics.approveCompletion = async function (id, adminId, note) {
  const now = new Date();
  
  const update = {
    $set: {
      status: "Completed",
      approvedAt: now,
      approvedBy: adminId,
      completedAt: now,
      updatedAt: now,
    },
    $push: {
      history: { 
        status: "Completed", 
        by: adminId, 
        at: now, 
        note: note || "Admin approved completion" 
      },
    },
  };
  
  const updated = await this.findByIdAndUpdate(id, update, { 
    new: true,
    runValidators: true 
  }).populate("user", "name email").populate("collector", "name email");
  
  return updated;
};

// Instance method to check if points can be awarded (helper for controllers)
WastePostSchema.methods.canAwardPoints = function() {
  return (
    this.status === "Completed" &&
    !this.pointsAwarded &&
    this.user // Must have a valid user
  );
};

// Instance method to mark as awarded (used by pointsController)
WastePostSchema.methods.markPointsAwarded = async function(session = null) {
  this.pointsAwarded = true;
  return this.save({ session });
};

// Export with safe fallback
module.exports = mongoose.models?.WastePost || mongoose.model("WastePost", WastePostSchema);