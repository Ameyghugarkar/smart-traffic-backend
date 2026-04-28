const axios = require("axios");

async function test() {
  const y = 2026;
  const m = 4;
  const start = new Date(y, m - 1, 1).toISOString();
  const end   = new Date(y, m, 0, 23, 59, 59).toISOString();
  console.log("Start:", start);
  console.log("End:", end);
  
  const url = `http://localhost:5000/api/traffic/history?start=${start}&end=${end}`;
  console.log("URL:", url);
  try {
    const res = await axios.get(url);
    console.log("Count:", res.data.count);
    if (res.data.count > 0) {
      console.log("First snapshot:", res.data.snapshots[0].capturedAt);
      console.log("Last snapshot:", res.data.snapshots[res.data.count - 1].capturedAt);
    }
  } catch (err) {
    console.error(err.message);
  }
}
test();
