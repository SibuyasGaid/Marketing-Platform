import { NonRetriableError, cron } from "inngest";
import { generationLimits, heygenConfig } from "@/lib/config";
import { AppError, ProviderError } from "@/lib/errors";
import {
  getClipRenderService,
  getCompetitorDigestService,
  getContentApprovalService,
  getContentCalendarService,
  getContentProductionService,
  getContentRegenerationService,
  getImageGenerationService,
  getSegmentAnalysisService,
  getTranscriptionService,
  getWeeklyBatchService,
} from "@/lib/container";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { JobRepository } from "@/repositories/JobRepository";
import { SourceVideoRepository } from "@/repositories/SourceVideoRepository";
import {
  avatarVideoRequestedEvent,
  clipVideoRequestedEvent,
  mergeRequestedEvent,
  calendarGenerateRequestedEvent,
  clipRenderRequestedEvent,
  contentApprovedEvent,
  contentRepostRequestedEvent,
  contentEditsRequestedEvent,
  imageGenerationRequestedEvent,
  inngest,
  segmentsSelectedEvent,
  videoCaptionsRequestedEvent,
  videoOutroRequestedEvent,
  vodIngestedEvent,
  weekBatchRequestedEvent,
} from "@/inngest/client";

/**
 * Every paid-API step is wrapped in step.run with a stable ID and the
 * services are idempotent by persisted state, so retries never duplicate
 * vendor calls (docs/API_OPTIMIZATION.md §2). Non-retryable AppErrors become
 * NonRetriableError so 4xx-class failures never burn paid retries (§8).
 */
function asInngestError(error: unknown): unknown {
  const isRetryable = error instanceof ProviderError && error.retryable;
  if (error instanceof AppError && !isRetryable) {
    return new NonRetriableError(error.message, { cause: error });
  }
  return error;
}

export const imageGenerationRequested = inngest.createFunction(
  {
    id: "image-generation-requested",
    triggers: [imageGenerationRequestedEvent],
    concurrency: { limit: generationLimits.concurrency.imageGen },
    retries: 3,
  },
  async ({ event, step }) => {
    await step.run("generate-image", async () => {
      try {
        await getImageGenerationService().executeGeneration(event.data.contentItemId);
      } catch (error) {
        throw asInngestError(error);
      }
      return { contentItemId: event.data.contentItemId };
    });
  },
);

/** clip/render-requested: cut a clip's segment into a small standalone file. */
export const clipRenderRequested = inngest.createFunction(
  {
    id: "clip-render-requested",
    triggers: [clipRenderRequestedEvent],
    concurrency: { limit: generationLimits.concurrency.imageGen },
    retries: 2,
  },
  async ({ event, step }) => {
    await step.run("render-clip", async () => {
      try {
        await getClipRenderService().render(event.data.contentItemId);
      } catch (error) {
        throw asInngestError(error);
      }
    });
  },
);

/** vod/ingested: transcribe once → analyze + rank → await user selection. */
export const vodIngested = inngest.createFunction(
  {
    id: "vod-ingested",
    triggers: [vodIngestedEvent],
    concurrency: { limit: generationLimits.concurrency.llm },
    retries: 3,
  },
  async ({ event, step }) => {
    await step.run("transcribe", async () => {
      try {
        await getTranscriptionService().executeTranscription(event.data.sourceVideoId);
      } catch (error) {
        throw asInngestError(error);
      }
    });

    await step.run("analyze-segments", async () => {
      try {
        const admin = createSupabaseAdminClient();
        const video = await new SourceVideoRepository(admin).getById(event.data.sourceVideoId);
        await getSegmentAnalysisService().analyze(event.data.sourceVideoId, video.title);
      } catch (error) {
        throw asInngestError(error);
      }
    });
  },
);

/** segments/selected: clips + copy per platform + optional HeyGen hooks. */
export const segmentsSelected = inngest.createFunction(
  {
    id: "segments-selected",
    triggers: [segmentsSelectedEvent],
    concurrency: { limit: generationLimits.concurrency.llm },
    retries: 3,
  },
  async ({ event, step }) => {
    const { hookItemIds, clipItemIds } = await step.run("produce-content", async () => {
      try {
        return await getContentProductionService().produce(event.data);
      } catch (error) {
        throw asInngestError(error);
      }
    });

    // Cut each clip into a standalone file (own function, own retries). Memoized
    // in a step so an Inngest retry never re-sends the render events.
    if (clipItemIds.length > 0) {
      await step.run("enqueue-clip-renders", async () => {
        for (const contentItemId of clipItemIds) {
          await inngest.send({ name: "clip/render-requested", data: { contentItemId } });
        }
      });
    }

    // HeyGen hooks: most expensive call in the system — start once, poll.
    for (const itemId of hookItemIds) {
      const { providerJobId } = await step.run(`hook-start-${itemId}`, async () => {
        try {
          return await getContentProductionService().startHook(itemId);
        } catch (error) {
          throw asInngestError(error);
        }
      });

      let finished = false;
      for (let attempt = 0; attempt < heygenConfig.maxPollAttempts && !finished; attempt += 1) {
        await step.sleep(`hook-wait-${itemId}-${attempt}`, `${heygenConfig.pollIntervalSeconds}s`);
        const status = await step.run(`hook-poll-${itemId}-${attempt}`, async () => {
          try {
            return await getContentProductionService().checkHook(providerJobId);
          } catch (error) {
            throw asInngestError(error);
          }
        });

        if (status.status === "completed" && status.videoUrl) {
          await step.run(`hook-complete-${itemId}`, async () => {
            try {
              await getContentProductionService().completeHook(itemId, {
                videoUrl: status.videoUrl!,
                durationSeconds: status.durationSeconds,
              });
            } catch (error) {
              throw asInngestError(error);
            }
          });
          finished = true;
        } else if (status.status === "failed") {
          throw new NonRetriableError(
            `HeyGen generation failed for item ${itemId}: ${status.errorMessage ?? "unknown"}`,
          );
        }
      }
      if (!finished) {
        throw new NonRetriableError(`HeyGen generation timed out for item ${itemId}`);
      }
    }
  },
);

/** avatar/video-requested: render a HeyGen avatar video from a typed script. */
export const avatarVideoRequested = inngest.createFunction(
  {
    id: "avatar-video-requested",
    triggers: [avatarVideoRequestedEvent],
    concurrency: { limit: generationLimits.concurrency.heygen },
    retries: 2,
  },
  async ({ event, step }) => {
    const itemId = event.data.contentItemId;
    // Mark the item failed on any terminal outcome so it stops showing as
    // "generating" forever (HeyGen credits exhausted, error, or timeout). The
    // credits case also raises the app-wide credits alert inside startHook.
    const markFailed = (message: string) =>
      step.run("avatar-mark-failed", async () => {
        await getContentProductionService().failHook(itemId, message);
      });

    let providerJobId: string;
    try {
      ({ providerJobId } = await step.run("avatar-start", async () => {
        try {
          return await getContentProductionService().startHook(itemId);
        } catch (error) {
          throw asInngestError(error);
        }
      }));
    } catch (error) {
      // Only mark failed on a TERMINAL error (non-retriable, e.g. credits
      // exhausted). A retriable error is left for Inngest to retry so the item
      // doesn't flap draft->failed between attempts.
      if (error instanceof NonRetriableError) {
        await markFailed("Could not start the video (often HeyGen credits — top up the wallet).");
      }
      throw error;
    }

    let finished = false;
    for (let attempt = 0; attempt < heygenConfig.maxPollAttempts && !finished; attempt += 1) {
      await step.sleep(`avatar-wait-${attempt}`, `${heygenConfig.pollIntervalSeconds}s`);
      const status = await step.run(`avatar-poll-${attempt}`, async () => {
        try {
          return await getContentProductionService().checkHook(providerJobId);
        } catch (error) {
          throw asInngestError(error);
        }
      });
      if (status.status === "completed" && status.videoUrl) {
        await step.run("avatar-complete", async () => {
          try {
            await getContentProductionService().completeHook(itemId, {
              videoUrl: status.videoUrl!,
              durationSeconds: status.durationSeconds,
            });
          } catch (error) {
            throw asInngestError(error);
          }
        });
        finished = true;
      } else if (status.status === "failed") {
        await markFailed(status.errorMessage ?? "The video failed to generate.");
        throw new NonRetriableError(
          `HeyGen generation failed for item ${itemId}: ${status.errorMessage ?? "unknown"}`,
        );
      }
    }
    if (!finished) {
      await markFailed("The video took too long and timed out. Try regenerating.");
      throw new NonRetriableError(`HeyGen generation timed out for item ${itemId}`);
    }
  },
);

/** clip/video-requested: render a HeyGen Video Agent visual clip (no avatar). */
export const clipVideoRequested = inngest.createFunction(
  {
    id: "clip-video-requested",
    triggers: [clipVideoRequestedEvent],
    concurrency: { limit: generationLimits.concurrency.heygen },
    retries: 2,
  },
  async ({ event, step }) => {
    const itemId = event.data.contentItemId;
    const markFailed = (message: string) =>
      step.run("clip-mark-failed", async () => {
        await getContentProductionService().failHook(itemId, message);
      });

    let sessionId: string;
    try {
      ({ providerJobId: sessionId } = await step.run("clip-start", async () => {
        try {
          return await getContentProductionService().startClip(itemId);
        } catch (error) {
          throw asInngestError(error);
        }
      }));
    } catch (error) {
      if (error instanceof NonRetriableError) await markFailed("Could not start the clip.");
      throw error;
    }

    let finished = false;
    for (let attempt = 0; attempt < heygenConfig.maxPollAttempts && !finished; attempt += 1) {
      await step.sleep(`clip-wait-${attempt}`, `${heygenConfig.pollIntervalSeconds}s`);
      const status = await step.run(`clip-poll-${attempt}`, async () => {
        try {
          return await getContentProductionService().checkClip(sessionId);
        } catch (error) {
          throw asInngestError(error);
        }
      });
      if (status.status === "completed" && status.videoUrl) {
        await step.run("clip-complete", async () => {
          try {
            await getContentProductionService().completeHook(itemId, {
              videoUrl: status.videoUrl!,
              durationSeconds: status.durationSeconds,
            });
          } catch (error) {
            throw asInngestError(error);
          }
        });
        finished = true;
      } else if (status.status === "failed") {
        await markFailed(status.errorMessage ?? "The clip failed to generate.");
        throw new NonRetriableError(`Clip generation failed for item ${itemId}`);
      }
    }
    if (!finished) {
      await markFailed("The clip took too long and timed out. Try regenerating.");
      throw new NonRetriableError(`Clip generation timed out for item ${itemId}`);
    }
  },
);

/** merge/requested: stitch a studio merged_video's sources via ffmpeg (no AI). */
export const mergeRequested = inngest.createFunction(
  {
    id: "merge-requested",
    triggers: [mergeRequestedEvent],
    concurrency: { limit: generationLimits.concurrency.imageGen },
    retries: 1,
  },
  async ({ event, step }) => {
    const itemId = event.data.contentItemId;
    await step.run("merge", async () => {
      try {
        await getContentProductionService().mergeVideo(itemId);
      } catch (error) {
        // Surface the failure on the item now (studioError) so the holding card
        // shows it instead of spinning; a retry re-runs and clears it on success.
        await getContentProductionService()
          .failHook(itemId, "Couldn't combine the videos — check the clips and try again.")
          .catch(() => {});
        throw asInngestError(error);
      }
    });
  },
);

/** video/captions-requested: transcribe an existing video and burn styled captions. */
export const videoCaptionsRequested = inngest.createFunction(
  {
    id: "video-captions-requested",
    triggers: [videoCaptionsRequestedEvent],
    concurrency: { limit: generationLimits.concurrency.imageGen },
    retries: 2,
  },
  async ({ event, step }) => {
    await step.run("add-captions", async () => {
      try {
        await getContentProductionService().addCaptionsToVideo(event.data.contentItemId);
      } catch (error) {
        throw asInngestError(error);
      }
    });
  },
);

/** video/outro-requested: append the account's outro clip to a rendered video. */
export const videoOutroRequested = inngest.createFunction(
  {
    id: "video-outro-requested",
    triggers: [videoOutroRequestedEvent],
    concurrency: { limit: generationLimits.concurrency.imageGen },
    retries: 2,
  },
  async ({ event, step }) => {
    await step.run("append-outro", async () => {
      try {
        await getContentProductionService().addOutroToVideo(event.data.contentItemId);
      } catch (error) {
        throw asInngestError(error);
      }
    });
  },
);

/**
 * content/approved: the publish path. The service re-reads the row and
 * re-checks the approval_events audit row before dispatching — this handler
 * never trusts its own event payload (docs/SECURITY.md §4).
 */
export const contentApproved = inngest.createFunction(
  { id: "content-approved", triggers: [contentApprovedEvent], retries: 3 },
  async ({ event, step }) => {
    return step.run("verify-and-dispatch", async () => {
      try {
        return await getContentApprovalService().dispatchApproved(event.data.contentItemId);
      } catch (error) {
        throw asInngestError(error);
      }
    });
  },
);

/**
 * content/repost-requested: publish an already-posted item to additional
 * platforms. The service re-checks the approval_events row and skips platforms
 * already posted, so the gate holds and nothing is double-posted.
 */
export const contentRepostRequested = inngest.createFunction(
  { id: "content-repost-requested", triggers: [contentRepostRequestedEvent], retries: 2 },
  async ({ event, step }) => {
    return step.run("repost", async () => {
      try {
        return await getContentApprovalService().repostToPlatforms(
          event.data.contentItemId,
          event.data.platforms,
        );
      } catch (error) {
        throw asInngestError(error);
      }
    });
  },
);

/**
 * Every 5 minutes: publish any scheduled items whose time has arrived. Each is
 * dispatched through the same gate-checked path as an immediate approval.
 */
export const dispatchDueScheduled = inngest.createFunction(
  { id: "dispatch-due-scheduled", triggers: [cron("*/5 * * * *")], retries: 2 },
  async ({ step }) => {
    return step.run("dispatch-due", async () => {
      try {
        return await getContentApprovalService().dispatchDueScheduled();
      } catch (error) {
        throw asInngestError(error);
      }
    });
  },
);

/** content/edits-requested: reviewer comment → regenerate → back to the queue. */
export const contentEditsRequested = inngest.createFunction(
  {
    id: "content-edits-requested",
    triggers: [contentEditsRequestedEvent],
    concurrency: { limit: generationLimits.concurrency.imageGen },
    retries: 2,
  },
  async ({ event, step }) => {
    const itemId = event.data.contentItemId;

    const { canRegenerate } = await step.run("prepare-regeneration", async () => {
      try {
        return await getContentRegenerationService().prepare(itemId);
      } catch (error) {
        throw asInngestError(error);
      }
    });

    if (canRegenerate) {
      try {
        await step.run("regenerate", async () => {
          await getImageGenerationService().executeGeneration(itemId);
        });
      } catch (error) {
        // Surface the failure in the queue instead of leaving it mid-flight.
        await step.run("mark-regeneration-failed", async () => {
          await getContentRegenerationService().fail(itemId);
        });
        throw asInngestError(error);
      }
    }

    await step.run("return-to-queue", async () => {
      await getContentRegenerationService().finish(itemId);
    });
  },
);

/** week/batch-requested: a full week of static posts queued for approval. */
export const weekBatchRequested = inngest.createFunction(
  {
    id: "week-batch-requested",
    triggers: [weekBatchRequestedEvent],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ event, step }) => {
    await step.run("generate-week", async () => {
      try {
        return await getWeeklyBatchService().executeBatch(event.data);
      } catch (error) {
        throw asInngestError(error);
      }
    });
  },
);

/** Daily 06:00 UTC: read content_calendar for today → generate → queue for approval. */
export const dailyCalendarGeneration = inngest.createFunction(
  {
    id: "daily-calendar-generation",
    triggers: [cron("0 6 * * *")],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    return step.run("generate-todays-calendar", async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        return await getContentCalendarService().generateForDate(today);
      } catch (error) {
        throw asInngestError(error);
      }
    });
  },
);

/** Manual trigger: generate a specific calendar day now (same path as the cron). */
export const calendarGenerateRequested = inngest.createFunction(
  {
    id: "calendar-generate-requested",
    triggers: [calendarGenerateRequestedEvent],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ event, step }) => {
    return step.run("generate-calendar-day", async () => {
      try {
        return await getContentCalendarService().generateForDate(event.data.calendarDate);
      } catch (error) {
        throw asInngestError(error);
      }
    });
  },
);

/** Weekly Monday 07:00 UTC: compile competitor digest → send via EmailProvider. */
export const weeklyCompetitorDigest = inngest.createFunction(
  { id: "weekly-competitor-digest", triggers: [cron("0 7 * * 1")], retries: 2 },
  async ({ step }) => {
    await step.run("compile-and-send", async () => {
      try {
        return await getCompetitorDigestService().run();
      } catch (error) {
        throw asInngestError(error);
      }
    });
  },
);

/**
 * Every 5 min, reconcile generations that never reached a terminal state (Inngest
 * run died mid-poll or exhausted retries) so nothing shows as "generating"
 * forever: HeyGen renders via failStuckVideos, and stuck image/clip jobs via
 * JobRepository.failStuckActive (which also clears the nav "working" cue).
 */
export const failStuckVideos = inngest.createFunction(
  { id: "fail-stuck-videos", triggers: [cron("*/5 * * * *")], retries: 1 },
  async ({ step }) => {
    const videos = await step.run("fail-stuck-videos", async () => {
      try {
        return await getContentProductionService().failStuckVideos(30);
      } catch (error) {
        throw asInngestError(error);
      }
    });
    const jobs = await step.run("fail-stuck-jobs", async () => {
      try {
        return await new JobRepository(createSupabaseAdminClient()).failStuckActive(30);
      } catch (error) {
        throw asInngestError(error);
      }
    });
    return { videos, jobs };
  },
);

export const allFunctions = [
  imageGenerationRequested,
  clipRenderRequested,
  vodIngested,
  segmentsSelected,
  avatarVideoRequested,
  clipVideoRequested,
  mergeRequested,
  videoCaptionsRequested,
  videoOutroRequested,
  contentApproved,
  contentRepostRequested,
  dispatchDueScheduled,
  contentEditsRequested,
  weekBatchRequested,
  dailyCalendarGeneration,
  calendarGenerateRequested,
  weeklyCompetitorDigest,
  failStuckVideos,
];
