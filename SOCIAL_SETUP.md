# LinkedIn sharing setup

How it works: when you publish a project or update in `/admin/`, a prompt asks
"Also want to share? Post it on LinkedIn?". If you say yes, a draft is written
(new title, context and description + a lightly edited image). You edit it, then
click "Approve & post" and confirm. Nothing is posted without that confirmation.
The "Share" button on any project/update row lets you share later too.

Your keys live only in Supabase Edge Function secrets, never in the browser.

## 1. Database
Run `supabase/schema-social.sql` in the Supabase SQL Editor (safe to re-run).

## 2. LinkedIn app
1. https://www.linkedin.com/developers/apps -> Create app. LinkedIn requires a Company Page:
   create a free one first (linkedin.com/company/setup/new), then enter its URL.
2. Settings tab -> Verify: click Generate URL, open it as the page admin, approve.
3. Products tab: add **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**.
4. Auth tab -> Authorized redirect URLs, add exactly:
   `https://rmcyqfoyegnqoqferftn.supabase.co/functions/v1/social-oauth/callback/linkedin`
5. Copy the Client ID and Primary Client Secret.
Posts go to your personal profile, not the Company Page.
LinkedIn connections expire after 60 days. The dashboard shows the date; click Reconnect.

## 3. Deploy the functions

### Option A: in the browser (no CLI)
Use the self-contained files in `supabase/dashboard-functions/`.
1. Supabase Dashboard -> **Edge Functions** -> **Secrets** (or "Manage secrets"). Add:
   `SITE_URL` = https://shreyanshcodes.netlify.app
   `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`
   `ANTHROPIC_API_KEY` (optional; without it you get template drafts)
2. Edge Functions -> **Deploy a new function** -> **Via Editor**. Do this three times:
   - name `social-oauth`   -> paste all of `social-oauth.ts`
   - name `social-draft`   -> paste all of `social-draft.ts`
   - name `social-publish` -> paste all of `social-publish.ts`
   Replace the template code in the editor, then click **Deploy**. The names must match exactly.
3. Open each function -> **Details/Settings** and turn **Verify JWT** OFF, then save.
   (Intended: each function checks that the caller is your admin account itself, and the OAuth
   callback is opened by LinkedIn, which cannot send your login.)

### Option B: Supabase CLI
```
npm i -g supabase
supabase login
supabase link --project-ref rmcyqfoyegnqoqferftn
supabase secrets set SITE_URL=https://shreyanshcodes.netlify.app \
  LINKEDIN_CLIENT_ID=... LINKEDIN_CLIENT_SECRET=... ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy social-oauth   --no-verify-jwt
supabase functions deploy social-draft   --no-verify-jwt
supabase functions deploy social-publish --no-verify-jwt
```
Optional secrets: CLAUDE_MODEL (default claude-sonnet-5-5), LINKEDIN_VERSION (default 202605).

## 4. Connect and test
Open `/admin/` -> LinkedIn sharing -> Connect LinkedIn. Then publish a test update and approve the post.
