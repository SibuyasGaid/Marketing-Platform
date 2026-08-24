import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/domain";
import { ForbiddenError, InvalidTransitionError, ProviderError, ValidationError } from "@/lib/errors";
import type { ContentItem, ContentItemRepository } from "@/repositories/ContentItemRepository";
import type { ApprovalEvent, ApprovalEventRepository } from "@/repositories/ApprovalEventRepository";
import type { PublishPayload, PublishProvider } from "@/providers/interfaces/PublishProvider";
import { ContentApprovalService } from "@/services/ContentApprovalService";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "image_post",
    platform: "instagram",
    targetPlatforms: ["instagram"],
    brand: "demo_brand",
    status: "pending_approval",
    title: null,
    caption: "Caption",
    generationInputs: {
      prompt: "",
      designNote: "",
      brandPresetId: "",
      avatarReferenceIds: [],
      brandReferenceIds: [],
      referenceImagePaths: [],
      personImagePaths: [],
      slides: [],
      slideDesignNotes: [],
      logoSlideIndexes: [],
      pendingSlideRegen: [],
      adjustmentNotes: [],
      pendingEdit: null,
      pendingEditMaskPath: null,
      editHistory: [],
    },
    rawGenerationInputs: {},
    outputAssets: [{ bucket: "brand-assets", path: "a/b.png", mimeType: "image/png" }],
    editComment: null,
    scheduledDate: null,
    scheduledFor: null,
    sourceVideoId: null,
    brandPresetId: null,
    platformPostUrl: null,
    createdBy: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

class FakeContentRepo {
  item: ContentItem = makeItem();
  editComment: string | null = null;

  async getById(): Promise<ContentItem> {
    return this.item;
  }
  async setStatusIfCurrent(
    _id: string,
    from: ContentItem["status"],
    to: ContentItem["status"],
  ): Promise<ContentItem | null> {
    if (this.item.status !== from) return null;
    this.item = { ...this.item, status: to };
    return this.item;
  }
  async setEditComment(_id: string, comment: string | null): Promise<void> {
    this.editComment = comment;
  }
  async setPlatformPostUrl(_id: string, url: string | null): Promise<void> {
    this.item = { ...this.item, platformPostUrl: url };
  }
  async setScheduledFor(_id: string, scheduledFor: string | null): Promise<void> {
    this.item = { ...this.item, scheduledFor };
  }
  async setScheduledDate(_id: string, scheduledDate: string | null): Promise<void> {
    this.item = { ...this.item, scheduledDate };
  }
  async setTargetPlatforms(_id: string, platforms: ContentItem["targetPlatforms"]): Promise<void> {
    this.item = { ...this.item, targetPlatforms: platforms };
  }
  async setGenerationInputs(_id: string, inputs: Record<string, unknown>): Promise<void> {
    this.item = { ...this.item, rawGenerationInputs: inputs };
  }
  async listDueScheduled(nowIso: string): Promise<ContentItem[]> {
    return this.item.status === "scheduled" &&
      this.item.scheduledFor !== null &&
      this.item.scheduledFor <= nowIso
      ? [this.item]
      : [];
  }
}

class FakeApprovalRepo {
  events: Array<{ action: string; comment?: string | null; reviewerId: string }> = [];
  /** Simulates the DB state independently of what the caller claims. */
  approvalExists = false;

  async record(input: {
    action: string;
    comment?: string | null;
    reviewerId: string;
  }): Promise<ApprovalEvent> {
    this.events.push(input);
    if (input.action === "approved") this.approvalExists = true;
    return {
      id: "e1",
      contentItemId: "x",
      reviewerId: input.reviewerId,
      reviewerEmail: null,
      action: input.action as ApprovalEvent["action"],
      comment: input.comment ?? null,
      createdAt: new Date().toISOString(),
    };
  }
  async hasApprovalFor(): Promise<boolean> {
    return this.approvalExists;
  }
  async listByItem(): Promise<ApprovalEvent[]> {
    return [];
  }
}

class FakePublisher implements PublishProvider {
  dispatched: PublishPayload[] = [];
  error: Error | null = null;
  /** When true, dispatch reports a synchronous publish (direct providers). */
  posted = false;

  async dispatch(payload: PublishPayload) {
    if (this.error) throw this.error;
    this.dispatched.push(payload);
    return this.posted
      ? { dispatchId: "d1", posted: true, postUrl: "https://post.example/1" }
      : { dispatchId: "d1" };
  }
}

const fakeStorage = {
  storage: {
    from: () => ({
      createSignedUrl: async () => ({ data: { signedUrl: "https://signed.example/a.png" }, error: null }),
    }),
  },
} as unknown as SupabaseClient;

const admin: Profile = { id: "u-admin", email: "a@x.com", displayName: null, role: "admin" };
const reviewer: Profile = { id: "u-rev", email: "r@x.com", displayName: null, role: "reviewer" };
const editor: Profile = { id: "u-ed", email: "e@x.com", displayName: null, role: "editor" };

let contentRepo: FakeContentRepo;
let approvalRepo: FakeApprovalRepo;
let publisher: FakePublisher;
let sentEvents: string[];
let service: ContentApprovalService;

beforeEach(() => {
  contentRepo = new FakeContentRepo();
  approvalRepo = new FakeApprovalRepo();
  publisher = new FakePublisher();
  sentEvents = [];
  service = new ContentApprovalService(
    contentRepo as unknown as ContentItemRepository,
    approvalRepo as unknown as ApprovalEventRepository,
    publisher,
    fakeStorage,
    async (event) => {
      sentEvents.push(event.name);
    },
  );
});

describe("ContentApprovalService — approve", () => {
  it("records an audit event and moves the item to approved", async () => {
    const result = await service.approve(contentRepo.item.id, reviewer);
    expect(result.status).toBe("approved");
    expect(approvalRepo.events).toEqual([
      { contentItemId: contentRepo.item.id, reviewerId: "u-rev", action: "approved" },
    ]);
    expect(sentEvents).toEqual(["content/approved"]);
  });

  it("refuses roles other than admin/reviewer", async () => {
    await expect(service.approve(contentRepo.item.id, editor)).rejects.toThrow(ForbiddenError);
    expect(approvalRepo.events).toHaveLength(0);
    expect(contentRepo.item.status).toBe("pending_approval");
  });

  it("refuses to approve an item that is not pending approval", async () => {
    contentRepo.item = makeItem({ status: "posted" });
    await expect(service.approve(contentRepo.item.id, admin)).rejects.toThrow(
      InvalidTransitionError,
    );
    expect(approvalRepo.events).toHaveLength(0);
  });

  it("a second concurrent approval does not double-dispatch", async () => {
    await service.approve(contentRepo.item.id, admin);
    // The row is now `approved`; a racing second click must fail the transition.
    await expect(service.approve(contentRepo.item.id, admin)).rejects.toThrow(
      InvalidTransitionError,
    );
    expect(sentEvents).toEqual(["content/approved"]);
  });
});

describe("ContentApprovalService — scheduling", () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60 * 1000).toISOString();

  it("holds an item as scheduled and does NOT dispatch when given a future time", async () => {
    const result = await service.approve(contentRepo.item.id, admin, future);
    expect(result.status).toBe("scheduled");
    expect(contentRepo.item.scheduledFor).toBe(future);
    // An approval event is still recorded — scheduling never bypasses the gate.
    expect(approvalRepo.approvalExists).toBe(true);
    // Nothing publishes yet.
    expect(sentEvents).toEqual([]);
  });

  it("treats a past/now schedule time as publish-now", async () => {
    const result = await service.approve(contentRepo.item.id, admin, past);
    expect(result.status).toBe("approved");
    expect(sentEvents).toEqual(["content/approved"]);
  });

  it("the cron dispatches a due scheduled item exactly once", async () => {
    await service.approve(contentRepo.item.id, admin, future);
    // Force it due.
    contentRepo.item = { ...contentRepo.item, scheduledFor: past };

    const first = await service.dispatchDueScheduled();
    expect(first.dispatched).toBe(1);
    expect(contentRepo.item.status).toBe("approved");
    expect(contentRepo.item.scheduledFor).toBeNull();
    expect(sentEvents).toEqual(["content/approved"]);

    // A second cron pass finds nothing due (already moved off `scheduled`).
    const second = await service.dispatchDueScheduled();
    expect(second.dispatched).toBe(0);
    expect(sentEvents).toEqual(["content/approved"]);
  });

  it("cancelling a schedule returns the item to the queue for re-approval", async () => {
    await service.approve(contentRepo.item.id, admin, future);
    const result = await service.cancelSchedule(contentRepo.item.id, admin);
    expect(result.status).toBe("pending_approval");
    expect(contentRepo.item.scheduledFor).toBeNull();
    // No publish happened.
    expect(sentEvents).toEqual([]);
  });
});

describe("ContentApprovalService — the publish gate", () => {
  it("dispatches only after a real approval was recorded", async () => {
    await service.approve(contentRepo.item.id, admin);
    const outcome = await service.dispatchApproved(contentRepo.item.id);
    expect(outcome).toEqual({ status: "dispatched", dispatchId: "d1" });
    expect(publisher.dispatched).toHaveLength(1);
    expect(publisher.dispatched[0]).toMatchObject({
      content_item_id: contentRepo.item.id,
      platform: "instagram",
      type: "image_post",
      asset_urls: ["https://signed.example/a.png"],
    });
    expect(contentRepo.item.status).toBe("publishing");
  });

  it("fans one post out to every target platform on approval", async () => {
    contentRepo.item = makeItem({
      status: "approved",
      platform: "instagram",
      targetPlatforms: ["instagram", "facebook", "linkedin"],
    });
    approvalRepo.approvalExists = true;

    await service.dispatchApproved(contentRepo.item.id);
    // One post → three dispatches, one per target platform, same asset each.
    expect(publisher.dispatched).toHaveLength(3);
    expect(publisher.dispatched.map((p) => p.platform)).toEqual([
      "instagram",
      "facebook",
      "linkedin",
    ]);
    expect(publisher.dispatched.every((p) => p.content_item_id === contentRepo.item.id)).toBe(true);
  });

  it("publishes a regenerated single image as ONE photo, not a duplicate carousel", async () => {
    // Regeneration keeps prior renders as version history in output_assets.
    // Publishing must send only the cover for a non-carousel item.
    contentRepo.item = makeItem({
      status: "approved",
      outputAssets: [
        { bucket: "brand-assets", path: "new.png", mimeType: "image/png" },
        { bucket: "brand-assets", path: "old.png", mimeType: "image/png" },
      ],
    });
    approvalRepo.approvalExists = true;

    await service.dispatchApproved(contentRepo.item.id);
    expect(publisher.dispatched[0].asset_urls).toHaveLength(1);
  });

  it("publishes a real carousel with every slide", async () => {
    contentRepo.item = makeItem({
      status: "approved",
      generationInputs: { ...makeItem().generationInputs, slides: ["a", "b", "c"] },
      outputAssets: [
        { bucket: "brand-assets", path: "s0.png", mimeType: "image/png" },
        { bucket: "brand-assets", path: "s1.png", mimeType: "image/png" },
        { bucket: "brand-assets", path: "s2.png", mimeType: "image/png" },
      ],
    });
    approvalRepo.approvalExists = true;

    await service.dispatchApproved(contentRepo.item.id);
    expect(publisher.dispatched[0].asset_urls).toHaveLength(3);
  });

  it("BYPASS ATTEMPT: status forced to approved without an approval event never publishes", async () => {
    // Simulates a direct DB/PostgREST write flipping status without going
    // through the service — the audit row is missing.
    contentRepo.item = makeItem({ status: "approved" });
    approvalRepo.approvalExists = false;

    await expect(service.dispatchApproved(contentRepo.item.id)).rejects.toThrow(ForbiddenError);
    expect(publisher.dispatched).toHaveLength(0);
    expect(contentRepo.item.status).toBe("approved");
  });

  it("BYPASS ATTEMPT: a forged content/approved event for a pending item never publishes", async () => {
    contentRepo.item = makeItem({ status: "pending_approval" });
    const outcome = await service.dispatchApproved(contentRepo.item.id);
    expect(outcome).toEqual({ status: "already_handled" });
    expect(publisher.dispatched).toHaveLength(0);
  });

  it("does not dispatch copy sets to socials", async () => {
    contentRepo.item = makeItem({ type: "copy_set", status: "approved" });
    approvalRepo.approvalExists = true;
    const outcome = await service.dispatchApproved(contentRepo.item.id);
    expect(outcome.status).toBe("skipped");
    expect(publisher.dispatched).toHaveLength(0);
  });

  it("does not dispatch an item with no generated asset", async () => {
    contentRepo.item = makeItem({ status: "approved", outputAssets: [] });
    approvalRepo.approvalExists = true;
    const outcome = await service.dispatchApproved(contentRepo.item.id);
    expect(outcome.status).toBe("skipped");
    expect(publisher.dispatched).toHaveLength(0);
  });

  it("marks the item failed when dispatch fails non-retryably", async () => {
    await service.approve(contentRepo.item.id, admin);
    publisher.error = new ProviderError("n8n", "bad request", false);
    await expect(service.dispatchApproved(contentRepo.item.id)).rejects.toThrow(ProviderError);
    expect(contentRepo.item.status).toBe("failed");
  });

  it("leaves the item publishing when dispatch fails retryably", async () => {
    await service.approve(contentRepo.item.id, admin);
    publisher.error = new ProviderError("n8n", "server error", true);
    await expect(service.dispatchApproved(contentRepo.item.id)).rejects.toThrow(ProviderError);
    expect(contentRepo.item.status).toBe("publishing");
  });
});

describe("ContentApprovalService — request edits", () => {
  it("records the comment, attaches it to the item, and queues regeneration", async () => {
    await service.requestEdits(contentRepo.item.id, reviewer, "  Make the headline bigger  ");
    expect(contentRepo.item.status).toBe("edits_requested");
    expect(contentRepo.editComment).toBe("Make the headline bigger");
    expect(approvalRepo.events[0]).toMatchObject({
      action: "edits_requested",
      comment: "Make the headline bigger",
    });
    expect(sentEvents).toEqual(["content/edits-requested"]);
  });

  it("requires a non-empty comment", async () => {
    await expect(service.requestEdits(contentRepo.item.id, admin, "   ")).rejects.toThrow(
      ValidationError,
    );
    expect(contentRepo.item.status).toBe("pending_approval");
  });

  it("refuses roles other than admin/reviewer", async () => {
    await expect(service.requestEdits(contentRepo.item.id, editor, "change it")).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("ContentApprovalService — retry", () => {
  it("returns a failed item to the queue for re-approval", async () => {
    contentRepo.item = makeItem({ status: "failed", editComment: "old note" });
    const result = await service.retryFailed(contentRepo.item.id, admin);
    expect(result.status).toBe("pending_approval");
    // Retry clears the stale edit note so the drawer reads clean.
    expect(contentRepo.editComment).toBeNull();
  });

  it("does not let a retry skip the gate — it never publishes directly", async () => {
    contentRepo.item = makeItem({ status: "failed" });
    await service.retryFailed(contentRepo.item.id, reviewer);
    // Status is pending_approval, not approved — dispatch is still gated.
    expect(contentRepo.item.status).toBe("pending_approval");
    expect(publisher.dispatched).toHaveLength(0);
  });

  it("refuses retry from non-review roles", async () => {
    contentRepo.item = makeItem({ status: "failed" });
    await expect(service.retryFailed(contentRepo.item.id, editor)).rejects.toThrow(ForbiddenError);
  });
});

describe("ContentApprovalService — publish callbacks", () => {
  it("marks posted from publishing", async () => {
    contentRepo.item = makeItem({ status: "publishing" });
    await service.markPosted(contentRepo.item.id);
    expect(contentRepo.item.status).toBe("posted");
  });

  it("is idempotent when the callback arrives twice", async () => {
    contentRepo.item = makeItem({ status: "posted" });
    await expect(service.markPosted(contentRepo.item.id)).resolves.toBeUndefined();
    expect(contentRepo.item.status).toBe("posted");
  });

  it("marks failed from publishing", async () => {
    contentRepo.item = makeItem({ status: "publishing" });
    await service.markFailed(contentRepo.item.id);
    expect(contentRepo.item.status).toBe("failed");
  });
});

describe("ContentApprovalService — repost to more platforms", () => {
  it("reposts only to new platforms and accumulates target + posted platforms", async () => {
    contentRepo.item = makeItem({
      status: "posted",
      targetPlatforms: ["instagram"],
      rawGenerationInputs: { postedPlatforms: ["instagram"] },
    });
    approvalRepo.approvalExists = true;
    publisher.posted = true;

    const outcome = await service.repostToPlatforms(contentRepo.item.id, [
      "instagram", // already posted → skipped (no duplicate)
      "facebook",
      "linkedin",
    ]);

    expect(outcome.status).toBe("dispatched");
    // Only the two NEW platforms were dispatched, never the already-live one.
    expect(publisher.dispatched.map((p) => p.platform)).toEqual(["facebook", "linkedin"]);
    // Both new platforms persist (not last-wins).
    expect(contentRepo.item.targetPlatforms).toEqual(["instagram", "facebook", "linkedin"]);
    expect(contentRepo.item.rawGenerationInputs.postedPlatforms).toEqual([
      "instagram",
      "facebook",
      "linkedin",
    ]);
  });

  it("refuses to repost when no approval event exists (the gate)", async () => {
    contentRepo.item = makeItem({
      status: "posted",
      targetPlatforms: ["instagram"],
      rawGenerationInputs: { postedPlatforms: ["instagram"] },
    });
    approvalRepo.approvalExists = false;
    publisher.posted = true;

    await expect(
      service.repostToPlatforms(contentRepo.item.id, ["facebook"]),
    ).rejects.toThrow(ForbiddenError);
    expect(publisher.dispatched).toHaveLength(0);
  });

  it("skips when the item is not posted", async () => {
    contentRepo.item = makeItem({ status: "pending_approval", targetPlatforms: ["instagram"] });
    approvalRepo.approvalExists = true;
    const outcome = await service.repostToPlatforms(contentRepo.item.id, ["facebook"]);
    expect(outcome.status).toBe("skipped");
    expect(publisher.dispatched).toHaveLength(0);
  });

  it("does nothing when every requested platform is already posted", async () => {
    contentRepo.item = makeItem({
      status: "posted",
      targetPlatforms: ["instagram", "facebook"],
      rawGenerationInputs: { postedPlatforms: ["instagram", "facebook"] },
    });
    approvalRepo.approvalExists = true;
    publisher.posted = true;
    const outcome = await service.repostToPlatforms(contentRepo.item.id, ["instagram", "facebook"]);
    expect(outcome.status).toBe("skipped");
    expect(publisher.dispatched).toHaveLength(0);
  });
});
