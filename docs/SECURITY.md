# Security Policy

This is an internal tool, but it holds brand assets, stakeholder likenesses (avatar references of real people), API keys for paid services, and the power to post publicly to company social accounts. Treat it as production-grade.

## 1. Secrets

- Secrets exist in exactly two places: Vercel environment variables and local `.env.local` (gitignored). Never in code, comments, migrations, seed files, logs, error messages, test fixtures, or documentation.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. It must never appear in any file under `components/`, any `"use client"` file, or anything prefixed `NEXT_PUBLIC_`. Grep for it in CI.
- Validate all env vars at boot with zod in `lib/config.ts`; crash immediately with the *name* of the missing var, never its value.
- Rotate any credential the moment it is suspected exposed (e.g., shared in chat or pinned in Slack). Team credentials belong in a password manager, not in messages.
- Client-side never calls AI providers directly. All Gemini/Anthropic/OpenAI/HeyGen calls happen server-side or in Inngest jobs.

## 2. Supabase Row Level Security

- **Every table gets RLS enabled in the same migration that creates it.** A migration creating a table without `alter table ... enable row level security` plus policies is incomplete and must not merge.
- Default posture: deny. Policies grant the minimum needed:
  - `profiles`: users read/update their own row; admins read all.
  - `content_items`, `approval_events`, `content_calendar`: authenticated org members read; writes go through server-side code paths (service role) so the state machine cannot be bypassed by direct PostgREST calls.
  - `avatar_references`: read for authenticated members; write restricted to `admin` role — these are real people's likenesses.
  - `ai_usage_log`, `jobs`: read for admins; written only server-side.
- Storage buckets are private by default. The UI receives short-lived signed URLs generated server-side. Public buckets are forbidden. Signed URLs sent to n8n for publishing get the minimum practical expiry.

## 3. Authentication and authorization

- All app routes behind Supabase Auth middleware; unauthenticated requests redirect to login. No allow-listed "temporary" open routes.
- Roles: `admin`, `editor`, `reviewer` stored in `profiles`, checked **server-side** in services — never inferred from client state.
- Only `admin` and `reviewer` roles may approve content or request edits. Enforce in `ContentApprovalService`, not just by hiding buttons.

## 4. The approval gate (highest-priority control)

This app can post to the company's public social accounts. The single most important security property: **nothing reaches `PublishProvider.dispatch()` without a server-verified approval.**

- Status transitions run only through the state machine; `pending_approval → approved` requires an authenticated reviewer identity and writes an `approval_events` row in the same transaction.
- The Inngest `content/approved` handler re-verifies the DB status and approval event before dispatching — it does not trust the event payload alone.
- There is no admin override, bulk-approve-all endpoint, or "skip review" flag in the MVP. If stakeholders want bulk approval later, it is an explicit per-item multi-select that still records one approval event per item.
- Audit log (`approval_events`) is append-only: no update or delete policies exist on it.

## 5. Webhooks and callbacks

- Inngest endpoints verified with `INNGEST_SIGNING_KEY` (the SDK's built-in verification stays on; never disabled "for local testing" in committed code).
- Outbound n8n calls include an HMAC-SHA256 signature header over the raw body using `N8N_WEBHOOK_SECRET`. Inbound `/api/webhooks/publish-status` verifies the same HMAC, rejects on mismatch with 401, and rejects stale timestamps (>5 min) to block replays.
- HeyGen callbacks (if used) are verified per HeyGen's signing docs; otherwise poll instead of accepting unauthenticated callbacks.
- Webhook handlers validate payloads with zod and look up referenced IDs before acting; they never write attacker-controlled fields directly.

## 6. Input handling and uploads

- Zod on every boundary (routes, server actions, webhooks, Inngest event data).
- VOD uploads: allow-list content types (video/mp4, video/quicktime, audio types for audio-only), enforce max size at both the client and the storage policy, and store under a server-generated path — never a user-supplied filename.
- Avatar reference uploads restricted to image types, admin-only, same path rules.
- User-entered prompts and edit comments are data, not instructions to the app: render escaped in the UI, and when injected into AI prompts, wrap in delimited blocks so a reviewer comment can't smuggle system-level instructions (see API_OPTIMIZATION.md §6 on prompt injection).

## 7. Rate limiting and abuse controls

- Caps are enforced with Postgres counters (`ai_usage_log`, via `UsageService.assertCanGenerate`): a soft daily spend budget and per-user daily generation caps, both configured in `lib/config.ts`. At internal-tool scale a DB count per generation request is sufficient; the primary cost protections are idempotent Inngest steps and persisted results. (Decision 2026-07-20: Upstash Redis dropped from the stack — revisit only if traffic outgrows Postgres counting.)
- Auth-sensitive routes rely on Supabase Auth's built-in rate limiting.
- Webhook endpoints reject invalid HMACs immediately and cheaply; no counter needed at this scale.

## 8. Logging hygiene

- Structured logs with job IDs and item IDs. Never log: API keys, signed URLs, full AI prompts containing brand-internal strategy, webhook signatures, or auth tokens.
- `ProviderError` messages logged server-side may include vendor error codes; client-facing messages are generic.

## 9. Dependencies and CI

- Lockfile committed; `npm audit` in CI, failing on high/critical.
- No new dependency without a reason recorded in the PR description; prefer the platform (Supabase/Inngest/Next) over adding packages.
