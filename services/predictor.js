// services/predictor.js
// predictTraffic  — next-interval prediction
// predictHourly   — 24-hour forecast anchored to zone personality
// Both now use TrafficHistory for multi-point data & real confidence scoring

const Traffic        = require("../models/traffic");
const TrafficHistory = require("../models/trafficHistory");

// ─── IST helper ───────────────────────────────────────────────────────────────
const getISTHour = () => {
  const now   = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const ist   = new Date(utcMs + 5.5 * 3600000);
  return ist.getHours();
};

// ─── Hour multipliers — Pune traffic pattern ──────────────────────────────────
const HOUR_MULTIPLIERS = [
  0.10, 0.08, 0.07, 0.06, 0.07, 0.10,  // 0–5  night
  0.25, 0.55, 0.85, 0.95, 0.90, 0.70,  // 6–11 morning
  0.60, 0.65, 0.60, 0.65, 0.75, 0.95,  // 12–17
  1.00, 0.95, 0.80, 0.60, 0.35, 0.20,  // 18–23 evening peak → night
];

// ─── Zone rush-hour peak congestion ──────────────────────────────────────────
const ZONE_PEAK = {
  "Hinjewadi":    0.92,
  "Wakad":        0.88,
  "Swargate":     0.90,
  "Shivajinagar": 0.85,
  "Deccan":       0.82,
  "Kothrud":      0.78,
  "Baner":        0.80,
  "Aundh":        0.75,
  "Viman Nagar":  0.78,
  "Hadapsar":     0.80,
  "Kharadi":      0.75,
  "Katraj":       0.72,
};

// ─── Get recent zone readings from TrafficHistory ─────────────────────────────
// Returns array of { congestion, capturedAt } sorted newest-first
const getZoneHistory = async (location, limit = 10) => {
  const snapshots = await TrafficHistory
    .find({ "zones.location": location })
    .sort({ capturedAt: -1 })
    .limit(limit)
    .select("capturedAt zones");

  return snapshots.map(s => {
    const z = s.zones.find(z => z.location === location);
    return { congestion: z?.congestion ?? null, capturedAt: s.capturedAt };
  }).filter(r => r.congestion !== null);
};

// ─── Confidence from number of history points ─────────────────────────────────
// 1 snapshot = 15 min, 5 = 75 min, 10 = 150 min of data
const getConfidence = (n) => n >= 5 ? "high" : n >= 2 ? "medium" : "low";

// ─── Next-interval prediction ─────────────────────────────────────────────────
const predictTraffic = async (location) => {
  try {
    // Get latest live reading
    const live = await Traffic.findOne({ location }).sort({ timestamp: -1 });
    if (!live) {
      return { location, current: 0, predicted: 0.3, confidence: "low",
               note: "No data — using default" };
    }

    // Get historical readings for trend calculation
    const history = await getZoneHistory(location, 10);

    let weightedAvg = live.congestion;
    if (history.length >= 2) {
      let weightedSum = 0, totalWeight = 0;
      history.forEach((rec, i) => {
        const w = history.length - i;
        weightedSum  += rec.congestion * w;
        totalWeight  += w;
      });
      weightedAvg = weightedSum / totalWeight;
    }

    const hour = getISTHour();
    let timeMultiplier = 1.0;
    if      (hour >= 8  && hour <= 10) timeMultiplier = 1.25;
    else if (hour >= 17 && hour <= 19) timeMultiplier = 1.30;
    else if (hour >= 22 || hour <= 5 ) timeMultiplier = 0.60;
    else if (hour >= 11 && hour <= 16) timeMultiplier = 0.95;

    let trendAdjustment = 0;
    if (history.length >= 2) {
      const trend = history[0].congestion - history[history.length - 1].congestion;
      trendAdjustment = trend * 0.15;
    }

    const noise     = (Math.random() - 0.5) * 0.05;
    const predicted = Math.min(1, Math.max(0,
      (weightedAvg * timeMultiplier) + trendAdjustment + noise
    ));

    return {
      location,
      current:    parseFloat(live.congestion.toFixed(3)),
      predicted:  parseFloat(predicted.toFixed(3)),
      confidence: getConfidence(history.length),
      dataPoints: history.length,
    };

  } catch (err) {
    console.error(`[Predictor] Error for "${location}":`, err.message);
    return { location, current: 0, predicted: 0.3, confidence: "low" };
  }
};

// ─── 24-hour hourly forecast ──────────────────────────────────────────────────
const predictHourly = async (location) => {
  try {
    // Get historical readings to blend with zone personality
    const history   = await getZoneHistory(location, 10);
    const live      = await Traffic.findOne({ location }).sort({ timestamp: -1 });
    const zonePeak  = ZONE_PEAK[location] || 0.75;
    const hour      = getISTHour();

    // Blend: 70% zone personality + 30% actual current data offset
    let dataBlend = 0;
    const currentReading = live?.congestion ?? (history[0]?.congestion ?? null);
    if (currentReading !== null) {
      const currentMult = HOUR_MULTIPLIERS[hour] || 0.5;
      const expectedNow = zonePeak * currentMult;
      dataBlend = (currentReading - expectedNow) * 0.30;
    }

    const forecast = [];
    for (let i = 0; i < 24; i++) {
      const forecastHour = (hour + i) % 24;
      const multiplier   = HOUR_MULTIPLIERS[forecastHour];
      const noise        = (Math.random() - 0.5) * 0.03;
      const congestion   = Math.min(1, Math.max(0,
        zonePeak * multiplier + dataBlend + noise
      ));

      const h    = forecastHour;
      const ampm = h >= 12 ? "PM" : "AM";
      const h12  = h === 0 ? 12 : h > 12 ? h - 12 : h;

      forecast.push({
        hour:       forecastHour,
        label:      `${h12}${ampm}`,
        congestion: parseFloat(congestion.toFixed(3)),
        pct:        Math.round(congestion * 100),
        status:     congestion > 0.65 ? "Heavy" : congestion > 0.35 ? "Moderate" : "Clear",
        isCurrent:  i === 0,
      });
    }

    return {
      location,
      zonePeak,
      confidence: getConfidence(history.length),
      dataPoints: history.length,
      forecast,
    };

  } catch (err) {
    console.error(`[HourlyPredictor] Error for "${location}":`, err.message);
    const hour     = getISTHour();
    const forecast = Array.from({ length: 24 }, (_, i) => {
      const h    = (hour + i) % 24;
      const ampm = h >= 12 ? "PM" : "AM";
      const h12  = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return {
        hour: h, label: `${h12}${ampm}`,
        congestion: HOUR_MULTIPLIERS[h] * 0.6,
        pct: Math.round(HOUR_MULTIPLIERS[h] * 60),
        status: "Clear", isCurrent: i === 0,
      };
    });
    return { location, zonePeak: 0.6, confidence: "low", dataPoints: 0, forecast };
  }
};

module.exports = { predictTraffic, predictHourly };
