const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CertificateSchema = new Schema({
  title: { type: String, default: "Certificate" },
  recipient: { type: String },
  issuedAt: { type: Date },
  validUntil: { type: Date, default: null },
  imageUrl: { type: String }, // hosted image URL (optional)
  pdfUrl: { type: String },   // hosted pdf URL (optional)
  verifyUrl: { type: String },// canonical verification link (optional)
  notes: { type: String },
  meta: { type: Schema.Types.Mixed },
}, { timestamps: true });

module.exports = mongoose.models?.Certificate || mongoose.model("Certificate", CertificateSchema);