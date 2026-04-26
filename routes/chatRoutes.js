// routes/chatRoutes.js
// Gemini-powered traffic assistant endpoint

const express  = require("express");
const router   = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const Traffic        = require("../models/traffic");
const TrafficHistory = require("../models/trafficHistory");

// ─── POST /api/chat ────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: "Message is required." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY_HERE") {
    return res.status(503).json({
      error: "Gemini API key not configured. Add GEMINI_API_KEY to your .env file.",
    });
  }

  try {
    // ── 1. Fetch live traffic data ─────────────────────────────────────────────
    const liveZones = await Traffic.find().lean();

    // ── 2. Fetch recent history (last 24h, max 20 snapshots for context) ───────
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const history24h = await TrafficHistory
      .find({ capturedAt: { $gte: since } })
      .sort({ capturedAt: -1 })
      .limit(20)
      .select("capturedAt avgCongestion totalVehicles heavyZones clearZones")
      .lean();

    // ── 3. Build context string ────────────────────────────────────────────────
    const now = new Date();
    const istTime = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const timeStr = istTime.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    const dateStr = istTime.toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric" });

    const zoneContext = liveZones.length
      ? liveZones
          .sort((a, b) => b.congestion - a.congestion)
          .map(z => {
            const pct    = Math.round(z.congestion * 100);
            const status = pct > 65 ? "Heavy" : pct > 35 ? "Moderate" : "Clear";
            const speed  = z.currentSpeed ? `${z.currentSpeed} km/h` : "N/A";
            return `  - ${z.location}: ${pct}% congestion (${status}), ~${z.vehicles} vehicles, speed ${speed}`;
          })
          .join("\n")
      : "  No live data available.";

    const historyContext = history24h.length
      ? history24h
          .slice(0, 8)
          .map(h => {
            const t   = new Date(h.capturedAt);
            const ist = new Date(t.getTime() + 5.5 * 60 * 60 * 1000);
            const ts  = ist.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
            return `  - ${ts}: avg ${Math.round(h.avgCongestion * 100)}% congestion, ${h.totalVehicles} vehicles, ${h.heavyZones} heavy zones`;
          })
          .join("\n")
      : "  No history available yet.";

    const systemPrompt = `You are PuneTrafficAI, an intelligent traffic assistant for the Smart Traffic Monitor system covering Pune, India.

Current IST Date & Time: ${dateStr}, ${timeStr}

LIVE TRAFFIC DATA (right now):
${zoneContext}

RECENT 24H HISTORY (latest 8 snapshots):
${historyContext}

YOUR ROLE:
- Answer questions about current Pune traffic conditions using the live data above
- Identify congested zones, suggest alternate areas, recommend travel times
- Explain traffic patterns, compare current vs historical
- Be concise, helpful, and specific — use actual numbers from the data
- Use a friendly, conversational tone
- If asked about a zone not in the data, say it's not in the monitored list
- Format responses with bullet points or short paragraphs as appropriate
- Keep answers under 150 words unless a detailed explanation is genuinely needed
- Always refer to times in IST

Do NOT make up data. Only use the figures provided above.`;

    // ── 4. Call Gemini 2.5 Flash ───────────────────────────────────────────────
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });

    // Build chat history for multi-turn context
    const chatHistory = history
      .filter(m => m.role && m.text)
      .map(m => ({
        role:  m.role === "user" ? "user" : "model",
        parts: [{ text: m.text }],
      }));

    const chat = model.startChat({ history: chatHistory });
    const result = await chat.sendMessage(message.trim());
    const reply  = result.response.text();

    res.json({ reply, timestamp: new Date().toISOString() });

  } catch (err) {
    console.error("[ChatRoute] Gemini error:", err.message);

    // Give a meaningful error if quota/key issue
    if (err.message?.includes("API_KEY") || err.message?.includes("403")) {
      return res.status(403).json({ error: "Invalid Gemini API key. Check your .env file." });
    }
    if (err.message?.includes("429") || err.message?.includes("quota")) {
      return res.status(429).json({ error: "Gemini quota exceeded. Try again in a minute." });
    }

    res.status(500).json({ error: "AI assistant is temporarily unavailable. Please try again." });
  }
});

module.exports = router;
