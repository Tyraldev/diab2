// OAuth callback - exchanges authorization code for tokens
const CLIENT_ID = process.env.DEXCOM_CLIENT_ID;
const CLIENT_SECRET = process.env.DEXCOM_CLIENT_SECRET;
const REDIRECT_URI = process.env.DEXCOM_REDIRECT_URI || "https://diab2.vercel.app/api/callback";
const DEXCOM_API = "https://api.eu.dexcom.com";

export default async function handler(req, res) {
  const { code, error } = req.query;
  if (error) return res.redirect("/?dexcom_error=" + encodeURIComponent(error));
  if (!code) return res.redirect("/?dexcom_error=no_code");
  try {
    const tokenRes = await fetch(DEXCOM_API+"/v2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type:"authorization_code", code, redirect_uri:REDIRECT_URI, client_id:CLIENT_ID, client_secret:CLIENT_SECRET }).toString()
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) return res.redirect("/?dexcom_error="+encodeURIComponent(JSON.stringify(tokens)));
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    return res.redirect("/?dexcom_access="+encodeURIComponent(tokens.access_token)+"&dexcom_refresh="+encodeURIComponent(tokens.refresh_token)+"&dexcom_expires="+expiresAt);
  } catch(e) { return res.redirect("/?dexcom_error="+encodeURIComponent(e.message)); }
}
