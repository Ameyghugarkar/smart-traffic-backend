// services/predictor.js
// predictTraffic  — next-interval prediction
// predictHourly   — 24-hour forecast
// Both now use purely data-driven statistical modeling from TrafficHistory

const Traffic        = require("../models/traffic");
const TrafficHistory = require("../models/trafficHistory");

// ─── IST helper ───────────────────────────────────────────────────────────────
const getISTTime = (dateObj) => {
  const utcMs = dateObj.getTime() + (dateObj.getTimezoneOffset() * 60000);
  return new Date(utcMs + 5.5 * 3600000);
};

// ─── Get historical baseline for a specific hour ─────────────────────────────
// Queries the database for the average congestion of a zone at a specific hour
const getHistoricalBaseline = async (location, targetHour) => {
  const pipeline = [
    { $unwind: "$zones" },
    { $match: { "zones.location": location } },
    {
      $project: {
        hour: { $hour: { date: "$capturedAt", timezone: "Asia/Kolkata" } },
        congestion: "$zones.congestion"
      }
    },
    { $match: { hour: targetHour } },
    {
      $group: {
        _id: "$hour",
        avgCongestion: { $avg: "$congestion" },
        count: { $sum: 1 }
      }
    }
  ];

  const result = await TrafficHistory.aggregate(pipeline);
  
  if (result.length > 0 && result[0].count >= 1) {
    return {
      baseline: result[0].avgCongestion,
      dataPoints: result[0].count
    };
  }
  
  // Fallback: If no history exists for this specific hour, calculate the global average
  const globalAvgResult = await TrafficHistory.aggregate([
    { $unwind: "$zones" },
    { $match: { "zones.location": location } },
    { $group: { _id: null, avgCongestion: { $avg: "$zones.congestion" } } }
  ]);
  
  if (globalAvgResult.length > 0) {
    return { baseline: globalAvgResult[0].avgCongestion, dataPoints: 0 };
  }
  
  return { baseline: 0.5, dataPoints: 0 };
};

// ─── Confidence from number of history points ─────────────────────────────────
const getConfidence = (n) => n >= 5 ? "high" : n >= 2 ? "medium" : "low";

// ─── Next-interval prediction (Next 15 mins) ──────────────────────────────────
const predictTraffic = async (location) => {
  try {
    const live = await Traffic.findOne({ location }).sort({ timestamp: -1 });
    if (!live) {
      return { location, current: 0, predicted: 0.3, confidence: "low", note: "No data" };
    }

    const now = new Date();
    const futureTime = new Date(now.getTime() + 15 * 60000); // 15 mins from now
    const targetHour = getISTTime(futureTime).getHours();

    const historyData = await getHistoricalBaseline(location, targetHour);
    
    // Get last 3 points for short-term trend
    const recentHistory = await TrafficHistory
      .find({ "zones.location": location })
      .sort({ capturedAt: -1 })
      .limit(3)
      .select("capturedAt zones");

    let trendAdjustment = 0;
    if (recentHistory.length >= 2) {
      const zNew = recentHistory[0].zones.find(z => z.location === location)?.congestion || live.congestion;
      const zOld = recentHistory[recentHistory.length - 1].zones.find(z => z.location === location)?.congestion || live.congestion;
      trendAdjustment = (zNew - zOld) * 0.5; // Momentum
    }

    // Next 15 mins = 70% current + 30% historical baseline + trend (No random noise)
    const predicted = (live.congestion * 0.70) + (historyData.baseline * 0.30) + trendAdjustment;

    return {
      location,
      current:    parseFloat(live.congestion.toFixed(3)),
      predicted:  parseFloat(Math.min(1, Math.max(0, predicted)).toFixed(3)),
      confidence: getConfidence(historyData.dataPoints),
      dataPoints: historyData.dataPoints,
    };

  } catch (err) {
    console.error(`[Predictor] Error for "${location}":`, err.message);
    return { location, current: 0, predicted: 0.3, confidence: "low" };
  }
};

// ─── 24-hour hourly forecast ──────────────────────────────────────────────────
const predictHourly = async (location) => {
  try {
    const live = await Traffic.findOne({ location }).sort({ timestamp: -1 });
    const now  = new Date();
    const currentHour = getISTTime(now).getHours();

    // Fetch historical baseline for all 24 hours in one aggregation query
    const pipeline = [
      { $unwind: "$zones" },
      { $match: { "zones.location": location } },
      {
        $project: {
          hour: { $hour: { date: "$capturedAt", timezone: "Asia/Kolkata" } },
          congestion: "$zones.congestion"
        }
      },
      {
        $group: {
          _id: "$hour",
          avgCongestion: { $avg: "$congestion" },
          count: { $sum: 1 }
        }
      }
    ];

    const allHoursResult = await TrafficHistory.aggregate(pipeline);
    const hourMap = {};
    let totalPoints = 0;
    
    allHoursResult.forEach(r => {
      hourMap[r._id] = r.avgCongestion;
      totalPoints += r.count;
    });

    const globalAvg = Object.values(hourMap).reduce((a,b)=>a+b, 0) / (Object.keys(hourMap).length || 1) || 0.5;

    // Calculate initial anomaly (Current live traffic vs Expected historical traffic)
    const currentBaseline = hourMap[currentHour] || globalAvg;
    const currentCongestion = live?.congestion || currentBaseline;
    const initialAnomaly = currentCongestion - currentBaseline;

    const forecast = [];
    for (let i = 0; i < 24; i++) {
      const forecastHour = (currentHour + i) % 24;
      const baseline     = hourMap[forecastHour] || globalAvg;
      
      // Decay factor: anomaly effect drops as we look further into the future
      const decayFactor = Math.pow(0.80, i); 
      
      const prediction = baseline + (initialAnomaly * decayFactor);
      const clampedPrediction = Math.min(1, Math.max(0, prediction));

      const h    = forecastHour;
      const ampm = h >= 12 ? "PM" : "AM";
      const h12  = h === 0 ? 12 : h > 12 ? h - 12 : h;

      forecast.push({
        hour:       forecastHour,
        label:      `${h12}${ampm}`,
        congestion: parseFloat(clampedPrediction.toFixed(3)),
        pct:        Math.round(clampedPrediction * 100),
        status:     clampedPrediction > 0.65 ? "Heavy" : clampedPrediction > 0.35 ? "Moderate" : "Clear",
        isCurrent:  i === 0,
      });
    }

    return {
      location,
      zonePeak: Math.max(...forecast.map(f => f.congestion)),
      confidence: getConfidence(totalPoints / 24),
      dataPoints: totalPoints,
      forecast,
    };

  } catch (err) {
    console.error(`[HourlyPredictor] Error for "${location}":`, err.message);
    const hour = getISTTime(new Date()).getHours();
    return { 
      location, zonePeak: 0.5, confidence: "low", dataPoints: 0, 
      forecast: Array.from({ length: 24 }, (_, i) => ({
        hour: (hour+i)%24, label: "NA", congestion: 0.5, pct: 50, status: "Moderate", isCurrent: i===0
      }))
    };
  }
};

module.exports = { predictTraffic, predictHourly };
