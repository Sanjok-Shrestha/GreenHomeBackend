// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const path = require("path");
let UserModel = null;
try { UserModel = require(path.join(__dirname, "..", "models", "User")); } catch (e) { UserModel = null; }

const JWT_SECRET = process.env.JWT_SECRET || "SECRET_KEY";

function unauthorized(res, message = "Not authorized") {
  return res.status(401).json({ message });
}

exports.protect = async (req, res, next) => {
  // allow preflight OPTIONS to pass
  if (req.method === "OPTIONS") return res.sendStatus(200);

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

    console.debug("[auth] incoming request for", req.method, req.originalUrl, "Authorization header present:", !!authHeader);

    if (!token) {
      console.warn("[auth] no token provided");
      return unauthorized(res, "Not authorized");
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
      console.debug("[auth] token decoded:", decoded);
    } catch (err) {
      console.warn("[auth] token verification failed:", err && err.message ? err.message : err);
      return unauthorized(res, "Invalid token");
    }

    const userId = decoded.id || decoded._id || decoded.sub;
    if (!userId) {
      console.warn("[auth] token payload missing user id");
      return unauthorized(res, "Invalid token payload");
    }

    // Attempt DB lookup if model exists
    if (UserModel) {
      try {
        const user = await UserModel.findById(userId).select("-password");
        if (user) {
          req.user = user;
          return next();
        }
        console.warn("[auth] user not found in DB for id:", userId);
      } catch (e) {
        console.error("[auth] DB lookup error:", e && e.message ? e.message : e);
      }
    }

    // Dev fallback: attach token payload as req.user so protected routes can still run locally
    // WARNING: This fallback is for development convenience only. Remove in production.
    req.user = { id: userId, role: decoded.role || "user", name: decoded.name || "Dev User", email: decoded.email || "" };
    console.debug("[auth] attached token payload as req.user (dev fallback)");
    return next();
  } catch (err) {
    console.error("[auth] unexpected error:", err && err.stack ? err.stack : err);
    return unauthorized(res, "Authentication error");
  }
};

exports.authorize = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not authorized" });
  if (roles.length === 0) return next();
  const role = (req.user.role || "").toString();
  if (roles.includes(role)) return next();
  if (Array.isArray(req.user.roles) && req.user.roles.some((r) => roles.includes(r))) return next();
  return res.status(403).json({ message: "Access denied" });
};