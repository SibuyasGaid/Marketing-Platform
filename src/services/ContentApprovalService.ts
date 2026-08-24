import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentItem } from "@/repositories/ContentItemRepository";
import type { ContentItemRepository } from "@/repositories/ContentItemRepository";
import type { ApprovalEvent, ApprovalEventRepository } from "@/repositories/ApprovalEventRepository";
import { BRAND_NAMES, type Profile } from "@/lib/domain";
import { ForbiddenError, InvalidTransitionError, ProviderError, ValidationError } from "@/lib/errors";
import { assertTransition } from "@/lib/statusMachine";
import { sydneyDateOf } from "@/lib/timezone";
import { BUCKETS, signedUrl } from "@/lib/supabase/storage";
import type { PublishPayload, PublishProvider } from "@/providers/interfaces/PublishProvider";

/** Signed asset links handed to n8n — minimum practical expiry (SECURITY §2). */
const ASSET_URL_TTL_SECONDS = 60 * 60;

/** Only these roles may approve or request edits (docs/SECURITY.md §3). */
const REVIEW_ROLES = new Set(["admin", "reviewer"]);

export type DispatchOutcome =
  | { status: "dispatched"; dispatchId: string }
  | { status: "already_handled" }
  | { status: "skipped"; reason: string };

/**
 * The approval gate — the highest-priority control in this app
 * (docs/SECURITY.md §4).
 *
 * Two independent facts must both hold before anything reaches
 * PublishProvider.dispatch():
 *   1. the row's status is `approved` in the database, and
 *   2. an `approval_events` row with action `approved` exists for that item.
 *
 * The Inngest handler re-checks both here rather than trusting its event
 * payload, so forging an event cannot publish. There is no bulk-approve and
 * no skip-review path.
 */
export class ContentApprovalService {
  constructor(
    private readonly contentRepo: ContentItemRepository,
    private readonly approvalRepo: ApprovalEventRepository,
    private readonly publisher: PublishProvider,
    private readonly storageClient: SupabaseClient,
    private readonly sendEvent: (event: {
      name: "content/approved" | "content/edits-requested";
      data: { contentItemId: string };
    }) => Promise<void>,
  ) {}

  /**
   * Records the reviewer's approval and either queues dispatch now or, when
   * `scheduledFor` is a future time, holds the item as `scheduled` for the cron
   * to dispatch later. The audit row is written before the status flips, so an
   * approved item can never exist without a matching audit trail — scheduling
   * does not bypass the gate.
   */
  async approve(itemId: string, reviewer: Profile, scheduledFor?: string | null): Promise<ContentItem> {
    this.assertMayReview(reviewer);
    const item = await this.contentRepo.getById(itemId);
    assertTransition(item.status, "approved");

    // A schedule time in the past (or now) is treated as "publish now".
    const schedule =
      scheduledFor && new Date(scheduledFor).getTime() > Date.now() ? scheduledFor : null;

    await this.approvalRepo.record({
      contentItemId: itemId,
      reviewerId: reviewer.id,
      action: "approved",
    });

    // Compare-and-set: a second concurrent approval finds the row already
    // moved and stops here instead of dispatching twice.
    const approved = await this.contentRepo.setStatusIfCurrent(itemId, item.status, "approved");
    if (!approved) {
      throw new InvalidTransitionError(item.status, "approved");
    }

    if (schedule) {
      // Hold for later: record the publish time and move to `scheduled`. The
      // dispatch cron re-checks the gate before publishing, same as immediate.
      await this.contentRepo.setScheduledFor(itemId, schedule);
      // Keep the calendar day in sync with the scheduled time (Sydney date) so
      // the board places the item in the correct day column — not its created day.
      await this.contentRepo.setScheduledDate(itemId, sydneyDateOf(schedule));
      const scheduled = await this.contentRepo.setStatusIfCurrent(itemId, "approved", "scheduled");
      if (!scheduled) throw new InvalidTransitionError("approved", "scheduled");
      return scheduled;
    }

    await this.sendEvent({ name: "content/approved", data: { contentItemId: itemId } });
    return approved;
  }

  /**
   * Cron entry point: dispatches every scheduled item whose publish time has
   * arrived. Each goes through the same gate-checked path as an immediate
   * approval. Returns how many were dispatched.
   */
  async dispatchDueScheduled(limit = 50): Promise<{ dispatched: number }> {
    const due = await this.contentRepo.listDueScheduled(new Date().toISOString(), limit);
    let dispatched = 0;
    for (const item of due) {
      // Compare-and-set guards against two overlapping cron runs racing the
      // same item; only the winner sends the dispatch event.
      const moved = await this.contentRepo.setStatusIfCurrent(item.id, "scheduled", "approved");
      if (!moved) continue;
      await this.contentRepo.setScheduledFor(item.id, null);
      await this.sendEvent({ name: "content/approved", data: { contentItemId: item.id } });
      dispatched += 1;
    }
    return { dispatched };
  }

  /**
   * Cancels a schedule and returns the item to the queue for a fresh decision.
   * Routes back through `pending_approval` so re-approval is required — a
   * cancelled schedule can never silently publish.
   */
  async cancelSchedule(itemId: string, reviewer: Profile): Promise<ContentItem> {
    this.assertMayReview(reviewer);
    const item = await this.contentRepo.getById(itemId);
    assertTransition(item.status, "pending_approval");
    const updated = await this.contentRepo.setStatusIfCurrent(itemId, "scheduled", "pending_approval");
    if (!updated) throw new InvalidTransitionError(item.status, "pending_approval");
    await this.contentRepo.setScheduledFor(itemId, null);
    // Clear the calendar day too so the cancelled item leaves the scheduled
    // column and returns to the normal queue (its created-day bucket).
    await this.contentRepo.setScheduledDate(itemId, null);
    return updated;
  }

  /** Sends the item back for changes with the reviewer's comment attached. */
  async requestEdits(
    itemId: string,
    reviewer: Profile,
    comment: string,
  ): Promise<ContentItem> {
    this.assertMayReview(reviewer);
    const trimmed = comment.trim();
    if (!trimmed) throw new ValidationError("Describe the changes needed.");

    const item = await this.contentRepo.getById(itemId);
    assertTransition(item.status, "edits_requested");

    await this.approvalRepo.record({
      contentItemId: itemId,
      reviewerId: reviewer.id,
      action: "edits_requested",
      comment: trimmed,
    });

    const updated = await this.contentRepo.setStatusIfCurrent(
      itemId,
      item.status,
      "edits_requested",
    );
    if (!updated) throw new InvalidTransitionError(item.status, "edits_requested");

    await this.contentRepo.setEditComment(itemId, trimmed);
    await this.sendEvent({
      name: "content/edits-requested",
      data: { contentItemId: itemId },
    });
    return updated;
  }

  /**
   * Called ONLY from the content/approved Inngest handler. Re-verifies both
   * halves of the gate against the database before dispatching.
   */
  async dispatchApproved(itemId: string): Promise<DispatchOutcome> {
    const item = await this.contentRepo.getById(itemId);

    // Idempotency: a retried event for an item already moved on is a no-op.
    if (item.status !== "approved") {
      return { status: "already_handled" };
    }

    // THE GATE: an approved status without a recorded approval means the row
    // was changed outside the service — refuse to publish.
    const hasApproval = await this.approvalRepo.hasApprovalFor(itemId);
    if (!hasApproval) {
      throw new ForbiddenError(
        `Refusing to publish ${itemId}: no approval event recorded for this item`,
      );
    }

    if (item.type === "copy_set") {
      // Copy sets are reference deliverables (email/ad copy), not social posts.
      return { status: "skipped", reason: "copy_set is not dispatched to socials" };
    }

    const assetUrls = await this.buildAssetUrls(item);
    if (assetUrls.length === 0) {
      return { status: "skipped", reason: "item has no generated asset to publish" };
    }
    const coverUrl = await this.buildCoverUrl(item);

    const publishing = await this.contentRepo.setStatusIfCurrent(
      itemId,
      "approved",
      "publishing",
    );
    if (!publishing) return { status: "already_handled" };

    // One post, many destinations: dispatch the same asset + caption to each
    // target platform. All must succeed to mark the item posted; if any fails,
    // it surfaces as a failure (retryable errors bubble so Inngest can retry).
    const platforms = item.targetPlatforms.length > 0 ? item.targetPlatforms : [item.platform];
    try {
      let anyAsync = false;
      let firstPostUrl: string | null = null;
      let lastDispatchId = "";
      for (const platform of platforms) {
        const result = await this.publisher.dispatch(
          this.toPublishPayload(item, assetUrls, platform, coverUrl),
        );
        lastDispatchId = result.dispatchId;
        if (result.posted) {
          if (!firstPostUrl && result.postUrl) firstPostUrl = result.postUrl;
        } else {
          // n8n-style async publisher; the status webhook settles it later.
          anyAsync = true;
        }
      }
      // Direct providers publish synchronously — settle as posted now once every
      // platform is done. If any platform is async (n8n), leave it publishing.
      if (!anyAsync) {
        await this.contentRepo.setStatusIfCurrent(itemId, "publishing", "posted");
        if (firstPostUrl) await this.contentRepo.setPlatformPostUrl(itemId, firstPostUrl);
        // Record which platforms actually went live, so a later "repost to more
        // platforms" knows what to skip (avoids duplicate posts).
        await this.contentRepo.setGenerationInputs(itemId, {
          ...item.rawGenerationInputs,
          postedPlatforms: platforms,
        });
      }
      return { status: "dispatched", dispatchId: lastDispatchId };
    } catch (error) {
      // Non-retryable failures settle the item now; retryable ones bubble so
      // Inngest can retry while the item stays `publishing`.
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable) {
        await this.contentRepo.setStatusIfCurrent(itemId, "publishing", "failed");
      }
      throw error;
    }
  }

  /**
   * Publishes an ALREADY-POSTED item to additional platforms it wasn't sent to
   * before (a reviewer changed their mind after it went live). Preserves the
   * gate: it re-verifies the item's approval_events row before dispatching, and
   * only ever targets platforms not already posted — so nothing publishes
   * unapproved and no platform is double-posted. Records each platform the moment
   * it succeeds, so an Inngest retry resumes without re-posting the done ones.
   * Runs only from the content/repost-requested handler.
   */
  async repostToPlatforms(itemId: string, requested: ContentItem["platform"][]): Promise<DispatchOutcome> {
    const item = await this.contentRepo.getById(itemId);
    if (item.status !== "posted") {
      return { status: "skipped", reason: "only posted items can be reposted" };
    }
    if (item.type === "copy_set") {
      return { status: "skipped", reason: "copy_set is not dispatched to socials" };
    }

    // THE GATE: reposting is still publishing — refuse unless this item carries a
    // recorded approval (it was approved to go live in the first place).
    const hasApproval = await this.approvalRepo.hasApprovalFor(itemId);
    if (!hasApproval) {
      throw new ForbiddenError(`Refusing to repost ${itemId}: no approval event recorded`);
    }

    // Skip platforms already posted (from the recorded set, or the target set for
    // items posted before we tracked it) and any invalid for this type.
    const alreadyPosted = new Set<string>(
      Array.isArray(item.rawGenerationInputs.postedPlatforms)
        ? (item.rawGenerationInputs.postedPlatforms as string[])
        : item.targetPlatforms,
    );
    const isImage = item.type === "image_post";
    const targets = [...new Set(requested)].filter(
      (platform) => !alreadyPosted.has(platform) && (isImage ? platform !== "youtube" : true),
    );
    if (targets.length === 0) {
      return { status: "skipped", reason: "no new platforms to repost to" };
    }

    const assetUrls = await this.buildAssetUrls(item);
    if (assetUrls.length === 0) {
      return { status: "skipped", reason: "item has no generated asset to publish" };
    }
    const coverUrl = await this.buildCoverUrl(item);

    let lastDispatchId = "";
    // Accumulate locally so multiple new platforms all persist (not last-wins),
    // and persist after each success so an Inngest retry resumes cleanly.
    const posted = new Set(alreadyPosted);
    const targetSet = new Set<ContentItem["platform"]>(item.targetPlatforms);
    let postUrl = item.platformPostUrl;
    for (const platform of targets) {
      // Re-read just-in-time so a racing repost that already handled this
      // platform is skipped — best-effort mutex to keep "no duplicates".
      const fresh = await this.contentRepo.getById(itemId).catch(() => null);
      const freshPosted = new Set<string>(
        Array.isArray(fresh?.rawGenerationInputs.postedPlatforms)
          ? (fresh!.rawGenerationInputs.postedPlatforms as string[])
          : fresh?.targetPlatforms ?? [],
      );
      if (freshPosted.has(platform)) {
        posted.add(platform);
        continue;
      }

      const result = await this.publisher.dispatch(
        this.toPublishPayload(item, assetUrls, platform, coverUrl),
      );
      lastDispatchId = result.dispatchId;
      // Only record as posted on a synchronous success. An async (n8n) dispatch
      // is settled later by the publish-status webhook, so don't mark it here.
      if (!result.posted) continue;

      posted.add(platform);
      targetSet.add(platform);
      if (!postUrl && result.postUrl) postUrl = result.postUrl;
      await this.contentRepo.setTargetPlatforms(itemId, [...targetSet]);
      await this.contentRepo.setGenerationInputs(itemId, {
        ...item.rawGenerationInputs,
        postedPlatforms: [...posted],
      });
      if (postUrl && !item.platformPostUrl) {
        await this.contentRepo.setPlatformPostUrl(itemId, postUrl);
      }
    }
    return { status: "dispatched", dispatchId: lastDispatchId };
  }

  /** n8n callback: the post went live. */
  async markPosted(itemId: string, platformPostUrl: string | null = null): Promise<void> {
    const item = await this.contentRepo.getById(itemId);
    if (item.status === "posted") return;
    assertTransition(item.status, "posted");
    await this.contentRepo.setStatusIfCurrent(itemId, item.status, "posted");
    if (platformPostUrl) {
      await this.contentRepo.setPlatformPostUrl(itemId, platformPostUrl);
    }
  }

  /** n8n callback (or a dispatch error): publishing failed. */
  async markFailed(itemId: string): Promise<void> {
    const item = await this.contentRepo.getById(itemId);
    if (item.status === "failed") return;
    assertTransition(item.status, "failed");
    await this.contentRepo.setStatusIfCurrent(itemId, item.status, "failed");
  }

  /**
   * Manual retry for a failed item: returns it to the queue for a fresh
   * review. Deliberately routes back through `pending_approval` — re-approval
   * is required, so a retry can never bypass the gate and publish directly.
   */
  async retryFailed(itemId: string, reviewer: Profile): Promise<ContentItem> {
    this.assertMayReview(reviewer);
    const item = await this.contentRepo.getById(itemId);
    assertTransition(item.status, "pending_approval");
    const updated = await this.contentRepo.setStatusIfCurrent(
      itemId,
      "failed",
      "pending_approval",
    );
    if (!updated) throw new InvalidTransitionError(item.status, "pending_approval");
    await this.contentRepo.setEditComment(itemId, null);
    return updated;
  }

  async getAuditTrail(itemId: string): Promise<ApprovalEvent[]> {
    return this.approvalRepo.listByItem(itemId);
  }

  /**
   * Edits the caption/description before it publishes. Admin/reviewer only.
   * Refused once the item is publishing or already posted — editing the caption
   * then would not change the live post.
   */
  async editCaption(itemId: string, reviewer: Profile, caption: string): Promise<ContentItem> {
    this.assertMayReview(reviewer);
    const item = await this.contentRepo.getById(itemId);
    if (item.status === "publishing" || item.status === "posted") {
      throw new ValidationError("This post is already publishing — its caption can't be changed.");
    }
    await this.contentRepo.setCaption(itemId, caption);
    return this.contentRepo.getById(itemId);
  }

  private assertMayReview(reviewer: Profile): void {
    if (!REVIEW_ROLES.has(reviewer.role)) {
      throw new ForbiddenError("Only admins and reviewers can approve or request edits.");
    }
  }

  private async buildAssetUrls(item: ContentItem): Promise<string[]> {
    // A carousel post has multiple slides (each its own output, in order). A
    // single image that was regenerated ALSO has multiple outputs — but those
    // are version history, not slides. Only fan out to every output for a real
    // carousel; otherwise publish just the cover (newest render, index 0), so a
    // regenerated single image never posts as a duplicate multi-photo carousel.
    const isCarousel = item.generationInputs.slides.length >= 2;
    const assets = isCarousel ? item.outputAssets : item.outputAssets.slice(0, 1);
    const urls = await Promise.all(
      assets.map((asset) =>
        signedUrl(this.storageClient, asset.bucket, asset.path, ASSET_URL_TTL_SECONDS),
      ),
    );
    return urls.filter((url): url is string => Boolean(url));
  }

  /**
   * Signs the optional custom video cover for a video item. Stored as a one-off
   * upload path on rawGenerationInputs.coverImagePath (brand-assets bucket), the
   * same way the avatar background image is. Null for images / when unset.
   */
  private async buildCoverUrl(item: ContentItem): Promise<string | null> {
    if (item.type === "image_post" || item.type === "copy_set") return null;
    const path = String(item.rawGenerationInputs.coverImagePath ?? "").trim();
    if (!path) return null;
    return signedUrl(this.storageClient, BUCKETS.brandAssets, path, ASSET_URL_TTL_SECONDS);
  }

  private toPublishPayload(
    item: ContentItem,
    assetUrls: string[],
    platform: ContentItem["platform"] = item.platform,
    coverUrl: string | null = null,
  ): PublishPayload {
    return {
      content_item_id: item.id,
      platform,
      brand: item.brand,
      brand_name: BRAND_NAMES[item.brand] ?? item.brand,
      type: item.type as Exclude<ContentItem["type"], "copy_set">,
      caption: item.caption ?? "",
      asset_urls: assetUrls,
      cover_url: coverUrl,
      scheduled_for: item.scheduledDate ? `${item.scheduledDate}T09:00:00Z` : null,
    };
  }
}
