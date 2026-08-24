import type { ContentItemRepository } from "@/repositories/ContentItemRepository";
import type { JobRepository } from "@/repositories/JobRepository";
import { assertTransition } from "@/lib/statusMachine";

export interface PrepareResult {
  /** False for types whose regeneration needs source-video context (see below). */
  canRegenerate: boolean;
}

/**
 * The `edits_requested → regenerating → pending_approval` half of the review
 * loop. Regeneration reuses the item's original inputs plus the reviewer's
 * comment — it never restarts the upstream transcription/analysis chain
 * (docs/API_OPTIMIZATION.md §2).
 *
 * MVP scope: image posts regenerate for real (Tab 1, weekly batch, and
 * calendar items are all image posts). Clips, copy sets, and avatar hooks
 * cycle back to the queue with the reviewer's comment attached for a human to
 * act on — re-running those needs the source segment and is deliberately not
 * automated yet.
 */
export class ContentRegenerationService {
  constructor(
    private readonly contentRepo: ContentItemRepository,
    private readonly jobRepo: JobRepository,
  ) {}

  async prepare(itemId: string): Promise<PrepareResult> {
    const item = await this.contentRepo.getById(itemId);

    // Idempotency: a retried event finds the item already moved on.
    if (item.status !== "edits_requested") {
      return { canRegenerate: false };
    }

    const canRegenerate = item.type === "image_post";

    if (canRegenerate && item.editComment) {
      await this.contentRepo.setGenerationInputs(itemId, {
        ...item.rawGenerationInputs,
        adjustmentNotes: [...item.generationInputs.adjustmentNotes, item.editComment],
      });
    }

    assertTransition(item.status, "regenerating");
    await this.contentRepo.setStatusIfCurrent(itemId, "edits_requested", "regenerating");

    if (canRegenerate) {
      // A fresh job row is what lets the (otherwise idempotent) image
      // generation run again for the new adjustment note.
      await this.jobRepo.create({ jobName: "image-regeneration", contentItemId: itemId });
    }
    return { canRegenerate };
  }

  /** Returns the item to the queue for a fresh review pass. */
  async finish(itemId: string): Promise<void> {
    const item = await this.contentRepo.getById(itemId);
    if (item.status !== "regenerating") return;
    assertTransition(item.status, "pending_approval");
    await this.contentRepo.setStatusIfCurrent(itemId, "regenerating", "pending_approval");
  }

  /** Regeneration blew up — surface it in the queue rather than hanging. */
  async fail(itemId: string): Promise<void> {
    const item = await this.contentRepo.getById(itemId);
    if (item.status !== "regenerating") return;
    assertTransition(item.status, "failed");
    await this.contentRepo.setStatusIfCurrent(itemId, "regenerating", "failed");
  }
}
