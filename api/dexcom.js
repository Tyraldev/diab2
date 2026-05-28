export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } }
};

const DEXCOM_BASE = {
  eu: "https://shareous1.dexcom.com",
  us: "https://share2.dexcom.com",
};

// Try multiple app IDs - ONE+ may require a different one
const APP_IDS = [
  "d8665ade-9673-4e27-9ff6-92db4ce13d13", // Dexcom Share iOS
  "d89443d2-327c-4a6f-89e5-496bbb0317db", // Dexcom Share Android
  "28b4cdca-b6d5-4ca2-b7d2-2cc1b9fb7d23", // Dexcom G5 mobile
];

const NULL_UUID = "00000000-0000-0000-0000-000000000000";

async function tryLogin(base, username, password, appId, endpoint) {
  const r = await fetch(`${base}/ShareWebServices/Services/General/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ accountName: username, password, applicationId: appId }),
  });
  const txt = await r.text();
  if (!r.ok) return null;
  const sid = txt.replace(/^"|"$/g, "").trim();
  if (sid === NULL_UUID || sid === "" || sid.length < 10) return null;
  return sid;
}

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
      // Try multiple endpoints and app IDs
      const attempts = [
        { endpoint: "LoginPublisherAccountByName", appId: APP_IDS[0] },
        { endpoint: "LoginAccountByName",          appId: APP_IDS[0] },
        { endpoint: "LoginPublisherAccountByName", appId: APP_IDS[1] },
        { endpoint: "LoginAccountByName",          appId: APP_IDS[1] },
        { endpoint: "LoginPublisherAccountByName", appId: APP_IDS[2] },
        { endpoint: "LoginAccountByName",          appId: APP_IDS[2] },
      ];

      let sid = null;
      let usedAttempt = null;
      for (const attempt of attempts) {
        sid = await tryLogin(base, username, password, attempt.appId, attempt.endpoint);
        if (sid) { usedAttempt = attempt; break; }
      }

      if (!sid) {
        return res.status(401).json({
          error: "Identifiants incorrects ou compte Dexcom ONE+ incompatible avec l API Share. Verifiez votre email et mot de passe."
        });
      }

      return res.status(200).json({
        sessionId: sid,
        method: usedAttempt.endpoint,
        appId: usedAttempt.appId
      });
    }

    if (action === "readings") {
      const mins = minutes || 1440;
      const count = maxCount || 288;
      const url = `${base}/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues?sessionId=${sessionId}&minutes=${mins}&maxCount=${count}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
      });
      const txt = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: "Readings failed ("+r.status+"): " + txt.slice(0,300) });
      if (!txt || txt.trim() === "" || txt.trim() === "null") {
        return res.status(200).json({ readings: [] });
      }
      try {
        const data = JSON.parse(txt);
        return res.status(200).json({ readings: Array.isArray(data) ? data : [] });
      } catch(e) {
        return res.status(500).json({ error: "Parse error: " + txt.slice(0, 200) });
      }
    }

    return res.status(400).json({ error: "Unknown action: " + action });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
