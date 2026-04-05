require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

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
// Accept either a single origin, comma-separated list, or '*' via env.
// Default set to local Vite dev server port 5173.
let FRONTEND_ORIGIN = process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || "http://localhost:5173";
// Normalize comma-separated string into array
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

// Simple global OPTIONS responder
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------------------- Disable caching for API responses ---------------------- */
/* This prevents 304 Not Modified replies for API endpoints and ensures the client
   receives fresh JSON during development. Keeps API responses no-store. */
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Surrogate-Control", "no-store");
  next();
});

/* ---------------------- Uploads static handling (fix) ---------------------- */
/* Purpose:
   - Prevent malformed /api/api/uploads/... duplicates by normalizing requests early
   - Serve the same uploads directory at both /uploads and /api/uploads so frontend
     requests work whether they request '/uploads/..' or axios(baseURL:'/api') + '/uploads/...'
   - Provide a debug route that logs missing files to help diagnose 404s
*/
const uploadsDir = path.join(__dirname, "uploads");

// Normalize accidental duplicate prefix: /api/api/uploads -> /api/uploads
app.use((req, res, next) => {
  if (typeof req.url === "string" && req.url.startsWith("/api/api/uploads")) {
    req.url = req.url.replace(/^\/api\/api\/uploads/, "/api/uploads");
  }
  next();
});

// Serve uploads publicly at both endpoints
app.use("/uploads", express.static(uploadsDir));
app.use("/api/uploads", express.static(uploadsDir));

// Explicit handler that logs missing files (use RegExp route to avoid path-to-regexp parameter syntax issues)
app.get(/^\/api\/uploads\/(.*)$/, (req, res) => {
  // req.params[0] contains the captured "rest of path"
  const rel = (req.params && req.params[0]) ? req.params[0] : "";
  const fs = require("fs");
  const fsPath = path.join(uploadsDir, rel);

  if (!fs.existsSync(fsPath)) {
    console.warn(`[uploads] file not found: ${fsPath} (requested ${req.originalUrl})`);
    return res.status(404).end();
  }

  res.sendFile(fsPath);
});

/* ---------------------- request logging (kept) ---------------------- */
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} Origin=${req.headers.origin || "-"}`);
  next();
});

/* ---------------------- Try to load optional models ---------------------- */
const Pickup = tryRequireCandidates([
  "./model/Pickup",
  "./models/Pickup",
  "./src/models/Pickup",
  "./src/models/pickup",
]);

const Report = tryRequireCandidates([
  "./models/Report",
  "./src/models/Report",
  "./src/models/report",
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
let pricingRoutes = tryRequireCandidates(["./routes/pricing", "./src/routes/pricing"]);

// wasteCategories (GET /api/waste/categories)
let wasteCategoriesRoutes = tryRequireCandidates(["./routes/wasteCategories", "./src/routes/wasteCategories"]);

// adminCategories (DB-backed CRUD at /api/admin/categories)
let adminCategoriesRoutes = tryRequireCandidates(["./routes/adminCategories", "./src/routes/adminCategories"]);

console.log("DEBUG: adminUsersRoutes found:", !!adminUsersRoutes);

/* ---------------------- Mount routes (guarded) ---------------------- */
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

// Health & root
app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now() }));
app.get("/", (req, res) => res.send("GreenHome Backend Running"));
app.get("/api/admin/__ping", (req, res) => res.json({ ok: true, ts: Date.now() }));

if (earningsRoutes) {
  mountRoute("/api/waste", earningsRoutes, "earningsRoutes");
} else {
  mountRoute("/api/waste", wasteRoutes || rewardCollectorRoutes, "wasteRoutes / wasteCollector");
}

// mount wasteCategories
mountRoute("/api/waste", wasteCategoriesRoutes, "wasteCategoriesRoutes");

// --- ALIAS: mount the same waste router at /api/posts so clients requesting /api/posts/* succeed ---
// This creates /api/posts/recent as an alias to the waste router if the waste router exists.
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

// rewards (complex fallback handling)
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

mountRoute("/api/notifications", notificationRoutes, "notificationRoutes");

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

// mount adminCategories (DB-backed) if available
if (adminCategoriesRoutes) {
  mountRoute("/api/admin", adminCategoriesRoutes, "adminCategoriesRoutes");
} else {
  try {
    const directAdminCats = require(path.join(__dirname, "routes", "adminCategories"));
    mountRoute("/api/admin", directAdminCats, "adminCategories (direct)");
    adminCategoriesRoutes = directAdminCats;
  } catch (e) {
    console.warn("adminCategories route not found via loader or direct require. A temporary in-memory handler may be used later.");
  }
}

if (certificatesRoutes) mountRoute("/api", certificatesRoutes, "certificatesRoutes");

/* ---------------------- DEBUG: route list endpoint + explicit fallback mount ---------------------- */

// Expose a JSON list of routes for debugging
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

// Fallback: also mount adminCategoriesRoutes at /api/admin/categories if present
try {
  if (adminCategoriesRoutes) {
    app.use("/api/admin/categories", adminCategoriesRoutes);
    console.log("Fallback: also mounted adminCategoriesRoutes at /api/admin/categories");
  }
} catch (e) {
  console.warn("Failed to mount adminCategoriesRoutes at /api/admin/categories:", e && e.message ? e.message : e);
}

/* ---------------------- Temporary in-memory admin CRUD (dev only) ---------------------- */
/* This provides GET/POST/PATCH/DELETE at /api/admin/categories while a DB-backed router is absent.
   It's intentionally simple and stores data in memory only (lost on server restart). */

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

  // Try to seed from /api/waste/categories if available
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
    const updates = req.body || {};
    memo[idx] = { ...memo[idx], ...updates };
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
  errorHandler = mod && mod.errorHandler ? mod.errorHandler : null;
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

/* ---------------------- Connect DB & Start server ---------------------- */
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

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("DB connection error / server not started:", err && (err.stack || err.message || err));
    process.exit(1);
  }
})();