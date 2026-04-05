// backend/controllers/adminCollectorsController.js
// add near top alongside your other requires:
// const Collector = require("../models/Collector");

exports.approve = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ ok: false, message: "Missing collector id" });

    // Update and return the updated document
    const updated = await Collector.findByIdAndUpdate(
      id,
      { $set: { status: "approved", active: true, isApproved: true } },
      { new: true, runValidators: true } // `new:true` returns updated doc
    ).lean();

    if (!updated) return res.status(404).json({ ok: false, message: "Collector not found" });

    // Prevent caching of API responses so clients get fresh data
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    return res.json({ ok: true, collector: updated });
  } catch (err) {
    console.error("adminCollectorsController.approve error:", err && (err.stack || err.message || err));
    return res.status(500).json({ ok: false, message: "Failed to approve collector" });
  }
};