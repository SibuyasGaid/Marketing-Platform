import type { SupabaseClient } from "@supabase/supabase-js";
import { ProviderCreditsError } from "@/lib/errors";
import { BUCKETS, signedUrl } from "@/lib/supabase/storage";
import type { SourceVideoRepository } from "@/repositories/SourceVideoRepository";
import type { TranscriptRepository } from "@/repositories/TranscriptRepository";
import type { TranscriptionProvider } from "@/providers/interfaces/TranscriptionProvider";
import type { UsageService } from "@/services/UsageService";

export interface IngestInput {
  title: string;
  description: string | null;
  storagePath: string | null;
  sourceUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  userId: string;
}

/**
 * VOD ingestion + transcription. A video is transcribed exactly once — the
 * transcript row is the permanent record (docs/API_OPTIMIZATION.md §2).
 */
export class TranscriptionService {
  constructor(
    private readonly videoRepo: SourceVideoRepository,
    private readonly transcriptRepo: TranscriptRepository,
    private readonly transcription: TranscriptionProvider,
    private readonly usage: UsageService,
    private readonly storageClient: SupabaseClient,
    private readonly sendEvent: (event: {
      name: "vod/ingested";
      data: { sourceVideoId: string };
    }) => Promise<void>,
  ) {}

  async ingest(input: IngestInput): Promise<string> {
    await this.usage.assertCanGenerate(input.userId);
    const video = await this.videoRepo.create({
      title: input.title,
      description: input.description,
      storagePath: input.storagePath,
      sourceUrl: input.sourceUrl,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedBy: input.userId,
    });
    await this.sendEvent({ name: "vod/ingested", data: { sourceVideoId: video.id } });
    return video.id;
  }

  /** Executed inside Inngest. Idempotent: existing transcript short-circuits. */
  async executeTranscription(sourceVideoId: string): Promise<void> {
    const existing = await this.transcriptRepo.findBySourceVideo(sourceVideoId);
    if (existing) return;

    const video = await this.videoRepo.getById(sourceVideoId);
    await this.videoRepo.setTranscriptStatus(sourceVideoId, "processing");

    try {
      const mediaUrl = video.storagePath
        ? await signedUrl(this.storageClient, BUCKETS.sourceVideos, video.storagePath, 4 * 3600)
        : video.sourceUrl;
      if (!mediaUrl) throw new Error("Source video has no readable location");

      const result = await this.transcription.transcribe({
        sourceUrl: mediaUrl,
        mimeType: video.mimeType ?? "video/mp4",
        sizeBytes: video.sizeBytes,
        idempotencyKey: `transcribe:${sourceVideoId}`,
      });

      await this.transcriptRepo.create({
        sourceVideoId,
        fullText: result.fullText,
        segmentMap: result.segments,
      });
      await this.usage.recordTextUsage({
        provider: "gemini",
        model: result.model,
        taskType: "transcription",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        jobRef: sourceVideoId,
        createdBy: null,
      });
      await this.videoRepo.setTranscriptStatus(sourceVideoId, "completed");
    } catch (error) {
      if (error instanceof ProviderCreditsError) {
        await this.usage.reportCreditsExhausted(error.provider, error.message);
      }
      await this.videoRepo.setTranscriptStatus(sourceVideoId, "failed");
      throw error;
    }
  }
}
