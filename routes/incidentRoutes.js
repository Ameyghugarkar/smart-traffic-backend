// routes/incidentRoutes.js — Full CRUD + reportedBy tracking

const express   = require("express");
const router    = express.Router();
const Incident  = require("../models/incident");
const { protect, adminOnly } = require("../middleware/auth");

// ─── CREATE — POST /api/incidents ────────────────────────────────────────────
router.post("/", protect, async (req, res) => {
  try {
    const { zone, type, severity, description, lat, lng } = req.body;
    if (!zone || !type || !lat || !lng)
      return res.status(400).json({ success: false, message: "zone, type, lat, lng required" });

    const incident = new Incident({
      zone, type, severity, description, lat, lng,
      reportedBy:   req.user.name,
      reportedById: req.user.id,
    });
    await incident.save();
    res.status(201).json({ success: true, incident });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── READ ALL active — GET /api/incidents ────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const incidents = await Incident.find({ resolved: false }).sort({ timestamp: -1 });
    res.json({ success: true, incidents });
  } catch (err) {
    res.status(500).json({ success: false, incidents: [] });
  }
});

// ─── READ ALL (admin) — GET /api/incidents/all ───────────────────────────────
router.get("/all", protect, adminOnly, async (req, res) => {
  try {
    const incidents = await Incident.find().sort({ timestamp: -1 });
    res.json({ success: true, incidents });
  } catch (err) {
    res.status(500).json({ success: false, incidents: [] });
  }
});

// ─── UPDATE — PATCH /api/incidents/:id ───────────────────────────────────────
router.patch("/:id", protect, async (req, res) => {
  try {
    const incident = await Incident.findByIdAndUpdate(
      req.params.id, { resolved: true }, { new: true }
    );
    if (!incident) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, incident });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DELETE one — DELETE /api/incidents/:id ──────────────────────────────────
router.delete("/:id", protect, async (req, res) => {
  try {
    const incident = await Incident.findById(req.params.id);
    if (!incident)
      return res.status(404).json({ success: false, message: "Incident not found" });

    // Allow delete if admin OR the user who reported it
    const isOwner = incident.reportedById === req.user.id;
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin)
      return res.status(403).json({ success: false, message: "Not authorized to delete this incident" });

    await Incident.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DELETE all — DELETE /api/incidents ──────────────────────────────────────
router.delete("/", protect, adminOnly, async (req, res) => {
  try {
    await Incident.deleteMany({});
    res.json({ success: true, message: "All cleared" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;