// app.js — main server bootstrap (updated to mount wasteSchedule and attach socket.io)
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

// Helper: resolve-and-require; returns module or null
function tryRequire(p) {
  try {
    const resolved = require.resolve(path.resolve(__dirname, p));
    return require(resolved);
  } catch (e) {
    return null;
  }
}

// Helper: require first existing candidate path from array
function tryRequireCandidates(candidates) {
  for (const p of candidates) {
    try {
      const resolved = require.resolve(path.resolve(__dirname, p));
      const mod = require(resolved);
      console.log(`Loaded module from: ${p}`);
      return mod;
    } catch (e) {
      // ignore and try next
    }
  }
  return null;
}

/* ---------------------- Express setup ---------------------- */
const app = express();
const PORT = process.env.PORT || 5000;

/* ---------------------- CORS and parsers (MUST BE BEFORE ROUTE MOUNTS) ---------------------- */
let FRONTEND_ORIGIN = process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || "http://localhost:5173";
if (typeof FRONTEND_ORIGIN === "string" && FRONTEND_ORIGIN.includes(",")) {
  FRONTEND_ORIGIN = FRONTEND_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
}
console.log("Configured FRONTEND_ORIGIN =", FRONTEND_ORIGIN);

const corsOptions = {
  origin: (origin, callback) => {
    console.log("CORS check origin =", origin);
    if (!origin) return callback(null, true);
    if (FRONTEND_ORIGIN === "*" || FRONTEND_ORIGIN === true) return callback(null, true);
    const allowed = Array.isArray(FRONTEND_ORIGIN)
      ? FRONTEND_ORIGIN.includes(origin)
      : origin === FRONTEND_ORIGIN;
    if (allowed) return callback(null, true);
    const err = new Error("Not allowed by CORS");
    err.status = 403;
    return callback(err);
  },
  credentials: true,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  preflightContinue: false,
  optionsSuccessStatus: 200,
};

// Debug incoming origin
app.use((req, res, next) => {
  console.log("Incoming request - method=%s url=%s Origin=%s", req.method, req.url, req.headers.origin || "-");
  next();
});

app.use(cors(corsOptions));
app.use((req, res, next) => { if (req.method === "OPTIONS") return res.sendStatus(200); next(); });
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------------------- Disable caching for API responses ---------------------- */
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Surrogate-Control", "no-store");
  next();
});

/* ---------------------- Uploads static handling ---------------------- */
const uploadsDir = path.join(__dirname, "uploads");
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) { /* ignore */ }

app.use((req, res, next) => {
  if (typeof req.url === "string" && req.url.startsWith("/api/api/uploads")) {
    req.url = req.url.replace(/^\/api\/api\/uploads/, "/api/uploads");
  }
  next();
});

app.use("/uploads", express.static(uploadsDir));
app.use("/api/uploads", express.static(uploadsDir));
app.get(/^\/api\/uploads\/(.*)$/, (req, res) => {
  const rel = (req.params && req.params[0]) ? req.params[0] : "";
  const fsPath = path.join(uploadsDir, rel);
  if (!fs.existsSync(fsPath)) {
    console.warn(`[uploads] file not found: ${fsPath} (requested ${req.originalUrl})`);
    return res.status(404).end();
  }
  res.sendFile(fsPath);
});

/* ---------------------- request logging ---------------------- */
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} Origin=${req.headers.origin || "-"}`);
  next();
});

/* ---------------------- Try to load optional models ---------------------- */
const PickupModel = tryRequireCandidates([
  "./model/Pickup",
  "./models/Pickup",
  "./src/models/Pickup",
  "./src/models/pickup",
]);

/* ---------------------- Try to load optional routes ---------------------- */
let earningsRoutes = tryRequireCandidates(["./routes/earnings", "./src/routes/earnings"]);
let authRoutes = tryRequireCandidates(["./routes/authRoutes", "./src/routes/authRoutes", "./routes/auth"]);
let usersRouter = tryRequireCandidates(["./routes/UserRoutes", "./routes/userRoutes", "./src/routes/UserRoutes"]);
let dashboardRoutes = tryRequireCandidates(["./routes/dashboardRoutes", "./src/routes/dashboardRoutes"]);
let wasteRoutes = tryRequireCandidates(["./routes/wasteRoutes", "./src/routes/wasteRoutes"]);
let collectorRoutes = tryRequireCandidates(["./routes/collectorRoutes", "./src/routes/collectorRoutes"]);
let rewardsRoutes = tryRequireCandidates(["./routes/rewardRoutes", "./routes/rewardsRoutes", "./src/routes/rewardRoutes"]);
let adminCollectorsRouter = tryRequireCandidates(["./routes/adminCollectors", "./src/routes/adminCollectors"]);
let adminUsersRoutes = tryRequireCandidates(["./routes/adminUsers", "./src/routes/adminUsers"]);
let notificationRoutes = tryRequireCandidates(["./routes/notificationRoutes", "./src/routes/notificationRoutes"]);
let adminRedemptionsRoutes = tryRequireCandidates(["./routes/adminRedemptions", "./src/routes/adminRedemptions"]);
let adminOverviewRoutes = tryRequireCandidates(["./routes/adminOverview", "./src/routes/adminOverview"]);
let adminReportsRoutes = tryRequireCandidates(["./routes/adminReports", "./src/routes/adminReports"]);
let rewardCollectorRoutes = tryRequireCandidates(["./routes/wasteCollector", "./src/routes/wasteCollector", "./routes/collectorRedeem"]);
let collectorAnalytics = tryRequireCandidates(["./routes/collectorAnalytics", "./src/routes/collectorAnalytics"]);
let certificatesRoutes = tryRequireCandidates(["./routes/certificates", "./routes/certificates"]);
let pricingRoutes = tryRequireCandidates(["./routes/pricing", "./routes/pricing"]);
let wasteCategoriesRoutes = tryRequireCandidates(["./routes/wasteCategories", "./src/routes/wasteCategories"]);
let adminCategoriesRoutes = tryRequireCandidates(["./routes/adminCategories", "./src/routes/adminCategories"]);

// NEW: try to load wasteSchedule router (the schedule/cancel endpoints)
let wasteScheduleRoutes = tryRequireCandidates(["./routes/wasteSchedule", "./src/routes/wasteSchedule"]);

/* ---------------------- Mount helper ---------------------- */
function mountRoute(prefix, mod, name) {
  if (!mod) {
    console.warn(`${name} not mounted (module not found).`);
    return;
  }
  try {
    app.use(prefix, mod);
    console.log(`Mounted ${name} at ${prefix}`);
  } catch (e) {
    console.warn(`Failed to mount ${name} at ${prefix}:`, e.message || e);
  }
}

/* ---------------------- Health & root endpoints ---------------------- */
app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now() }));
app.get("/", (req, res) => res.send("GreenHome Backend Running"));
app.get("/api/admin/__ping", (req, res) => res.json({ ok: true, ts: Date.now() }));

/* ---------------------- Mount primary routes ---------------------- */
if (earningsRoutes) {
  mountRoute("/api/waste", earningsRoutes, "earningsRoutes");
} else {
  mountRoute("/api/waste", wasteRoutes || rewardCollectorRoutes, "wasteRoutes / wasteCollector");
}

// wasteCategories
mountRoute("/api/waste", wasteCategoriesRoutes, "wasteCategoriesRoutes");

// alias /api/posts
try {
  const aliasModule = earningsRoutes || wasteRoutes || rewardCollectorRoutes;
  if (aliasModule) {
    mountRoute("/api/posts", aliasModule, "wasteRoutes (mounted as /api/posts alias)");
    console.log("Alias mounted: /api/posts -> wasteRoutes");
  } else {
    console.warn("Alias not created: wasteRoutes module not found for /api/posts");
  }
} catch (e) {
  console.warn("Failed to mount /api/posts alias:", e && e.message ? e.message : e);
}

// pricing
mountRoute("/api/pricing", pricingRoutes, "pricingRoutes");

// common mounts
mountRoute("/api/auth", authRoutes, "authRoutes");
mountRoute("/api/users", usersRouter, "usersRouter");
mountRoute("/api/dashboard", dashboardRoutes, "dashboardRoutes");
mountRoute("/api/collector", collectorRoutes, "collectorRoutes");
mountRoute("/api/collector", collectorAnalytics, "collectorAnalytics (mounted at same prefix)");

// rewards mounting (keep fallback behavior)
if (rewardsRoutes) {
  mountRoute("/api", rewardsRoutes, "rewardsRoutes (mounted at /api)");
} else {
  mountRoute("/api/rewards", rewardsRoutes, "rewardsRoutes (fallback mount)");
  try {
    const direct = require(path.join(__dirname, "routes", "rewardRoutes"));
    mountRoute("/api", direct, "rewardRoutes (direct)");
    rewardsRoutes = direct;
  } catch (e) {
    try {
      const direct2 = require(path.join(__dirname, "routes", "rewardsRoutes"));
      mountRoute("/api", direct2, "rewardsRoutes (direct)");
      rewardsRoutes = direct2;
    } catch (e2) {
      console.warn("rewardRoutes not found via direct require.");
    }
  }
}

// Prefer combined notifications router if present, otherwise fall back to discovered notificationRoutes
try {
  const combinedNotifications = require(path.join(__dirname, "routes", "notifications"));
  mountRoute("/api/notifications", combinedNotifications, "notifications (combined)");
} catch (e) {
  mountRoute("/api/notifications", notificationRoutes, "notificationRoutes (fallback)");
}

// admin mounts
if (adminCollectorsRouter) mountRoute("/api/admin", adminCollectorsRouter, "adminCollectors");

if (adminUsersRoutes) {
  mountRoute("/api/admin", adminUsersRoutes, "adminUsers");
} else {
  try {
    const m = require(path.join(__dirname, "routes", "adminUsers"));
    mountRoute("/api/admin", m, "adminUsers (direct)");
  } catch (e) {
    console.warn("adminUsers not found via direct require.");
  }
}

if (adminRedemptionsRoutes) mountRoute("/api/admin", adminRedemptionsRoutes, "adminRedemptions");
if (adminOverviewRoutes) mountRoute("/api/admin", adminOverviewRoutes, "adminOverview");
if (adminReportsRoutes) mountRoute("/api/admin", adminReportsRoutes, "adminReports");

// mount adminCategories (DB-backed) if available; also mount fallback path at /api/admin/categories
if (adminCategoriesRoutes) {
  mountRoute("/api/admin", adminCategoriesRoutes, "adminCategoriesRoutes");
  try { app.use("/api/admin/categories", adminCategoriesRoutes); console.log("Also mounted adminCategoriesRoutes at /api/admin/categories"); } catch (e) {}
} else {
  try {
    const directAdminCats = require(path.join(__dirname, "routes", "adminCategories"));
    mountRoute("/api/admin", directAdminCats, "adminCategories (direct)");
    app.use("/api/admin/categories", directAdminCats);
  } catch (e) {
    console.warn("adminCategories route not found via loader or direct require. A temporary in-memory handler may be used later.");
  }
}

/* ---------------------- NEW: mount wasteScheduleRoutes so schedule endpoints exist ---------------------- */
// This mounts the schedule router at /api/waste; its routes are relative, e.g. /:id/schedule maps to /api/waste/:id/schedule
if (wasteScheduleRoutes) {
  mountRoute("/api/waste", wasteScheduleRoutes, "wasteScheduleRoutes");
} else {
  try {
    const wsDirect = require(path.join(__dirname, "routes", "wasteSchedule"));
    mountRoute("/api/waste", wsDirect, "wasteSchedule (direct)");
  } catch (e) {
    console.warn("wasteSchedule router not found; scheduling endpoints will not exist until routes/wasteSchedule.js is added.");
  }
}

/* mount certificates if present (some routers define /certificates internally) */
if (certificatesRoutes) {
  mountRoute("/api", certificatesRoutes, "certificatesRoutes");
}

/* ---------------------- DEBUG: route list endpoint ---------------------- */
app.get("/__debug/routes", (req, res) => {
  const out = [];
  const stack = app._router?.stack || [];
  stack.forEach((layer) => {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods || {}).map((m) => m.toUpperCase()).join(",");
      out.push({ path: layer.route.path, methods });
    } else if (layer.name === "router" && layer.handle && Array.isArray(layer.handle.stack)) {
      layer.handle.stack.forEach((handler) => {
        if (!handler.route) return;
        const methods = Object.keys(handler.route.methods || {}).map((m) => m.toUpperCase()).join(",");
        out.push({ path: handler.route.path, methods });
      });
    }
  });
  res.json(out);
});

/* ---------------------- Temporary in-memory admin CRUD (dev only) ---------------------- */
(() => {
  // If a DB-backed adminCategoriesRoutes is mounted, skip the temp router.
  if (adminCategoriesRoutes) {
    console.log("DB-backed adminCategoriesRoutes present — skipping temporary in-memory admin router.");
    return;
  }

  const expressLocal = require("express");
  const tmpRouter = expressLocal.Router();

  let memo = []; // in-memory store: { _id, name, description, active }
  let nextId = 1;

  async function seedFromWaste() {
    try {
      const host = process.env.INTERNAL_API_HOST || `http://localhost:${process.env.PORT || 5000}`;
      let fetchImpl;
      if (typeof fetch === "function") fetchImpl = fetch;
      else {
        try { fetchImpl = require("node-fetch"); } catch (e) { fetchImpl = null; }
      }
      if (!fetchImpl) return;
      const r = await fetchImpl(`${host}/api/waste/categories`);
      if (!r || !r.ok) return;
      const data = await r.json().catch(() => null);
      if (!data) return;
      if (Array.isArray(data) && data.length) {
        if (typeof data[0] === "string") {
          memo = data.map((s) => ({ _id: `s-${nextId++}`, name: s, description: "", active: true }));
        } else {
          memo = data.map((d) => ({
            _id: `s-${nextId++}`,
            name: d.name ?? d.label ?? String(d).slice(0, 100),
            description: d.description ?? "",
            active: typeof d.active === "boolean" ? d.active : true,
          }));
        }
      }
    } catch (e) {
      // ignore any seed errors
    }
  }

  seedFromWaste();

  tmpRouter.get("/", (req, res) => res.json(memo));

  tmpRouter.post("/", (req, res) => {
    const { name, description, active } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ message: "Name required" });
    const trimmed = String(name).trim();
    const existing = memo.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return res.status(200).json(existing);
    const created = { _id: String(nextId++), name: trimmed, description: description ?? "", active: typeof active === "boolean" ? active : true };
    memo.unshift(created);
    return res.status(201).json(created);
  });

  tmpRouter.patch("/:id", (req, res) => {
    const { id } = req.params;
    const idx = memo.findIndex((c) => String(c._id) === String(id));
    if (idx === -1) return res.status(404).json({ message: "Not found" });
    memo[idx] = { ...memo[idx], ...(req.body || {}) };
    return res.json(memo[idx]);
  });

  tmpRouter.delete("/:id", (req, res) => {
    const { id } = req.params;
    const idx = memo.findIndex((c) => String(c._id) === String(id));
    if (idx === -1) return res.status(404).json({ message: "Not found" });
    memo.splice(idx, 1);
    return res.json({ success: true });
  });

  app.use("/api/admin/categories", tmpRouter);
  console.log("Temporary in-memory admin /api/admin/categories mounted (dev only).");
})();

/* ---------------------- Error handler (optional) ---------------------- */
let errorHandler;
try {
  const mod = tryRequireCandidates(["./middleware/errorHandler", "./src/middleware/errorHandler"]);
  errorHandler = mod && (typeof mod === "function" ? mod : mod.errorHandler ? mod.errorHandler : null);
  if (errorHandler) {
    app.use(errorHandler);
    console.log("Loaded external errorHandler middleware.");
  }
} catch (e) {
  // ignore
}

if (!errorHandler) {
  app.use((err, req, res, next) => {
    console.error("Unhandled error:", err && err.stack ? err.stack : err);
    if (res.headersSent) return next(err);
    const status = err && err.status ? err.status : 500;
    res.status(status).json({ message: err && err.message ? err.message : "Internal Server Error" });
  });
}

/* ---------------------- Scheduler (optional) ---------------------- */
try {
  const scheduler = tryRequireCandidates(["./scheduler/reminderJobs", "./src/scheduler/reminderJobs"]);
  if (scheduler && typeof scheduler.startReminderJobs === "function") {
    scheduler.startReminderJobs();
    console.log("Started reminderJobs scheduler (if configured).");
  } else {
    console.warn("Scheduler not found or startReminderJobs missing.");
  }
} catch (e) {
  console.warn("Failed to start scheduler:", e.message || e);
}

/* ---------------------- Utility: list registered routes (debug) ---------------------- */
function listRoutes() {
  const routes = [];
  try {
    const stack = app._router?.stack || [];
    stack.forEach((layer) => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods || {}).map((m) => m.toUpperCase()).join(",");
        routes.push(`${methods} ${layer.route.path}`);
      } else if (layer.name === "router" && layer.handle && Array.isArray(layer.handle.stack)) {
        layer.handle.stack.forEach((handler) => {
          if (!handler.route) return;
          const methods = Object.keys(handler.route.methods || {}).map((m) => m.toUpperCase()).join(",");
          routes.push(`${methods} ${handler.route.path}`);
        });
      }
    });
  } catch (e) {
    console.warn("listRoutes error:", e && e.stack ? e.stack : e);
  }
  console.log("Registered routes:\n", routes.join("\n") || "(none)");
}

/* ---------------------- Connect DB & Start HTTP + Socket server ---------------------- */
(async () => {
  try {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    const dbName = process.env.DB_NAME || undefined;
    if (!uri) {
      console.error("MONGODB_URI (or MONGO_URI) is not set in .env — server will not start.");
      process.exit(1);
    }

    const masked = uri.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:<password>@");
    console.log("Connecting to MongoDB:", masked, dbName ? ` dbName=${dbName}` : "");

    await mongoose.connect(uri, {
      ...(dbName ? { dbName } : {}),
    });

    console.log("Database connected successfully");

    // Print route map for debugging
    listRoutes();

    // Create HTTP server and attach socket.io
    const server = http.createServer(app);

    const io = new Server(server, {
      cors: {
        origin: FRONTEND_ORIGIN,
        credentials: true,
      },
      maxHttpBufferSize: 1e6,
    });

    // expose globally for controllers that may emit events
    global.io = io;

    // Try to resolve WastePost model (use loader used earlier)
    const WastePost = tryRequireCandidates([
      "./models/WastePost",
      "./model/WastePost",
      "./src/models/WastePost",
      "./server/models/WastePost",
    ]) || null;

    const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

    // Socket auth middleware: parse Bearer token from handshake.auth.token or Authorization header
    io.use((socket, next) => {
      try {
        const token =
          socket.handshake?.auth?.token ||
          (socket.handshake?.headers?.authorization || "").replace(/^Bearer\s+/i, "");
        if (!token) {
          socket.userId = null;
          return next();
        }
        const payload = jwt.verify(token, JWT_SECRET);
        socket.userId = payload.id || payload._id || payload.userId || null;
        return next();
      } catch (err) {
        // invalid token -> mark as anonymous (or reject with next(err) to enforce)
        socket.userId = null;
        return next();
      }
    });

    io.on("connection", (socket) => {
      // join/leave rooms for specific pickups
      socket.on("join-waste-room", (wasteId) => {
        if (typeof wasteId !== "string") return;
        socket.join(`waste:${wasteId}`);
      });

      socket.on("leave-waste-room", (wasteId) => {
        if (typeof wasteId !== "string") return;
        socket.leave(`waste:${wasteId}`);
      });

      // collector sends live location update
      socket.on("collector-location", async (payload = {}) => {
        try {
          const { wasteId, lat, lng } = payload || {};
          if (!wasteId || typeof lat !== "number" || typeof lng !== "number") return;
          // must be authenticated collector
          const uid = socket.userId;
          if (!uid) return;

          if (!WastePost) return;
          const waste = await WastePost.findById(wasteId).select("collector shareLocation");
          if (!waste) return;
          if (!waste.collector || String(waste.collector) !== String(uid)) return;

          // Optionally respect shareLocation flag; if you want to require it uncomment:
          // if (!waste.shareLocation) return;

          // update last known collector location
          waste.collectorLocation = { lat, lng, updatedAt: new Date() };
          await waste.save();

          // emit to room
          io.to(`waste:${wasteId}`).emit("collector-location", {
            wasteId,
            lat,
            lng,
            updatedAt: waste.collectorLocation.updatedAt,
          });
        } catch (err) {
          console.error("socket collector-location error:", err && (err.stack || err.message));
        }
      });

      socket.on("disconnect", () => {
        // optional cleanup
      });
    });

    server.listen(PORT, () => {
      console.log(`HTTP+Socket server listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("DB connection error / server not started:", err && (err.stack || err.message || err));
    process.exit(1);
  }
})();