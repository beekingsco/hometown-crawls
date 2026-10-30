/**
 * Public Supabase settings for a deploy.
 * Vercel serves this at /api/public-config.
 *
 * Preview and staging must set SUPABASE_URL and SUPABASE_ANON_KEY so the
 * self-serve crawl pages do not fall back to the live Puyallup project.
 * The anon key is the public client key. This route never reads or returns
 * a service role key.
 *
 * HC_APP_URL is optional. Invite mail uses it when set, otherwise VERCEL_URL.
 */
function readConfig() {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
  const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
  const configured = Boolean(supabaseUrl && supabaseAnonKey);
  const appUrl = String(process.env.HC_APP_URL || "").trim().replace(/\/$/, "")
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return {
    configured,
    preview: process.env.VERCEL_ENV === "preview",
    supabaseUrl: configured ? supabaseUrl : "",
    supabaseAnonKey: configured ? supabaseAnonKey : "",
    appUrl,
  };
}

function handler(req, res) {
  if (!req || req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(readConfig());
}

module.exports = handler;
module.exports.readConfig = readConfig;
