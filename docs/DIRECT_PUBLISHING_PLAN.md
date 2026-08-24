# Direct social publishing (replace n8n) — plan

**Status: PLANNED, not started.** Pick this up here. Nothing below is built yet.

Goal: publish approved content straight to LinkedIn, Instagram, Facebook, and
YouTube via their official APIs instead of routing through n8n.

## Why, and the honest trade-off

- **Pros:** no n8n dependency or extra hop, synchronous post status (no inbound
  callback needed), full control, per-account tokens.
- **Cons / reality:** each platform needs its own OAuth + token lifecycle, and
  (the real bottleneck) **app review / verification** that takes days to weeks.
  n8n was originally chosen partly to offload exactly this. The code is the
  smaller part; the platform approvals are the long pole.
- **Recommendation:** keep the `PublishProvider` abstraction and roll out
  per-platform. Do the easiest platform end to end first, keep n8n as the
  fallback for the rest via a per-platform router, and start the review/
  verification applications in parallel with coding.

## Architecture fit (the easy part)

- `providers/interfaces/PublishProvider.ts` already exists; `N8nPublishProvider`
  implements it. `ContentApprovalService.dispatchApproved()` calls
  `PublishProvider.publish(payload)` — **unchanged**. The approval gate,
  `approval_events` audit, `setStatusIfCurrent`, the dispatch re-check, the
  `content/approved` Inngest handler, and usage logging all stay the same.
- Build a `DirectPublishProvider` that routes by `payload.platform` to a
  per-platform publisher (mirror the existing `n8nWebhookUrlForPlatform` switch
  with a `directPublisherForPlatform`). Swap it in `lib/container.ts` (one line).
  You can even route some platforms to direct and others to n8n during rollout.
- **No inbound webhook needed:** direct API calls return the post id/URL
  synchronously (or you poll for video processing), so `dispatchApproved` can set
  `posted` (with `platform_post_url`) or `failed` directly.
  `/api/webhooks/publish-status` can stay for n8n or be retired later.

## New building blocks to add

1. **`social_connections` table** (new migration + RLS, service-role writes
   only; tokens never leave the server): `id, account_slug (fk accounts.slug),
   platform, access_token, refresh_token, expires_at, external_id, scopes,
   connected_by, created_at, updated_at`. `external_id` holds the
   platform-specific target: FB `page_id`, IG `ig_user_id`, LinkedIn author URN,
   YouTube `channel_id`. Encrypt tokens at rest (see Open decisions).
2. **`SocialConnectionRepository`** (get by account+platform, upsert, list).
3. **OAuth connect flow** per platform: `/api/oauth/[platform]/start` (redirect
   with a signed `state` that carries the account slug + CSRF nonce) and
   `/api/oauth/[platform]/callback` (verify state, exchange code → tokens →
   resolve external_id → store). These routes must be excluded from the auth
   proxy matcher like the other `/api/*` routes, or gated appropriately.
4. **Token refresh** per platform (refresh before `expires_at`).
5. **Per-platform publishers** implementing `publish(payload, connection)`:
   Meta (IG + FB), LinkedIn, YouTube.
6. **Connect UI**: a "Connections" section on the **Accounts editor**
   (`/accounts/[slug]`) with Connect / Reconnect buttons per platform and their
   connected status. Fits naturally now that accounts are data-driven.
7. **Env / config** (`lib/config.ts`, all optional at boot like the others):
   `META_APP_ID` / `META_APP_SECRET`, `LINKEDIN_CLIENT_ID` /
   `LINKEDIN_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
   (YouTube), an OAuth redirect base URL, and a token-encryption key.

## Per-platform specifics

> Confirm against current platform docs before implementing — these APIs,
> scope names, and review requirements change frequently.

### Meta: Facebook Pages + Instagram (Graph API)
- Requires a Meta app. Permissions gated by **App Review + Business
  Verification**: `pages_manage_posts`, `pages_read_engagement`,
  `instagram_basic`, `instagram_content_publish`, `business_management`.
- IG account must be **Business/Creator** and linked to a Facebook Page.
- Tokens: OAuth → short-lived user token → long-lived user token (~60d) → **Page
  access token** (can be long-lived). Store the Page token + `page_id` +
  `ig_user_id`.
- **FB Page image post:** `POST /{page-id}/photos` with `url` + `caption` +
  page token (`/feed` for text/link, `/videos` for video).
- **IG publish (2-step):** `POST /{ig-user-id}/media` with `image_url` (or
  `video_url`) + `caption` → returns a creation id → `POST
  /{ig-user-id}/media_publish` with that id. The media URL **must be publicly
  fetchable** by Meta (our signed Supabase URL works if reachable; give it a
  long enough TTL, or expose a short-lived public URL just for the fetch).
  Reels/video need a status poll before publish. Rate limit ~25 posts/24h.

### LinkedIn
- LinkedIn developer app, OAuth 2.0 (3-legged). Member posting:
  `w_member_social`. **Organization (company page) posting:**
  `w_organization_social` + **Community Management API access** (partner
  application/approval).
- Posts API `POST /rest/posts` (or legacy `/ugcPosts`). Images: register an
  upload → PUT the binary → reference the returned asset URN in the post. Author
  URN = `urn:li:person:{id}` or `urn:li:organization:{id}`.
- Access tokens ~60d; refresh tokens available.

### YouTube (video only — clips / heygen_video, not image posts)
- Google Cloud project + YouTube Data API v3. Scope
  `https://www.googleapis.com/auth/youtube.upload`. **Google OAuth app
  verification** required for the scope.
- Resumable `videos.insert` with the stored MP4 (we already keep clip/heygen
  files in `generated-media`) + `snippet` (title/description/tags) + `status`
  (privacy).
- Quota 10,000 units/day default; an upload costs ~1600 units (~6/day). Request
  more if needed.

## Media handling
- **IG/FB** pull media from a public URL — ensure the signed URL is reachable
  with adequate TTL, or mint a short-lived public URL just for the platform fetch.
- **LinkedIn / YouTube** upload the binary of the stored asset directly.

## Recommended sequencing
1. Build the connections subsystem: table + repo + generic OAuth start/callback +
   the Connections UI on Accounts. Validate connecting one real account.
2. Implement **one** platform end to end first (suggest Facebook Page or
   LinkedIn member — fewest review hurdles) behind `DirectPublishProvider`; keep
   n8n for the others via the router.
3. Add Instagram (needs Meta review), then LinkedIn organization, then YouTube.
4. Retire n8n per platform as each direct path is approved and verified.

## Open decisions (need the user)
- Post as the **Page/Organization** (elevated, review-gated permissions) or as a
  **member/personal** account (lighter, faster to ship)?
- Which platform first?
- Token encryption at rest: KMS vs. app-level secret vs. rely on the private
  table + service role only?
- Keep n8n as a fallback during rollout (recommended: yes, via the provider
  router)?

## What does NOT change
The approval gate, `approval_events` audit, `setStatusIfCurrent`,
`dispatchApproved` re-check, the `content/approved` handler, and usage logging.
Only the `PublishProvider` implementation, a connections subsystem, and the
connect UI are added.

---

## What Charles needs to provide, step by step per platform

Do these during downtime (they involve signup + approval waits). For each app,
set the OAuth **redirect URI** to your production domain:
`https://<your-app-domain>/api/oauth/<platform>/callback`
(routes not built yet; the paths are reserved by this plan). Send me only the
**Client ID / App ID** and **Client Secret / App Secret** per platform; they go
into Vercel env vars, never the repo. Also decide up front: **post as the
Page/Organization** (richer, but review-gated) or **as a personal/member
account** (faster to ship).

### LinkedIn  (portal: linkedin.com/developers)
1. Create an app; associate it with the LinkedIn **Company Page** you admin.
2. Auth tab → copy **Client ID** and **Client Secret**.
3. Add redirect URL: `.../api/oauth/linkedin/callback`.
4. Products to request: **Sign In with LinkedIn (OpenID Connect)** for auth, plus
   **Share on LinkedIn** (post as a member) and/or **Community Management API**
   (post as the Company Page — needs LinkedIn approval, apply now).
5. **Send me:** Client ID, Client Secret. Tell me: post as person or company page.

### Facebook + Instagram  (portal: developers.facebook.com)
1. Create an app, type **Business**.
2. Add products: **Facebook Login**, and **Instagram** (Graph API / content
   publishing).
3. Settings → Basic → copy **App ID** and **App Secret**.
4. Add OAuth redirect URI: `.../api/oauth/meta/callback`.
5. Make sure the **Instagram account is Business/Creator** and **linked to the
   Facebook Page** you want to post to.
6. In Meta Business Manager, start **Business Verification** and **App Review**
   for these permissions (this is the long pole, begin ASAP): `pages_manage_posts`,
   `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`,
   `business_management`.
7. **Send me:** App ID, App Secret. (One Meta app covers both FB and IG.)

### YouTube  (portal: console.cloud.google.com)
1. Create a Google Cloud project; enable **YouTube Data API v3**.
2. Configure the **OAuth consent screen** (External); add scope
   `.../auth/youtube.upload`; add yourself as a test user, and later submit for
   **verification** (needed for the upload scope).
3. Credentials → Create **OAuth Client ID** (Web application); add redirect URI
   `.../api/oauth/youtube/callback`; copy **Client ID** and **Client Secret**.
4. **Send me:** Client ID, Client Secret. (YouTube is video-only, so it applies
   to clips and avatar videos, not image posts.)

### Env var names I'll wire when you send the credentials
`META_APP_ID`, `META_APP_SECRET`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, plus a token-encryption key and the
OAuth redirect base URL. All optional at boot (like the existing keys).

### Heavy work queued for session reset (not started)
`social_connections` migration + repo, OAuth start/callback routes, token
refresh, per-platform publishers, `DirectPublishProvider` router, and the
Connections section on the Accounts editor. Config env scaffolding will be added
then too.
