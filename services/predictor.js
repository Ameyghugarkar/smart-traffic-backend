// services/predictor.js
// predictTraffic  — next-interval prediction (unchanged)
// predictHourly   — 24-hour forecast anchored to zone personality

const Traffic = require("../models/traffic");

// ─── Hour multipliers — Pune traffic pattern ──────────────────────────────────
const HOUR_MULTIPLIERS = [
  0.10, 0.08, 0.07, 0.06, 0.07, 0.10,  // 0–5  night
  0.25, 0.55, 0.85, 0.95, 0.90, 0.70,  // 6–11 morning
  0.60, 0.65, 0.60, 0.65, 0.75, 0.95,  // 12–17
  1.00, 0.95, 0.80, 0.60, 0.35, 0.20,  // 18–23 evening peak → night
];

// ─── Zone rush-hour peak congestion (used as anchor, not current value) ───────
// This prevents nighttime data from making rush-hour forecasts unrealistically low
const ZONE_PEAK = {
  "Hinjewadi":    0.92,  // IT Park — worst evening rush
  "Wakad":        0.88,  // feeds Hinjewadi
  "Swargate":     0.90,  // major bus hub
  "Shivajinagar": 0.85,  // FC Road
  "Deccan":       0.82,  // JM Road
  "Kothrud":      0.78,
  "Baner":        0.80,
  "Aundh":        0.75,
  "Viman Nagar":  0.78,
  "Hadapsar":     0.80,
  "Kharadi":      0.75,
  "Katraj":       0.72,
};

// ─── Next-interval prediction (original — unchanged) ─────────────────────────
const predictTraffic = async (location) => {
  try {
    const records = await Traffic.find({ location })
      .sort({ timestamp: -1 })
      .limit(10);

    if (!records || records.length === 0) {
      return { location, current: 0, predicted: 0.3, confidence: "low",
               note: "No data — using default" };
    }

    let weightedSum = 0, totalWeight = 0;
    records.forEach((rec, index) => {
      const weight = records.length - index;
      weightedSum += rec.congestion * weight;
      totalWeight += weight;
    });
    const weightedAvg = weightedSum / totalWeight;

    const hour = new Date().getHours();
    let timeMultiplier = 1.0;
    if      (hour >= 8  && hour <= 10) timeMultiplier = 1.25;
    else if (hour >= 17 && hour <= 19) timeMultiplier = 1.30;
    else if (hour >= 22 || hour <= 5 ) timeMultiplier = 0.60;
    else if (hour >= 11 && hour <= 16) timeMultiplier = 0.95;

    let trendAdjustment = 0;
    if (records.length >= 2) {
      const trend = records[0].congestion - records[records.length - 1].congestion;
      trendAdjustment = trend * 0.15;
    }

    const noise = (Math.random() - 0.5) * 0.05;
    const predicted = Math.min(1, Math.max(0,
      (weightedAvg * timeMultiplier) + trendAdjustment + noise
    ));

    return {
      location,
      current:    parseFloat(records[0].congestion.toFixed(3)),
      predicted:  parseFloat(predicted.toFixed(3)),
      confidence: records.length >= 5 ? "high" : "medium",
      dataPoints: records.length,
    };

  } catch (err) {
    console.error(`[Predictor] Error for "${location}":`, err.message);
    return { location, current: 0, predicted: 0.3, confidence: "low" };
  }
};

// ─── 24-hour hourly forecast ──────────────────────────────────────────────────
const predictHourly = async (location) => {
  try {
    const records = await Traffic.find({ location })
      .sort({ timestamp: -1 })
      .limit(10);

    // Use zone peak as the anchor — this represents what the zone looks like
    // at its busiest (6 PM multiplier = 1.0). We scale all hours from this.
    // This way night forecast is low AND rush hour forecast is realistically high
    // regardless of what time the user opens the app.
    const zonePeak = ZONE_PEAK[location] || 0.75;

    // Blend: 70% zone personality + 30% actual current data
    // If we have real data, nudge the forecast up/down slightly
    let dataBlend = 0;
    if (records && records.length > 0) {
      const currentHour = new Date().getHours();
      const currentMult = HOUR_MULTIPLIERS[currentHour] || 0.5;
      const expectedNow = zonePeak * currentMult;
      const actualNow   = records[0].congestion;
      // How different is reality from expectation right now?
      dataBlend = (actualNow - expectedNow) * 0.30;
    }

    const currentHour = new Date().getHours();
    const forecast    = [];

    for (let i = 0; i < 24; i++) {
      const forecastHour = (currentHour + i) % 24;
      const multiplier   = HOUR_MULTIPLIERS[forecastHour];
      const noise        = (Math.random() - 0.5) * 0.03;

      const congestion = Math.min(1, Math.max(0,
        zonePeak * multiplier + dataBlend + noise
      ));

      const h     = forecastHour;
      const ampm  = h >= 12 ? "PM" : "AM";
      const h12   = h === 0 ? 12 : h > 12 ? h - 12 : h;

      forecast.push({
        hour:      forecastHour,
        label:     `${h12}${ampm}`,
        congestion: parseFloat(congestion.toFixed(3)),
        pct:       Math.round(congestion * 100),
        status:    congestion > 0.65 ? "Heavy" : congestion > 0.35 ? "Moderate" : "Clear",
        isCurrent: i === 0,
      });
    }

    return {
      location,
      zonePeak,
      confidence: records?.length >= 5 ? "high" : records?.length >= 2 ? "medium" : "low",
      dataPoints: records?.length || 0,
      forecast,
    };

  } catch (err) {
    console.error(`[HourlyPredictor] Error for "${location}":`, err.message);
    const currentHour = new Date().getHours();
    const forecast = Array.from({ length: 24 }, (_, i) => {
      const h    = (currentHour + i) % 24;
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