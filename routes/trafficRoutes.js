// routes/trafficRoutes.js

const express  = require("express");
const router   = express.Router();
const Traffic  = require("../models/traffic");
const TrafficHistory = require("../models/trafficHistory");
const { generateTrafficData }           = require("../services/dataFetcher");
const { predictTraffic, predictHourly } = require("../services/predictor");

// ─── Get historical snapshots ─────────────────────────────────────────────────
// ?range=24h (default) | 7d | 30d
// OR ?start=ISO_STRING&end=ISO_STRING
router.get("/history", async (req, res) => {
  try {
    const { range, start, end } = req.query;
    let queryFilter = {};

    if (start && end) {
      queryFilter = {
        capturedAt: { $gte: new Date(start), $lte: new Date(end) }
      };
    } else {
      const defaultRange = range || "24h";
      const now   = new Date();
      let   since;

      if      (defaultRange === "7d")  since = new Date(now - 7  * 24 * 60 * 60 * 1000);
      else if (defaultRange === "30d") since = new Date(now - 30 * 24 * 60 * 60 * 1000);
      else                             since = new Date(now - 24 *      60 * 60 * 1000); // 24h
      
      queryFilter = { capturedAt: { $gte: since } };
    }

    const snapshots = await TrafficHistory
      .find(queryFilter)
      .sort({ capturedAt: 1 })
      .select("capturedAt avgCongestion totalVehicles heavyZones clearZones");

    res.json({ success: true, count: snapshots.length, snapshots });
  } catch (err) {
    console.error("[Route /history]", err.message);
    res.status(500).json({ success: false, snapshots: [] });
  }
});

// ─── Get historical snapshots for a specific zone ─────────────────────────────
router.get("/history/:location", async (req, res) => {
  try {
    const location = decodeURIComponent(req.params.location).trim();
    const range    = req.query.range || "24h";
    const now      = new Date();
    let   since;

    if      (range === "7d")  since = new Date(now - 7  * 24 * 60 * 60 * 1000);
    else if (range === "30d") since = new Date(now - 30 * 24 * 60 * 60 * 1000);
    else                      since = new Date(now - 24 *      60 * 60 * 1000);

    const snapshots = await TrafficHistory
      .find({ capturedAt: { $gte: since }, "zones.location": location })
      .sort({ capturedAt: 1 })
      .select("capturedAt zones");

    const result = snapshots.map(s => {
      const z = s.zones.find(z => z.location === location);
      return {
        capturedAt:  s.capturedAt,
        congestion:  z ? Math.round(z.congestion * 100) : null,
        vehicles:    z ? z.vehicles : null,
      };
    });

    res.json({ success: true, location, range, data: result });
  } catch (err) {
    console.error("[Route /history/:location]", err.message);
    res.status(500).json({ success: false, data: [] });
  }
});


// ─── Generate fresh data ──────────────────────────────────────────────────────
router.get("/generate", async (req, res) => {
  try {
    await Traffic.deleteMany({});
    const data = await generateTrafficData();
    await Traffic.insertMany(data);
    res.json({ success: true, message: `Generated ${data.length} traffic records`, count: data.length });
  } catch (err) {
    console.error("[Route /generate]", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Get all traffic records — plain array ────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const data = await Traffic.find().sort({ timestamp: -1 });
    res.json(data);
  } catch (err) {
    console.error("[Route /]", err.message);
    res.status(500).json([]);
  }
});

// ─── 24-hour hourly forecast — MUST be before /predict/:location ─────────────
// If this is placed after, Express matches "hourly" as the :location param
router.get("/predict/hourly/:location", async (req, res) => {
  const location = decodeURIComponent(req.params.location).trim();
  if (!location) return res.json({ location: "", forecast: [] });
  try {
    const result = await predictHourly(location);
    res.json(result);
  } catch (err) {
    console.error("[Route /predict/hourly]", err.message);
    res.json({ location, forecast: [], confidence: "low" });
  }
});

// ─── Next-interval prediction — AFTER hourly to avoid param conflict ──────────
router.get("/predict/:location", async (req, res) => {
  const location = decodeURIComponent(req.params.location).trim();
  if (!location) return res.json({ location: "", current: 0, predicted: 0, confidence: "low" });
  try {
    const result = await predictTraffic(location);
    res.json(result);
  } catch (err) {
    console.error("[Route /predict]", err.message);
    res.json({ location, current: 0, predicted: 0.3, confidence: "low" });
  }
});

module.exports = router;