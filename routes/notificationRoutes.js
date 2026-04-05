// routes/notificationRoutes.js
const express = require("express");
const router = express.Router();

// Simple in-memory store for dev. Replace with DB in production.
const subsByKey = new Map();

// Helper: try to extract a user key (best-effort) from Authorization Bearer JWT payload (no signature verification)
function getUserKeyFromReq(req) {
  try {
    const auth = req.headers.authorization;
    if (!auth) return "anon";
    const token = auth.split(" ")[1];
    if (!token) return "anon";
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"));
    return payload.sub || payload.id || payload.userId || payload.email || `user:${payload?.sub || "unknown"}`;
  } catch (e) {
    return "anon";
  }
}

// VAPID key (provide via env in production)
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "BROWSER_VAPID_PUBLIC_KEY_PLACEHOLDER";

/**
 * GET /api/notifications/vapidPublicKey
 * Returns the public VAPID key client should use to subscribe.
 */
router.get("/vapidPublicKey", (req, res) => {
  return res.json({ key: vapidPublicKey });
});

/**
 * GET /api/notifications/push-subscription/exists
 * Returns { exists: boolean } for the current user.
 */
router.get("/push-subscription/exists", (req, res) => {
  const key = getUserKeyFromReq(req);
  return res.json({ exists: subsByKey.has(key) });
});

/**
 * POST /api/notifications/push-subscription
 * Body: { subscription: <PushSubscription JSON> }
 * Stores subscription for the user (dev-only: in-memory).
 */
router.post("/push-subscription", express.json(), (req, res) => {
  const key = getUserKeyFromReq(req);
  const sub = req.body && req.body.subscription;
  if (!sub) return res.status(400).json({ message: "subscription required" });
  subsByKey.set(key, sub);
  return res.json({ ok: true });
});

/**
 * DELETE /api/notifications/push-subscription
 * Removes stored subscription for the user.
 */
router.delete("/push-subscription", (req, res) => {
  const key = getUserKeyFromReq(req);
  subsByKey.delete(key);
  return res.json({ ok: true });
});

module.exports = router;