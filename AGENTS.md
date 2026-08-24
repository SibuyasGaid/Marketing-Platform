# AGENTS.md

Content Studio — an AI content generation and social publishing platform. Next.js (App Router) on Vercel, Supabase (Postgres/Auth/Storage), Inngest for background jobs, Gemini for images, Anthropic/OpenAI for text, HeyGen for avatar video, Resend/SendGrid for email, n8n for social publishing.

Overview: `README.md`. Full spec: `PROJECT_PROMPT.md`. Standards (read before coding): `docs/CODING_STANDARDS.md`, `docs/SECURITY.md`, `docs/API_OPTIMIZATION.md`. **All UI is built per `docs/DESIGN.md`** — dark violet-on-indigo token system, do not deviate; no hardcoded hex in components (tokens live in `globals.css` + Tailwind theme; the one status pill is `components/ui/StatusPill.tsx` driven by `statusStyles.ts`; the one button is `components/ui/Button.tsx`).

## Commands

```
npm run dev          # local dev (Next.js + Inngest dev server via concurrently)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest
npm run build        # next build
npm run db:types     # regenerate Supabase types after schema changes (needs Supabase CLI)
```

Run `typecheck` and `lint` before declaring any task complete. Never commit with either failing.

## Architecture map

```
src/
  app/                  # routes + server actions only; no business logic
    (app)/              # protected shell — tabs: /images, /content, /queue
    login/              # auth page + signIn/signOut server actions
    api/inngest/        # Inngest serve route (signature-verified)
  components/           # presentational React; no data fetching, no API calls
  services/             # business logic classes (see CODING_STANDARDS)
  providers/            # external API adapters behind interfaces
    interfaces/         # EmailProvider, PublishProvider, ImageGenProvider,
                        # TextModelProvider, VideoProvider
  repositories/         # all Supabase queries; nothing else touches the DB
  inngest/              # client.ts (typed eventType contracts) + functions.ts
  lib/                  # config, errors, domain, statusMachine, container
    supabase/           # server.ts (anon+cookies), admin.ts (service role)
  proxy.ts              # Next 16 middleware: session refresh + auth redirect
supabase/migrations/    # SQL migrations; RLS in the same migration as the table
```

## Stack/version notes (decided in Phase 1)

- **Next.js 16**: middleware lives in `src/proxy.ts` (default export `proxy`), not `middleware.ts`. Matcher excludes `/api/inngest` and `/api/webhooks` — those verify signatures instead of cookies.
- **Inngest v4 API**: triggers via `eventType(name, { schema })` / `cron(expr)` passed as `triggers: [...]` inside the single options arg of `createFunction(options, handler)`. No `EventSchemas`. Event schemas must not use zod transforms/defaults (input type must equal output type).
- **Zod v4**: use `z.email()`, `z.url()`, `z.uuid()`, `z.iso.date()` (not the deprecated `z.string().email()` chains).
- **Env validation is lazy**: `getServerEnv()` memoizes; nothing reads env at module scope, so `next build` runs without secrets. Test hook: `resetServerEnvCache()`.
- **Status lifecycle**: as spec, plus `failed → pending_approval` as the manual-retry path (re-approval required, gate intact).
- **DB access posture**: clients (anon key) get read-only policies on content tables; every state-machine write goes through service-role repositories server-side. `ai_usage_log` and `jobs` are admin-read only. `approval_events` is append-only.
- **No Upstash/Redis** (decided 2026-07-20): rate/spend caps are Postgres counters via `UsageService.assertCanGenerate` (soft daily budget + per-user caps from `ai_usage_log`). Every paid AI call must be recorded through `UsageService` (`recordTextUsage`/`recordMediaUsage`) with pricing from `lib/config.ts`; vendor credit exhaustion raises a `provider_alerts` row (throw `ProviderCreditsError`, call `reportCreditsExhausted`) which surfaces as an app-wide modal until an admin resolves it on /admin. Spend dashboard lives on /admin; per-run costs render via `components/usage/CostBadge`.
- **Approval gate implementation** (Phase 4): `ContentApprovalService` is the only path to publishing. `approve()` writes the `approval_events` row *before* flipping status and uses `setStatusIfCurrent` (compare-and-set) so a double-click can't dispatch twice. `dispatchApproved()` — called only from the `content/approved` Inngest handler — re-reads the row and re-checks `hasApprovalFor()` in the DB before touching `PublishProvider`; a forged event or a hand-edited status cannot publish. Never add a bulk-approve or skip-review path.
- **Webhook signing**: `lib/webhookSignature.ts` is shared by both directions — HMAC-SHA256 over `"<timestamp>.<rawBody>"`, headers `x-timestamp`/`x-signature`, constant-time compare, 5-minute freshness window. Inbound routes must verify against the **raw** body before parsing.
- **Optional env**: `RESEND_API_KEY`, the four `N8N_WEBHOOK_URL_<PLATFORM>` vars, and `N8N_WEBHOOK_SECRET` are optional at boot (blank strings coerce to undefined) so the app runs before those services are provisioned; the owning provider throws a clear `ProviderError` at call time instead.
- **Brands + per-platform posting** (2026-07-22): two sample brands (`demo_brand`, `sample_co`) live on the `brand` enum (`lib/domain.ts` `BRANDS`/`BRAND_NAMES`). Every `content_item` carries a `brand`; the composer, segment selection, weekly batch, and calendar all let the admin pick brand + platforms. Image posts fan out to one item per selected platform (`IMAGE_PLATFORMS` excludes youtube), each with a platform-optimized caption from `PostCaptionService` (one text call for all platforms). Publishing routes by platform: `n8nWebhookUrlForPlatform(env, platform)` picks one of four webhooks; `PublishPayload` includes `brand` + `brand_name`. Calendar entries store `platforms` (jsonb array) + `brand` and fan out in the cron.
- **Locked brand visual identity** (2026-07-22): `BRAND_STYLE_GUIDES` in `lib/domain.ts` holds each brand's official color/typography/art-direction sheet (Demo Brand = deep indigo `#1A0F3A` / violet `#892BE2` / gold `#FFD600`, Poppins headlines + Open Sans body). `buildImagePrompt`/`buildEditPrompt` inject it into every generation on top of the chosen preset — brand colors are authoritative, the preset palette is demoted to secondary. This is the single place to edit when a brand ships a new graphics reference; empty strings are skipped and fall back to the preset only.
- **Data-driven accounts** (2026-07-23): brands are now editable rows in the `accounts` table (slug/name/description/visual_identity), not a fixed enum. `Brand` is a `string` slug; `content_items.brand`/`content_calendar.brand` are text referencing `accounts.slug`. `BRANDS`/`BRAND_NAMES`/`BRAND_STYLE_GUIDES` in `lib/domain.ts` are now the seed + fallback (`AccountRepository.fallbackAccounts()`) used when the accounts table isn't migrated. The `/accounts` tab (list/search/create + `/accounts/[slug]` editor) manages each account's description, visual identity, and reference photos (`brand_references.account_slug`). All account reads are `.catch(fallback)` so the app runs before the migration. Generation injects the account's description + visual_identity (authoritative, falls back to `BRAND_STYLE_GUIDES`) and auto-applies its reference photos; pickers list accounts from the DB. Adding an account makes it selectable everywhere automatically.
- **Regeneration scope**: `ContentRegenerationService` fully regenerates `image_post` items (append reviewer comment → new job → re-render). Clips, copy sets, and avatar hooks cycle back to `pending_approval` with the comment attached for a human — re-running those needs source-segment context and is deliberately not automated yet.

## Non-negotiable rules

1. **Approval gate is server-enforced.** No code path may dispatch content to `PublishProvider` unless the item's status transition to `approved` was written with a matching `approval_events` row. UI state is never trusted.
2. **Every external API sits behind a provider interface.** Services depend on interfaces, never on SDKs directly. Swapping Resend→SendGrid or n8n→Zernio must require zero service-layer changes.
3. **RLS on every table, in the same migration that creates it.** Service-role key is server-only. See `docs/SECURITY.md`.
4. **All webhooks verify signatures** (Inngest signing key, n8n HMAC) before touching data.
5. **Zod-validate every boundary:** request bodies, server action inputs, webhook payloads, AI structured outputs, env vars (fail fast at boot via `lib/config.ts`).
6. **AI calls follow `docs/API_OPTIMIZATION.md`:** tiered models, cached system prompts, persisted results (never re-transcribe/re-analyze), capped max_tokens, idempotent Inngest steps so retries never duplicate paid calls, every call logged to `ai_usage_log`.
7. **No secrets in code, logs, error messages, or client bundles.** Env var names only.
8. **Never `setInterval(() => router.refresh(), …)`.** `router.refresh()` re-runs the whole server route — every query plus storage URL signing. A bare interval keeps firing in a background tab and never stops if its condition can't clear (a failed render, a publish that never settles), which is a self-inflicted DoS on the database. Use `useActiveRefresh(active, intervalMs)` (hidden-tab skip + 1.5x backoff + hard stop) for full refreshes, or `useGenerationStatusRefresh` to poll the cheap `/api/generation-status` signature and refresh only on real change.

## Working style

- Plan before coding: for any multi-file task, state the plan (files, schema changes, interfaces touched) and confirm it compiles conceptually before writing.
- Small, complete units: finish a vertical slice (migration → repository → service → route/UI) rather than scaffolding everything at once.
- After schema changes: write the migration, run `npm run db:types`, also then update code.
- When a stakeholder-facing behavior is ambiguous, choose the interpretation that keeps the approval gate strictest and flag the assumption in your summary.
- End every task with: what changed, what to test manually, any env/external setup owed by the team.

## Keeping this file current

When commands, structure, schema conventions, or architectural decisions change, update this file in the same commit — it must be enough for a blank session to pick the work up. (`CLAUDE.md` is a pointer: `@AGENTS.md` — content lives here.)

- **Demo mode** (2026-08-24): with Supabase unconfigured (`isDemoMode()` in `lib/demoMode.ts` — true when `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is blank), `createSupabaseAdminClient`/`createSupabaseServerClient` return the stub in `lib/demo/demoClient.ts` instead of throwing. It implements the slice of PostgREST the repositories use (eq/neq/in/gt/gte/lt/lte/is, order, limit, range, single/maybeSingle, head-count) over fixtures in `lib/demo/fixtures.ts`, so real repositories and real mappers run unchanged — **no repository, service, or page has a demo branch**. Writes resolve without persisting. Storage paths resolve to inline SVG art (`lib/demo/placeholders.ts`); nothing leaves the process. `proxy.ts` skips the auth gate, and each action file's `requireUser()` throws `DemoModeError` (extends `AppError`, so the existing `toState` renders its message) — one line per file covers all 95 actions. Any page whose render depends on `isDemoMode()` must be `force-dynamic`: `next build` runs without secrets, so a prerendered page bakes in the build machine's answer.

## Repo posture

This is a portfolio repo. It carries no credentials and connects to no hosted database: `.env.example` is names-only, `APP_URL` falls back to localhost, and the two seeded accounts are placeholders. Do not add real project URLs, keys, app IDs, customer names, or company branding. Keep it runnable with no configuration — demo mode is what makes the repo browsable, so don't add a module-scope env read that breaks booting without secrets.
