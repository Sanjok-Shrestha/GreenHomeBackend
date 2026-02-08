require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const authRoutes = require("./Routes/authRoutes");

const app = express();
const port = 5000 ;
const dashboardRoutes = require("./routes/dashboardRoutes");
const wasteRoutes = require("./routes/wasteRoutes");

app.use("/api/waste", wasteRoutes);
app.use("/api/dashboard", dashboardRoutes)
// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get("/", (req, res) => {
  res.send("GreenHome Backend Running");
});

// ✅ Authentication Routes
app.use("/api/auth", authRoutes);



// Database Connection
mongoose.connect(process.env.MONGODB_URI, {
  dbName: "greenhome_database",
})
.then(() => {
  console.log("Database connected successfully");
})
.catch((err) => console.log(err));

// Start Server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
