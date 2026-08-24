import { describe, expect, it } from "vitest";
import { ContentProductionService } from "@/services/ContentProductionService";
import type {
  ContentItem,
  ContentItemRepository,
  OutputAsset,
} from "@/repositories/ContentItemRepository";

// The studio methods (move-to-queue, regenerate, fail-stuck) only touch
// contentRepo, so a Map-backed fake that reflects writes is enough to verify the
// approval-gate + studio-aware behavior without the full service graph.
const VIDEO: OutputAsset = { bucket: "generated-media", path: "id/1.mp4", mimeType: "video/mp4" };

function makeItem(overrides: Partial<ContentItem>): ContentItem {
  return {
    id: "id",
    type: "heygen_video",
    status: "draft",
    outputAssets: [],
    rawGenerationInputs: { studio: true, kind: "clip_video" },
    caption: "",
    targetPlatforms: ["instagram"],
    createdAt: new Date().toISOString(),
    createdBy: "user-1",
    ...overrides,
  } as ContentItem;
}

function makeService(items: ContentItem[]) {
  const store = new Map(items.map((item) => [item.id, item]));
  const repo: Partial<ContentItemRepository> = {
    listByType: async () => [...store.values()],
    getById: async (id: string) => {
      const found = store.get(id);
      if (!found) throw new Error("not found");
      return found;
    },
    setStatus: async (id, status) => {
      const next = { ...store.get(id)!, status };
      store.set(id, next);
      return next;
    },
    setCaption: async (id, caption) => {
      store.set(id, { ...store.get(id)!, caption });
    },
    setGenerationInputs: async (id, generationInputs) => {
      store.set(id, { ...store.get(id)!, rawGenerationInputs: generationInputs });
    },
    setOutputs: async (id, outputAssets) => {
      store.set(id, { ...store.get(id)!, outputAssets });
    },
  };
  const n = null as never;
  const service = new ContentProductionService(
    repo as ContentItemRepository,
    n, n, n, n, n, n, n, n, n, n,
  );
  return { service, store };
}

const HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();

describe("moveStudioVideoToQueue (approval gate)", () => {
  it("sends a ready studio video to pending_approval with the caption", async () => {
    const { service, store } = makeService([
      makeItem({ id: "ready", status: "draft", outputAssets: [VIDEO] }),
    ]);
    await service.moveStudioVideoToQueue("ready", "My caption");
    const item = store.get("ready")!;
    expect(item.status).toBe("pending_approval");
    expect(item.caption).toBe("My caption");
  });

  it("refuses a non-studio item", async () => {
    const { service } = makeService([
      makeItem({ id: "x", rawGenerationInputs: { kind: "clip_video" }, outputAssets: [VIDEO] }),
    ]);
    await expect(service.moveStudioVideoToQueue("x", "c")).rejects.toThrow();
  });

  it("refuses a video that hasn't rendered yet (no output)", async () => {
    const { service } = makeService([makeItem({ id: "pending", outputAssets: [] })]);
    await expect(service.moveStudioVideoToQueue("pending", "c")).rejects.toThrow();
  });
});

describe("resetStudioVideoForRegeneration", () => {
  it("clears the prior output + flags and returns the kind", async () => {
    const { service, store } = makeService([
      makeItem({
        id: "r",
        outputAssets: [VIDEO],
        rawGenerationInputs: { studio: true, kind: "clip_video", studioReady: true },
      }),
    ]);
    const kind = await service.resetStudioVideoForRegeneration("r");
    expect(kind).toBe("clip_video");
    const item = store.get("r")!;
    expect(item.outputAssets).toEqual([]);
    expect(item.rawGenerationInputs.studioReady).toBe(false);
    expect(item.rawGenerationInputs.studioError).toBeNull();
  });

  it("returns merged_video so regenerate routes to the merge pipeline, not avatar", async () => {
    const { service } = makeService([
      makeItem({
        id: "m",
        status: "draft",
        outputAssets: [],
        rawGenerationInputs: { studio: true, kind: "merged_video" },
      }),
    ]);
    expect(await service.resetStudioVideoForRegeneration("m")).toBe("merged_video");
  });
});

describe("failStuckVideos (studio-aware)", () => {
  it("records a studioError on a stuck studio video, keeping it draft", async () => {
    const { service, store } = makeService([
      makeItem({ id: "stuck", status: "draft", outputAssets: [], createdAt: HOUR_AGO }),
    ]);
    const result = await service.failStuckVideos(30);
    expect(result.failed).toBe(1);
    const item = store.get("stuck")!;
    expect(item.status).toBe("draft"); // studio videos hold as draft
    expect(typeof item.rawGenerationInputs.studioError).toBe("string");
  });

  it("skips a studio video that already failed (has studioError)", async () => {
    const { service } = makeService([
      makeItem({
        id: "done",
        outputAssets: [],
        createdAt: HOUR_AGO,
        rawGenerationInputs: { studio: true, kind: "clip_video", studioError: "already failed" },
      }),
    ]);
    const result = await service.failStuckVideos(30);
    expect(result.failed).toBe(0);
  });

  it("fails a stuck NON-studio hook to the failed status", async () => {
    const { service, store } = makeService([
      makeItem({
        id: "hook",
        status: "draft",
        outputAssets: [],
        createdAt: HOUR_AGO,
        rawGenerationInputs: { kind: "avatar_video" },
      }),
    ]);
    const result = await service.failStuckVideos(30);
    expect(result.failed).toBe(1);
    expect(store.get("hook")!.status).toBe("failed");
  });
});
