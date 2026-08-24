import { Inngest, eventType } from "inngest";
import { z } from "zod";

/**
 * Typed event contracts for all workflows (PROJECT_PROMPT.md §6), using the
 * Inngest v4 eventType API. Handlers re-validate against the DB before acting —
 * event payloads alone are never trusted for the approval gate
 * (docs/SECURITY.md §4).
 */

export const imageGenerationRequestedEvent = eventType("image/generation-requested", {
  schema: z.object({ contentItemId: z.uuid() }),
});

export const vodIngestedEvent = eventType("vod/ingested", {
  schema: z.object({ sourceVideoId: z.uuid() }),
});

export const clipRenderRequestedEvent = eventType("clip/render-requested", {
  schema: z.object({ contentItemId: z.uuid() }),
});

export const segmentsSelectedEvent = eventType("segments/selected", {
  schema: z.object({
    sourceVideoId: z.uuid(),
    segmentIds: z.array(z.string().min(1)).min(1),
    brand: z.string().min(1),
    platforms: z.array(z.enum(["instagram", "facebook", "linkedin", "youtube"])).min(1),
    generateHeygenHook: z.boolean(),
    vertical: z.boolean(),
    generateThumbnail: z.boolean(),
    requestedBy: z.uuid(),
  }),
});

/** Standalone avatar video: generate a HeyGen video from a typed script. */
export const avatarVideoRequestedEvent = eventType("avatar/video-requested", {
  schema: z.object({ contentItemId: z.uuid() }),
});

/** Combine tab: stitch several videos into one via ffmpeg (no AI credits). */
export const mergeRequestedEvent = eventType("merge/requested", {
  schema: z.object({ contentItemId: z.uuid() }),
});

/** Prompt-driven visual clip: generate a HeyGen Video Agent clip (no avatar). */
export const clipVideoRequestedEvent = eventType("clip/video-requested", {
  schema: z.object({ contentItemId: z.uuid() }),
});

/** Add burned-in styled captions to an already-rendered video (transcribe + burn). */
export const videoCaptionsRequestedEvent = eventType("video/captions-requested", {
  schema: z.object({ contentItemId: z.uuid() }),
});

/** Append the account's outro clip to the end of a rendered video (ffmpeg concat). */
export const videoOutroRequestedEvent = eventType("video/outro-requested", {
  schema: z.object({ contentItemId: z.uuid() }),
});

export const contentApprovedEvent = eventType("content/approved", {
  schema: z.object({ contentItemId: z.uuid() }),
});

/** Repost an already-posted item to additional platforms it wasn't sent to. */
export const contentRepostRequestedEvent = eventType("content/repost-requested", {
  schema: z.object({
    contentItemId: z.uuid(),
    platforms: z.array(z.enum(["instagram", "facebook", "linkedin", "youtube"])).min(1),
  }),
});

export const contentEditsRequestedEvent = eventType("content/edits-requested", {
  schema: z.object({ contentItemId: z.uuid() }),
});

export const weekBatchRequestedEvent = eventType("week/batch-requested", {
  schema: z.object({
    weekStartDate: z.iso.date(),
    requestedBy: z.uuid(),
    brand: z.string().min(1),
    theme: z.string().min(1),
  }),
});

/** Manual on-demand run of a calendar day (the daily cron path, triggered now). */
export const calendarGenerateRequestedEvent = eventType("calendar/generate-requested", {
  schema: z.object({ calendarDate: z.iso.date(), requestedBy: z.uuid() }),
});

export const inngest = new Inngest({
  id: "ai-institute-marketing-platform",
});
