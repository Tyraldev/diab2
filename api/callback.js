export const config = {
  api: { bodyParser: true }
};

const CLIENT_ID = process.env.DEXCOM_CLIENT_ID;
const CLIENT_SECRET = process.env.DEXCOM_CLIENT_SECRET;
const REDIRECT_URI = process.env.DEXCOM_REDIRECT_URI || "https://diab2.vercel.app/api/callback";
const DEXCOM_API = "https://sandbox-api.dexcom.com";

export default async function handler(req, res) {
  const code = req.query.code;
  const error = req.query.error;

  if (error) {
    res.writeHead(302, { Location: "/?dexcom_error=" + encodeURIComponent(error) });
    res.end();
    return;
  }

  if (!code) {
    res.writeHead(302, { Location: "/?dexcom_error=no_code" });
    res.end();
    return;
  }

  try {
    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", REDIRECT_URI);
    params.append("client_id", CLIENT_ID);
    params.append("client_secret", CLIENT_SECRET);

    const tokenRes = await fetch(DEXCOM_API + "/v2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });

    const tokens = await tokenRes.json();

    if (!tokenRes.ok) {
      const errMsg = encodeURIComponent(JSON.stringify(tokens).slice(0, 200));
      res.writeHead(302, { Location: "/?dexcom_error=" + errMsg });
      res.end();
      return;
    }

    const expiresAt = Date.now() + tokens.expires_in * 1000;
    const location = "/?dexcom_access=" + encodeURIComponent(tokens.access_token) +
      "&dexcom_refresh=" + encodeURIComponent(tokens.refresh_token) +
      "&dexcom_expires=" + expiresAt;

    res.writeHead(302, { Location: location });
    res.end();

  } catch(e) {
    res.writeHead(302, { Location: "/?dexcom_error=" + encodeURIComponent(e.message) });
    res.end();
  }
}
