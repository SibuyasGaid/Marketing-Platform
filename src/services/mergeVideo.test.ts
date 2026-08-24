import { beforeEach, describe, expect, it, vi } from "vitest";

// Storage helpers are mocked: signedUrl echoes the path (so we can assert order),
// upload/remove are spies. Only what mergeVideo touches is provided.
vi.mock("@/lib/supabase/storage", () => ({
  BUCKETS: { generatedMedia: "generated-media" },
  signedUrl: vi.fn(async (_client: unknown, bucket: string, path: string) => `signed:${bucket}/${path}`),
  uploadToBucket: vi.fn(async () => {}),
  removeFromBucket: vi.fn(async () => {}),
}));

import { ContentProductionService } from "@/services/ContentProductionService";
import { removeFromBucket, uploadToBucket } from "@/lib/supabase/storage";
import type { ContentItem, ContentItemRepository } from "@/repositories/ContentItemRepository";
import type { VideoClipProvider } from "@/providers/interfaces/VideoClipProvider";
import type { UsageService } from "@/services/UsageService";

const uploadMock = vi.mocked(uploadToBucket);
const removeMock = vi.mocked(removeFromBucket);

function makeItem(sources: { bucket: string; path: string; cleanup: boolean }[]): ContentItem {
  return {
    id: "merge-1",
    type: "heygen_video",
    status: "draft",
    outputAssets: [],
    rawGenerationInputs: { kind: "merged_video", studio: true, sources },
    caption: "",
    targetPlatforms: ["instagram"],
    createdAt: new Date().toISOString(),
    createdBy: "user-1",
  } as unknown as ContentItem;
}

function makeService(item: ContentItem) {
  const store = new Map([[item.id, item]]);
  const setOutputs = vi.fn(async (id: string, outputAssets: ContentItem["outputAssets"]) => {
    store.set(id, { ...store.get(id)!, outputAssets });
  });
  const setGenerationInputs = vi.fn(async (id: string, gi: ContentItem["rawGenerationInputs"]) => {
    store.set(id, { ...store.get(id)!, rawGenerationInputs: gi });
  });
  const repo: Partial<ContentItemRepository> = {
    getById: async (id: string) => {
      const found = store.get(id);
      if (!found) throw new Error("not found");
      return found;
    },
    setOutputs,
    setGenerationInputs,
  };
  const mergeClips = vi.fn(async (_input: { sourceUrls: string[] }) => ({
    bytes: Buffer.from("merged"),
    mimeType: "video/mp4",
  }));
  const clip = { mergeClips } as unknown as VideoClipProvider;
  const recordMediaUsage = vi.fn(async () => {});
  const usage = { recordMediaUsage } as unknown as UsageService;
  const n = null as never;
  const service = new ContentProductionService(
    repo as ContentItemRepository,
    n, n, n, n, n, n,
    clip,
    n,
    usage,
    {} as never,
  );
  return { service, store, setOutputs, mergeClips, recordMediaUsage };
}

describe("ContentProductionService.mergeVideo", () => {
  beforeEach(() => {
    uploadMock.mockClear();
    removeMock.mockClear();
  });

  it("merges sources in order, marks ready (stays draft), logs no usage", async () => {
    const { service, store, setOutputs, mergeClips, recordMediaUsage } = makeService(
      makeItem([
        { bucket: "generated-media", path: "a/1.mp4", cleanup: false },
        { bucket: "generated-media", path: "merge-sources/x.mp4", cleanup: true },
      ]),
    );

    await service.mergeVideo("merge-1");

    // Order preserved into the ffmpeg merge.
    expect(mergeClips).toHaveBeenCalledTimes(1);
    expect(mergeClips.mock.calls[0][0]).toEqual({
      sourceUrls: ["signed:generated-media/a/1.mp4", "signed:generated-media/merge-sources/x.mp4"],
    });
    // Output stored + item marked ready, still draft.
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(setOutputs).toHaveBeenCalledTimes(1);
    const item = store.get("merge-1")!;
    expect(item.status).toBe("draft");
    expect(item.rawGenerationInputs.studioReady).toBe(true);
    // Pure ffmpeg — never bills usage.
    expect(recordMediaUsage).not.toHaveBeenCalled();
  });

  it("deletes only the uploaded sources afterward (never library ones)", async () => {
    const { service } = makeService(
      makeItem([
        { bucket: "generated-media", path: "a/1.mp4", cleanup: false },
        { bucket: "generated-media", path: "merge-sources/x.mp4", cleanup: true },
        { bucket: "generated-media", path: "merge-sources/y.mp4", cleanup: true },
      ]),
    );

    await service.mergeVideo("merge-1");

    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(removeMock.mock.calls[0][2]).toEqual(["merge-sources/x.mp4", "merge-sources/y.mp4"]);
  });

  it("refuses a merge with fewer than two sources", async () => {
    const { service } = makeService(
      makeItem([{ bucket: "generated-media", path: "a/1.mp4", cleanup: false }]),
    );
    await expect(service.mergeVideo("merge-1")).rejects.toThrow();
  });
});
