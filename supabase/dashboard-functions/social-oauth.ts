import { createClient } from "npm:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
export class HttpError extends Error {
  constructor(public status: number, msg: string, public extra: Record<string, unknown> = {}) { super(msg); }
}
export const env = (k: string) => Deno.env.get(k) ?? "";
export const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
export const db = () => createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
export const SITE = () => (env("SITE_URL") || "https://shreyanshcodes.netlify.app").replace(/\/$/, "");

/** Every function verifies the caller is a signed-in admin itself. */
export async function requireAdmin(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in to the admin dashboard first.");
  const admin = db();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Your session expired. Sign in again.");
  const { data: row } = await admin.from("admin_users").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!row) throw new HttpError(403, "This account is not an admin.");
  return { admin, user: data.user };
}

export function serve(fn: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try { return await fn(req); }
    catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
      console.error(e);
      return json({ error: "Unexpected server error." }, 500);
    }
  });
}

export const URL_RE = /(https?:\/\/[^\s]+)/g;
export function itemLink(type: string) {
  return type === "project" ? `${SITE()}/pages/projects` : `${SITE()}/#blog`;
}

/* ===== social-oauth ===== */
// Connect / disconnect LinkedIn.
//   POST /social-oauth/start        {platform}   (admin)  -> {url}
//   POST /social-oauth/disconnect   {platform}   (admin)
//   GET  /social-oauth/callback/linkedin     (called by the provider)

const redirectUri = (p: string) => `${env("SUPABASE_URL")}/functions/v1/social-oauth/callback/${p}`;

serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "POST" && path.endsWith("/start")) {
    const { admin } = await requireAdmin(req);
    const { platform } = await req.json();
    if (platform !== "linkedin") throw new HttpError(400, "Unknown platform.");
    const clientId = env("LINKEDIN_CLIENT_ID");
    if (!clientId) throw new HttpError(500, "LinkedIn client id is not configured (see SOCIAL_SETUP.md).");
    const state = crypto.randomUUID();
    const authUrl = "https://www.linkedin.com/oauth/v2/authorization?" + new URLSearchParams({
      response_type: "code", client_id: clientId, redirect_uri: redirectUri("linkedin"),
      scope: "openid profile w_member_social", state,
    });
    await admin.from("social_oauth_state").delete().lt("created_at", new Date(Date.now() - 3600_000).toISOString());
    await admin.from("social_oauth_state").insert({ state, platform });
    return json({ url: authUrl });
  }

  if (req.method === "POST" && path.endsWith("/disconnect")) {
    const { admin } = await requireAdmin(req);
    const { platform } = await req.json();
    await admin.from("social_accounts").delete().eq("platform", platform);
    await admin.from("social_status").upsert({ platform, connected: false, account_name: null, expires_at: null, updated_at: new Date().toISOString() });
    return json({ ok: true });
  }

  if (req.method === "GET" && path.includes("/callback/")) {
    const platform = "linkedin";
    const back = (q: string) => Response.redirect(`${SITE()}/admin/?${q}`, 302);
    try {
      if (url.searchParams.get("error")) return back("social_error=" + encodeURIComponent(url.searchParams.get("error_description") || url.searchParams.get("error")!));
      const code = url.searchParams.get("code"), state = url.searchParams.get("state");
      if (!code || !state) return back("social_error=Missing%20code");
      const admin = db();
      const { data: st } = await admin.from("social_oauth_state").select("*").eq("state", state).maybeSingle();
      if (!st || st.platform !== platform || Date.now() - new Date(st.created_at).getTime() > 10 * 60_000)
        return back("social_error=Connection%20request%20expired.%20Try%20again.");
      await admin.from("social_oauth_state").delete().eq("state", state);

      const r = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri("linkedin"),
          client_id: env("LINKEDIN_CLIENT_ID"), client_secret: env("LINKEDIN_CLIENT_SECRET") }),
      });
      const tok = await r.json();
      if (!r.ok) throw new Error(tok.error_description || "LinkedIn token exchange failed");
      const me = await (await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
      const accountId = me.sub, accountName = me.name || "LinkedIn member";
      const expires_at = tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null;
      const now = new Date().toISOString();
      await admin.from("social_accounts").upsert({ platform, access_token: tok.access_token, refresh_token: tok.refresh_token ?? null,
        expires_at, account_id: accountId, account_name: accountName, updated_at: now });
      await admin.from("social_status").upsert({ platform, connected: true, account_name: accountName, expires_at, updated_at: now });
      return back("connected=" + platform);
    } catch (e) {
      console.error(e);
      return back("social_error=" + encodeURIComponent((e as Error).message));
    }
  }
  throw new HttpError(404, "Not found.");
});
