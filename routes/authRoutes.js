// backend/routes/authRoutes.js

const express = require("express");
const router  = express.Router();
const jwt     = require("jsonwebtoken");
const bcrypt  = require("bcryptjs");
const mongoose = require("mongoose");
const { protect, adminOnly } = require("../middleware/auth");

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });

// Helper — get users collection directly (bypasses Mongoose model hooks)
const getUsers = () => mongoose.connection.db.collection("users");

// ─── Register ─────────────────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ success: false, message: "All fields required" });

  // Validate email format — must have proper domain like .com .in etc
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRegex.test(email))
    return res.status(400).json({ success: false, message: "Enter a valid email address (e.g. name@gmail.com)" });

  try {
    const users   = getUsers();
    const exists  = await users.findOne({ email: email.toLowerCase() });
    if (exists)
      return res.status(400).json({ success: false, message: "Email already registered" });

    const hashed = bcrypt.hashSync(password, 10);
    const result = await users.insertOne({
      name,
      email:     email.toLowerCase(),
      password:  hashed,
      role:      "user",
      createdAt: new Date(),
    });

    const id = result.insertedId.toString();
    res.status(201).json({
      success: true,
      token:   generateToken(id),
      user:    { id, name, email: email.toLowerCase(), role: "user" },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ success: false, message: "Email and password required" });

  try {
    const users = getUsers();
    const user  = await users.findOne({ email: email.toLowerCase() });
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    if (user.blocked)
      return res.status(403).json({ success: false, message: "Your account has been blocked. Contact admin." });

    const id = user._id.toString();
    res.json({
      success: true,
      token:   generateToken(id),
      user:    { id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Get current user ─────────────────────────────────────────────────────────
router.get("/me", protect, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ─── Create admin (one-time) ──────────────────────────────────────────────────
router.post("/create-admin", async (req, res) => {
  try {
    const users   = getUsers();
    const exists  = await users.findOne({ role: "admin" });
    if (exists)
      return res.status(400).json({ success: false, message: "Admin already exists" });

    const hashed = bcrypt.hashSync("admin123", 10);
    const result = await users.insertOne({
      name:      "Admin",
      email:     "admin@traffic.com",
      password:  hashed,
      role:      "admin",
      createdAt: new Date(),
    });

    const id = result.insertedId.toString();
    res.status(201).json({
      success: true,
      message: "Admin created — login with admin@traffic.com / admin123",
      token:   generateToken(id),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Get all users (admin only) — GET /api/auth/users ────────────────────────
router.get("/users", protect, adminOnly, async (req, res) => {
  try {
    const users = getUsers();
    const all   = await users.find({}, { projection: { password: 0 } }).toArray();
    res.json({ success: true, users: all });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Block/Unblock user (admin only) — PATCH /api/auth/users/:id/block ─────
router.patch("/users/:id/block", protect, adminOnly, async (req, res) => {
  try {
    const users  = getUsers();
    const { ObjectId } = require("mongodb");
    const user   = await users.findOne({ _id: new ObjectId(req.params.id) });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.role === "admin") return res.status(400).json({ success: false, message: "Cannot block admin" });

    const blocked = !user.blocked; // toggle
    await users.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { blocked } });
    res.json({ success: true, blocked, message: blocked ? "User blocked" : "User unblocked" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Delete user (admin only) — DELETE /api/auth/users/:id ──────────────────
router.delete("/users/:id", protect, adminOnly, async (req, res) => {
  try {
    const { ObjectId } = require("mongodb");
    const users = getUsers();
    const user  = await users.findOne({ _id: new ObjectId(req.params.id) });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.role === "admin") return res.status(400).json({ success: false, message: "Cannot delete admin" });

    await users.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true, message: "User deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;