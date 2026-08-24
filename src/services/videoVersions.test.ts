import { describe, expect, it } from "vitest";
import {
  isCaptionedOutput,
  isOriginalOutput,
  isOutroOutput,
} from "@/services/ContentProductionService";

/**
 * These path-based helpers are what keep captioning/outro/switch correct no
 * matter how output_assets is reordered (a switch flips positions). Identifying
 * the base render by path — never by array index — is what prevents a second
 * "regenerate captions" from double-burning or deleting the master.
 */
const asset = (path: string) => ({ bucket: "generated-media", path, mimeType: "video/mp4" });

describe("video version identification (by path)", () => {
  it("recognises a captioned derivative", () => {
    expect(isCaptionedOutput(asset("abc/captioned-1785829878765.mp4"))).toBe(true);
    expect(isCaptionedOutput(asset("abc/1785817314676.mp4"))).toBe(false);
    expect(isCaptionedOutput(asset("abc/outro-1785829878765.mp4"))).toBe(false);
  });

  it("recognises an outro derivative", () => {
    expect(isOutroOutput(asset("abc/outro-1785829878765.mp4"))).toBe(true);
    expect(isOutroOutput(asset("abc/captioned-1785829878765.mp4"))).toBe(false);
    expect(isOutroOutput(asset("abc/1785817314676.mp4"))).toBe(false);
  });

  it("treats a plain render as the original", () => {
    expect(isOriginalOutput(asset("abc/1785817314676.mp4"))).toBe(true);
    expect(isOriginalOutput(asset("abc/captioned-1785829878765.mp4"))).toBe(false);
    expect(isOriginalOutput(asset("abc/outro-1785829878765.mp4"))).toBe(false);
  });

  it("finds the original regardless of array order (post-switch safety)", () => {
    // After a "Use original" switch the array is [original, captioned]; after an
    // outro it can be [withOutro, captioned, original]. In both, exactly one is
    // the base render and it's found by path, not position.
    const swapped = [asset("x/1784.mp4"), asset("x/captioned-1785.mp4")];
    const withOutro = [
      asset("x/outro-1786.mp4"),
      asset("x/captioned-1785.mp4"),
      asset("x/1784.mp4"),
    ];
    expect(swapped.filter(isOriginalOutput)).toHaveLength(1);
    expect(swapped.find(isOriginalOutput)?.path).toBe("x/1784.mp4");
    expect(withOutro.filter(isOriginalOutput)).toHaveLength(1);
    expect(withOutro.find(isOriginalOutput)?.path).toBe("x/1784.mp4");
  });
});
