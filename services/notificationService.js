const nodemailer = require("nodemailer");
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const User = (() => {
  try { return require("../models/User"); } catch (e) { return mongoose.models?.User || null; }
})();

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (process.env.SMTP_HOST && process.env.SMTP_PORT) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

async function sendEmail(to, subject, html, text) {
  const t = getTransporter();
  if (!t) { console.warn("sendEmail: SMTP transporter not configured, skipping email to", to); return false; }
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || `"No Reply" <no-reply@example.com>`,
      to,
      subject,
      text: text || html,
      html,
    });
    return true;
  } catch (err) {
    console.error("sendEmail error:", err && err.message ? err.message : err);
    return false;
  }
}

// Placeholder SMS sender (replace with Twilio or similar)
async function sendSMS(phone, message) {
  console.log("sendSMS placeholder ->", phone, message);
  return false;
}

/**
 * Create notification (persist to DB) and attempt delivery according to channel.
 * Returns the saved Notification document.
 */
async function createNotification(userId, { type, title, body, channel = "inapp", data = {} } = {}) {
  if (!userId) throw new Error("userId required");

  const notif = await Notification.create({
    user: userId,
    type,
    title,
    body,
    channel,
    data,
    sentAt: new Date(),
  });

  // Attempt email if requested
  if ((channel === "email" || channel === "all") && User) {
    try {
      const user = await User.findById(userId).select("email name").lean();
      if (user?.email) {
        const ok = await sendEmail(user.email, title, `<p>${body || ""}</p>`);
        if (ok) {
          notif.deliveredAt = new Date();
          await notif.save();
        }
      }
    } catch (err) {
      console.warn("createNotification email error", err && err.message ? err.message : err);
    }
  }

  // Attempt SMS if requested
  if ((channel === "sms" || channel === "all") && User) {
    try {
      const user = await User.findById(userId).select("phone").lean();
      if (user?.phone) {
        const ok = await sendSMS(user.phone, `${title}${body ? " - " + body : ""}`);
        if (ok) {
          notif.deliveredAt = new Date();
          await notif.save();
        }
      }
    } catch (err) {
      console.warn("createNotification sms error", err && err.message ? err.message : err);
    }
  }

  // Return the saved notification
  return notif;
}

/**
 * Broadcast notifications to users that match the filter (Mongoose query object).
 * Careful with large user sets.
 */
async function broadcast({ type, title, body, channel = "inapp", data = {}, filter = {} } = {}) {
  const UserModel = User;
  if (!UserModel) throw new Error("User model not available for broadcast");

  const cursor = UserModel.find(filter).select("_id").cursor();
  let count = 0;
  for await (const u of cursor) {
    await createNotification(u._id, { type, title, body, channel, data });
    count++;
  }
  return { ok: true, created: count };
}

module.exports = {
  createNotification,
  broadcast,
};