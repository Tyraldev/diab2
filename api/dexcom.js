export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } }
};

const DEXCOM_BASE = {
  eu: "https://shareous1.dexcom.com",
  us: "https://share2.dexcom.com",
};
const APP_ID = "d8665ade-9673-4e27-9ff6-92db4ce13d13";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: "Invalid JSON body" }); }
  }
  if (!body) return res.status(400).json({ error: "Empty body" });

  const { action, region, username, password, sessionId, minutes, maxCount } = body;
  const base = DEXCOM_BASE[region] || DEXCOM_BASE.eu;

  try {
    if (action === "login") {
      const r = await fetch(
        `${base}/ShareWebServices/Services/General/LoginPublisherAccountByName`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ accountName: username, password, applicationId: APP_ID }),
        }
      );
      const txt = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: "Dexcom login failed ("+r.status+"): " + txt.slice(0,200) });
      const sid = txt.replace(/^"|"$/g, "").trim();
      return res.status(200).json({ sessionId: sid });
    }

    if (action === "readings") {
      const mins = minutes || 1440;
      const count = maxCount || 288;
      // Try with sessionId in both URL and body
      const url = `${base}/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues?sessionId=${encodeURIComponent(sessionId)}&minutes=${mins}&maxCount=${count}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify("")
      });
      const txt = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: "Readings failed ("+r.status+"): " + txt.slice(0,300) });
      if (!txt || txt.trim() === "") return res.status(200).json({ readings: [] });
      try {
        const data = JSON.parse(txt);
        return res.status(200).json({ readings: Array.isArray(data) ? data : [] });
      } catch(e) {
        return res.status(500).json({ error: "Parse error. Response: " + txt.slice(0, 300) });
      }
    }

    return res.status(400).json({ error: "Unknown action: " + action });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
