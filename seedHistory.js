// seedHistory.js
require("dotenv").config();
const mongoose = require("mongoose");
const TrafficHistory = require("./models/trafficHistory");
const { PUNE_LOCATIONS } = require("./services/dataFetcher");

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

const getSimulatedCongestion = (date) => {
  // IST hour decimal
  const t = (date.getUTCHours() + 5.5) % 24 + date.getUTCMinutes() / 60;
  
  let base;
  if      (t >= 8.0  && t <= 10.5) base = 0.70 + Math.random() * 0.20; // Morning peak
  else if (t >= 12.0 && t <= 14.0) base = 0.40 + Math.random() * 0.20; // Lunch
  else if (t >= 17.0 && t <= 20.5) base = 0.72 + Math.random() * 0.22; // Evening peak
  else if (t >= 22.0 || t <= 5.0 ) base = 0.05 + Math.random() * 0.10; // Night
  else                             base = 0.28 + Math.random() * 0.22; // Off-peak
  return Math.min(1, base);
};

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB.");

    console.log("Deleting old history data...");
    await TrafficHistory.deleteMany({});

    const snapshots = [];
    const now = new Date();
    
    // Generate 30 days of data, 1 snapshot every hour to avoid massive DB bloat
    // But for the last 24 hours, generate 1 every 15 minutes.
    
    console.log("Generating snapshots...");
    for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
      for (let hour = 0; hour < 24; hour++) {
        // Interval: every 15 mins for last day, else every 1 hour
        const intervals = (daysAgo === 0) ? [0, 15, 30, 45] : [0];
        
        for (let minute of intervals) {
          const pastDate = new Date(now.getTime() - (daysAgo * 24 * 60 * 60 * 1000));
          pastDate.setHours(hour, minute, 0, 0);
          
          if (pastDate > now) continue;

          let totalVehicles = 0;
          let heavyZones = 0;
          let clearZones = 0;
          
          const timeBased = getSimulatedCongestion(pastDate);
          
          const zones = PUNE_LOCATIONS.map(loc => {
            const multiplier = ZONE_MULTIPLIER[loc.location] || 1.0;
            // Add some noise
            let congestion = timeBased * multiplier * (0.9 + Math.random() * 0.2);
            congestion = Math.min(1, Math.max(0, congestion));
            congestion = parseFloat(congestion.toFixed(3));
            
            const vehicles = Math.round(congestion * 850 + 100 + Math.random() * 80);
            
            totalVehicles += vehicles;
            if (congestion > 0.65) heavyZones++;
            if (congestion <= 0.35) clearZones++;
            
            return {
              location: loc.location,
              congestion,
              vehicles,
              source: "time-based"
            };
          });
          
          const avgCongestion = parseFloat((zones.reduce((s, z) => s + z.congestion, 0) / zones.length).toFixed(3));
          
          snapshots.push({
            capturedAt: pastDate,
            avgCongestion,
            totalVehicles,
            heavyZones,
            clearZones,
            zones
          });
        }
      }
    }
    
    console.log(`Saving ${snapshots.length} snapshots...`);
    // Insert in batches of 100
    for(let i = 0; i < snapshots.length; i += 100) {
      await TrafficHistory.insertMany(snapshots.slice(i, i + 100));
    }
    
    console.log("✅ Seed completed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Error seeding:", err);
    process.exit(1);
  }
};

seed();
