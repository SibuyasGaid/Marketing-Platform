import { beforeEach, describe, expect, it, vi } from "vitest";

// completeHook's storage helpers are mocked so we can assert it never re-uploads
// on a retry. Only the pieces completeHook touches are provided.
vi.mock("@/lib/supabase/storage", () => ({
  BUCKETS: {
    generatedMedia: "generated-media",
    avatarReferences: "avatar-references",
    brandAssets: "brand-assets",
  },
  uploadToBucket: vi.fn(async () => {}),
  downloadFromBucket: vi.fn(),
  removeFromBucket: vi.fn(),
  signedUrl: vi.fn(),
}));

import { ContentProductionService } from "@/services/ContentProductionService";
import { uploadToBucket } from "@/lib/supabase/storage";
import type {
  ContentItem,
  ContentItemRepository,
  OutputAsset,
} from "@/repositories/ContentItemRepository";

const uploadMock = uploadToBucket as unknown as ReturnType<typeof vi.fn>;
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

function makeService(item: ContentItem, recordImpl?: () => Promise<void>) {
  const store = new Map([[item.id, item]]);
  const setOutputs = vi.fn(async (id: string, outputAssets: OutputAsset[]) => {
    store.set(id, { ...store.get(id)!, outputAssets });
  });
  const setGenerationInputs = vi.fn(async (id: string, gi: ContentItem["rawGenerationInputs"]) => {
    store.set(id, { ...store.get(id)!, rawGenerationInputs: gi });
  });
  const setStatus = vi.fn(async (id: string, status: ContentItem["status"]) => {
    const next = { ...store.get(id)!, status };
    store.set(id, next);
    return next;
  });
  const repo: Partial<ContentItemRepository> = {
    getById: async (id: string) => {
      const found = store.get(id);
      if (!found) throw new Error("not found");
      return found;
    },
    setOutputs,
    setGenerationInputs,
    setStatus,
  };
  const recordMediaUsage = vi.fn(recordImpl ?? (async () => {}));
  const usage = { recordMediaUsage };
  const n = null as never;
  const service = new ContentProductionService(
    repo as ContentItemRepository,
    n, n, n, n, n, n, n, n,
    usage as never,
    {} as never,
  );
  return { service, store, setOutputs, setGenerationInputs, recordMediaUsage };
}

function okFetch() {
  return vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
}

describe("completeHook idempotency", () => {
  beforeEach(() => {
    uploadMock.mockClear();
  });

  it("skips re-download/upload when the render is already stored (retry-safe)", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as never;
    const { service, setOutputs, recordMediaUsage } = makeService(
      makeItem({ outputAssets: [VIDEO] }),
    );

    await service.completeHook("id", { videoUrl: "http://x/v.mp4", durationSeconds: 10 });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(setOutputs).not.toHaveBeenCalled();
    expect(recordMediaUsage).toHaveBeenCalledTimes(1);
  });

  it("stores once and logs the cost once across a retry where the first log fails", async () => {
    const fetchSpy = okFetch();
    global.fetch = fetchSpy as never;
    let attempts = 0;
    const { service, store, setOutputs, recordMediaUsage } = makeService(
      makeItem({ outputAssets: [] }),
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient DB hiccup on the cost log");
      },
    );

    // First run: stores the render, then the cost log throws → step fails.
    await expect(service.completeHook("id", { videoUrl: "http://x/v.mp4" })).rejects.toThrow();
    // Retry: the render is already stored, so it must not re-fetch/upload, and it
    // logs the cost exactly once (the first attempt committed nothing).
    await service.completeHook("id", { videoUrl: "http://x/v.mp4" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(setOutputs).toHaveBeenCalledTimes(1);
    expect(recordMediaUsage).toHaveBeenCalledTimes(2); // one threw, one succeeded
    expect(store.get("id")!.rawGenerationInputs.studioReady).toBe(true);
  });
});
