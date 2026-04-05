const cron = require("node-cron");
const mongoose = require("mongoose");
const Pickup = (() => { try { return require("../models/Pickup"); } catch (e) { return mongoose.models?.Pickup || null; } })();
const notificationService = require("../services/notificationService");

if (!Pickup) console.warn("reminderJobs: Pickup model not found");

function startReminderJobs() {
  const schedule = process.env.REMINDER_CRON || "*/10 * * * *";
  console.log("Starting reminder job schedule:", schedule);

  cron.schedule(schedule, async () => {
    try {
      const windowHours = Number(process.env.REMINDER_HOURS || 24);
      const now = new Date();
      const windowStart = now;
      const windowEnd = new Date(now.getTime() + windowHours * 3600 * 1000);

      const pickups = await Pickup.find({
        scheduledAt: { $gte: windowStart, $lte: windowEnd },
        reminderNotifiedAt: { $exists: false },
        status: { $nin: ["Collected", "Completed"] },
      }).limit(200).lean();

      for (const p of pickups) {
        const recipientId = p.user || p.userId || p.requester || null;
        if (!recipientId) continue;
        const when = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString() : "soon";
        const title = "Pickup reminder";
        const body = `Your pickup is scheduled for ${when}. Please be ready.`;

        try {
          await notificationService.createNotification(recipientId, {
            type: "pickup_reminder",
            title,
            body,
            channel: "all",
            data: { pickupId: p._id },
          });

          await Pickup.findByIdAndUpdate(p._1 ?? p._id, { $set: { reminderNotifiedAt: new Date() } });
        } catch (err) {
          console.error("Failed to notify pickup", p._id, err);
        }
      }
    } catch (err) {
      console.error("reminderJobs error", err && err.stack ? err.stack : err);
    }
  }, { timezone: process.env.TIMEZONE || "UTC" });
}

module.exports = { startReminderJobs };