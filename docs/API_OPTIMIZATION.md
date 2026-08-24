# AI API Usage & Token Optimization

Every AI call costs money and time. This app makes many of them (transcript analysis, segment scoring, copy for four platforms, image generation, HeyGen video). These rules keep spend proportional to value. All rules are enforced in code review, not left to intent.

## 1. Model tiering

Match model capability to task difficulty. Model IDs live in `lib/config.ts` only — never hardcoded at call sites — so tiers can be retuned without a code hunt.

| Task | Tier | Example (Anthropic) |
|---|---|---|
| Transcript segment scoring, classification, tagging, metadata extraction | Fast/cheap | `claude-haiku-4-5` |
| Final marketing copy, LinkedIn long-form, email copy, campaign angles | Mid | `claude-sonnet-4-6` |
| Weekly competitor digest synthesis | Mid | `claude-sonnet-4-6` |

Do not use a top-tier model anywhere in the MVP. If output quality is insufficient, fix the prompt and inputs first; escalating the model tier is a deliberate config change, not a per-call decision.

## 2. Never pay for the same work twice

- **Transcripts are persisted permanently.** A source video is transcribed exactly once. Any feature needing the transcript reads `transcripts`, never re-transcribes.
- **Analyses are persisted.** Segment scores/rankings are written to the DB keyed by transcript + analysis version. Re-running analysis requires an explicit version bump or user action, never an implicit refresh.
- **Regeneration reuses context.** "Request edits" re-runs generation with the original inputs + the reviewer comment — it does not restart the upstream transcription/analysis chain.
- **Idempotency in Inngest is mandatory.** Every step that calls a paid API is wrapped in `step.run` with a stable step ID, and the service method takes an idempotency key (content item ID + step name). A retried job must return the persisted prior result, not call the vendor again. This is the single biggest cost-bug risk in the system.

## 3. Prompt construction

- **System prompts are static and cacheable.** Brand voice rules, platform style guides, and output format instructions live in versioned prompt files (`lib/prompts/`), identical across calls, with Anthropic prompt caching enabled (`cache_control` on the system block). Dynamic content (transcript chunk, calendar prompt, edit comment) goes only in the user turn.
- **Send only what the task needs.** Segment scoring gets the chunk being scored plus a one-line video summary — not the full transcript. Copy generation gets the selected segment text — not the whole VOD.
- **Chunk long transcripts** (~8–12k tokens per chunk with small overlap), score per chunk (fast tier), then rank the top candidates in a single reduce call. Never send a 2-hour transcript in one prompt.
- **Cap `max_tokens` per task type** in config: scoring calls ~500, captions ~800, long-form LinkedIn/email ~1,500, digest ~2,500. A call without an explicit cap is a review failure.
- One generation call produces all four platform variants for a copy set in a single structured response — four platforms is one call, not four.

## 4. Structured outputs

- Every analysis/scoring call returns JSON validated by zod. On parse failure: one repair attempt with the error appended, then fail the job — no unbounded retry loops against a paid API.
- Keep schemas flat and terse; verbose nested schemas inflate output tokens.

## 5. Expensive media calls (Gemini images, HeyGen video)

- **HeyGen is the most expensive call in the system.** Videos are generated only for explicitly user-selected topics/segments — never automatically for every ranked segment. The weekly batch generates the number of videos specified by the calendar, no speculative extras.
- Image generation: one image per queued post by default; "regenerate" is a user action on a specific item, capped per item per day (config).
- Generated media is stored in Supabase Storage immediately and referenced thereafter — never regenerated because a URL was lost.
- Avatar reference images are uploaded once to HeyGen (or referenced by stable asset IDs) — not re-uploaded per generation.

## 6. Prompt injection defense

Transcripts, competitor content, and reviewer comments are untrusted text that gets embedded into prompts. Wrap them in clearly delimited blocks (`<transcript>…</transcript>`, `<reviewer_note>…</reviewer_note>`) and instruct the model that content inside delimiters is data to analyze, never instructions to follow. Competitor monitoring especially: scraped/competitor text must not be able to steer copy generation or the digest email.

## 7. Cost observability

- Every AI call logs to `ai_usage_log`: provider, model, task type, input/output tokens (from the API response), estimated cost, content item / job reference, timestamp.
- The admin view shows spend by day and by task type. This ships in the MVP — cost visibility is a feature, not a nice-to-have.
- Config includes a soft daily budget; when exceeded, non-scheduled generation endpoints return a friendly "budget reached" error while scheduled/approved flows continue.

## 8. Concurrency and retries

- Inngest concurrency limits per provider (e.g., 3 concurrent HeyGen jobs, 5 concurrent LLM steps) to stay under vendor rate limits — hitting 429s and retrying is paying latency for nothing.
- Retries: exponential backoff, max 3 attempts, only on retryable errors (429/5xx/timeouts). 4xx validation errors fail immediately to a `failed` status with the safe error surfaced in the queue UI.
