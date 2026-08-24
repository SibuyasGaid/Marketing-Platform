import type { Brand, ImagePlatform } from "@/lib/domain";
import { ValidationError } from "@/lib/errors";
import { assertTransition } from "@/lib/statusMachine";
import type { BrandPresetRepository } from "@/repositories/BrandPresetRepository";
import type { CalendarEntry, ContentCalendarRepository } from "@/repositories/ContentCalendarRepository";
import type { ContentItemRepository } from "@/repositories/ContentItemRepository";
import type { JobRepository } from "@/repositories/JobRepository";
import type { ImageGenerationService } from "@/services/ImageGenerationService";
import type { PostCaptionService } from "@/services/PostCaptionService";

/**
 * Scheduled generation (PROJECT_PROMPT.md §2): the team enters a prompt or a
 * preset per day ahead of time; the daily cron turns today's entries into
 * content sitting in the approval queue.
 */
export class ContentCalendarService {
  constructor(
    private readonly calendarRepo: ContentCalendarRepository,
    private readonly contentRepo: ContentItemRepository,
    private readonly presetRepo: BrandPresetRepository,
    private readonly jobRepo: JobRepository,
    private readonly imageGen: ImageGenerationService,
    private readonly captionService: PostCaptionService,
  ) {}

  async addEntry(input: {
    calendarDate: string;
    brand: Brand;
    platforms: ImagePlatform[];
    prompt: string;
    brandPresetId: string | null;
    createdBy: string;
  }): Promise<CalendarEntry> {
    const prompt = input.prompt.trim();
    if (!prompt && !input.brandPresetId) {
      throw new ValidationError("Add a prompt or pick a template preset for this day.");
    }
    if (input.platforms.length === 0) {
      throw new ValidationError("Pick at least one platform for this day.");
    }
    return this.calendarRepo.create({
      calendarDate: input.calendarDate,
      brand: input.brand,
      platforms: input.platforms,
      prompt: prompt || null,
      brandPresetId: input.brandPresetId,
      createdBy: input.createdBy,
    });
  }

  async listWeek(fromDate: string, toDate: string): Promise<CalendarEntry[]> {
    return this.calendarRepo.listBetween(fromDate, toDate);
  }

  async removeEntry(id: string): Promise<void> {
    await this.calendarRepo.delete(id);
  }

  /**
   * Executed by the daily cron. Idempotent per calendar entry: an entry that
   * already produced an item is skipped, so a retried run never re-bills.
   */
  async generateForDate(calendarDate: string): Promise<{ created: number; skipped: number }> {
    const entries = await this.calendarRepo.listForDate(calendarDate);
    if (entries.length === 0) return { created: 0, skipped: 0 };

    const existing = await this.contentRepo.listByType("image_post", 300);
    // Idempotency key per produced item: calendar entry + platform.
    const alreadyGenerated = new Set(
      existing
        .filter((item) => typeof item.rawGenerationInputs.calendarEntryId === "string")
        .map((item) => `${item.rawGenerationInputs.calendarEntryId}:${item.platform}`),
    );

    const presets = await this.presetRepo.listActive();
    let created = 0;
    let skipped = 0;

    for (const entry of entries) {
      const preset = entry.brandPresetId
        ? presets.find((candidate) => candidate.id === entry.brandPresetId) ?? presets[0]
        : presets[0];
      if (!preset) {
        // No preset configured at all — nothing to generate against.
        skipped += 1;
        continue;
      }

      const topic =
        entry.prompt ?? `Post for ${entry.calendarDate} using the ${preset.name} preset.`;
      const platformsToMake = entry.platforms.filter(
        (platform) => !alreadyGenerated.has(`${entry.id}:${platform}`),
      );
      if (platformsToMake.length === 0) {
        skipped += 1;
        continue;
      }

      const captions = await this.captionService.generate({
        brand: entry.brand,
        topic,
        tone: preset.tone,
        platforms: platformsToMake,
        idempotencyKey: `calendar:${entry.id}`,
        createdBy: entry.createdBy,
      });

      for (const platform of platformsToMake) {
        const item = await this.contentRepo.create({
          type: "image_post",
          platform,
          brand: entry.brand,
          caption: captions[platform] ?? null,
          scheduledDate: entry.calendarDate,
          generationInputs: {
            kind: "calendar",
            calendarEntryId: entry.id,
            prompt: topic,
            brandPresetId: preset.id,
            avatarReferenceIds: [],
            adjustmentNotes: [],
          },
          brandPresetId: preset.id,
          createdBy: entry.createdBy ?? preset.id,
        });

        await this.jobRepo.create({ jobName: "calendar-generation", contentItemId: item.id });
        await this.imageGen.executeGeneration(item.id);

        assertTransition("draft", "pending_approval");
        await this.contentRepo.setStatus(item.id, "pending_approval");
        created += 1;
      }
    }

    return { created, skipped };
  }
}
