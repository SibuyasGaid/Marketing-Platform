import { describe, expect, it } from "vitest";
import { parseSegments } from "./GeminiTranscriptionProvider";

describe("parseSegments (Gemini transcript output)", () => {
  it("maps snake_case segments to the domain shape", () => {
    const raw = JSON.stringify({ segments: [{ start_s: 0, end_s: 15.5, text: " Hello there " }] });
    expect(parseSegments(raw)).toEqual([{ startS: 0, endS: 15.5, text: "Hello there" }]);
  });

  it("accepts camelCase keys the model sometimes returns", () => {
    const raw = JSON.stringify({ segments: [{ startS: 3, endS: 9, text: "Hi" }] });
    expect(parseSegments(raw)).toEqual([{ startS: 3, endS: 9, text: "Hi" }]);
  });

  it("strips a markdown code fence around the JSON", () => {
    const raw = '```json\n{"segments":[{"start_s":1,"end_s":2,"text":"fenced"}]}\n```';
    expect(parseSegments(raw)).toEqual([{ startS: 1, endS: 2, text: "fenced" }]);
  });

  it("drops empty-text segments", () => {
    const raw = JSON.stringify({ segments: [{ start_s: 0, end_s: 1, text: "   " }, { start_s: 1, end_s: 2, text: "kept" }] });
    expect(parseSegments(raw)).toEqual([{ startS: 1, endS: 2, text: "kept" }]);
  });

  it("returns no segments for invalid JSON, so the provider fails the job", () => {
    expect(parseSegments("not json at all")).toEqual([]);
  });

  it("returns no segments when the shape is wrong instead of storing junk", () => {
    expect(parseSegments(JSON.stringify({ segments: "nope" }))).toEqual([]);
    expect(parseSegments(JSON.stringify({ segments: [{ text: 42 }] }))).toEqual([]);
  });
});
