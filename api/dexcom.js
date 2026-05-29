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


// ── LIBREVIEW API ─────────────────────────────────────────────────────────────
let LIBRE_HOST = "api-eu.libreview.io";

function libreReq(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      "Content-Type": "application/json;charset=UTF-8",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU OS 17_4.1 like Mac OS X) AppleWebKit/536.26 (KHTML, like Gecko) Version/17.4.1 Mobile/10A5355d Safari/8536.25",
      "version": "4.10.0",
      "product": "llu.ios",
    };
    if (token) headers["Authorization"] = "Bearer " + token;
    if (data) headers["Content-Length"] = Buffer.byteLength(data);
    const req = https.request({ hostname: LIBRE_HOST, path, method, headers }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch(e) { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function mgToGL(v) { return (parseFloat(v) / 100).toFixed(2); }
function litrend(t) { return {1:"^^",2:"^",3:"/->",4:"->",5:"\->",6:"v",7:"vv"}[t]||"->"; }

async function handleLibre(action, body, res) {
  const { username, password, token, patientId } = body;
  
  if (action === "libre_login") {
    // Try LLU login API
    let r = await libreReq("POST", "/llu/auth/login", { email: username, password }, null);
    // Handle region redirect (e.g. EU -> FR)
    if (r.data && r.data.data && r.data.data.redirect) {
      const newRegion = r.data.data.region || "fr";
      LIBRE_HOST = "api-" + newRegion.toLowerCase() + ".libreview.io";
      r = await libreReq("POST", "/llu/auth/login", { email: username, password }, null);
    }
    if (r.status === 200 && r.data && r.data.data && r.data.data.authTicket) {
      const d = r.data.data;
      return res.status(200).json({
        token: d.authTicket.token,
        patientId: d.user ? d.user.id : "",
        name: d.user ? (d.user.firstName + " " + d.user.lastName) : username,
        region: LIBRE_HOST
      });
    }
    return res.status(401).json({ error: "Identifiants LibreView incorrects: " + JSON.stringify(r.data).slice(0,300) });
  }

  if (action === "libre_connections") {
    if (body.region) LIBRE_HOST = body.region;
    const r = await libreReq("GET", "/llu/connections", null, token);
    if (r.status !== 200) return res.status(r.status).json({ error: "Connections: "+JSON.stringify(r.data).slice(0,200) });
    const conns = r.data.data || [];
    return res.status(200).json({ connections: conns.map(c => ({ id: c.patientId, name: c.firstName+" "+c.lastName })) });
  }

  if (action === "libre_readings") {
    if (body.region) LIBRE_HOST = body.region;
    const r = await libreReq("GET", "/llu/connections/"+patientId+"/graph", null, token);
    if (r.status === 401) return res.status(401).json({ error: "TOKEN_EXPIRED", code: "TOKEN_EXPIRED" });
    if (r.status !== 200) return res.status(r.status).json({ error: "Readings: "+JSON.stringify(r.data).slice(0,200) });
    const data = r.data.data || {};
    const graphData = data.graphData || [];
    const current = data.connection && data.connection.glucoseMeasurement;
    const readings = graphData.filter(p => p.ValueInMgPerDl).map(p => {
      const dt = new Date(p.Timestamp);
      return { time: dt.toTimeString().slice(0,5), value: mgToGL(p.ValueInMgPerDl), ts: dt.toISOString(), trend: litrend(p.TrendArrow) };
    }).sort((a,b) => a.ts.localeCompare(b.ts));
    return res.status(200).json({
      readings,
      current: current ? { value: mgToGL(current.ValueInMgPerDl), trend: litrend(current.TrendArrow), time: new Date(current.Timestamp).toTimeString().slice(0,5) } : null
    });
  }

  return res.status(400).json({ error: "Unknown libre action: "+action });
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
    // Route LibreView actions
    if (action && action.indexOf("libre_") === 0) {
      return handleLibre(action, body, res);
    }

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
      // Get last 24h with proper format YYYY-MM-DDTHH:MM:SS
      const start = new Date(now.getTime()-24*60*60*1000).toISOString().replace("Z","");
      const end = now.toISOString().replace("Z","");
      const path = "/v3/users/self/egvs?startDate="+encodeURIComponent(start)+"&endDate="+encodeURIComponent(end);
      const r = await get(path, accessToken);
      if (r.status === 401) return res.status(401).json({error:"TOKEN_EXPIRED",code:"TOKEN_EXPIRED"});
      if (r.status !== 200) return res.status(r.status).json({error:"Readings failed ("+r.status+"): "+JSON.stringify(r.data).slice(0,300)});
      const egvs = r.data.egvs || r.data.records || r.data || [];
      return res.status(200).json({
        readings: Array.isArray(egvs) ? egvs : [],
        debug: {total: Array.isArray(egvs)?egvs.length:0, keys: Object.keys(r.data||{}).slice(0,10)}
      });
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
