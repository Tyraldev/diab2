const https = require("https");
const qs = require("querystring");

const CLIENT_ID = process.env.DEXCOM_CLIENT_ID;
const CLIENT_SECRET = process.env.DEXCOM_CLIENT_SECRET;
const REDIRECT_URI = process.env.DEXCOM_REDIRECT_URI || "https://diab2-one.vercel.app/";
const HOST = "sandbox-api.dexcom.com";

function post(path, data) {
  return new Promise((resolve, reject) => {
    const body = qs.stringify(data);
    const req = https.request({
      hostname: HOST, path, method: "POST",
      headers: {"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(body)}
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try{resolve({status:res.statusCode,data:JSON.parse(raw)});}catch(e){resolve({status:res.statusCode,data:raw});} });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: HOST, path, method: "GET",
      headers: {"Authorization":"Bearer "+token,"Accept":"application/json"}
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try{resolve({status:res.statusCode,data:JSON.parse(raw)});}catch(e){resolve({status:res.statusCode,data:raw});} });
    });
    req.on("error", reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch(e) { body = {}; } }

  const { action, code, accessToken, refreshToken } = body;

  try {
    if (action === "exchange_code") {
      const r = await post("/v2/oauth2/token", {
        grant_type: "authorization_code",
        code, redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET
      });
      if (r.status !== 200 || !r.data.access_token)
        return res.status(400).json({error: "Exchange failed: "+JSON.stringify(r.data).slice(0,200)});
      return res.status(200).json({
        accessToken: r.data.access_token,
        refreshToken: r.data.refresh_token,
        expiresAt: Date.now() + r.data.expires_in * 1000
      });
    }

    if (action === "refresh") {
      const r = await post("/v2/oauth2/token", {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET
      });
      if (r.status !== 200 || !r.data.access_token)
        return res.status(401).json({error: "Refresh failed"});
      return res.status(200).json({
        accessToken: r.data.access_token,
        refreshToken: r.data.refresh_token,
        expiresAt: Date.now() + r.data.expires_in * 1000
      });
    }

    if (action === "readings") {
      const now = new Date();
      const start = new Date(now-24*60*60*1000).toISOString().slice(0,19);
      const end = now.toISOString().slice(0,19);
      const r = await get("/v3/users/self/egvs?startDate="+start+"&endDate="+end, accessToken);
      if (r.status === 401) return res.status(401).json({error:"TOKEN_EXPIRED",code:"TOKEN_EXPIRED"});
      if (r.status !== 200) return res.status(r.status).json({error:"Readings failed: "+JSON.stringify(r.data).slice(0,200)});
      return res.status(200).json({readings: r.data.egvs || []});
    }

    if (action === "auth_url") {
      const url = "https://"+HOST+"/v2/oauth2/login?client_id="+CLIENT_ID+"&redirect_uri="+encodeURIComponent(REDIRECT_URI)+"&response_type=code&scope=offline_access";
      return res.status(200).json({url});
    }

    return res.status(400).json({error:"Unknown action: "+action});
  } catch(e) {
    return res.status(500).json({error: e.message});
  }
};
