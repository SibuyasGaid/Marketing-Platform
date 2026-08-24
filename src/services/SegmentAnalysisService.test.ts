import { describe, expect, it } from "vitest";
import { chunkSegments } from "@/services/SegmentAnalysisService";
import type { TranscriptSegment } from "@/providers/interfaces/TranscriptionProvider";

function segment(index: number, chars: number): TranscriptSegment {
  return { startS: index * 30, endS: index * 30 + 30, text: "x".repeat(chars) };
}

describe("chunkSegments", () => {
  it("keeps a short transcript in one chunk", () => {
    const segments = [segment(0, 500), segment(1, 500)];
    expect(chunkSegments(segments)).toHaveLength(1);
  });

  it("splits long transcripts and overlaps chunk boundaries", () => {
    // 30 segments × 2000 chars = 60k chars → multiple ~36k chunks
    const segments = Array.from({ length: 30 }, (_, index) => segment(index, 2000));
    const chunks = chunkSegments(segments);
    expect(chunks.length).toBeGreaterThan(1);
    // Overlap: last segments of chunk N reappear at the start of chunk N+1.
    const firstChunk = chunks[0];
    const secondChunk = chunks[1];
    expect(secondChunk[0]).toBe(firstChunk[firstChunk.length - 2]);
    // Every original segment is covered.
    const covered = new Set(chunks.flat());
    for (const original of segments) expect(covered.has(original)).toBe(true);
  });

  it("returns no chunks for an empty transcript", () => {
    expect(chunkSegments([])).toHaveLength(0);
  });
});
