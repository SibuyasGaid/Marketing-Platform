import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKETS, signedUrl, uploadToBucket } from "@/lib/supabase/storage";
import type { ContentItemRepository } from "@/repositories/ContentItemRepository";
import type { JobRepository } from "@/repositories/JobRepository";
import type { SourceVideoRepository } from "@/repositories/SourceVideoRepository";
import type { VideoClipProvider } from "@/providers/interfaces/VideoClipProvider";

/**
 * Cuts a `clip` content item's segment out of its source video into a small,
 * standalone MP4 stored in generated-media. Idempotent: a clip that already has
 * a rendered output is never re-cut, so Inngest retries never duplicate work.
 */
export class ClipRenderService {
  constructor(
    private readonly contentRepo: ContentItemRepository,
    private readonly videoRepo: SourceVideoRepository,
    private readonly jobRepo: JobRepository,
    private readonly clipProvider: VideoClipProvider,
    private readonly storageClient: SupabaseClient,
  ) {}

  async render(contentItemId: string): Promise<void> {
    const item = await this.contentRepo.getById(contentItemId);
    if (item.type !== "clip") return;
    if (item.outputAssets.length > 0) return; // already rendered

    let job = (await this.jobRepo.latestByContentItems([contentItemId])).get(contentItemId) ?? null;
    if (job && job.status === "completed") return;
    if (!job) job = await this.jobRepo.create({ jobName: "clip-render", contentItemId });
    await this.jobRepo.setStatus(job.id, "running");

    try {
      if (!item.sourceVideoId) throw new Error("Clip has no source video");
      const source = await this.videoRepo.getById(item.sourceVideoId);
      const sourceUrl = source.storagePath
        ? await signedUrl(this.storageClient, BUCKETS.sourceVideos, source.storagePath, 2 * 3600)
        : source.sourceUrl;
      if (!sourceUrl) throw new Error("Source video has no readable location");

      const raw = item.rawGenerationInputs;
      const startS = typeof raw.startS === "number" ? raw.startS : 0;
      const endS = typeof raw.endS === "number" ? raw.endS : startS + 15;
      // Default to vertical (Reels/Shorts); only landscape if explicitly false.
      const vertical = raw.vertical !== false;
      const generateThumbnail = raw.generateThumbnail === true;

      const result = await this.clipProvider.clip({ sourceUrl, startS, endS, vertical });
      const path = `${item.id}/${Date.now()}.mp4`;
      await uploadToBucket(
        this.storageClient,
        BUCKETS.generatedMedia,
        path,
        result.bytes,
        result.mimeType,
      );
      await this.contentRepo.setOutputs(item.id, [
        { bucket: BUCKETS.generatedMedia, path, mimeType: result.mimeType },
      ]);

      // Optional thumbnail from the segment midpoint; else the platform auto-picks.
      if (generateThumbnail) {
        const thumb = await this.clipProvider.thumbnail({
          sourceUrl,
          atS: startS + (endS - startS) / 2,
          vertical,
        });
        const thumbPath = `${item.id}/thumb-${Date.now()}.jpg`;
        await uploadToBucket(
          this.storageClient,
          BUCKETS.generatedMedia,
          thumbPath,
          thumb.bytes,
          thumb.mimeType,
        );
        await this.contentRepo.setGenerationInputs(item.id, {
          ...item.rawGenerationInputs,
          thumbnailPath: thumbPath,
        });
      }

      await this.jobRepo.setStatus(job.id, "completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Clip render failed";
      await this.jobRepo.setStatus(job.id, "failed", message);
      throw error;
    }
  }
}
