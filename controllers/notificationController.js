const mongoose = require("mongoose");
const Notification = (() => {
  try { return require("../models/Notification"); } catch (e) { return mongoose.models?.Notification || null; }
})();

exports.listNotifications = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ message: "Not authorized" });

    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize || "25"), 10)));
    const unreadOnly = req.query.unreadOnly === "1" || req.query.unreadOnly === "true";

    const filter = { user: mongoose.Types.ObjectId(String(userId)) };
    if (unreadOnly) filter.read = false;

    const total = await Notification.countDocuments(filter);
    const items = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    return res.json({ total, page, pageSize, data: items });
  } catch (err) {
    console.error("listNotifications error", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Failed to list notifications" });
  }
};

exports.markRead = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ message: "Not authorized" });

    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(String(id))) return res.status(400).json({ message: "Invalid id" });

    const updated = await Notification.findOneAndUpdate(
      { _id: id, user: userId },
      { $set: { read: true } },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ message: "Not found" });
    return res.json({ ok: true, notification: updated });
  } catch (err) {
    console.error("markRead error", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Failed to mark read" });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ message: "Not authorized" });

    await Notification.updateMany({ user: userId, read: false }, { $set: { read: true } });
    return res.json({ ok: true });
  } catch (err) {
    console.error("markAllRead error", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Failed to mark all read" });
  }
};