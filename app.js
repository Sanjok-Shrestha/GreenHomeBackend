require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

// NOTE: these route files must match your project
const authRoutes = require("./routes/authRoutes");
const usersRouter = require("./routes/UserRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const wasteRoutes = require("./routes/wasteRoutes");
// collectorRoutes will be required dynamically (may be absent)

// Global error handler (if present)
const { errorHandler } = require("./middleware/errorHandler");

const app = express();
const port = process.env.PORT || 5000;

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} Origin=${req.headers.origin || "-"}`);
  next();
});

// CORS - allow the dev client by default
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Health check (useful in browser or container probes)
app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get("/", (req, res) => res.send("GreenHome Backend Running"));

// Mount routers
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRouter);
app.use("/api/waste", wasteRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/rewards", require("./routes/rewardsRoutes"));
// Only mount collector routes if the file exists & requires successfully
try {
  const collectorRoutes = require("./routes/collectorRoutes");
  if (collectorRoutes) {
    app.use("/api/collector", collectorRoutes);
    console.log("collectorRoutes mounted at /api/collector");
  }
} catch (e) {
  console.warn("collectorRoutes not mounted (file may be missing):", e.message);
}

// Global error handler (after routes)
if (errorHandler) app.use(errorHandler);

// Connect to MongoDB and start server
(async () => {
  try {
    const uri = process.env.MONGODB_URI;
    const dbName = process.env.DB_NAME || undefined;
    if (!uri) throw new Error("MONGODB_URI is not set in .env");

    const masked = uri.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:<password>@");
    console.log("Connecting to MongoDB:", masked, dbName ? ` dbName=${dbName}` : "");

    await mongoose.connect(uri, {
      ...(dbName ? { dbName } : {}),
      // other mongoose options can go here
    });

    console.log("Database connected successfully");

    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
  } catch (err) {
    console.error("DB connection error / server not started:", err);
    process.exit(1);
  }
})();