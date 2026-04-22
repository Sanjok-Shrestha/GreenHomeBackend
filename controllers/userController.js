// controllers/userController.js
const mongoose = require("mongoose");
const User = require("../models/User");
const WastePost = require("../models/WastePost");

/* --- helpers (unchanged or lightly refactored) --- */

function toObjectIdMaybe(v) {
  try { return mongoose.Types.ObjectId(String(v)); } catch { return v; }
}

function n(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function normalizeAddress(u) {
  if (!u) return null;

  const a = u.address;
  if (a && typeof a === "object") {
    const have = a.line1 || a.line2 || a.city || a.state || a.postalCode || a.country;
    if (have) {
      return {
        line1: n(a.line1),
        line2: n(a.line2),
        city: n(a.city),
        state: n(a.state),
        postalCode: n(a.postalCode),
        country: n(a.country),
      };
    }
  }

  if (a && typeof a === "string") {
    const s = n(a);
    if (s) return { line1: s, line2: null, city: null, state: null, postalCode: null, country: null };
  }

  const line1 = n(u.addressLine1 ?? u.address1 ?? u.address_line1 ?? u.addressString ?? null);
  const line2 = n(u.addressLine2 ?? u.address2 ?? u.address_line2 ?? null);
  const city = n(u.city ?? null);
  const state = n(u.state ?? null);
  const postalCode = n(u.postalCode ?? u.postcode ?? u.zip ?? null);
  const country = n(u.country ?? null);

  const any = line1 || line2 || city || state || postalCode || country;
  if (!any) return null;

  return { line1, line2, city, state, postalCode, country };
}

function normalizePhone(u) {
  if (!u) return null;
  const p = u.phone ?? u.mobile ?? u.phoneNumber ?? u.contact?.phone ?? null;
  if (!p) return null;
  const digits = String(p).replace(/\D/g, "");
  return digits === "" ? null : digits;
}

/* --- profile/aggregation builder used by GET and PUT responses --- */
async function buildProfileFromUserObject(u) {
  // u is a plain object or Mongoose doc (prefer plain object)
  let userObj;
  try {
    if (typeof u.toObject === "function") userObj = u.toObject();
    else userObj = { ...u };
  } catch {
    userObj = { ...u };
  }
  const userId = toObjectIdMaybe(userObj._id ?? userObj.id);
  // compute aggregates similarly to getProfile
  let totalEarnings = 0, assignedCount = 0, completedThisMonth = 0, kgCollected = 0, postCount = 0;
  const postCountP = WastePost.countDocuments({ user: userId });

  if (String(userObj.role) === "collector") {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const completedMatch = { collector: userId, status: { $in: ["Collected", "Completed"] } };

    const earningsAggP = WastePost.aggregate([
      { $match: completedMatch },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$price", 0] } } } },
    ]).exec();

    const kgAggP = WastePost.aggregate([
      { $match: completedMatch },
      { $group: { _id: null, kg: { $sum: { $ifNull: ["$quantity", 0] } } } },
    ]).exec();

    const assignedCountP = WastePost.countDocuments({
      collector: userId,
      status: { $in: ["Scheduled", "Picked", "Pending"] },
    }).exec();

    const completedThisMonthP = WastePost.countDocuments({
      collector: userId,
      status: { $in: ["Collected", "Completed"] },
      completedAt: { $gte: startOfMonth },
    }).exec();

    const [earningsAgg, kgAgg, assignedCt, completedMonth, postCt] = await Promise.all([
      earningsAggP, kgAggP, assignedCountP, completedThisMonthP, postCountP,
    ]);

    totalEarnings = (earningsAgg && earningsAgg[0] && earningsAgg[0].total) ? earningsAgg[0].total : 0;
    kgCollected = (kgAgg && kgAgg[0] && kgAgg[0].kg) ? kgAgg[0].kg : 0;
    assignedCount = assignedCt ?? 0;
    completedThisMonth = completedMonth ?? 0;
    postCount = postCt ?? 0;
  } else {
    postCount = await postCountP;
  }

  return {
    id: String(userObj._id ?? userObj.id),
    name: userObj.name,
    email: userObj.email,
    role: userObj.role,
    points: userObj.points ?? 0,
    isApproved: userObj.isApproved ?? false,
    createdAt: userObj.createdAt,
    avatarUrl: userObj.avatarUrl ?? userObj.avatar ?? null,

    phone: normalizePhone(userObj),
    address: normalizeAddress(userObj),
    receiveEmails: typeof userObj.receiveEmails !== "undefined" ? userObj.receiveEmails : (userObj.receiveEmail ?? userObj.receive_emails ?? false),
    receiveSMS: typeof userObj.receiveSMS !== "undefined" ? userObj.receiveSMS : (userObj.receiveSms ?? userObj.receive_sms ?? false),

    bankAccount: userObj.bankAccount ?? userObj.bank_account ?? null,
    vehicle: userObj.vehicle ?? null,

    totalEarnings,
    rewards: totalEarnings ?? (userObj.rewards ?? 0),

    assignedCount,
    completedThisMonth,
    kgCollected,
    postCount,
  };
}

/* --- existing GET handler (unchanged) --- */
exports.getProfile = async (req, res) => {
  try {
    const provided = req.user;
    if (!provided) return res.status(404).json({ message: "User not found" });

    const profile = await buildProfileFromUserObject(provided);
    return res.json(profile);
  } catch (err) {
    console.error("getProfile error:", err && (err.stack || err.message));
    return res.status(500).json({ message: "Server error" });
  }
};

/* --- NEW: PUT /api/users/profile handler --- */
exports.updateProfile = async (req, res) => {
  try {
    const provided = req.user;
    if (!provided) return res.status(404).json({ message: "User not found" });

    // allowed updates (don't allow email/password here — handle separately)
    const {
      name, bio, social, receiveEmails, receiveSMS, bankAccount, vehicle,
    } = req.body;

    // phone: accept digits or formatted -> normalize to digits-only
    let phone = req.body.phone ?? null;
    if (phone) phone = String(phone).replace(/\D/g, "") || null;

    // address: accept nested object, flattened fields, or addressString
    let address = null;
    if (req.body.address && typeof req.body.address === "object") {
      address = {
        line1: n(req.body.address.line1),
        line2: n(req.body.address.line2),
        city: n(req.body.address.city),
        state: n(req.body.address.state),
        postalCode: n(req.body.address.postalCode),
        country: n(req.body.address.country),
      };
    } else if (req.body.addressString && typeof req.body.addressString === "string") {
      const s = n(req.body.addressString);
      if (s) address = { line1: s, line2: null, city: null, state: null, postalCode: null, country: null };
    } else if (req.body.addressLine1 || req.body.city || req.body.postalCode) {
      address = {
        line1: n(req.body.addressLine1 ?? req.body.address1),
        line2: n(req.body.addressLine2 ?? req.body.address2),
        city: n(req.body.city),
        state: n(req.body.state),
        postalCode: n(req.body.postalCode),
        country: n(req.body.country),
      };
    } else if (provided.address && typeof provided.address === "string") {
      // keep existing string if present and no new address provided
      address = provided.address;
    } else if (provided.address && typeof provided.address === "object") {
      // keep existing object if no update provided
      address = provided.address;
    }

    const update = {};
    if (typeof name !== "undefined") update.name = name;
    if (typeof bio !== "undefined") update.bio = bio;
    if (typeof social !== "undefined") update.social = social;
    if (typeof receiveEmails !== "undefined") update.receiveEmails = receiveEmails;
    if (typeof receiveSMS !== "undefined") update.receiveSMS = receiveSMS;
    if (typeof bankAccount !== "undefined") update.bankAccount = bankAccount;
    if (typeof vehicle !== "undefined") update.vehicle = vehicle;
    if (phone !== null) update.phone = phone;
    if (address !== undefined) update.address = address;

    // Persist using findByIdAndUpdate (returns the updated doc)
    const id = provided._id ?? provided.id;
    const updatedUser = await User.findByIdAndUpdate(id, { $set: update }, { new: true }).exec();
    if (!updatedUser) return res.status(404).json({ message: "User not found after update" });

    // Build profile shape and return it (same as GET)
    const profile = await buildProfileFromUserObject(updatedUser);
    return res.json(profile);
  } catch (err) {
    console.error("updateProfile error:", err && (err.stack || err.message));
    if (err.code === 11000) return res.status(409).json({ message: "Duplicate field error" });
    return res.status(500).json({ message: "Server error" });
  }
};