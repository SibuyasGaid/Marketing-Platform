import { describe, expect, it } from "vitest";
import { parseSrt, segmentsToSrt, srtToStyledAss } from "@/lib/captions";

const SAMPLE_SRT = `1
00:00:00,000 --> 00:00:01,500
hit yet is less

2
00:00:01,500 --> 00:00:03,250
than you think
`;

describe("parseSrt", () => {
  it("parses cues with times in centiseconds and joined text", () => {
    const cues = parseSrt(SAMPLE_SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ startCs: 0, endCs: 150, text: "hit yet is less" });
    expect(cues[1]).toEqual({ startCs: 150, endCs: 325, text: "than you think" });
  });

  it("tolerates CRLF line endings and missing trailing newline", () => {
    const crlf = "1\r\n00:00:02,000 --> 00:00:04,000\r\nhello world";
    const cues = parseSrt(crlf);
    expect(cues).toEqual([{ startCs: 200, endCs: 400, text: "hello world" }]);
  });

  it("joins multi-line cue text into one line", () => {
    const multi = "1\n00:00:00,000 --> 00:00:02,000\nfirst line\nsecond line";
    expect(parseSrt(multi)[0].text).toBe("first line second line");
  });

  it("skips blocks with no timing line", () => {
    expect(parseSrt("just some text\n\nmore text")).toEqual([]);
  });
});

describe("srtToStyledAss", () => {
  it("emits a styled ASS document with a bottom-centered bold caption style", () => {
    const ass = srtToStyledAss(SAMPLE_SRT);
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("Style: Caption,Montserrat");
    // Bold flag (-1) present in the style line.
    expect(ass).toMatch(/Style: Caption,Montserrat,\d+,[^\n]*,-1,/);
    expect(ass).toContain("[Events]");
  });

  it("emits one Dialogue line per cue with ASS timestamps", () => {
    const ass = srtToStyledAss(SAMPLE_SRT);
    const dialogues = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));
    expect(dialogues).toHaveLength(2);
    expect(dialogues[0]).toContain("0:00:00.00,0:00:01.50");
    expect(dialogues[0]).toContain("hit yet is less");
  });

  it("escapes braces so caption text can't inject ASS override tags", () => {
    const srt = "1\n00:00:00,000 --> 00:00:01,000\nuse {bold} now";
    const ass = srtToStyledAss(srt);
    expect(ass).toContain("use \\{bold\\} now");
  });

  it("produces no Dialogue lines for empty input", () => {
    const ass = srtToStyledAss("");
    expect(ass.split("\n").filter((line) => line.startsWith("Dialogue:"))).toHaveLength(0);
  });
});

describe("segmentsToSrt", () => {
  it("splits a long segment into short cues of at most maxWords words", () => {
    const srt = segmentsToSrt(
      [{ startS: 0, endS: 10, text: "one two three four five six seven eight" }],
      5,
    );
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("one two three four five");
    expect(cues[1].text).toBe("six seven eight");
  });

  it("apportions cue times across the segment span", () => {
    const srt = segmentsToSrt([{ startS: 0, endS: 10, text: "one two three four five six" }], 3);
    const cues = parseSrt(srt);
    // 6 words over 10s -> ~1.667s/word; first 3 words = 0..5s, next 3 = 5..10s.
    expect(cues[0].startCs).toBe(0);
    expect(cues[0].endCs).toBe(500);
    expect(cues[1].startCs).toBe(500);
    expect(cues[1].endCs).toBe(1000);
  });

  it("skips empty segments and produces valid sequential SRT", () => {
    const srt = segmentsToSrt([
      { startS: 0, endS: 2, text: "hello world" },
      { startS: 2, endS: 3, text: "   " },
    ]);
    expect(srt).toContain("1\n");
    expect(parseSrt(srt)).toHaveLength(1);
  });

  it("returns an empty string for no segments", () => {
    expect(segmentsToSrt([])).toBe("");
  });

  it("skips segments with non-finite or inverted timing (would never display)", () => {
    const srt = segmentsToSrt([
      { startS: Number.NaN, endS: Number.NaN, text: "broken timing" },
      { startS: 5, endS: 2, text: "inverted" },
      { startS: -1, endS: 2, text: "negative start" },
      { startS: 0, endS: 2, text: "good one" },
    ]);
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("good one");
    expect(srt).not.toContain("NaN");
  });
});
