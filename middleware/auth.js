// backend/middleware/auth.js

const jwt      = require("jsonwebtoken");
const mongoose = require("mongoose");
const { ObjectId } = require("mongodb");

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer "))
    return res.status(401).json({ success: false, message: "Not authorized — no token" });

  try {
    const token   = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Use raw driver — no Mongoose model hooks
    const users = mongoose.connection.db.collection("users");
    const user  = await users.findOne({ _id: new ObjectId(decoded.id) });

    if (!user) return res.status(401).json({ success: false, message: "User not found" });

    req.user = { id: user._id.toString(), name: user.name, email: user.email, role: user.role };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Token invalid or expired" });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== "admin")
    return res.status(403).json({ success: false, message: "Admin access required" });
  next();
};

module.exports = { protect, adminOnly };