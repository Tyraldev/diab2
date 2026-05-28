// Vercel Serverless Function - Proxy Dexcom Share API
// Evite les erreurs CORS en passant par le serveur Vercel

const DEXCOM_BASE = {
  eu: "https://shareous1.dexcom.com",
  us: "https://share2.dexcom.com",
};

const APP_ID = "d8665ade-9673-4e27-9ff6-92db4ce13d13";

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, region, username, password, sessionId, minutes, maxCount } = req.body;
  const base = DEXCOM_BASE[region] || DEXCOM_BASE.eu;

  try {
    if (action === "login") {
      const r = await fetch(
        `${base}/ShareWebServices/Services/General/LoginPublisherAccountByName`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountName: username,
            password: password,
            applicationId: APP_ID,
          }),
        }
      );
      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ error: "Dexcom login failed: " + txt });
      }
      const sid = await r.json();
      return res.status(200).json({ sessionId: sid });
    }

    if (action === "readings") {
      const mins = minutes || 1440;
      const count = maxCount || 288;
      const r = await fetch(
        `${base}/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues?sessionId=${sessionId}&minutes=${mins}&maxCount=${count}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );
      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ error: "Dexcom readings failed: " + txt });
      }
      const data = await r.json();
      return res.status(200).json({ readings: data });
    }

    return res.status(400).json({ error: "Unknown action: " + action });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
