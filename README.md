# Content Studio

An AI content generation and social publishing platform. Generate brand-consistent
images and video, turn long-form recordings into short-form clips, and publish to
Instagram, Facebook, LinkedIn, and YouTube — with a human approval gate that no
code path can bypass.

Built with Next.js 16 (App Router), Supabase, and Inngest.

> **This is a copied, de-branded version of a client tool.** The live version
> runs with the client, on their infrastructure, under their own keys and
> secrets; none of those are in this repo or its history. This copy was purged
> of company data, branding, names and brand guides (the two sample accounts
> and their visual identities are invented), and it ships with no credentials
> and no connection to any hosted database.
>
> It runs anyway: with Supabase unconfigured the app starts in **demo mode** and
> serves the full interface against in-memory sample data, so you can clone it
> and browse every screen with `npm install && npm run build && npm start`.
> Supply your own Supabase project and API keys to make it real.
>
> Built by [Charles Luis Gaid](https://charlesluisgaid.com/).

---

## What it does

**Generate images.** Per-account style guides (palette, typography, art direction,
recurring layouts) are injected into every prompt, so output stays on-brand across
a whole feed rather than drifting shot to shot. Platform-aware sizing, a reference
photo library for consistent likenesses, and refine-with-a-note regeneration that
doesn't restart from scratch.

**Repurpose long-form video.** Ingest a recording; the pipeline transcribes it,
scores every segment for clarity and promotional potential, ranks and deduplicates
the candidates, then cuts the winners into clips with ffmpeg. One text call writes
platform-specific captions for the whole set — LinkedIn framing genuinely distinct
from Instagram, not the same string reposted.

**Generate avatar video.** Talking-head hooks from a script via HeyGen, with
burned-in captions and account outro clips appended by ffmpeg.

**Publish with an approval gate.** Everything lands in a calendar-style queue as
`pending_approval`. A reviewer approves or requests edits with a comment; edits
route back through regeneration. Approved items dispatch to the platform APIs
directly or through n8n webhooks.

**Watch the spend.** Every paid AI call is priced and logged. A daily budget cap
and per-user limits are enforced before the call, not after the bill.

## The approval gate

The gate is the load-bearing design decision, so it's enforced in three places:

1. `ContentApprovalService` writes the `approval_events` row **before** flipping
   status, using a compare-and-set so a double-click can't dispatch twice.
2. The Inngest dispatch handler re-reads the row and re-checks `hasApprovalFor()`
   against the database before touching a publish provider.
3. Clients hold a read-only anon key. Every state-machine write goes through a
   service-role repository server-side.

A forged event or a hand-edited status row refuses to publish. There is no
bulk-approve and no skip-review path, deliberately.

## Architecture

```
src/
  app/            routes + server actions only; no business logic
  components/     presentational React; no data fetching
  services/       business logic (12 services)
  providers/      external APIs behind interfaces — swapping Resend for
                  SendGrid, or n8n for a direct API, touches no service code
  repositories/   every Supabase query lives here; nothing else touches the DB
  inngest/        typed background job contracts + handlers
  lib/            config, errors, domain, status machine, DI container
supabase/migrations/   RLS policies ship in the same migration as their table
```

Layer rules are strict on purpose: a route never queries, a component never
fetches, a service never imports an SDK. Every boundary — request bodies, server
action inputs, webhook payloads, AI structured output, env vars — is Zod-validated.

**Cost discipline.** Tiered models per task, cached system prompts, capped
`max_tokens`, persisted results (transcripts are never re-derived), and idempotent
Inngest steps so a retry never repeats a paid call.

**Security.** RLS on every table. Webhooks in both directions authenticate with
HMAC-SHA256 over `"<timestamp>.<rawBody>"` with a constant-time compare and a
5-minute freshness window, verified against the raw bytes before parsing. OAuth
state is signed and bound to the user id. Stored social tokens are encrypted at
rest with AES-256-GCM. Secrets appear as env var *names* only — never in code,
logs, or error messages. See [docs/SECURITY.md](docs/SECURITY.md).

## How it's tested

226 Vitest tests, organised by risk rather than by file. Services run against
injected fakes, so the suite needs no network or database and finishes in about
five seconds.

| Area | What the tests prove |
|---|---|
| The publish gate (`ContentApprovalService`) | Approve, schedule, request edits, retry, repost and publish callbacks, including **bypass attempts**: a status forced to `approved` without an approval event, and a forged `content/approved` event, both refuse to publish. A double-click cannot dispatch twice. |
| Status state machine | Every legal and illegal transition, table-driven |
| AI output guardrails | Structured output is zod-validated with exactly one repair attempt, never a third paid call; transcripts are schema-checked; em dashes are stripped from generated copy |
| Spend control | Per-model and per-second cost math, daily and per-user caps, credit-exhaustion alerts |
| Idempotency | A retried render stores once and logs its cost once |
| Webhooks | Tampered body, wrong secret, replayed signature, stale timestamp |
| Demo mode | The stub behaves like PostgREST through the real repositories and never persists |

## Demo mode

When `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing, the
app serves a read-only tour instead of failing on the first query:

- Pages render against fixtures in `src/lib/demo/`, fed through the **real**
  repositories — the actual column mapping and domain conversion still run.
- Generated media resolves to inline SVG art matching each sample account's
  style guide, so the page is self-contained with no external requests.
- Auth is bypassed (there is no auth provider to check against) and anything
  that would write returns "nothing is saved" instead.

Interception lives in `createSupabaseAdminClient()` / `createSupabaseServerClient()`,
which hand back a stub client. No repository, service, or page contains a demo
branch. Setting both Supabase vars turns it off with no code change, and the
auth gate is fully enforced the moment it is off.

## Running it

Requires Node 20+. A Supabase project and an Inngest account are needed for real
use; without them you get demo mode.

```bash
npm install
cp .env.example .env.local     # fill in your own values
npm run dev                    # Next.js + the Inngest dev server
```

Apply `supabase/migrations/` in order, then optionally run `supabase/seed.sql`
for demo data. Two sample accounts (Demo Brand, Sample Co) ship as placeholders
showing what a filled-in style guide looks like — edit or delete them on
`/accounts`.

```bash
npm run typecheck
npm run lint
npm run test
```

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 (token-driven "proofing desk" UI, self-hosted Schibsted Grotesk) · Supabase (Postgres/Auth/Storage) ·
Inngest · Zod v4 · Vitest · Gemini (images) · Anthropic + OpenAI (text) ·
HeyGen (avatar video) · ffmpeg · Resend/SendGrid · n8n

## Docs

| | |
|---|---|
| [AGENTS.md](AGENTS.md) | Architecture map and the non-negotiable rules |
| [docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md) | Layer boundaries and conventions |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model and controls |
| [docs/API_OPTIMIZATION.md](docs/API_OPTIMIZATION.md) | Token and cost strategy |
| [docs/DESIGN.md](docs/DESIGN.md) | Design token system |
| [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md) | Guided tour of the three workspaces |
