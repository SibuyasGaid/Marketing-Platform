import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { heygenConfig } from "@/lib/config";
import type { Brand, Platform } from "@/lib/domain";
import { ProviderCreditsError, ProviderError, ValidationError } from "@/lib/errors";
import { AVATAR_SCRIPT_SYSTEM, COPY_SET_SYSTEM } from "@/lib/prompts/contentPrompts";
import { assertTransition } from "@/lib/statusMachine";
import { completeStructured } from "@/lib/structured";
import { stripEmDashes, stripEmDashesDeep } from "@/lib/text";
import {
  BUCKETS,
  downloadFromBucket,
  removeFromBucket,
  signedUrl,
  uploadToBucket,
} from "@/lib/supabase/storage";
import type { AccountRepository } from "@/repositories/AccountRepository";
import type { AvatarReferenceRepository } from "@/repositories/AvatarReferenceRepository";
import type { ContentItemRepository, OutputAsset } from "@/repositories/ContentItemRepository";
import type { SourceVideoRepository } from "@/repositories/SourceVideoRepository";
import type { TranscriptRepository, RankedSegment } from "@/repositories/TranscriptRepository";
import type { TextModelProvider } from "@/providers/interfaces/TextModelProvider";
import type { TranscriptionProvider } from "@/providers/interfaces/TranscriptionProvider";
import type { VideoClipProvider } from "@/providers/interfaces/VideoClipProvider";
import type { VideoProvider } from "@/providers/interfaces/VideoProvider";
import { segmentsToSrt } from "@/lib/captions";
import type { UsageService } from "@/services/UsageService";

const CopySetSchema = z.object({
  instagram_caption: z.string(),
  facebook_caption: z.string(),
  linkedin_post: z.string(),
  youtube: z.object({
    title: z.string(),
    description: z.string(),
    tags: z.array(z.string()).max(12),
  }),
  email: z.object({ subject: z.string(), body: z.string() }),
  ad: z.object({ headline: z.string(), primary_text: z.string() }),
  hook_script: z.string(),
});
type CopySet = z.infer<typeof CopySetSchema>;

export interface ProduceInput {
  sourceVideoId: string;
  segmentIds: string[];
  brand: Brand;
  platforms: Platform[];
  generateHeygenHook: boolean;
  /** Render clips 9:16 for Reels/Shorts. */
  vertical: boolean;
  /** Also cut a thumbnail frame (else the platform auto-picks one). */
  generateThumbnail: boolean;
  requestedBy: string;
}

/**
 * segments/selected orchestration (PROJECT_PROMPT.md §6.2): per selected
 * segment, ONE copy call produces all platform variants (§3 — four platforms
 * is one call, not four), then clip items + a copy_set item land in
 * pending_approval. HeyGen hooks are created here and driven to completion
 * by the Inngest function via start/check/complete.
 */
export class ContentProductionService {
  constructor(
    private readonly contentRepo: ContentItemRepository,
    private readonly transcriptRepo: TranscriptRepository,
    private readonly videoRepo: SourceVideoRepository,
    private readonly avatarRepo: AvatarReferenceRepository,
    private readonly accountRepo: AccountRepository,
    private readonly textModel: TextModelProvider,
    private readonly video: VideoProvider,
    private readonly clip: VideoClipProvider,
    private readonly transcription: TranscriptionProvider,
    private readonly usage: UsageService,
    private readonly storageClient: SupabaseClient,
  ) {}

  /**
   * Standalone avatar video from a typed script (no source recording). Creates
   * a heygen_video item; the caller fires avatar/video-requested to render it
   * through the same HeyGen lifecycle as hooks. Returns the new item id.
   */
  async createAvatarVideo(input: {
    script: string;
    caption: string;
    brand: string;
    platforms: Platform[];
    avatarReferenceId: string | null;
    /** Optional background: solid color hex, or an uploaded image's storage path. */
    backgroundColor?: string | null;
    backgroundImagePath?: string | null;
    /** Optional custom video cover/thumbnail (one-off upload storage path). */
    coverImagePath?: string | null;
    /** Optional body-motion direction + energy (HeyGen Avatar IV). Blank = defaults. */
    motionPrompt?: string | null;
    expressiveness?: "low" | "medium" | "high" | null;
    /** Burn auto-generated subtitles into the video. */
    subtitles?: boolean;
    requestedBy: string;
  }): Promise<string> {
    const rawScript = input.script.trim();
    if (!rawScript) throw new Error("Enter a script for the avatar to say.");
    if (input.platforms.length === 0) throw new Error("Pick at least one platform.");

    // Optimize the raw script for HeyGen TTS delivery (spoken rhythm, emotional
    // pacing via wording/punctuation, no stage directions). Falls back to the
    // raw script on any failure so a video is never blocked.
    const script = await this.optimizeAvatarScript(rawScript, input.requestedBy);

    const item = await this.contentRepo.create({
      type: "heygen_video",
      platform: input.platforms[0],
      targetPlatforms: input.platforms,
      brand: input.brand,
      caption: input.caption,
      generationInputs: {
        kind: "avatar_video",
        // Videos from the Generate Videos studio hold in its "Generated videos"
        // sub-page and never auto-enter the Approval Queue (the user moves them).
        studio: true,
        script,
        rawScript, // keep the user's original for reference/regeneration
        avatarReferenceId: input.avatarReferenceId ?? "",
        backgroundColor: input.backgroundColor ?? "",
        backgroundImagePath: input.backgroundImagePath ?? "",
        coverImagePath: input.coverImagePath ?? "",
        motionPrompt: input.motionPrompt ?? "",
        expressiveness: input.expressiveness ?? "",
        subtitles: input.subtitles ?? false,
      },
      brandPresetId: null,
      createdBy: input.requestedBy,
    });
    return item.id;
  }

  /**
   * Standalone prompt-driven "visual clip" (HeyGen Video Agent) — no avatar. The
   * caller supplies the visuals prompt, the narration script, optional on-screen
   * text (baked into the prompt), and optional reference image paths that steer
   * the look. Creates a studio heygen_video item (kind clip_video) that renders
   * into the Generated Videos sub-page. Returns the new item id.
   */
  async createClipVideo(input: {
    visualsPrompt: string;
    script: string;
    textToDisplay?: string | null;
    brand: string;
    platforms: Platform[];
    referenceImagePaths?: string[];
    requestedBy: string;
  }): Promise<string> {
    const visualsPrompt = input.visualsPrompt.trim();
    if (!visualsPrompt) throw new Error("Describe the visuals for the clip.");
    if (input.platforms.length === 0) throw new Error("Pick at least one platform.");

    const item = await this.contentRepo.create({
      type: "heygen_video",
      platform: input.platforms[0],
      targetPlatforms: input.platforms,
      brand: input.brand,
      caption: "",
      generationInputs: {
        kind: "clip_video",
        studio: true,
        visualsPrompt,
        script: input.script.trim(),
        textToDisplay: (input.textToDisplay ?? "").trim(),
        referenceImagePaths: input.referenceImagePaths ?? [],
      },
      brandPresetId: null,
      createdBy: input.requestedBy,
    });
    return item.id;
  }

  /**
   * Ingests a video the user edited elsewhere — already uploaded straight to
   * storage via a signed URL — and drops it into the Approval Queue as a normal
   * video content_item, so an outside edit can re-enter the flow. The uploaded
   * object becomes the item's base render (the path carries no captioned-/outro-
   * prefix, so the version tools treat it as the original). Moves it straight to
   * pending_approval (gate-safe — still needs human approval to publish). No AI
   * cost, so nothing is logged to usage. Returns the new item id.
   */
  async createUploadedVideoFromPath(input: {
    brand: string;
    platforms: Platform[];
    caption: string;
    storagePath: string;
    mimeType: string;
    requestedBy: string;
  }): Promise<string> {
    if (input.platforms.length === 0) throw new Error("Pick at least one platform.");

    const item = await this.contentRepo.create({
      type: "heygen_video",
      platform: input.platforms[0],
      targetPlatforms: input.platforms,
      brand: input.brand,
      caption: input.caption,
      generationInputs: { kind: "uploaded_video", subtitles: false },
      brandPresetId: null,
      createdBy: input.requestedBy,
    });

    await this.contentRepo.setOutputs(item.id, [
      {
        bucket: BUCKETS.generatedMedia,
        path: input.storagePath,
        mimeType: input.mimeType || "video/mp4",
      },
    ]);

    assertTransition("draft", "pending_approval");
    await this.contentRepo.setStatus(item.id, "pending_approval");
    return item.id;
  }

  /**
   * Creates a studio "merged video" item (kind merged_video) that holds in the
   * Generated videos sub-page. Records the ordered sources; the merge/requested
   * Inngest handler renders it via mergeVideo. `cleanup: true` marks a one-off
   * uploaded source to delete after a successful merge (library sources are
   * other items' outputs — never cleaned up). Returns the new item id.
   */
  async createMergedVideo(input: {
    brand: string;
    platforms: Platform[];
    sources: { bucket: string; path: string; cleanup: boolean }[];
    requestedBy: string;
  }): Promise<string> {
    if (input.platforms.length === 0) throw new Error("Pick at least one platform.");
    if (input.sources.length < 2) throw new ValidationError("Pick at least two videos to combine.");

    const item = await this.contentRepo.create({
      type: "heygen_video",
      platform: input.platforms[0],
      targetPlatforms: input.platforms,
      brand: input.brand,
      caption: "",
      generationInputs: { kind: "merged_video", studio: true, sources: input.sources },
      brandPresetId: null,
      createdBy: input.requestedBy,
    });
    return item.id;
  }

  /**
   * Renders a studio merged_video: signs each source, stitches them in order via
   * ffmpeg (pure — no AI, no credits, nothing logged to usage), stores the result
   * as the item's base render, and marks it ready (stays draft in the holding).
   * Best-effort deletes one-off uploaded sources afterward. Throws on failure so
   * the caller can record a studioError.
   */
  async mergeVideo(itemId: string): Promise<void> {
    const item = await this.contentRepo.getById(itemId);
    const rawSources = Array.isArray(item.rawGenerationInputs.sources)
      ? (item.rawGenerationInputs.sources as { bucket: string; path: string; cleanup?: boolean }[])
      : [];
    if (rawSources.length < 2) {
      throw new ValidationError("This merge has fewer than two source videos.");
    }

    // Sign every source fresh (2h) in parallel — order preserved — so ffmpeg can
    // fetch them during the merge.
    const signed = await Promise.all(
      rawSources.map((source) =>
        signedUrl(this.storageClient, source.bucket, source.path, 2 * 3600),
      ),
    );
    if (signed.some((url) => !url)) {
      throw new ProviderError("ffmpeg", "A source video is missing from storage.");
    }
    const sourceUrls = signed as string[];

    const merged = await this.clip.mergeClips({ sourceUrls });
    const path = `${itemId}/${Date.now()}.mp4`;
    await uploadToBucket(this.storageClient, BUCKETS.generatedMedia, path, merged.bytes, merged.mimeType);
    await this.contentRepo.setOutputs(itemId, [
      { bucket: BUCKETS.generatedMedia, path, mimeType: merged.mimeType },
    ]);

    // Studio holding: mark ready, stay draft. No usage recorded (pure ffmpeg).
    await this.contentRepo.setGenerationInputs(itemId, {
      ...item.rawGenerationInputs,
      studioReady: true,
      studioError: null,
    });

    // Delete one-off uploaded sources now they're baked in (never library ones).
    const cleanupPaths = rawSources
      .filter((source) => source.cleanup === true)
      .map((source) => source.path);
    if (cleanupPaths.length > 0) {
      await removeFromBucket(this.storageClient, BUCKETS.generatedMedia, cleanupPaths).catch(() => {});
    }
  }

  /**
   * Rewrites a typed script into a HeyGen-ready spoken script (natural rhythm,
   * emotional pacing via wording/punctuation, symbols spelled out, no stage
   * directions the TTS would read aloud). Best-effort — returns the trimmed raw
   * script if the model call fails, so generation is never blocked.
   */
  private async optimizeAvatarScript(rawScript: string, createdBy: string): Promise<string> {
    try {
      const result = await this.textModel.complete({
        system: AVATAR_SCRIPT_SYSTEM,
        user: `<script>\n${rawScript}\n</script>`,
        taskType: "hookScript",
        tier: "mid",
        idempotencyKey: `avatarscript:${createdBy}:${Date.now()}`,
      });
      await this.usage.recordTextUsage({
        provider: "anthropic",
        model: result.model,
        taskType: "hookScript",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        createdBy,
      });
      const optimized = stripEmDashes(result.text.trim());
      return optimized.length > 0 ? optimized : rawScript;
    } catch (error) {
      if (error instanceof ProviderCreditsError) {
        await this.usage.reportCreditsExhausted(error.provider, error.message);
      }
      return rawScript;
    }
  }

  /** Returns IDs of new clip items (to render) and heygen_video items (to generate). */
  async produce(input: ProduceInput): Promise<{ hookItemIds: string[]; clipItemIds: string[] }> {
    const video = await this.videoRepo.getById(input.sourceVideoId);
    const transcript = await this.transcriptRepo.findBySourceVideo(input.sourceVideoId);
    if (!transcript?.analysis) throw new Error("Video has no ranked segments yet");

    const segments = transcript.analysis.rankedSegments.filter((segment) =>
      input.segmentIds.includes(segment.id),
    );
    const hookItemIds: string[] = [];
    const clipItemIds: string[] = [];

    // Idempotency: which (video, segment) pairs already produced a clip. Fetched
    // ONCE (not per segment) — each segment id is distinct, so a clip created
    // earlier in this run is never for a segment checked later in it.
    const existingClips = await this.contentRepo.listByType("clip", 200);
    const producedSegmentIds = new Set(
      existingClips
        .filter((item) => item.rawGenerationInputs.sourceVideoId === input.sourceVideoId)
        .map((item) => item.rawGenerationInputs.segmentId),
    );

    for (const segment of segments) {
      if (producedSegmentIds.has(segment.id)) continue;

      const copy = await this.generateCopySet(video.title, segment, input.sourceVideoId, input.requestedBy);

      for (const platform of input.platforms) {
        const item = await this.contentRepo.create({
          type: "clip",
          platform,
          brand: input.brand,
          caption: captionFor(copy, platform),
          sourceVideoId: input.sourceVideoId,
          generationInputs: {
            kind: "clip",
            sourceVideoId: input.sourceVideoId,
            segmentId: segment.id,
            startS: segment.startS,
            endS: segment.endS,
            title: segment.title,
            vertical: input.vertical,
            generateThumbnail: input.generateThumbnail,
            youtube: platform === "youtube" ? copy.youtube : undefined,
          },
          brandPresetId: null,
          createdBy: input.requestedBy,
        });
        assertTransition("draft", "pending_approval");
        await this.contentRepo.setStatus(item.id, "pending_approval");
        clipItemIds.push(item.id);
      }

      const copyItem = await this.contentRepo.create({
        type: "copy_set",
        platform: input.platforms[0],
        brand: input.brand,
        caption: copy.email.subject,
        sourceVideoId: input.sourceVideoId,
        generationInputs: {
          kind: "copy_set",
          sourceVideoId: input.sourceVideoId,
          segmentId: segment.id,
          segmentTitle: segment.title,
          copy,
        },
        brandPresetId: null,
        createdBy: input.requestedBy,
      });
      assertTransition("draft", "pending_approval");
      await this.contentRepo.setStatus(copyItem.id, "pending_approval");

      if (input.generateHeygenHook) {
        const hookItem = await this.contentRepo.create({
          type: "heygen_video",
          platform: input.platforms[0],
          brand: input.brand,
          caption: captionFor(copy, input.platforms[0]),
          sourceVideoId: input.sourceVideoId,
          generationInputs: {
            kind: "heygen_hook",
            sourceVideoId: input.sourceVideoId,
            segmentId: segment.id,
            script: copy.hook_script,
          },
          brandPresetId: null,
          createdBy: input.requestedBy,
        });
        hookItemIds.push(hookItem.id);
      }
    }

    return { hookItemIds, clipItemIds };
  }

  private async generateCopySet(
    videoTitle: string,
    segment: RankedSegment,
    sourceVideoId: string,
    requestedBy: string,
  ): Promise<CopySet> {
    try {
      const { value, completions } = await completeStructured(
        this.textModel,
        {
          system: COPY_SET_SYSTEM,
          user: [
            `Video title: ${videoTitle}`,
            "<segment>",
            `Title: ${segment.title}`,
            `Quote: ${segment.excerpt}`,
            `Why it works: ${segment.rationale}`,
            "</segment>",
          ].join("\n"),
          taskType: "copySet",
          tier: "mid",
          idempotencyKey: `copy:${sourceVideoId}:${segment.id}`,
        },
        CopySetSchema,
      );
      for (const completion of completions) {
        await this.usage.recordTextUsage({
          provider: "anthropic",
          model: completion.model,
          taskType: "copySet",
          inputTokens: completion.inputTokens,
          outputTokens: completion.outputTokens,
          jobRef: sourceVideoId,
          createdBy: requestedBy,
        });
      }
      // Hard safety net: strip em/en dashes the model may have used despite
      // the prompt rule, across every copy field.
      return stripEmDashesDeep(value);
    } catch (error) {
      if (error instanceof ProviderCreditsError) {
        await this.usage.reportCreditsExhausted(error.provider, error.message);
      }
      throw error;
    }
  }

  // ------------------------------------------------ HeyGen hook lifecycle

  /** Uploads the reference to HeyGen once (asset ID persisted), then starts generation. */
  async startHook(itemId: string): Promise<{ providerJobId: string }> {
    const item = await this.contentRepo.getById(itemId);
    const script = String(item.rawGenerationInputs.script ?? "");
    if (!script) throw new Error("Hook item has no script");

    try {
      // Prefer this account's people; fall back to all active references.
      const references = await this.avatarRepo
        .listForAccount(item.brand)
        .catch(() => this.avatarRepo.listActive());
      // Honor a chosen person if the item names one; else prefer an already-
      // uploaded reference, else the first available.
      const preferredId = String(item.rawGenerationInputs.avatarReferenceId ?? "");
      const chosen = preferredId ? references.find((ref) => ref.id === preferredId) : undefined;
      const reference = chosen ?? references.find((ref) => ref.providerAssetId) ?? references[0];
      if (!reference) {
        throw new ProviderError(
          "heygen",
          "No avatar/person photo for this account — add one on the account page.",
        );
      }

      let assetId = reference.providerAssetId;
      if (!assetId) {
        const image = await downloadFromBucket(
          this.storageClient,
          BUCKETS.avatarReferences,
          reference.storagePath,
        );
        const uploaded = await this.video.uploadAvatarAsset(image);
        assetId = uploaded.assetId;
        await this.avatarRepo.setProviderAssetId(reference.id, assetId);
      }

      // Optional background chosen in the composer: an uploaded image wins over
      // a solid color; omitted if neither is set (provider default). The image
      // is signed fresh here (2h) so HeyGen can fetch it during rendering.
      const bgColor = String(item.rawGenerationInputs.backgroundColor ?? "").trim();
      const bgImagePath = String(item.rawGenerationInputs.backgroundImagePath ?? "").trim();
      const bgImageUrl = bgImagePath
        ? await signedUrl(this.storageClient, BUCKETS.brandAssets, bgImagePath, 2 * 3600)
        : null;
      const background = bgImageUrl
        ? ({ type: "image", url: bgImageUrl } as const)
        : bgColor
          ? ({ type: "color", value: bgColor } as const)
          : undefined;

      // Optional dynamism controls from the composer (blank = provider defaults).
      const motionPrompt = String(item.rawGenerationInputs.motionPrompt ?? "").trim() || undefined;
      const rawExpr = String(item.rawGenerationInputs.expressiveness ?? "").trim();
      const expressiveness =
        rawExpr === "low" || rawExpr === "medium" || rawExpr === "high" ? rawExpr : undefined;

      const job = await this.video.startGeneration({
        script,
        avatarAssetId: assetId,
        background,
        motionPrompt,
        expressiveness,
        idempotencyKey: `hook:${itemId}`,
      });
      return { providerJobId: job.providerJobId };
    } catch (error) {
      if (error instanceof ProviderCreditsError) {
        await this.usage.reportCreditsExhausted(error.provider, error.message);
      }
      throw error;
    }
  }

  async checkHook(providerJobId: string) {
    return this.video.getJobStatus(providerJobId);
  }

  /**
   * Starts a prompt-driven visual clip (HeyGen Video Agent) from a studio
   * clip_video item. Composes the prompt from the visuals, the on-screen text
   * (baked in), and the narration script; uploads any reference images to steer
   * the look. Returns the Video Agent session id to poll.
   */
  async startClip(itemId: string): Promise<{ providerJobId: string }> {
    const item = await this.contentRepo.getById(itemId);
    const visualsPrompt = String(item.rawGenerationInputs.visualsPrompt ?? "").trim();
    if (!visualsPrompt) throw new Error("Clip item has no visuals prompt");
    const script = String(item.rawGenerationInputs.script ?? "").trim();
    const textToDisplay = String(item.rawGenerationInputs.textToDisplay ?? "").trim();

    try {
      // Upload any one-off reference images to HeyGen → asset ids (steers the
      // agent toward a predictable look). In parallel — they're independent — and
      // best-effort per image: a failed download/upload is skipped, order kept.
      const refPaths = Array.isArray(item.rawGenerationInputs.referenceImagePaths)
        ? (item.rawGenerationInputs.referenceImagePaths as string[])
        : [];
      const uploads = await Promise.all(
        refPaths.map(async (path) => {
          const image = await downloadFromBucket(this.storageClient, BUCKETS.brandAssets, path).catch(
            () => null,
          );
          if (!image) return null;
          return this.video.uploadImageAsset(image).catch(() => null);
        }),
      );
      const referenceAssetIds = uploads
        .filter((uploaded): uploaded is { assetId: string } => uploaded !== null)
        .map((uploaded) => uploaded.assetId);

      const prompt = [
        "Create a short vertical 9:16 social media video clip.",
        `Visuals: ${visualsPrompt}`,
        textToDisplay
          ? `Show this text on screen, prominently and correctly spelled: "${textToDisplay}"`
          : "",
        script
          ? `Speak this narration as the voiceover, word for word: "${script}"`
          : "No spoken narration — visuals only.",
        "Keep it clean, modern, and brand-appropriate. Do not add unrelated text.",
      ]
        .filter(Boolean)
        .join("\n");

      const job = await this.video.startClip({
        prompt,
        voiceId: script ? heygenConfig.voiceId || undefined : undefined,
        referenceAssetIds,
        orientation: "portrait",
        idempotencyKey: `clip:${itemId}`,
      });
      return { providerJobId: job.sessionId };
    } catch (error) {
      if (error instanceof ProviderCreditsError) {
        await this.usage.reportCreditsExhausted(error.provider, error.message);
      }
      throw error;
    }
  }

  /** Poll a clip's Video Agent session (resolves session → video). */
  async checkClip(sessionId: string) {
    return this.video.getClipStatus(sessionId);
  }

  /**
   * Downloads the finished (clean) video into our storage and queues the item.
   * Captions are NOT burned here — that's a separate on-demand step so the video
   * lands fast and this step never risks a re-encode timeout. If subtitles were
   * requested at generation, the flag stays on the item and the queue surfaces
   * the "Generate captions" prompt.
   */
  async completeHook(
    itemId: string,
    urls: { videoUrl: string; durationSeconds?: number },
  ): Promise<void> {
    const item = await this.contentRepo.getById(itemId);
    const isClip = item.rawGenerationInputs.kind === "clip_video";

    // Idempotent so an Inngest step retry never orphans a stored file or
    // double-logs the paid HeyGen cost (docs/API_OPTIMIZATION.md §8):
    //   1. store the render only if it isn't already stored (output presence is
    //      the marker) — a retry after storage skips the re-download/re-upload;
    //   2. finalize the item's state with guarded writes;
    //   3. record the paid cost LAST — a successful log ends the step (no retry);
    //      a failed log commits nothing (single insert), and the retry, which
    //      skips 1–2 as already done, logs exactly once.

    // 1) Store the CLEAN render only — no caption burn here (that's a separate
    //    on-demand step so this never risks a re-encode timeout). If subtitles
    //    were requested, the flag stays on the item for the queue's prompt.
    if (item.outputAssets.length === 0) {
      const response = await fetch(urls.videoUrl);
      if (!response.ok) {
        throw new ProviderError("heygen", "Could not download finished video", true);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const path = `${itemId}/${Date.now()}.mp4`;
      await uploadToBucket(this.storageClient, BUCKETS.generatedMedia, path, bytes, "video/mp4");
      await this.contentRepo.setOutputs(itemId, [
        { bucket: BUCKETS.generatedMedia, path, mimeType: "video/mp4" },
      ]);
    }

    // 2) Finalize state. Studio videos hold in the "Generated videos" sub-page
    //    (stay draft, marked ready) — the user later moves them to the Approval
    //    Queue. Non-studio hooks (Content Engine) go to pending_approval. Both
    //    writes are guarded so a retry neither repeats nor throws on them.
    if (item.rawGenerationInputs.studio === true) {
      if (item.rawGenerationInputs.studioReady !== true || item.rawGenerationInputs.studioError) {
        await this.contentRepo.setGenerationInputs(itemId, {
          ...item.rawGenerationInputs,
          studioReady: true,
          studioError: null,
        });
      }
    } else if (item.status !== "pending_approval") {
      assertTransition(item.status, "pending_approval");
      await this.contentRepo.setStatus(itemId, "pending_approval");
    }

    // 3) Record the paid HeyGen cost last (single atomic insert). HeyGen bills
    //    per second; the flat estimate is the fallback when duration is missing.
    await this.usage.recordMediaUsage({
      provider: "heygen",
      model: isClip ? "video-agent" : "avatar-video",
      taskType: isClip ? "videoAgentClip" : "avatarHook",
      inputTokens: 0,
      outputTokens: 0,
      unit: "video",
      durationSeconds: urls.durationSeconds,
      contentItemId: itemId,
      createdBy: item.createdBy,
    });
  }

  // ------------------------------------------------ post-hoc captions

  private static readonly PRE_PUBLISH = new Set([
    "draft",
    "pending_approval",
    "edits_requested",
  ]);

  /**
   * Burns styled captions into an already-rendered video, keeping the original.
   * The ORIGINAL render is transcribed (Gemini), split into short cues, styled,
   * and burned with ffmpeg. The original is identified by its storage path (not
   * array position) so a prior "switch" can never cause a double-burn or delete
   * the master. Regenerating replaces any stale captioned/outro derivatives and
   * deletes their files. Result: output_assets = [captioned, original], active
   * (index 0) = captioned.
   */
  async addCaptionsToVideo(itemId: string): Promise<void> {
    const item = await this.contentRepo.getById(itemId);
    if (item.type !== "clip" && item.type !== "heygen_video") {
      throw new ValidationError("Captions can only be added to videos.");
    }
    if (!ContentProductionService.PRE_PUBLISH.has(item.status)) {
      throw new ValidationError("This video is already publishing — captions can't be added now.");
    }
    if (item.outputAssets.length === 0) {
      throw new ValidationError("This item has no rendered video yet.");
    }

    // Identify the base render by PATH, never by position — after a version
    // switch the array order flips, so index-based guesses double-burn and can
    // delete the master. Fall back to the last output if none looks "original".
    const original =
      item.outputAssets.find(isOriginalOutput) ??
      item.outputAssets[item.outputAssets.length - 1];
    // Every derived file (old captioned / outro) is stale and gets cleaned up.
    const staleDerived = item.outputAssets.filter((asset) => asset.path !== original.path);

    // Persist an in-progress flag so the queue shows a live "burning captions"
    // state that survives navigation. Cleared on success, and on hard failure so
    // the spinner never gets stuck.
    await this.contentRepo.setGenerationInputs(itemId, {
      ...item.rawGenerationInputs,
      captionsPending: true,
    });

    try {
      // Transcribe the ORIGINAL video → segments → short-cue SRT. Stable key:
      // the source video is immutable, so a retry re-uses the same transcription
      // rather than re-billing (AGENTS.md rule 6).
      const sourceUrl = await signedUrl(
        this.storageClient,
        original.bucket,
        original.path,
        2 * 3600,
      );
      if (!sourceUrl) throw new ProviderError("gemini", "Could not read the stored video", true);
      const transcript = await this.transcription.transcribe({
        sourceUrl,
        mimeType: original.mimeType || "video/mp4",
        sizeBytes: null,
        idempotencyKey: `recaption:${itemId}`,
      });
      await this.usage.recordTextUsage({
        provider: "gemini",
        model: transcript.model,
        taskType: "transcription",
        inputTokens: transcript.inputTokens,
        outputTokens: transcript.outputTokens,
        contentItemId: itemId,
        createdBy: item.createdBy,
      });
      const srt = segmentsToSrt(transcript.segments);
      if (!srt.trim()) throw new ProviderError("gemini", "No speech found to caption", false);

      // Burn styled captions onto the original and store as a NEW output.
      const { bytes } = await this.clip.burnCaptions({ sourceUrl, srt });
      const path = `${itemId}/captioned-${Date.now()}.mp4`;
      await uploadToBucket(this.storageClient, BUCKETS.generatedMedia, path, bytes, "video/mp4");

      const captioned = { bucket: BUCKETS.generatedMedia, path, mimeType: "video/mp4" };
      // Keep only the original + the fresh captioned version (drop any stale
      // captioned/outro outputs so switching is between exactly two files).
      await this.contentRepo.setOutputs(itemId, [captioned, original]);
      await this.contentRepo.setGenerationInputs(itemId, {
        ...item.rawGenerationInputs,
        hasCaptionedVersion: true,
        captionsActive: true,
        captionsPending: false,
        // A fresh caption invalidates any prior outro (built on the old version).
        hasOutro: false,
        outroPending: false,
      });
      // Best-effort cleanup of every stale derivative (old captioned + outro).
      const stalePaths = staleDerived.map((asset) => asset.path).filter((p) => p !== path);
      if (stalePaths.length > 0) {
        await removeFromBucket(this.storageClient, BUCKETS.generatedMedia, stalePaths).catch(
          () => {},
        );
      }
    } catch (error) {
      // Clear the pending flag so the UI stops showing "burning" and the user
      // can retry. Re-read to avoid clobbering concurrent writes.
      const latest = await this.contentRepo.getById(itemId).catch(() => null);
      if (latest) {
        await this.contentRepo
          .setGenerationInputs(itemId, { ...latest.rawGenerationInputs, captionsPending: false })
          .catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Toggles which stored version is active (served + published) between the
   * captioned and the original render. Versions are found by path, so this is
   * correct regardless of array order. Blocked once an outro is appended (the
   * outro is built on one specific version; switching under it would publish a
   * mismatched asset) — regenerate captions to reset if needed.
   */
  async switchVideoVersion(itemId: string): Promise<void> {
    const item = await this.contentRepo.getById(itemId);
    if (item.rawGenerationInputs.hasCaptionedVersion !== true) {
      throw new ValidationError("This video has only one version.");
    }
    if (item.rawGenerationInputs.hasOutro === true) {
      throw new ValidationError(
        "This video has an outro appended — regenerate captions to change the base version.",
      );
    }
    if (!ContentProductionService.PRE_PUBLISH.has(item.status)) {
      throw new ValidationError("This video is already publishing — its version can't be changed.");
    }
    const captioned = item.outputAssets.find(isCaptionedOutput);
    const original = item.outputAssets.find(isOriginalOutput);
    if (!captioned || !original) {
      throw new ValidationError("This video is missing one of its versions.");
    }
    const captionsActive = item.rawGenerationInputs.captionsActive === true;
    // Make the OTHER version active (index 0 is served + published).
    const next = captionsActive ? [original, captioned] : [captioned, original];
    await this.contentRepo.setOutputs(itemId, next);
    await this.contentRepo.setGenerationInputs(itemId, {
      ...item.rawGenerationInputs,
      captionsActive: !captionsActive,
    });
  }

  /**
   * Appends the account's outro clip to the end of the current active video
   * (the captioned version if one is active), producing the final post-ready
   * video as the new active output. The pre-outro versions are kept underneath
   * (so nothing is lost); regenerating captions clears the outro and returns to
   * the two base versions. Runs the concat in ffmpeg (re-encode).
   */
  async addOutroToVideo(itemId: string): Promise<void> {
    const item = await this.contentRepo.getById(itemId);
    if (item.type !== "clip" && item.type !== "heygen_video") {
      throw new ValidationError("An outro can only be added to videos.");
    }
    if (!ContentProductionService.PRE_PUBLISH.has(item.status)) {
      throw new ValidationError("This video is already publishing — an outro can't be added now.");
    }
    if (item.rawGenerationInputs.hasOutro === true) {
      throw new ValidationError("This video already has the outro appended.");
    }
    const active = item.outputAssets[0];
    if (!active) throw new ValidationError("This item has no rendered video yet.");

    const account = await this.accountRepo.getBySlug(item.brand).catch(() => null);
    const outroPath = account?.outroVideoPath ?? null;
    if (!outroPath) {
      throw new ValidationError(
        "This account has no outro clip. Add one on the account page first.",
      );
    }

    await this.contentRepo.setGenerationInputs(itemId, {
      ...item.rawGenerationInputs,
      outroPending: true,
    });

    try {
      const [sourceUrl, outroUrl] = await Promise.all([
        signedUrl(this.storageClient, active.bucket, active.path, 2 * 3600),
        signedUrl(this.storageClient, BUCKETS.brandAssets, outroPath, 2 * 3600),
      ]);
      if (!sourceUrl || !outroUrl) {
        throw new ProviderError("ffmpeg", "Could not read the video or outro clip", true);
      }

      const { bytes } = await this.clip.appendOutro({ sourceUrl, outroUrl });
      const path = `${itemId}/outro-${Date.now()}.mp4`;
      await uploadToBucket(this.storageClient, BUCKETS.generatedMedia, path, bytes, "video/mp4");

      const withOutro = { bucket: BUCKETS.generatedMedia, path, mimeType: "video/mp4" };
      // Active = index 0. With-outro on top, prior versions kept underneath.
      await this.contentRepo.setOutputs(itemId, [withOutro, ...item.outputAssets]);
      await this.contentRepo.setGenerationInputs(itemId, {
        ...item.rawGenerationInputs,
        hasOutro: true,
        outroPending: false,
      });
    } catch (error) {
      const latest = await this.contentRepo.getById(itemId).catch(() => null);
      if (latest) {
        await this.contentRepo
          .setGenerationInputs(itemId, { ...latest.rawGenerationInputs, outroPending: false })
          .catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Marks a never-completed avatar/clip/hook render as failed so it stops showing
   * as "generating" forever (HeyGen timed out, credits, or errored). A studio
   * video records the error on the item (stays draft) so its "Generated videos"
   * sub-page shows a failure with a clear message; a non-studio hook draft goes
   * to the failed status. Anything already produced is left alone.
   */
  async failHook(itemId: string, message?: string): Promise<void> {
    const item = await this.contentRepo.getById(itemId).catch(() => null);
    if (!item) return;
    if (item.outputAssets.length > 0) return; // already produced — nothing to fail
    if (item.rawGenerationInputs.studio === true) {
      await this.contentRepo.setGenerationInputs(itemId, {
        ...item.rawGenerationInputs,
        studioError: message ?? "Generation failed. Try regenerating.",
        studioReady: false,
      });
      return;
    }
    if (item.status === "draft") {
      assertTransition("draft", "failed");
      await this.contentRepo.setStatus(itemId, "failed");
    }
  }

  /**
   * Moves a generated studio video into the Approval Queue with a caption. Stays
   * gate-safe — it lands in pending_approval, which still requires human approval
   * to publish. Only a ready studio video (draft + rendered output) can move.
   */
  async moveStudioVideoToQueue(itemId: string, caption: string): Promise<void> {
    const item = await this.contentRepo.getById(itemId);
    if (item.rawGenerationInputs.studio !== true) {
      throw new ValidationError("This is not a generated studio video.");
    }
    if (item.status !== "draft" || item.outputAssets.length === 0) {
      throw new ValidationError("This video isn't ready to move yet.");
    }
    await this.contentRepo.setCaption(itemId, caption);
    assertTransition("draft", "pending_approval");
    await this.contentRepo.setStatus(itemId, "pending_approval");
  }

  /**
   * Resets a studio video (clip or avatar) for a fresh re-roll: clears the prior
   * output + any error, keeping the same inputs so the caller can re-fire the
   * matching generation event. Returns the kind so the caller picks the event.
   */
  async resetStudioVideoForRegeneration(itemId: string): Promise<string> {
    const item = await this.contentRepo.getById(itemId);
    if (item.rawGenerationInputs.studio !== true) {
      throw new ValidationError("This is not a generated studio video.");
    }
    if (item.status !== "draft") {
      throw new ValidationError("Only a video still in the studio can be regenerated here.");
    }
    // Best-effort cleanup of the prior render before re-rolling.
    if (item.outputAssets.length > 0) {
      await removeFromBucket(
        this.storageClient,
        BUCKETS.generatedMedia,
        item.outputAssets.map((asset) => asset.path),
      ).catch(() => {});
    }
    await this.contentRepo.setOutputs(itemId, []);
    await this.contentRepo.setGenerationInputs(itemId, {
      ...item.rawGenerationInputs,
      studioReady: false,
      studioError: null,
    });
    return item.rawGenerationInputs.kind === "clip_video"
      ? "clip_video"
      : item.rawGenerationInputs.kind === "merged_video"
        ? "merged_video"
        : "avatar_video";
  }

  /**
   * Safety net for HeyGen renders that never reached a terminal state — e.g. the
   * Inngest run died mid-poll or exhausted its retries on a retryable error, so
   * `failHook`/`completeHook` never fired and the item sits in `draft` forever,
   * showing as "generating" in the UI. Run periodically by a cron: any
   * heygen_video still `draft` with no output past `olderThanMinutes` is marked
   * failed (studio-aware, via failHook) so the user sees it stopped and can
   * regenerate. Items that produced output (already completed) or already carry a
   * studioError (already failed) are left alone.
   */
  async failStuckVideos(olderThanMinutes = 30, limit = 100): Promise<{ failed: number }> {
    const cutoff = Date.now() - olderThanMinutes * 60 * 1000;
    const recent = await this.contentRepo.listByType("heygen_video", limit).catch(() => []);
    let failed = 0;
    for (const item of recent) {
      const stuck =
        item.status === "draft" &&
        item.outputAssets.length === 0 &&
        !item.rawGenerationInputs.studioError &&
        new Date(item.createdAt).getTime() < cutoff;
      if (!stuck) continue;
      await this.failHook(item.id, "Generation stalled and was stopped. Try regenerating.");
      failed += 1;
    }
    return { failed };
  }
}

function captionFor(copy: CopySet, platform: Platform): string {
  switch (platform) {
    case "instagram":
      return copy.instagram_caption;
    case "facebook":
      return copy.facebook_caption;
    case "linkedin":
      return copy.linkedin_post;
    case "youtube":
      return copy.youtube.description;
  }
}

// --- Video version identification (by storage path, not array position) -------
// Derived versions are named `${itemId}/captioned-*.mp4` and `${itemId}/outro-*.mp4`;
// the base render has neither prefix. Identifying by path (not index) keeps
// captioning/outro/switch correct no matter how the outputs array is reordered.
export function isCaptionedOutput(asset: OutputAsset): boolean {
  return /\/captioned-\d+\.mp4$/.test(asset.path);
}
export function isOutroOutput(asset: OutputAsset): boolean {
  return /\/outro-\d+\.mp4$/.test(asset.path);
}
export function isOriginalOutput(asset: OutputAsset): boolean {
  return !isCaptionedOutput(asset) && !isOutroOutput(asset);
}
