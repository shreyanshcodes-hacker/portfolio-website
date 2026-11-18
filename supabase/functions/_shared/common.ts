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
