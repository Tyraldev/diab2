const https = require("https");
const querystring = require("querystring");

const CLIENT_ID = process.env.DEXCOM_CLIENT_ID;
const CLIENT_SECRET = process.env.DEXCOM_CLIENT_SECRET;
const REDIRECT_URI = process.env.DEXCOM_REDIRECT_URI || "https://diab2.vercel.app/api/callback";

function httpPost(hostname, path, data) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(data);
    const options = {
      hostname,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch(e) { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  const code = req.query && req.query.code;
  const error = req.query && req.query.error;

  if (error) {
    return res.redirect("/?dexcom_error=" + encodeURIComponent(error));
  }
  if (!code) {
    return res.redirect("/?dexcom_error=no_code");
  }

  try {
    const result = await httpPost("sandbox-api.dexcom.com", "/v2/oauth2/token", {
      grant_type: "authorization_code",
      code: code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    });

    if (result.status !== 200 || !result.data.access_token) {
      const msg = typeof result.data === "string" ? result.data : JSON.stringify(result.data);
      return res.redirect("/?dexcom_error=" + encodeURIComponent(msg.slice(0, 200)));
    }

    const expiresAt = Date.now() + result.data.expires_in * 1000;
    const location = "/?dexcom_access=" + encodeURIComponent(result.data.access_token) +
      "&dexcom_refresh=" + encodeURIComponent(result.data.refresh_token) +
      "&dexcom_expires=" + expiresAt;

    return res.redirect(location);
  } catch(e) {
    return res.redirect("/?dexcom_error=" + encodeURIComponent(e.message));
  }
};
