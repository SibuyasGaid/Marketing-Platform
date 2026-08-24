# Master Build Prompt — Content Studio

> Kept as a record of the original build specification this project was implemented from.

> **How to use this file:** Initialize an empty repo, drop `CLAUDE.md` and the `docs/` folder into the root, then paste this entire prompt into Claude Code as your first message. Work phase by phase — do not ask Claude Code to build everything in one shot. At the end of each phase, run the verification checklist before moving on.

---

## 1. Context

You are building an internal web application: a centralized platform for AI-assisted brand image generation, long-form content repurposing, and multi-platform social publishing with a human approval gate.

Read `CLAUDE.md` and everything in `docs/` before writing any code. Those files define non-negotiable standards for architecture, security, and AI API token usage. Follow them for every file you create.

## 2. Scope — Three Workspaces (Tabs)

### Tab 1: Brand Image Agent
A guided interface for generating brand-consistent social images via the Google Gemini API.

- Brand preset selection: tone, colors, visual style, campaign context. Presets are stored in Supabase and reusable.
- Prompt-assisted generation for posts, ads, announcements, and promotional creatives.
- **Platform-aware output:** LinkedIn image styles are distinct from Instagram/Facebook styles. Each preset defines per-platform variants (dimensions, tone, visual treatment).
- **Avatar reference library:** each recurring on-camera person has a library of multiple approved reference images stored in Supabase Storage. Generation flows can pull these references so outputs consistently depict them. Multiple references per person is required — HeyGen and image outputs look most natural with several.
- Saved output history tied to the authenticated user and workspace; assets stored in Supabase Storage.
- Regeneration workflow: refine an output with an adjustment note without restarting from scratch.

### Tab 2: Content & Marketing Agent Team
The heavy automation engine. Handles **both** clipping existing videos **and** generating new ones.

- VOD / live-training ingestion with metadata capture.
- AI transcript analysis to identify strong segments (clarity, relevance, teaching value, promotional potential), with ranking.
- Automated clip job creation for selected highlight segments.
- Generation of platform-specific social captions, email copy, ad copy, and campaign angle variations. **LinkedIn copy is a distinct style** from IG/FB — longer, professional framing, different hook structure.
- HeyGen-powered avatar video hook generation for selected topics/offers, using the avatar reference library above.
- Weekly competitor monitoring summaries compiled and delivered by email (Resend by default; SendGrid supported behind the same provider interface).
- **Weekly batch mode:** a single action — "Generate this week's content" — that produces a full week of static image posts and video content in one orchestrated run, queued into the approval tab.

### Tab 3: Content Queue & Approvals (added by stakeholders — not in the original plan)
A calendar-style queue screen showing what content is scheduled/generated for each day.

- Every generated piece (image post, clip, HeyGen video, copy set) lands here with status `pending_approval`.
- **Approve button:** on click, the item is dispatched to socials automatically via an n8n webhook (Zernio is an acceptable alternative; build behind a `PublishProvider` interface either way). Nothing ever posts without explicit approval — enforce this server-side, not just in the UI.
- **Request Edits action:** opens a comment box; the reviewer writes required changes; item moves to `edits_requested` with the comment attached; the generation pipeline can re-run with the edit note as an additional instruction.
- Status lifecycle: `draft → pending_approval → approved → publishing → posted` | `edits_requested → regenerating → pending_approval` | `failed`.
- Per-day view of the queue, filterable by platform and status.
- Audit log of who approved/requested edits and when.

### Scheduled Generation (added by stakeholders)
- **Content calendar input:** users enter, ahead of time, either a prompt or a template reference for each day's posts.
- An Inngest cron runs daily, reads the calendar, generates that day's content, and places it in the approval queue.
- Weekly competitor digest is a separate Inngest cron delivering email via the email provider.

## 3. Target Platforms

| Platform | Content types | Style notes |
|---|---|---|
| Instagram | Image posts, clips, HeyGen videos | Visual-first, short captions, hashtags |
| Facebook | Image posts, clips, HeyGen videos | Similar to IG, slightly longer copy allowed |
| LinkedIn | **Distinct** post copy + **distinct** image style | Professional tone, longer-form, thought-leadership framing |
| YouTube | Clips and generated videos | Titles, descriptions, tags generated per video |

## 4. Tech Stack (fixed — do not substitute)

| Layer | Technology |
|---|---|
| Frontend + hosting | Next.js (App Router) on Vercel |
| Database, auth, storage | Supabase (Postgres + RLS, Auth, Storage) |
| Background jobs / orchestration | Inngest |
| Image generation | Google Gemini API |
| Text analysis + copywriting | Anthropic API (primary), OpenAI API (optional secondary) — behind a provider interface |
| Avatar video generation | HeyGen API |
| Email | Resend (default) / SendGrid — behind an `EmailProvider` interface |
| Social publishing | n8n webhook (default) / Zernio — behind a `PublishProvider` interface |
| Rate limiting | Upstash |

## 5. Data Model (initial schema — extend as needed, never weaken RLS)

- `profiles` — app users, role (`admin`, `editor`, `reviewer`).
- `brand_presets` — tone, palette, style rules, per-platform variants (JSONB).
- `avatar_references` — person name, storage path, active flag. Multiple rows per person.
- `source_videos` — VOD metadata, storage path or source URL, transcript status.
- `transcripts` — full transcript text + segment map, linked to source video. **Persisted permanently; never re-transcribe.**
- `content_items` — the central table. Type (`image_post`, `clip`, `heygen_video`, `copy_set`), platform, scheduled date, status (lifecycle above), generation inputs, output asset refs, edit comments.
- `content_calendar` — per-day prompt or template reference entered ahead of time.
- `approval_events` — audit log: who, action, comment, timestamp.
- `competitor_reports` — weekly digest content + delivery status.
- `ai_usage_log` — provider, model, tokens in/out, cost estimate, job ref (see `docs/API_OPTIMIZATION.md`).
- `jobs` — Inngest job tracking mirror for UI status display.

All tables get Row Level Security. Storage buckets get access policies. See `docs/SECURITY.md`.

## 6. Inngest Workflows

1. **`vod/ingested`** — transcribe → analyze + rank segments → write results → await user selection.
2. **`segments/selected`** — clip jobs → copy generation per platform → optional HeyGen hook job → all outputs written as `content_items` in `pending_approval`.
3. **`content/approved`** — dispatch to `PublishProvider` (n8n webhook) → track delivery → mark `posted` or `failed`.
4. **`content/edits-requested`** — re-run generation with the reviewer's comment appended as an instruction → back to `pending_approval`.
5. **Cron: daily generation** — read `content_calendar` for today → generate → queue for approval.
6. **Cron: weekly competitor digest** — compile → send via `EmailProvider`.
7. **`week/batch-requested`** — orchestrate a full week of static + video content generation → queue all items.

All heavy work runs in Inngest, never in request handlers. All steps must be idempotent (see `docs/API_OPTIMIZATION.md` — retries must never duplicate paid API calls).

## 7. n8n Publish Contract

On approval, POST to the configured n8n webhook with an HMAC signature header. Payload:

```json
{
  "content_item_id": "uuid",
  "platform": "instagram | facebook | linkedin | youtube",
  "type": "image_post | clip | heygen_video",
  "caption": "string",
  "asset_urls": ["signed supabase urls"],
  "scheduled_for": "iso8601 | null"
}
```

n8n calls back a `/api/webhooks/publish-status` endpoint (HMAC-verified) with `posted` / `failed` + platform post URL.

## 8. Build Phases

**Phase 1 — Foundation (Day 1):** Next.js app on Vercel, Supabase auth + schema + storage + RLS, Inngest scaffolding, protected routing, shared UI shell, env var wiring. Provider interfaces defined (`EmailProvider`, `PublishProvider`, `ImageGenProvider`, `TextModelProvider`, `VideoProvider`) with concrete implementations stubbed.

**Phase 2 — Tab 1 (Day 2):** Brand Image Agent, presets, Gemini pipeline, avatar reference library upload + management, output history, regeneration.

**Phase 3 — Tab 2 (Days 3–4):** VOD ingestion, transcript pipeline, segment analysis + ranking, clip orchestration, per-platform copy generation, HeyGen integration, weekly competitor digest, weekly batch mode.

**Phase 4 — Tab 3 + Scheduling (Day 5):** Approval queue UI, approve/request-edits flows with server-side enforcement, audit log, n8n publish integration + status callbacks, content calendar + daily cron.

**Phase 5 — Polish (Day 6):** Error/fallback states, admin visibility, status displays, stakeholder walkthrough prep.

After each phase: `npm run typecheck && npm run lint && npm run test` must pass, and you must summarize what was built and what env vars/external setup the team owes you.

## 8.1 Session Continuity (mandatory — this project spans multiple sessions)

You have no memory between sessions. The repo is your only memory. Maintain it as follows:

1. **`PROGRESS.md` at the repo root is your session log.** At the start of every session, read it first. At the end of every session (and after completing any significant unit of work), update it with:
   - Current phase and what is **done** (checked list per phase deliverable).
   - What is **in progress** and its exact state (e.g., "migration written, repository not yet wired").
   - What is **next** — the specific next task a blank session should pick up.
   - Known issues, TODOs, and any deviations from this spec with the reason.
   - External blockers (missing env vars, pending API keys, awaiting stakeholder decisions).
2. **Keep `CLAUDE.md` current.** Whenever you add or change commands, directory structure, provider implementations, schema conventions, or make an architectural decision not covered by the docs, update `CLAUDE.md` in the same commit. A new session reading only `CLAUDE.md` + `PROGRESS.md` must be able to continue without re-reading the entire codebase.
3. **Never restart or re-scaffold work already marked done in `PROGRESS.md`.** If something looks wrong, note it and fix forward.
4. If you are ever started in this repo without further instructions, your default action is: read `CLAUDE.md`, read `PROGRESS.md`, then continue from its "next" item.

## 9. Non-Goals for MVP

- No public-facing pages; internal tool only.
- No in-app video editor; clipping is automated via segment timestamps.
- No direct platform API integrations for posting (n8n owns that).
- No multi-tenant workspaces; single organization.

## 10. Environment Variables (names only — values live in Vercel/local `.env.local`, never in the repo)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY        # server-only, never exposed to client
ANTHROPIC_API_KEY
OPENAI_API_KEY                   # optional
GOOGLE_GEMINI_API_KEY
HEYGEN_API_KEY
RESEND_API_KEY                   # or SENDGRID_API_KEY
INNGEST_EVENT_KEY
INNGEST_SIGNING_KEY
N8N_PUBLISH_WEBHOOK_URL
N8N_WEBHOOK_SECRET               # HMAC shared secret
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

## 11. Definition of Done (MVP)

- All three tabs functional end to end.
- Nothing can post to socials without a recorded approval event — verified by attempting to bypass via direct API call.
- Daily cron generates from the calendar; weekly digest email delivers.
- Every AI call is logged in `ai_usage_log` with token counts.
- RLS enabled on every table; anon key cannot read another user's data.
- Typecheck, lint, and tests green.
