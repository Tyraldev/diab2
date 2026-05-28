export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

const CLIENT_ID = process.env.DEXCOM_CLIENT_ID;
const CLIENT_SECRET = process.env.DEXCOM_CLIENT_SECRET;
const REDIRECT_URI = process.env.DEXCOM_REDIRECT_URI || "https://diab2.vercel.app/api/callback";
const DEXCOM_API = "https://api.eu.dexcom.com";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: "Invalid JSON" }); } }
  if (!body) return res.status(400).json({ error: "Empty body" });

  const { action, accessToken, refreshToken } = body;

  try {
    if (action === "auth_url") {
      const url = DEXCOM_API+"/v2/oauth2/login?client_id="+CLIENT_ID+"&redirect_uri="+encodeURIComponent(REDIRECT_URI)+"&response_type=code&scope=offline_access";
      return res.status(200).json({ url });
    }

    if (action === "refresh") {
      const r = await fetch(DEXCOM_API+"/v2/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type:"refresh_token", refresh_token:refreshToken, client_id:CLIENT_ID, client_secret:CLIENT_SECRET }).toString()
      });
      const t = await r.json();
      if (!r.ok) return res.status(401).json({ error: "Refresh failed: "+JSON.stringify(t) });
      return res.status(200).json({ accessToken:t.access_token, refreshToken:t.refresh_token, expiresAt:Date.now()+t.expires_in*1000 });
    }

    if (action === "readings") {
      const now = new Date();
      const start = new Date(now.getTime()-24*60*60*1000).toISOString().slice(0,19);
      const end = now.toISOString().slice(0,19);
      const r = await fetch(DEXCOM_API+"/v3/users/self/egvs?startDate="+start+"&endDate="+end, {
        headers: { "Authorization": "Bearer "+accessToken }
      });
      if (r.status === 401) return res.status(401).json({ error:"Token expired", code:"TOKEN_EXPIRED" });
      if (!r.ok) { const t=await r.text(); return res.status(r.status).json({ error:"Readings failed: "+t.slice(0,200) }); }
      const data = await r.json();
      return res.status(200).json({ readings: data.egvs || [] });
    }

    return res.status(400).json({ error: "Unknown action: "+action });
  } catch(e) { return res.status(500).json({ error: e.message }); }
}
