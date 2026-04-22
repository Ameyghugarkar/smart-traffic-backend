// models/incident.js — added reportedBy fields

const mongoose = require("mongoose");

const incidentSchema = new mongoose.Schema({
  zone:         { type: String, required: true },
  type:         { type: String, enum: ["Accident","Road Closure","Flooding","Construction","Breakdown","Protest","Other"], required: true },
  severity:     { type: String, enum: ["low","medium","high"], default: "medium" },
  description:  { type: String, default: "" },
  lat:          { type: Number, required: true },
  lng:          { type: Number, required: true },
  resolved:     { type: Boolean, default: false },
  reportedBy:   { type: String, default: "Anonymous" },   // user name
  reportedById: { type: String, default: "" },             // user id
  timestamp:    { type: Date, default: Date.now },
});

module.exports = mongoose.models.Incident || mongoose.model("Incident", incidentSchema);