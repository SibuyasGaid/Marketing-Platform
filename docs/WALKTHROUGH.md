# Walkthrough

A 10–15 minute guided tour of the platform. Order:
Brand Images → Content Engine → Approval Queue. End by approving something live.

## Before the demo (5 min)

1. Ensure `npm run dev` is running (the Inngest dev server must be up so jobs execute), or use the deployed URL.
2. Run `supabase/seed.sql` in the Supabase SQL Editor — seeds a preset, two competitors, a processed webinar with ranked segments, and a week of queued content. (Re-runnable; only touches demo-tagged rows.)
3. Log in as an **admin**. Have a short MP4 handy for the live ingest, plus 1–2 photos of a person for the avatar library.
4. Optional but stronger: generate one real image on /images beforehand so the queue has a card with an actual rendered thumbnail.

## 1. Brand Images (Tab 1) — 3 min

- **Presets:** point out the seeded sample preset with its palette strip. Presets are reusable brand voice + colors + style rules.
- **Avatar library (admin):** upload a photo of a person. Explain: several photos per person give the most natural results, and this same library feeds the avatar videos in Tab 2.
- **Generate:** pick the preset, select the person, choose Instagram, type a prompt ("Launch announcement graphic — bold, energetic"), hit Generate. While it renders (~15–30s), note the platform-aware sizing (LinkedIn is styled differently from IG/FB).
- **Refine + hand off:** use Regenerate with a note ("make the headline bigger") to show refinement without starting over, then **Send to queue** — this is the bridge to the approval flow.

## 2. Content Engine (Tab 2) — 4 min

- **Weekly batch:** point at "Generate this week's content" — one themed click produces a week of posts. Don't run it live unless you want to spend credits; describe it.
- **Ingest a webinar:** drag in the short MP4. The pipeline stepper shows **Transcribe → Analyze → Rank** advancing live. (For the demo, the seeded webinar already shows completed ranked segments — scroll to it.)
- **Ranked segments:** show the score badges and quotes. Select 1–2 segments, pick platforms, optionally tick "Create avatar hook (HeyGen)", and **Create content**. Explain: one call writes captions for every platform (LinkedIn distinct), plus email/ad copy, all landing in the queue.
- **Competitors:** show the watchlist. Every Monday the system researches these on the live web and emails an admin digest.

## 3. Approval Queue (Tab 3) — 4 min, the finale

- **Week board:** the seeded items are spread across the week. Show the platform/status filters.
- **Open the drawer:** click a `pending_approval` item. Walk through the preview, caption, generation inputs, and the **audit log**.
- **The gate (the key promise):** state plainly — *nothing posts without a recorded human approval, and it's enforced on the server, not just hidden in the UI.* Mention the automated test that proves a forced status change without an approval record refuses to publish.
- **Request edits:** open Request Edits on an image post, type a change, send it. It goes back, regenerates, and returns to the queue with the comment attached.
- **Approve live:** click **Approve** on an item. It records the approval, moves to `approved` → `publishing`, and dispatches to n8n. *(If n8n isn't connected yet, it lands in `failed` with the reason — explain that publishing turns on the moment the n8n workflow is wired, and everything up to the handoff is done.)*

## 4. Admin (bonus) — 1 min

- Show the **cost dashboard**: today's spend, by provider/task, and the per-run table. Every AI dollar is visible, with a daily budget cap and an out-of-credits alert.
- Show **job health** and **recent review activity** for operational visibility.

## Closing line

"Everything you generate waits in the daily queue. Approve posts it automatically; Request Edits sends it back with your comments; nothing posts without sign-off. Next we connect the social accounts through n8n so Approve publishes for real — then a short testing window before we call it launched."
