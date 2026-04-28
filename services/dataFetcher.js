// services/dataFetcher.js
// Hybrid approach: TomTom speed data blended with time-of-day realism
// Handles TomTom's poor coverage of Indian roads gracefully

const axios = require("axios");

const TOMTOM_API_KEY = "9hI7ljRGx18cOYRnp4pbtwBori7Dp42u";

const PUNE_LOCATIONS = [
  { location: "Kothrud",      lat: 18.5040, lng: 73.8120 },
  { location: "Shivajinagar", lat: 18.5300, lng: 73.8470 },
  { location: "Hinjewadi",    lat: 18.5900, lng: 73.7400 },
  { location: "Viman Nagar",  lat: 18.5630, lng: 73.9120 },
  { location: "Hadapsar",     lat: 18.5060, lng: 73.9230 },
  { location: "Kharadi",      lat: 18.5510, lng: 73.9380 },
  { location: "Baner",        lat: 18.5560, lng: 73.7890 },
  { location: "Wakad",        lat: 18.5970, lng: 73.7620 },
  { location: "Aundh",        lat: 18.5580, lng: 73.8080 },
  { location: "Katraj",       lat: 18.4530, lng: 73.8660 },
  { location: "Swargate",     lat: 18.5005, lng: 73.8560 },
  { location: "Deccan",       lat: 18.5170, lng: 73.8430 },
];

// Realistic time-of-day base congestion for Pune
// Always use IST (UTC+5:30) — Railway server runs in UTC
const getTimeBasedCongestion = () => {
  const now        = new Date();
  const utcMs      = now.getTime() + (now.getTimezoneOffset() * 60000); // UTC ms
  const istMs      = utcMs + (5.5 * 60 * 60 * 1000);                   // IST = UTC+5:30
  const ist        = new Date(istMs);
  const t          = ist.getHours() + ist.getMinutes() / 60;            // IST decimal hours

  let base;
  if      (t >= 8.0  && t <= 10.5) base = 0.70 + Math.random() * 0.20; // Morning peak
  else if (t >= 12.0 && t <= 14.0) base = 0.40 + Math.random() * 0.20; // Lunch
  else if (t >= 17.0 && t <= 20.5) base = 0.72 + Math.random() * 0.22; // Evening peak
  else if (t >= 22.0 || t <= 5.0 ) base = 0.05 + Math.random() * 0.10; // Night (low)
  else                              base = 0.28 + Math.random() * 0.22; // Off-peak

  console.log(`🕐 IST time: ${ist.getHours()}:${String(ist.getMinutes()).padStart(2,"0")} → base congestion: ${(base*100).toFixed(0)}%`);
  return parseFloat(Math.min(1, base).toFixed(3));
};


// Per-zone character multipliers
const ZONE_MULTIPLIER = {
  "Shivajinagar": 1.15,
  "Swargate":     1.20,
  "Deccan":       1.10,
  "Kothrud":      1.05,
  "Hinjewadi":    1.25,
  "Wakad":        1.20,
  "Baner":        1.10,
  "Viman Nagar":  1.05,
  "Hadapsar":     1.05,
  "Kharadi":      1.00,
  "Aundh":        1.00,
  "Katraj":       0.95,
};

// Detect if TomTom data is actually trustworthy
const isTomTomReliable = (currentSpeed, freeFlowSpeed) => {
  if (!currentSpeed || !freeFlowSpeed || freeFlowSpeed <= 0) return false;
  const hour = new Date().getHours();
  const isPeakHour = (hour >= 7 && hour <= 22);
  const speedRatio = currentSpeed / freeFlowSpeed;
  if (isPeakHour && speedRatio >= 0.95) return false; // suspiciously clear during peak
  if (freeFlowSpeed < 15) return false; // snapped to footpath/service lane
  return true;
};

const fetchOneLocation = async ({ location, lat, lng }) => {
  let tomtomCongestion = null;
  let currentSpeed     = null;
  let freeFlowSpeed    = null;

  for (const zoom of [12, 10]) {
    try {
      const url =
        `https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/${zoom}/json` +
        `?point=${lat},${lng}&unit=KMPH&openLr=false&key=${TOMTOM_API_KEY}`;

      const res  = await axios.get(url, { timeout: 8000 });
      const data = res.data?.flowSegmentData;
      if (!data?.currentSpeed || !data?.freeFlowSpeed) continue;

      currentSpeed  = data.currentSpeed;
      freeFlowSpeed = data.freeFlowSpeed;

      if (!isTomTomReliable(currentSpeed, freeFlowSpeed)) {
        console.log(`⚠️  ${location} [zoom${zoom}]: unreliable (${currentSpeed}/${freeFlowSpeed}) — blending with time`);
        break;
      }

      const currentTT  = data.currentTravelTime;
      const freeFlowTT = data.freeFlowTravelTime;
      if (freeFlowTT && currentTT && freeFlowTT > 0) {
        tomtomCongestion = 1 - (freeFlowTT / currentTT);
      } else {
        tomtomCongestion = 1 - (currentSpeed / freeFlowSpeed);
      }
      tomtomCongestion = Math.min(1, Math.max(0, tomtomCongestion));
      console.log(`✅ ${location} [zoom${zoom}]: ${currentSpeed}/${freeFlowSpeed} km/h → ${(tomtomCongestion*100).toFixed(0)}%`);
      break;

    } catch (err) {
      console.warn(`⚠️  ${location} [zoom${zoom}]: ${err.message}`);
    }
  }

  const timeBased  = getTimeBasedCongestion();
  const multiplier = ZONE_MULTIPLIER[location] || 1.0;

  let finalCongestion;
  let source;

  if (tomtomCongestion !== null) {
    finalCongestion = (tomtomCongestion * 0.6) + (timeBased * 0.4);
    source = "tomtom";
  } else {
    finalCongestion = Math.min(1, timeBased * multiplier);
    source = "time-based";
  }

  finalCongestion = parseFloat(finalCongestion.toFixed(3));
  const vehicles  = Math.round(finalCongestion * 850 + 100 + Math.random() * 80);

  console.log(`📍 ${location}: final=${(finalCongestion*100).toFixed(0)}% [${source}]`);

  return {
    location, lat, lng,
    vehicles,
    congestion:   finalCongestion,
    currentSpeed,
    freeFlowSpeed,
    source,
    timestamp: new Date(),
  };
};

const generateTrafficData = async () => {
  console.log("\n🌍 Fetching Pune traffic data (hybrid TomTom + time-based)...\n");

  const results = await Promise.all(
    PUNE_LOCATIONS.map(loc => fetchOneLocation(loc))
  );

  const tomtomCount = results.filter(r => r.source === "tomtom").length;
  const timeCount   = results.filter(r => r.source === "time-based").length;
  console.log(`\n📊 Done: ${tomtomCount} TomTom-blended, ${timeCount} time-based\n`);

  return results;
};

module.exports = { generateTrafficData, PUNE_LOCATIONS };