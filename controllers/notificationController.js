const mongoose = require("mongoose");

let Notification;
try {
  Notification = require("../models/Notification");
} catch (e) {
  console.error("[notifications] Failed to require ../models/Notification:", e.message || e);
  Notification = mongoose.models?.Notification || null;
}

exports.listNotifications = async (req, res) => {
  try {
    if (!Notification) {
      console.error("listNotifications error: Notification model not loaded");
      return res.json({ total: 0, page: 1, pageSize: 25, data: [] });
    }

    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      console.error("listNotifications error: no userId on req.user");
      return res.status(401).json({ message: "Not authorized" });
    }

    let userObjectId;
    try {
      userObjectId = new mongoose.Types.ObjectId(String(userId));
    } catch (e) {
      console.error("listNotifications error: invalid userId", userId, e.message || e);
      return res.status(400).json({ message: "Invalid user id" });
    }

    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize || "25"), 10)));
    const unreadOnly = req.query.unreadOnly === "1" || req.query.unreadOnly === "true";

    const filter = { user: userObjectId };
    if (unreadOnly) filter.read = false;

    const total = await Notification.countDocuments(filter);
    const items = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    return res.json({ total, page, pageSize, data: items });
  } catch (err) {
    console.error("listNotifications error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to list notifications" });
  }
};

exports.markRead = async (req, res) => {
  try {
    if (!Notification) {
      console.error("markRead error: Notification model not loaded");
      return res.status(500).json({ message: "Notification model missing" });
    }

    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ message: "Not authorized" });

    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const updated = await Notification.findOneAndUpdate(
      { _id: id, user: userId },
      { $set: { read: true } },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ message: "Not found" });
    return res.json({ ok: true, notification: updated });
  } catch (err) {
    console.error("markRead error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to mark read" });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    if (!Notification) {
      console.error("markAllRead error: Notification model not loaded");
      return res.status(500).json({ message: "Notification model missing" });
    }

    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ message: "Not authorized" });

    await Notification.updateMany({ user: userId, read: false }, { $set: { read: true } });
    return res.json({ ok: true });
  } catch (err) {
    console.error("markAllRead error", err && (err.stack || err.message || err));
    return res.status(500).json({ message: "Failed to mark all read" });
  }
};