// backend/controllers/adminUsersController.js
console.log("Loading controller: ./controllers/adminUsersController.js");

const mongoose = require("mongoose");
const User = (() => {
  try { return require("../models/User"); }
  catch (e) { return mongoose.models?.User || null; }
})();

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(String(id));
}

exports.listUsers = async (req, res) => {
  try {
    console.log("adminUsersController.listUsers called");
    if (!User) return res.status(200).json([]);

    const q = String(req.query.q || "").trim();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    const skip = Math.max(0, Number(req.query.skip || 0));
    const sortBy = req.query.sortBy || "createdAt";
    const sortDir = req.query.sortDir === "asc" ? 1 : -1;

    const filter = {};
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ name: re }, { email: re }, { _id: re }];
    }

    const docs = await User.find(filter)
      .select("name email role isApproved points active createdAt")
      .sort({ [sortBy]: sortDir })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.json(docs);
  } catch (err) {
    console.error("adminUsersController.listUsers error", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Failed to list users" });
  }
};

exports.setActive = async (req, res) => {
  try {
    if (!User) return res.status(500).json({ message: "User model not available" });

    const id = req.params.id;
    if (!isValidId(id)) return res.status(400).json({ message: "Invalid user id" });

    const active = req.body && typeof req.body.active === "boolean" ? req.body.active : undefined;
    if (typeof active === "undefined") return res.status(400).json({ message: "Missing 'active' boolean in body" });

    const updated = await User.findOneAndUpdate(
      { _id: id },
      { $set: { active } },
      { new: true }
    ).select("name email role isApproved points active createdAt").lean();

    if (!updated) return res.status(404).json({ message: "User not found" });
    return res.json({ ok: true, user: updated });
  } catch (err) {
    console.error("adminUsersController.setActive error", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Failed to update active state" });
  }
};

exports.setRole = async (req, res) => {
  try {
    if (!User) return res.status(500).json({ message: "User model not available" });

    const id = req.params.id;
    if (!isValidId(id)) return res.status(400).json({ message: "Invalid user id" });

    const role = String(req.body.role || "").trim();
    if (!role) return res.status(400).json({ message: "Missing role in body" });

    // optional roles enforcement
    const allowed = ["admin", "collector", "user"];
    if (!allowed.includes(role)) return res.status(400).json({ message: "Invalid role" });

    const updated = await User.findOneAndUpdate(
      { _id: id },
      { $set: { role } },
      { new: true }
    ).select("name email role isApproved points active createdAt").lean();

    if (!updated) return res.status(404).json({ message: "User not found" });
    return res.json({ ok: true, user: updated });
  } catch (err) {
    console.error("adminUsersController.setRole error", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Failed to update role" });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    if (!User) return res.status(500).json({ message: "User model not available" });

    const id = req.params.id;
    if (!isValidId(id)) return res.status(400).json({ message: "Invalid user id" });

    // optional: prevent self-deletion
    const reqUserId = req.user?.id || req.user?._id;
    if (reqUserId && String(reqUserId) === String(id)) {
      return res.status(400).json({ message: "Cannot delete yourself" });
    }

    const deleted = await User.findByIdAndDelete(id).lean();
    if (!deleted) return res.status(404).json({ message: "User not found" });
    return res.json({ ok: true, deletedId: id });
  } catch (err) {
    console.error("adminUsersController.deleteUser error", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Failed to delete user" });
  }
};