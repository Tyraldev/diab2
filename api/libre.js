const https = require("https");

const LIBRE_HOST = "api-eu.libreview.io";

function librePost(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
      "Domain": "Libreview",
      "GatewayType": "LinkUp.Android",
      "version": "4.7",
      "product": "llu.ios",
    };
    if (token) headers["Authorization"] = "Bearer " + token;

    const req = https.request({
      hostname: LIBRE_HOST, path, method: "POST", headers
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch(e) { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function libreGet(path, token) {
  return new Promise((resolve, reject) => {
    const headers = {
      "Content-Type": "application/json",
      "Domain": "Libreview",
      "GatewayType": "LinkUp.Android",
      "version": "4.7",
      "product": "llu.ios",
    };
    if (token) headers["Authorization"] = "Bearer " + token;

    const req = https.request({
      hostname: LIBRE_HOST, path, method: "GET", headers
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch(e) { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// Convert mg/dL to g/L
function mgdlToGL(v) {
  return (parseFloat(v) / 100).toFixed(2);
}

// Convert trend arrow number to string
function trendLabel(t) {
  const trends = {1:"^^",2:"^",3:"/->",4:"->",5:"\->",6:"v",7:"vv"};
  return trends[t] || "->";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch(e) { body = {}; } }

  const { action, username, password, token, patientId } = body;

  try {
    // LOGIN
    if (action === "login") {
      const r = await librePost("/lsl/api/nisperson/getauthenticateduser", {
        Domain: "Libreview",
        GatewayType: "LinkUp.Android",
        Password: password,
        UserName: username
      });

      if (r.status !== 200 || !r.data.result) {
        return res.status(401).json({ error: "Identifiants incorrects: " + JSON.stringify(r.data).slice(0, 200) });
      }

      const result = r.data.result;
      return res.status(200).json({
        token: result.UserToken,
        patientId: result.AccountId,
        name: result.FirstName + " " + result.LastName,
        country: result.Country
      });
    }

    // LOGIN v2 (LibreLinkUp newer API)
    if (action === "login2") {
      const r = await librePost("/llu/auth/login", {
        email: username,
        password: password
      }, null);

      if (r.status !== 200) {
        return res.status(401).json({ error: "Login failed: " + JSON.stringify(r.data).slice(0, 200) });
      }

      const d = r.data.data || r.data;
      const authToken = d.authTicket && d.authTicket.token;
      if (!authToken) {
        return res.status(401).json({ error: "No token: " + JSON.stringify(r.data).slice(0, 200) });
      }

      return res.status(200).json({
        token: authToken,
        name: d.user ? (d.user.firstName + " " + d.user.lastName) : "",
        patientId: d.user ? d.user.id : ""
      });
    }

    // GET CONNECTIONS (to find patient ID)
    if (action === "connections") {
      const r = await libreGet("/llu/connections", token);
      if (r.status !== 200) return res.status(r.status).json({ error: "Connections failed: " + JSON.stringify(r.data).slice(0, 200) });
      const connections = r.data.data || [];
      return res.status(200).json({ connections: connections.map(c => ({ id: c.patientId, name: c.firstName + " " + c.lastName })) });
    }

    // GET READINGS via LibreLinkUp
    if (action === "readings") {
      const pid = patientId;
      const r = await libreGet("/llu/connections/" + pid + "/graph", token);
      if (r.status === 401) return res.status(401).json({ error: "TOKEN_EXPIRED", code: "TOKEN_EXPIRED" });
      if (r.status !== 200) return res.status(r.status).json({ error: "Readings failed: " + JSON.stringify(r.data).slice(0, 200) });

      const data = r.data.data || {};
      const graphData = data.graphData || [];
      const current = data.connection && data.connection.glucoseMeasurement;

      // Convert to our format
      const readings = graphData
        .filter(p => p.ValueInMgPerDl)
        .map(p => {
          const dt = new Date(p.Timestamp);
          return {
            time: dt.toTimeString().slice(0, 5),
            value: mgdlToGL(p.ValueInMgPerDl),
            ts: dt.toISOString(),
            trend: trendLabel(p.TrendArrow)
          };
        })
        .sort((a, b) => a.ts.localeCompare(b.ts));

      // Add current reading if available
      if (current && current.ValueInMgPerDl) {
        const dt = new Date(current.Timestamp);
        const exists = readings.find(r => Math.abs(new Date(r.ts) - dt) < 60000);
        if (!exists) {
          readings.push({
            time: dt.toTimeString().slice(0, 5),
            value: mgdlToGL(current.ValueInMgPerDl),
            ts: dt.toISOString(),
            trend: trendLabel(current.TrendArrow),
            isCurrent: true
          });
        }
      }

      return res.status(200).json({
        readings,
        current: current ? {
          value: mgdlToGL(current.ValueInMgPerDl),
          trend: trendLabel(current.TrendArrow),
          time: new Date(current.Timestamp).toTimeString().slice(0, 5)
        } : null
      });
    }

    // HISTORICAL READINGS (last 7 days)
    if (action === "history") {
      const pid = patientId;
      const r = await libreGet("/llu/connections/" + pid + "/logbook", token);
      if (r.status === 401) return res.status(401).json({ error: "TOKEN_EXPIRED", code: "TOKEN_EXPIRED" });
      if (r.status !== 200) return res.status(r.status).json({ error: "History failed: " + JSON.stringify(r.data).slice(0, 200) });

      const data = r.data.data || {};
      const logbook = data || [];

      const readings = (Array.isArray(logbook) ? logbook : [])
        .filter(p => p.ValueInMgPerDl)
        .map(p => {
          const dt = new Date(p.Timestamp);
          return {
            time: dt.toTimeString().slice(0, 5),
            value: mgdlToGL(p.ValueInMgPerDl),
            ts: dt.toISOString(),
            trend: trendLabel(p.TrendArrow)
          };
        });

      return res.status(200).json({ readings });
    }

    return res.status(400).json({ error: "Unknown action: " + action });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
