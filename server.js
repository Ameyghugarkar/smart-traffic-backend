// backend/server.js

const express = require("express");
const cors    = require("cors");
const cron    = require("node-cron");
require("dotenv").config();

const connectDB          = require("./config/db");
const trafficRoutes      = require("./routes/trafficRoutes");
const incidentRoutes     = require("./routes/incidentRoutes");
const authRoutes         = require("./routes/authRoutes");
const { generateTrafficData } = require("./services/dataFetcher");
const Traffic            = require("./models/traffic");
const TrafficHistory     = require("./models/trafficHistory");

const app = express();

app.use(cors());
app.use(express.json());

connectDB();

app.use("/api/traffic",   trafficRoutes);
app.use("/api/incidents", incidentRoutes);
app.use("/api/auth",      authRoutes);

app.get("/", (req, res) => {
  res.send("🚦 Smart Traffic Backend Running");
});

// ─── Cron Job: collect & snapshot traffic every 15 minutes ───────────────────
// Runs at :00, :15, :30, :45 of every hour — safe within TomTom free tier
cron.schedule("*/15 * * * *", async () => {
  console.log(`\n⏰ [Cron] ${new Date().toLocaleString()} — collecting traffic snapshot...`);
  try {
    // 1. Fetch fresh data from TomTom
    const data = await generateTrafficData();

    // 2. Replace live traffic records (current state)
    await Traffic.deleteMany({});
    await Traffic.insertMany(data);

    // 3. Save a historical snapshot
    const avgCongestion = parseFloat(
      (data.reduce((s, z) => s + z.congestion, 0) / data.length).toFixed(3)
    );
    const totalVehicles = data.reduce((s, z) => s + (z.vehicles || 0), 0);
    const heavyZones    = data.filter(z => z.congestion > 0.65).length;
    const clearZones    = data.filter(z => z.congestion <= 0.35).length;

    await TrafficHistory.create({
      avgCongestion,
      totalVehicles,
      heavyZones,
      clearZones,
      zones: data.map(z => ({
        location:   z.location,
        congestion: z.congestion,
        vehicles:   z.vehicles,
        source:     z.source,
      })),
    });

    console.log(`✅ [Cron] Snapshot saved — avg congestion: ${(avgCongestion * 100).toFixed(0)}%, ${data.length} zones\n`);
  } catch (err) {
    console.error("❌ [Cron] Failed:", err.message);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📅 Cron job scheduled — traffic snapshot every 15 minutes`);
});