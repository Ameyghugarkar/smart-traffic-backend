// backend/createAdmin.js
// Run: node createAdmin.js
// Creates admin directly in MongoDB, bypassing Mongoose model

const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");
require("dotenv").config();

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;
    const users = db.collection("users");

    // Check if admin already exists
    const existing = await users.findOne({ email: "admin@traffic.com" });
    if (existing) {
      console.log("⚠️  Admin already exists — you can login with admin@traffic.com / admin123");
      process.exit(0);
    }

    // Hash password directly
    const salt     = bcrypt.genSaltSync(10);
    const hashed   = bcrypt.hashSync("admin123", salt);

    await users.insertOne({
      name:      "Admin",
      email:     "admin@traffic.com",
      password:  hashed,
      role:      "admin",
      createdAt: new Date(),
    });

    console.log("✅ Admin created successfully!");
    console.log("   Email:    admin@traffic.com");
    console.log("   Password: admin123");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
};

run();