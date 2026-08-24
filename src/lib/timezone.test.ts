import { describe, expect, it } from "vitest";
import { sydneyLocalToUtcIso, utcIsoToSydneyLocal } from "@/lib/timezone";

describe("timezone — Sydney scheduling", () => {
  it("converts winter (AEST, UTC+10) wall-clock to the right UTC instant", () => {
    // 29 Jul 2026 09:00 in Sydney (AEST) is 28 Jul 2026 23:00 UTC.
    expect(sydneyLocalToUtcIso("2026-07-29T09:00")).toBe("2026-07-28T23:00:00.000Z");
  });

  it("converts summer (AEDT, UTC+11) wall-clock to the right UTC instant", () => {
    // 15 Jan 2026 09:00 in Sydney (AEDT) is 14 Jan 2026 22:00 UTC.
    expect(sydneyLocalToUtcIso("2026-01-15T09:00")).toBe("2026-01-14T22:00:00.000Z");
  });

  it("round-trips UTC → Sydney local → UTC", () => {
    const utc = "2026-07-28T23:00:00.000Z";
    const local = utcIsoToSydneyLocal(utc); // "2026-07-29T09:00"
    expect(local).toBe("2026-07-29T09:00");
    expect(sydneyLocalToUtcIso(local)).toBe(utc);
  });

  it("rejects an unparseable value", () => {
    expect(sydneyLocalToUtcIso("not-a-date")).toBeNull();
  });
});
