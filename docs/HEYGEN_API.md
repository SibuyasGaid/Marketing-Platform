# HeyGen API reference (v3) — for this project

Notes pasted from HeyGen's developer docs (developers.heygen.com). Our app calls
the HeyGen API on a **pay-as-you-go** wallet (no dashboard subscription). The
Free/Creator/Pro tiers in the HeyGen web app are the STUDIO plans, NOT the API —
ignore them for our integration.

Docs index: https://heygen-1fa696a7.mintlify.site/llms.txt

## Current usage in our code (v3 Photo Avatar — migrated 2026-08-04)

`HeyGenVideoProvider` uses the **v3 Photo Avatar** path:
- `POST /v3/assets` (multipart) to upload the person's photo → `asset_id`
- `POST /v3/avatars` `{type:"photo", file:{type:"asset_id",...}}` → reusable `avatar_id`
  (stored in `avatar_references.provider_asset_id`, reused for every future video)
- `POST /v3/videos` `{type:"avatar", avatar_id, script, voice_id, engine:{type:"avatar_iv"},
  resolution:"1080p", aspect_ratio:"9:16", expressiveness, motion_prompt, background}`
- `GET /v3/videos/{video_id}` to poll (reads `video_url` on completed)

`expressiveness` (default "high") + `motion_prompt` (default "speaking to camera with
natural hand gestures") animate the body/gestures — the fix for the old v2
talking_photo path, which only moved the mouth. Both are overridable per item from
the Avatar Videos composer. Defaults live in `heygenConfig` (lib/config.ts).

Migration `20260804000001_reset_heygen_v3_avatar_ids.sql` nulled every
`provider_asset_id` so old v2 `talking_photo_id`s (invalid under v3) are re-registered
as v3 Photo Avatars on next use.

## The v3 model (what we should move to)

Endpoint: `POST /v3/videos` (async → returns `video_id`; poll `GET /v3/videos/{video_id}`).
Engines selected per request via `engine.type`:

| Engine       | engine.type   | Default | Notes |
|--------------|---------------|---------|-------|
| Avatar IV    | `avatar_iv`   | yes (omit engine) | Broadest support: photo_avatar, digital_twin, studio_avatar, arbitrary image. Supports `motion_prompt` + `expressiveness`. |
| Avatar V     | `avatar_v`    | no      | Highest-fidelity motion; digital_twin only; `motion_prompt` yes, `expressiveness` NO. |
| Avatar III   | `avatar_iii`  | no      | Dedicated photo-to-video; 4K (except photo avatar). |

Check a look's `supported_api_engines` via `GET /v3/avatars/looks/{look_id}` before
requesting a non-default engine (else 400).

### Request shapes

**Avatar (registered look — photo avatar or digital twin):**
```json
{ "type": "avatar", "avatar_id": "LOOK_ID", "script": "...", "voice_id": "...",
  "resolution": "1080p", "aspect_ratio": "9:16",
  "engine": { "type": "avatar_iv" },
  "motion_prompt": "gesturing while presenting", "expressiveness": "high",
  "background": { "type": "color", "value": "#RRGGBB" } }
```

**Image-to-Video (NO avatar setup — animate any image inline):** ← easiest upgrade
```json
{ "type": "image", "image": { "type": "url", "url": "https://..." },
  "script": "...", "voice_id": "...", "resolution": "1080p", "aspect_ratio": "9:16",
  "background": { "type": "color", "value": "#RRGGBB" } }
```
`image.type` can be `url`, `asset_id` (upload via `POST /v3/assets`), or `base64`.
Note: per docs, image-to-video does NOT support motion_prompt/expressiveness; a
**Photo Avatar** (registered once via `POST /v3/avatars`) DOES.

**Audio-to-Video:** same endpoint, pass `audio_url`/`audio_asset_id` instead of
`script`+`voice_id` (mutually exclusive). Works with `type: avatar` or `type: image`.

### Photo Avatar (register once, reuse, unlock motion/expressiveness)
- `POST /v3/avatars` `{ "type": "photo", "name": "...", "file": { "type": "url"|"asset_id", ... } }`
  → response `data.avatar_item.id` = the `avatar_id`.
- Then `POST /v3/videos` `type: "avatar"`, that `avatar_id`, plus `motion_prompt`
  and `expressiveness` (`high`/`medium`/`low`, default low).

### Digital Twin (most dynamic; trained from real footage)
- Find via `GET /v3/avatars/looks?avatar_type=digital_twin&ownership=private` → `id`.
- `POST /v3/videos` `type: "avatar"`, `avatar_id`, `engine` avatar_iv (default) or
  avatar_v (higher fidelity; check supported_api_engines).

### Subtitles / captions
`caption` is an object on /v3/videos. `{file_format:"srt"}` returns a sidecar SRT
via `subtitle_url` (video stays clean). Add `style:"default"` to ALSO burn captions
in → `captioned_video_url`. The API only exposes `style:"default"` (plain look) —
the bold word-highlight "karaoke" style is Studio-only, NOT available via API.

**Our implementation (decoupled 2026-08-04):** we do NOT request HeyGen captions
at all — `POST /v3/videos` always returns the clean `video_url`, which we store.
Captions are a SEPARATE on-demand step so the video lands fast and the completion
step never risks a re-encode timeout: in the Approval Queue, "Generate captions"
transcribes the stored video (Gemini) → `segmentsToSrt` → styled ASS
(`srtToStyledAss`) → `FfmpegClipProvider.burnCaptions` (libass). Both versions are
kept; "Use original"/"Use captioned" swaps which is active. The composer's "Plan
to add subtitles" toggle is just a hint that surfaces the button in the queue.

### Key optional params on /v3/videos
`resolution` (4k/1080p/720p), `aspect_ratio` (auto/16:9/9:16/4:5/5:4/1:1),
`background` ({type:color,value} or {type:image,url|asset_id}), `remove_background`,
`voice_settings` (speed 0.5-1.5, pitch -50..50, locale), `motion_prompt`,
`expressiveness` (IV only), `caption` (object; sidecar srt via subtitle_url, add
style to burn in), `callback_url`/`callback_id` (webhook instead of polling),
`output_format` (mp4 default / webm transparent).

### Status / result (GET /v3/videos/{video_id})
status: pending | processing | completed | failed (with failure_code/failure_message).
On completed: `video_url` (clean), `captioned_video_url`, `subtitle_url`,
`thumbnail_url`, `gif_url`, `duration`. URLs are presigned + expire — download promptly.

## Cost logging in our app
Video usage is billed **per second**: `pricing.videoPerSecondUsd.heygen = 0.05`
(Avatar IV Photo Avatar) × the video's `duration` (from GET /v3/videos). So a 4s
clip ≈ $0.20 and a 60s clip ≈ $3.00 — not a flat rate. `videoPerGenerationUsd` is
kept only as a fallback estimate for when the final duration isn't returned.
Historical log rows keep their original estimate (append-only); only new videos
use per-second. Edit rates in `lib/config.ts` `pricing`.

## Pricing (API, per second unless noted)
- Avatar IV: Photo Avatar $0.05/s, Digital Twin $0.0667/s, Studio $0.0667/s
- Avatar III: Digital Twin $0.0167/s, Studio $0.0167/s, Photo Avatar $0.0433/s
- Avatar V: Digital Twin $0.0667/s
- Cinematic Avatar $7.00/video; Video Agent $0.0333/s
No API subscription needed — prepaid USD wallet.

## Recommended upgrade path for us
1. **Quick win:** move from v2 talking_photo → **v3 Image-to-Video** (`type:image`)
   or a registered **Photo Avatar** with `expressiveness:"high"` + a `motion_prompt`.
   Photo Avatar adds real motion/gesture control (the fix for "only face moves").
2. **Best quality:** **Digital Twin** trained per person, engine avatar_iv/avatar_v.
3. Voice: our ElevenLabs voice imported into HeyGen → its HeyGen `voice_id`
   (currently set in heygenConfig.voiceId).
