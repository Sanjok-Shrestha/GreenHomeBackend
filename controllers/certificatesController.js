const mongoose = require("mongoose");
const Certificate = (() => {
  try { return require("../models/Certificate"); }
  catch (e) { try { return require("../../models/Certificate"); } catch (_) { return null; } }
})();

if (!Certificate) console.warn("Certificate model not found — update require path if needed.");

/**
 * GET /api/certificates?q=&page=&pageSize=
 * Returns: { total, page, pageSize, data: [...] }
 */
exports.listCertificates = async (req, res) => {
  try {
    if (!Certificate) return res.status(500).json({ message: "Certificate model missing on server" });

    const q = (req.query.q || "").toString().trim();
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize || "20"), 10)));

    const filter = {};
    if (q) {
      // safe regex escape
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ title: re }, { recipient: re }, { _id: re }];
    }

    const total = await Certificate.countDocuments(filter);
    const docs = await Certificate.find(filter)
      .sort({ issuedAt: -1, createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    return res.json({ total, page, pageSize, data: docs });
  } catch (err) {
    console.error("listCertificates error", err);
    return res.status(500).json({ message: "Failed to load certificates" });
  }
};

/**
 * GET /api/certificates/:id
 */
exports.getCertificate = async (req, res) => {
  try {
    if (!Certificate) return res.status(500).json({ message: "Certificate model missing on server" });
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(String(id))) return res.status(400).json({ message: "Invalid id" });
    const doc = await Certificate.findById(id).lean();
    if (!doc) return res.status(404).json({ message: "Certificate not found" });
    return res.json(doc);
  } catch (err) {
    console.error("getCertificate error", err);
    return res.status(500).json({ message: "Failed to load certificate" });
  }
};

/**
 * POST /api/certificates
 * Body: { title, recipient, issuedAt, validUntil, imageUrl, pdfUrl, verifyUrl, notes, meta }
 * (Protect with admin middleware when mounting in production)
 */
exports.createCertificate = async (req, res) => {
  try {
    const body = req.body || {};
    const doc = await Certificate.create({
      title: body.title,
      recipient: body.recipient,
      issuedAt: body.issuedAt ? new Date(body.issuedAt) : new Date(),
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      imageUrl: body.imageUrl,
      pdfUrl: body.pdfUrl,
      verifyUrl: body.verifyUrl,
      notes: body.notes,
      meta: body.meta || {},
    });
    return res.status(201).json({ ok: true, certificate: doc });
  } catch (err) {
    console.error("createCertificate error", err);
    return res.status(500).json({ message: "Failed to create certificate" });
  }
};

/**
 * DELETE /api/certificates/:id
 * (Protect with admin middleware when mounting in production)
 */
exports.deleteCertificate = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(String(id))) return res.status(400).json({ message: "Invalid id" });
    const doc = await Certificate.findByIdAndDelete(id).lean();
    if (!doc) return res.status(404).json({ message: "Certificate not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("deleteCertificate error", err);
    return res.status(500).json({ message: "Failed to delete certificate" });
  }
};
