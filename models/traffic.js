// models/traffic.js
// Added source, currentSpeed, freeFlowSpeed so TomTom metadata is persisted

const mongoose = require("mongoose");

const trafficSchema = new mongoose.Schema({
  location: {
    type: String,
    required: true,
  },
  lat: {
    type: Number,
    required: true,
  },
  lng: {
    type: Number,
    required: true,
  },
  vehicles: {
    type: Number,
    required: true,
  },
  congestion: {
    type: Number,
    required: true,
  },
  // TomTom metadata — lets you debug what raw speeds were returned
  currentSpeed: {
    type: Number,
    default: null,
  },
  freeFlowSpeed: {
    type: Number,
    default: null,
  },
  source: {
    type: String,
    enum: ["tomtom", "fallback", "time-based"],  // ← added "time-based"
    default: "fallback",
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

module.exports =
  mongoose.models.Traffic || mongoose.model("Traffic", trafficSchema);