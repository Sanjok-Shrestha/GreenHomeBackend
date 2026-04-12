// utils/notify.js
// Minimal notification placeholder. Replace with your real push/email/SMS implementation.

function notifyCollectorPlaceholder(wasteItem) {
  try {
    console.debug("[notify] would notify collectors about waste post", wasteItem._id);
    // Example: enqueue to a background worker, send email, or push update to a WebSocket topic.
  } catch (e) {
    console.warn("[notify] failed", e);
  }
}

module.exports = { notifyCollectorPlaceholder };