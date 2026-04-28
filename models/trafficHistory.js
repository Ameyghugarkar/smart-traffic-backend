// models/trafficHistory.js
// Stores a snapshot of all zone data every 15 minutes for historical analytics

const mongoose = require("mongoose");

const zoneSnapshotSchema = new mongoose.Schema({
  location:   { type: String, required: true },
  congestion: { type: Number, required: true },
  vehicles:   { type: Number, required: true },
  source:     { type: String, default: "time-based" },
}, { _id: false });

const trafficHistorySchema = new mongoose.Schema({
  capturedAt:     { type: Date, default: Date.now },
  avgCongestion:  { type: Number, required: true },   // 0–1
  totalVehicles:  { type: Number, required: true },
  heavyZones:     { type: Number, default: 0 },
  clearZones:     { type: Number, default: 0 },
  zones:          [zoneSnapshotSchema],
});

// Auto-delete records older than 30 days to keep DB lean
trafficHistorySchema.index({ capturedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports =
  mongoose.models.TrafficHistory ||
  mongoose.model("TrafficHistory", trafficHistorySchema);
