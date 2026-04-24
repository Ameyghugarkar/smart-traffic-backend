require("dotenv").config();
const mongoose = require("mongoose");
const TrafficHistory = require("./models/trafficHistory");

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const count = await TrafficHistory.countDocuments();
  console.log("Total documents:", count);
  
  const oldest = await TrafficHistory.findOne().sort({ capturedAt: 1 });
  console.log("Oldest:", oldest ? oldest.capturedAt : null);
  
  const newest = await TrafficHistory.findOne().sort({ capturedAt: -1 });
  console.log("Newest:", newest ? newest.capturedAt : null);
  
  process.exit();
}
check();
