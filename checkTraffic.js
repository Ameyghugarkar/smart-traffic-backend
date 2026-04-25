require("dotenv").config();
const mongoose = require("mongoose");
const Traffic = require("./models/traffic");

async function checkTraffic() {
  await mongoose.connect(process.env.MONGO_URI);
  const data = await Traffic.find();
  console.log(`Live Traffic zones: ${data.length}`);
  if (data.length > 0) {
    console.log(`Timestamp: ${data[0].timestamp}`);
  }
  process.exit();
}
checkTraffic();
