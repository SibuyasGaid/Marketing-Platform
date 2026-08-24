# Content Studio

An AI content generation and social publishing platform. Generate brand-consistent
images and video, turn long-form recordings into short-form clips, and publish to
Instagram, Facebook, LinkedIn, and YouTube — with a human approval gate that no
code path can bypass.

Built with Next.js 16 (App Router), Supabase, and Inngest.

> **Portfolio project.** This repo ships with no credentials and connects to no
> hosted database. Bring your own Supabase project and API keys to run it.

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

## Running it

Requires Node 20+, a Supabase project, and an Inngest account.

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

Next.js 16 · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres/Auth/Storage) ·
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
