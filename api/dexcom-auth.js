// Initiates Dexcom OAuth flow - redirects browser to Dexcom login
const CLIENT_ID = process.env.DEXCOM_CLIENT_ID;
const REDIRECT_URI = process.env.DEXCOM_REDIRECT_URI || "https://diab2.vercel.app/api/callback";
const DEXCOM_API = "https://api.dexcom.com";

export default function handler(req, res) {
  const authUrl = DEXCOM_API + "/v2/oauth2/login" +
    "?client_id=" + CLIENT_ID +
    "&redirect_uri=" + encodeURIComponent(REDIRECT_URI) +
    "&response_type=code" +
    "&scope=offline_access";

  res.redirect(302, authUrl);
}
