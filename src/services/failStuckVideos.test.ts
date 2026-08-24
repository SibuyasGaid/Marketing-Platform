import { describe, expect, it } from "vitest";
import { ContentProductionService } from "@/services/ContentProductionService";
import type { ContentItem, ContentItemRepository } from "@/repositories/ContentItemRepository";

// failStuckVideos + failHook only touch contentRepo, so a partial fake is enough.
function makeItem(overrides: Partial<ContentItem>): ContentItem {
  return {
    id: "id",
    type: "heygen_video",
    status: "draft",
    outputAssets: [],
    rawGenerationInputs: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  } as ContentItem;
}

function makeService(items: ContentItem[]) {
  const statusWrites: Array<{ id: string; status: string }> = [];
  const repo: Partial<ContentItemRepository> = {
    listByType: async () => items,
    getById: async (id: string) => {
      const found = items.find((i) => i.id === id);
      if (!found) throw new Error("not found");
      return found;
    },
    setStatus: async (id: string, status) => {
      statusWrites.push({ id, status });
      return makeItem({ id, status });
    },
  };
  const n = null as never;
  const service = new ContentProductionService(repo as ContentItemRepository, n, n, n, n, n, n, n, n, n, n);
  return { service, statusWrites };
}

const HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const NOW = new Date().toISOString();

describe("ContentProductionService.failStuckVideos", () => {
  it("marks an old draft with no output as failed", async () => {
    const { service, statusWrites } = makeService([
      makeItem({ id: "stuck", status: "draft", outputAssets: [], createdAt: HOUR_AGO }),
    ]);
    const result = await service.failStuckVideos(30);
    expect(result.failed).toBe(1);
    expect(statusWrites).toEqual([{ id: "stuck", status: "failed" }]);
  });

  it("spares a render still inside its poll window", async () => {
    const { service, statusWrites } = makeService([
      makeItem({ id: "inflight", status: "draft", outputAssets: [], createdAt: NOW }),
    ]);
    const result = await service.failStuckVideos(30);
    expect(result.failed).toBe(0);
    expect(statusWrites).toEqual([]);
  });

  it("never touches an item that already produced output", async () => {
    const { service, statusWrites } = makeService([
      makeItem({
        id: "done",
        status: "draft",
        outputAssets: [
          { bucket: "renders", path: "done/base.mp4", mimeType: "video/mp4" },
        ],
        createdAt: HOUR_AGO,
      }),
    ]);
    const result = await service.failStuckVideos(30);
    expect(result.failed).toBe(0);
    expect(statusWrites).toEqual([]);
  });
});
