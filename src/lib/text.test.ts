import { describe, expect, it } from "vitest";
import { stripEmDashes, stripEmDashesDeep } from "@/lib/text";

describe("stripEmDashes", () => {
  it("replaces spaced em dashes with a hyphen", () => {
    expect(stripEmDashes("Build a real agency — not another course")).toBe(
      "Build a real agency - not another course",
    );
  });

  it("replaces unspaced em dashes", () => {
    expect(stripEmDashes("word—word")).toBe("word - word");
  });

  it("replaces en dashes too", () => {
    expect(stripEmDashes("2020–2024 growth")).toBe("2020 - 2024 growth");
  });

  it("leaves ordinary hyphens and text untouched", () => {
    expect(stripEmDashes("client-onboarding, done right.")).toBe(
      "client-onboarding, done right.",
    );
  });

  it("collapses doubled spaces the replacement could create", () => {
    expect(stripEmDashes("a  —  b")).toBe("a - b");
  });
});

describe("stripEmDashesDeep", () => {
  it("strips em dashes across every string field in a copy object", () => {
    const copy = {
      instagram_caption: "Doors open — enroll now",
      youtube: { title: "Systems — that scale", tags: ["a — b", "c"] },
      email: { subject: "Read this", body: "No dashes here" },
    };
    const cleaned = stripEmDashesDeep(copy);
    expect(cleaned.instagram_caption).toBe("Doors open - enroll now");
    expect(cleaned.youtube.title).toBe("Systems - that scale");
    expect(cleaned.youtube.tags).toEqual(["a - b", "c"]);
    expect(cleaned.email.body).toBe("No dashes here");
  });
});
