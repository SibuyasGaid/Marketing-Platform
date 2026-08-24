import { describe, expect, it } from "vitest";
import { ONEOFF_REFERENCE_PREFIX, isOneoffReferencePath } from "@/lib/supabase/storage";

describe("isOneoffReferencePath", () => {
  it("accepts server-generated one-off paths", () => {
    expect(
      isOneoffReferencePath(`${ONEOFF_REFERENCE_PREFIX}0f524b91-5f45-4a58-820c-cadcfb992686.png`),
    ).toBe(true);
    expect(isOneoffReferencePath(`${ONEOFF_REFERENCE_PREFIX}abc123.jpg`)).toBe(true);
    expect(isOneoffReferencePath(`${ONEOFF_REFERENCE_PREFIX}abc123.jpeg`)).toBe(true);
    expect(isOneoffReferencePath(`${ONEOFF_REFERENCE_PREFIX}abc123.webp`)).toBe(true);
  });

  it("rejects paths that escape the one-off prefix (path-injection defense)", () => {
    // The whole point: a client-supplied arbitrary storage path must not be
    // downloadable and leaked into a render.
    expect(isOneoffReferencePath("references/library/secret.png")).toBe(false);
    expect(isOneoffReferencePath("avatar-references/alex/1.png")).toBe(false);
    expect(isOneoffReferencePath("../references/oneoff/x.png")).toBe(false);
    expect(isOneoffReferencePath("references/oneoff/../../etc/passwd")).toBe(false);
    expect(isOneoffReferencePath("references/oneoff/x.svg")).toBe(false);
    expect(isOneoffReferencePath("references/oneoff/x.png/extra")).toBe(false);
    expect(isOneoffReferencePath("")).toBe(false);
  });
});
