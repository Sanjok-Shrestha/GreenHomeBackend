// backend/middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const path = require("path");
let UserModel = null;
try {
  UserModel = require(path.join(__dirname, "..", "models", "User"));
} catch (e) {
  UserModel = null;
}

const JWT_SECRET = process.env.JWT_SECRET || "SECRET_KEY";

function unauthorized(res, message = "Not authorized", code = "UNAUTHORIZED") {
  return res.status(401).json({ code, message });
}

exports.protect = async (req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(200);

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

    console.debug("[auth] incoming request for", req.method, req.originalUrl, "Authorization header present:", !!authHeader);

    if (!token) {
      console.warn("[auth] no token provided");
      return unauthorized(res, "Authorization token required", "NO_TOKEN");
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err && err.name === "TokenExpiredError") {
        console.warn("[auth] token verification failed: jwt expired");
        return res.status(401).json({ code: "TOKEN_EXPIRED", message: "Authentication token expired" });
      }
      console.warn("[auth] token verification failed:", err && err.message ? err.message : String(err));
      return unauthorized(res, "Invalid authentication token", "INVALID_TOKEN");
    }

    const userId = decoded.id || decoded._id || decoded.sub;
    if (!userId) {
      console.warn("[auth] token payload missing user id");
      return unauthorized(res, "Invalid token payload", "INVALID_TOKEN_PAYLOAD");
    }

    if (UserModel) {
      try {
        const user = await UserModel.findById(userId).select("-password");
        if (!user) {
          console.warn("[auth] user not found in DB for id:", userId);
          return unauthorized(res, "User not found", "USER_NOT_FOUND");
        }
        req.user = user;
        return next();
      } catch (err) {
        console.error("[auth] DB lookup error:", err && err.message ? err.message : err);
        return unauthorized(res, "Authentication error", "AUTH_DB_ERROR");
      }
    }

    // Dev-only fallback
    if (process.env.NODE_ENV !== "production") {
      req.user = {
        id: userId,
        role: decoded.role || "user",
        name: decoded.name || "Dev User",
        email: decoded.email || "",
      };
      console.debug("[auth] attached token payload as req.user (dev fallback)");
      return next();
    }

    return unauthorized(res, "User information unavailable", "NO_USER_MODEL");
  } catch (err) {
    console.error("[auth] unexpected error:", err && err.stack ? err.stack : err);
    return unauthorized(res, "Authentication error", "AUTH_ERROR");
  }
};

exports.authorize = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not authorized", code: "UNAUTHORIZED" });
  if (roles.length === 0) return next();
  const role = (req.user.role || "").toString();
  if (roles.includes(role)) return next();
  if (Array.isArray(req.user.roles) && req.user.roles.some((r) => roles.includes(r))) return next();
  return res.status(403).json({ message: "Access denied", code: "ACCESS_DENIED" });
};