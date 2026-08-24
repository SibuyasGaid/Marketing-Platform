# Plan — Combine Videos tab (merge clips / avatar videos / uploads, no credits)

> **Status: BUILT (2026-08-13), not pushed.** Implemented per this plan and all
> six decisions. Kept here as the design record; see PROGRESS.md for the shipped
> summary. Remaining polish (thumbnails in the picker) noted below.

## 1. Goal (from the Slack thread)

A new place to **stitch multiple videos into one**, using code (ffmpeg) so it
**never spends AI credits**. Sources are anything we already have — generated
**clips**, **avatar videos**, or **uploaded** videos — plus files uploaded on the
spot. The user picks the videos, **fixes the sequence**, and merges. The merged
result then behaves like any generated video: **download**, **add a post caption
(typed or from a prompt)**, **add subtitles**, or **push to the Approval Queue**.

Requested as: *"a different tab we can merge/connect any clips or avatar vids we
generate, or vids we upload… then download, add post captions (typed or from
prompt), add subtitles, or push to approval queue"* — with the hard constraint
that it must not use AI credits.

## 2. Why this is cheap to build

The merge primitive **already exists** in the repo. `FfmpegClipProvider.appendOutro`
([src/providers/FfmpegClipProvider.ts](../src/providers/FfmpegClipProvider.ts))
already:
- normalizes each input to an identical layout (1080×1920, 30 fps, H.264 + AAC
  stereo 48k), **adding a silent audio bed when a clip has none**, then
- concatenates with the **concat demuxer** (stream copy).

A general merge = the same thing extended from 2 inputs to N. ffmpeg runs from a
bundled `ffmpeg-static` binary in the Inngest background functions (same place
the outro/caption jobs run). **No external service, no per-use cost.**

## 3. User stories (v1)

1. As an editor, I open **Generate Videos → Combine**, select 2+ existing videos
   (clips / avatar videos / prior uploads) and/or upload new ones.
2. I **drag to reorder** them into the sequence I want.
3. I click **Combine** — a background job stitches them (no credits) and the
   result appears in **Generated videos** (the existing holding area).
4. From there I **download**, **add a caption** (typed or "Suggest from prompt"),
   **add subtitles**, or **Send to Approval Queue** — then schedule/approve as
   usual.

## 4. Scope

**In (v1):**
- Combine 2–N videos (cap N, see §9) into one vertical 9:16 output.
- Sources: pick from our stored videos **and/or** direct-upload new ones.
- Reorder before merging.
- Output lands in the existing **Generated videos** studio holding as a normal
  `heygen_video` item (kind `merged_video`), gate-safe.
- Holding actions: download, caption (typed / from prompt), **add subtitles**,
  send to Approval Queue. (Most already exist; subtitles is the one addition.)

**Out (v1) — possible later:**
- Trimming/splitting a clip inside the tool (only whole clips in v1).
- Transitions/crossfades, per-clip volume, background music.
- Non-9:16 output presets (v1 forces 9:16, matching our content). Landscape
  uploads get letterboxed (pad) — see open questions.
- Timeline scrubbing UI (v1 is an ordered list with thumbnails, not a timeline).

## 5. UX / UI

**Location:** add a third sub-tab to the existing Generate Videos tab:
`Compose | Combine | Generated videos` (in
[VideoStudioTabs.tsx](../src/components/avatar/VideoStudioTabs.tsx)). Rationale:
the output already belongs in **Generated videos**, so keeping Combine next to it
is the most cohesive. (Alternative: a top-level nav item — heavier, less cohesive.)

**Combine composer (`CombineStudio`, new client component):**
- **Account/page** picker + **platforms** (same controls as the other studios).
- **Source list** — an ordered list of chosen segments, each a card with a
  thumbnail + label + remove button, **drag-to-reorder** (framer-motion
  `Reorder.Group`/`Reorder.Item` — already a dependency, no new package).
- **Add sources:**
  - **"Add from library"** — a picker listing our video items that have a
    rendered output (clips, avatar videos, prior uploads/merges), with
    thumbnails. Multi-select appends to the sequence.
  - **"Upload video"** — reuses the direct-to-storage signed upload just built
    for the queue (`createQueueVideoUploadUrl` pattern), into a `merge-sources/`
    path; the uploaded file becomes a selectable source.
- **Combine** button → fires the merge job; the composer clears and nudges the
  user to **Generated videos**, where the new item shows the existing
  "rendering" state (progress bar + status-poll refresh) until it lands.

**Generated videos holding (existing `GeneratedVideos.tsx`):** merged items render
exactly like avatar/clip videos. Add one control to the ready card: **"Add
subtitles"** (see §7). Everything else (download, caption box + Suggest caption,
Send to Approval Queue, Regenerate, Delete) already works.

## 6. Architecture

**Data model (no migration needed):**
- Merged output is a `content_item`, `type: "heygen_video"`,
  `generationInputs.kind: "merged_video"`, `studio: true` (so it holds in
  Generated videos and stays `draft`), plus `sources: [{ path, bucket }... in
  order]` recording the ordered inputs.
- Reuses the studio holding lifecycle: `studioReady` on success, `studioError` on
  failure — same as generated clips/avatars.

**Flow:**
1. `CombineStudio` submits ordered sources (library paths + uploaded paths) +
   account/platforms → server action `requestCombineVideo`.
2. Action validates (role, ≥2 sources, path prefixes, caps), creates the
   `merged_video` item (draft, studio, sources in generationInputs), fires an
   Inngest event `merge/requested { contentItemId }`.
3. Inngest `mergeRequested` handler → `ContentProductionService.mergeVideo(id)`:
   - re-reads the item, signs each source URL (fresh),
   - calls a new provider method `clip.mergeClips({ sourceUrls })` →
     normalized-concat bytes (generalized `appendOutro`),
   - stores the result as the item's **base render** in generated-media
     (`${id}/${ts}.mp4`, no captioned-/outro- prefix so the version tools treat
     it as original),
   - `completeHook`-style: set `studioReady`, stay draft. **No `recordMediaUsage`
     — zero credits.**
   - on failure → `failHook(id, message)` (studioError), same as other studio
     videos; the 5-min reconciliation cron already covers a stuck merge.
4. Holding + queue behave exactly as for any video item.

**Provider change** ([VideoClipProvider](../src/providers/interfaces/VideoClipProvider.ts)):
add `mergeClips(input: { sourceUrls: string[] }): Promise<{ bytes; mimeType; durationS? }>`.
Implementation in `FfmpegClipProvider` = refactor `appendOutro`'s two-step
(normalize each → concat list) to loop over N inputs. The existing
`normalizeWithSilentAudio` + `hasAudioStream` helpers are reused unchanged.

## 7. Reuse map (what we already have)

| Need | Reuse |
|---|---|
| Normalize + concat videos | `FfmpegClipProvider.appendOutro` / `normalizeWithSilentAudio` |
| Background job + progress | Inngest function + studio holding "rendering" + status-poll |
| Direct upload of new sources | `createQueueVideoUploadUrl` / `uploadToSignedUrl` (just built) |
| Holding actions (download, caption, queue) | `GeneratedVideos` card + `moveStudioVideoToQueue` |
| Caption from prompt | `suggestStudioCaption` (already wired: "✨ Suggest caption") |
| Add subtitles | `video/captions-requested` Inngest path (`addCaptionsToVideo`) |
| Stuck-render safety net | `failStuckVideos` cron (already covers heygen_video drafts) |
| Storage-full safeguards | `objectExists` + `reportStorageIssue` provider alert |

**Subtitles in holding:** simplest is to expose an **"Add subtitles"** button on
the ready holding card that fires the existing `video/captions-requested` event
(transcribe → burn styled captions), the same one the queue uses. It works on any
video item with speech. (Alternative: only offer subtitles after the item is in
the queue, where it already exists — but the thread explicitly wants it in this
flow, so add it to holding.)

## 8. No-credits guarantee

- Merge is pure ffmpeg (`ffmpeg-static`) in our own function — **no AI call,
  nothing recorded to `ai_usage_log`.**
- "Suggest caption from prompt" **does** use a text model (existing behavior,
  on-demand only). Typing a caption is free. Subtitles use transcription
  (Gemini) — that IS a paid call; keep it **on-demand** (button), never
  automatic, and label it. Merge itself stays free.

## 9. Constraints & risks (important)

- **Serverless time / single-instance temp files.** The whole merge (normalize
  every clip + concat) must run in **one function invocation** — Inngest steps
  can land on different instances and the tmp files don't persist across them, so
  we can't normalize in one step and concat in another (unless we persist each
  normalized clip to storage first). v1: do it in one step, and **cap the work**.
  - **Recommended caps:** ≤ **6 clips** and ≤ **~3 min** total input duration.
  - Verify/raise the merge function's `maxDuration` (each ffmpeg pass has a 240s
    timeout; 6 normalizes + concat run sequentially). If we need more, escalate
    to the "persist normalized clips to storage" design (below).
- **Re-encode cost.** Every input is re-encoded to normalize (unavoidable for
  mixed sources). At `-preset veryfast` this is fine for short vertical clips but
  scales with count × duration — hence the caps.
- **Mismatched inputs / audio.** Handled by the existing normalize step (forces a
  common layout, adds silent audio when missing). Landscape uploads get
  letterboxed to 9:16 (pad) — confirm that's desired (open question).
- **Storage growth.** Uploaded sources + merged outputs accumulate in
  generated-media. Reuse the storage-full safeguards; consider cleaning up
  `merge-sources/` uploads after a successful merge.
- **Large uploads.** Reuse the 1 GB signed-upload cap + storage-full handling.

**Scale-up path (if caps prove too small):** normalize **each** clip in its own
Inngest step and **upload the normalized clip to storage** (persist), then a final
step downloads the normalized set and concats (stream copy — cheap). This spreads
the re-encode across steps/instances and removes the single-invocation time limit,
at the cost of extra storage I/O. Not needed for v1.

## 10. Implementation phases (vertical slices)

1. **Provider merge primitive** — `mergeClips` in `FfmpegClipProvider` +
   interface; unit-testable arg-building; refactor `appendOutro` to share the
   loop. (No UI yet.)
2. **Service + Inngest** — `ContentProductionService.mergeVideo`,
   `createMergedVideo` (item creation), `merge/requested` event + handler,
   register in `allFunctions`. Gate-safe, no usage logged.
3. **Combine composer UI** — `CombineStudio` (account/platforms, source list,
   reorder, add-from-library picker, upload), `requestCombineVideo` action, wired
   as the third sub-tab. Output shows in Generated videos.
4. **Holding "Add subtitles"** — button on the ready card firing
   `video/captions-requested`; small addition to `GeneratedVideos`.
5. **Polish** — caps + friendly errors, `merge-sources/` cleanup, thumbnails in
   the library picker, tests, docs, PROGRESS.md.

## 11. Files (new / touched)

- New: `src/components/avatar/CombineStudio.tsx`, `docs/COMBINE_VIDEOS_PLAN.md`
  (this file).
- Touched: `FfmpegClipProvider.ts` + `interfaces/VideoClipProvider.ts` (mergeClips);
  `ContentProductionService.ts` (mergeVideo/createMergedVideo); `inngest/client.ts`
  + `inngest/functions.ts` (merge event/handler); `avatar/actions.ts`
  (requestCombineVideo, add-from-library source list, subtitles action);
  `VideoStudioTabs.tsx` (Combine sub-tab); `GeneratedVideos.tsx` (Add subtitles);
  `avatar/page.tsx` (load selectable library sources). No DB migration.

## 12. Open questions (decide before building)

1. ~~**Tab placement:** sub-tab of Generate Videos vs a new top-level nav item?~~
   **DECIDED (2026-08-12): sub-tab of Generate Videos** (`Compose | Combine |
   Generated videos`).
2. ~~Landscape/mismatched sources~~ **DECIDED: letterbox/pad to 9:16** (matches
   our content; the normalize step already does this).
3. ~~Caps~~ **DECIDED: ≤ 6 clips / ~3 min total input for v1** (keeps the merge
   inside one function run).
4. ~~Subtitles placement~~ **DECIDED: add "Add subtitles" to the holding card**
   (fires the existing `video/captions-requested`).
5. ~~Source cleanup~~ **DECIDED: delete `merge-sources/` uploads after a
   successful merge** (best-effort; keep them on failure so a retry can reuse).
6. ~~Reorder UX~~ **DECIDED: drag-and-drop** via framer-motion `Reorder.Group` /
   `Reorder.Item` — framer-motion is already a dependency (QueueBoard uses it),
   so no new package.

**All decisions resolved (2026-08-12) — ready to build on approval.**

## 13. Testing

- Unit: `mergeClips` arg construction (order preserved, N inputs, silent-audio
  branch) — pure, no ffmpeg, like the existing caption tests.
- Service: `mergeVideo` marks studioReady on success, studioError on failure,
  logs **no** usage (assert `recordMediaUsage` never called) — extend the
  studio/completeHook test pattern.
- Manual/live: merge 2 avatar videos; merge clip+avatar+upload; a landscape
  upload (padding); verify holding actions (download, caption, subtitles, queue),
  then approve/publish; confirm no `ai_usage_log` rows from the merge.
