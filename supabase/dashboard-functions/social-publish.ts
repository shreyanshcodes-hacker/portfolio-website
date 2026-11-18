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

/* ===== social-publish ===== */
// POST {platform:'linkedin', source_type, source_id, text, include_link, image_url?, allow_repost?}  (admin)
// Publishes ONE LinkedIn post. The dashboard calls this only after the
// admin has reviewed the text and clicked an explicit confirmation for that platform.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// LinkedIn treats ( ) [ ] { } < > @ | \ * _ ~ as markup in "commentary"; escape them (not inside URLs).
function liEscape(t: string) {
  return t.split(URL_RE).map((part, i) => i % 2 === 1 ? part :
    part.replace(/[\\|{}@\[\]()<>*_~]/g, "\\$&").replace(/#(?![\p{L}\p{N}_])/gu, "\\#")).join("");
}

serve(async (req) => {
  const { admin } = await requireAdmin(req);
  const b = await req.json();
  const { platform, source_type, source_id, include_link, image_url, allow_repost } = b;
  if (platform !== "linkedin") throw new HttpError(400, "Unknown platform.");
  if (!["project", "post"].includes(source_type) || !source_id) throw new HttpError(400, "Missing source.");
  let text = String(b.text || "").trim();
  if (!text) throw new HttpError(400, "The post text is empty.");

  const link = itemLink(source_type);
  if (include_link && !text.includes(link)) text += "\n\n" + link;
  if (text.length > 3000) throw new HttpError(400, "Too long for LinkedIn (max 3000 characters).");

  // Don't double-post by accident.
  if (!allow_repost) {
    const { data: prev } = await admin.from("social_shares").select("created_at").eq("source_type", source_type)
      .eq("source_id", source_id).eq("platform", platform).eq("status", "posted").order("created_at", { ascending: false }).limit(1);
    if (prev?.length) throw new HttpError(409, "Already posted to this platform.", { duplicate: { at: prev[0].created_at } });
  }

  // Only images from our own storage bucket may be attached.
  let imageBytes: Uint8Array | null = null, imageType = "image/png";
  if (image_url) {
    const allowed = `${env("SUPABASE_URL")}/storage/v1/object/public/social-images/`;
    if (!String(image_url).startsWith(allowed)) throw new HttpError(400, "Image must come from the social-images bucket.");
    const ir = await fetch(image_url);
    if (!ir.ok) throw new HttpError(400, "Could not read the share image.");
    imageType = ir.headers.get("content-type") || "image/png";
    imageBytes = new Uint8Array(await ir.arrayBuffer());
    if (imageBytes.length > 5 * 1024 * 1024) throw new HttpError(400, "Image is larger than 5 MB.");
  }

  const { data: acc } = await admin.from("social_accounts").select("*").eq("platform", platform).maybeSingle();
  if (!acc) throw new HttpError(400, `LinkedIn is not connected. Connect it in the Social tab.`);

  const log = (row: Record<string, unknown>) =>
    admin.from("social_shares").insert({ source_type, source_id, platform, text, image_url: image_url ?? null, ...row });

  try {
    const result = await postLinkedIn(acc, text, imageBytes, imageType);
    await log({ status: "posted", external_id: result.id, external_url: result.url });
    return json({ ok: true, ...result });
  } catch (e) {
    const msg = (e as Error).message;
    await log({ status: "failed", error: msg });
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, msg);
  }
});

/* ---------------- LinkedIn ---------------- */
async function postLinkedIn(acc: any, text: string, img: Uint8Array | null, imgType: string) {
  if (acc.expires_at && new Date(acc.expires_at) < new Date()) throw new HttpError(401, "LinkedIn connection expired (they last 60 days). Reconnect in the Social tab.");
  const author = `urn:li:person:${acc.account_id}`;
  const headers = {
    Authorization: `Bearer ${acc.access_token}`, "Content-Type": "application/json",
    "Linkedin-Version": env("LINKEDIN_VERSION") || "202605", "X-Restli-Protocol-Version": "2.0.0",
  };

  let imageUrn: string | null = null;
  if (img) {
    const init = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
      method: "POST", headers, body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
    });
    const ij = await init.json();
    if (!init.ok) throw new HttpError(502, "LinkedIn image registration failed: " + (ij.message || init.status), { media_failed: true });
    const up = await fetch(ij.value.uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${acc.access_token}`, "Content-Type": imgType }, body: img });
    if (!up.ok) throw new HttpError(502, "LinkedIn image upload failed.", { media_failed: true });
    imageUrn = ij.value.image;
    await sleep(2000); // images are processed asynchronously
  }

  const body: Record<string, unknown> = {
    author, commentary: liEscape(text), visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false,
  };
  if (imageUrn) body.content = { media: { id: imageUrn, altText: "Preview image for this post" } };

  let r = await fetch("https://api.linkedin.com/rest/posts", { method: "POST", headers, body: JSON.stringify(body) });
  if (!r.ok && imageUrn) { await sleep(3000); r = await fetch("https://api.linkedin.com/rest/posts", { method: "POST", headers, body: JSON.stringify(body) }); }
  if (!r.ok) {
    const ej = await r.json().catch(() => ({}));
    if (r.status === 401) throw new HttpError(401, "LinkedIn rejected the token. Reconnect in the Social tab.");
    throw new HttpError(502, "LinkedIn error: " + (ej.message || r.status), imageUrn ? { media_failed: true } : {});
  }
  const id = r.headers.get("x-restli-id") || "";
  return { id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : "https://www.linkedin.com/feed/" };
}
