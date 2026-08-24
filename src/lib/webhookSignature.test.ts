import { describe, expect, it } from "vitest";
import { isFreshTimestamp, signPayload, verifySignature } from "@/lib/webhookSignature";

const SECRET = "shared-secret";
const BODY = JSON.stringify({ content_item_id: "abc", status: "posted" });

describe("webhook signatures", () => {
  it("verifies a signature it produced", () => {
    const ts = Date.now().toString();
    const signature = signPayload(SECRET, ts, BODY);
    expect(verifySignature(SECRET, ts, BODY, signature)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const ts = Date.now().toString();
    const signature = signPayload(SECRET, ts, BODY);
    const tampered = JSON.stringify({ content_item_id: "abc", status: "failed" });
    expect(verifySignature(SECRET, ts, tampered, signature)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const ts = Date.now().toString();
    const signature = signPayload("wrong-secret", ts, BODY);
    expect(verifySignature(SECRET, ts, BODY, signature)).toBe(false);
  });

  it("rejects a replayed signature paired with a new timestamp", () => {
    const originalTs = Date.now().toString();
    const signature = signPayload(SECRET, originalTs, BODY);
    const newTs = (Date.now() + 1000).toString();
    expect(verifySignature(SECRET, newTs, BODY, signature)).toBe(false);
  });

  it("rejects malformed signatures without throwing", () => {
    const ts = Date.now().toString();
    expect(verifySignature(SECRET, ts, BODY, "")).toBe(false);
    expect(verifySignature(SECRET, ts, BODY, "not-hex")).toBe(false);
  });

  it("accepts fresh timestamps and rejects stale ones", () => {
    const now = Date.now();
    expect(isFreshTimestamp(now.toString(), now)).toBe(true);
    expect(isFreshTimestamp((now - 60_000).toString(), now)).toBe(true);
    // Older than the 5-minute replay window.
    expect(isFreshTimestamp((now - 6 * 60_000).toString(), now)).toBe(false);
    // Far-future timestamps are equally suspect.
    expect(isFreshTimestamp((now + 6 * 60_000).toString(), now)).toBe(false);
    expect(isFreshTimestamp("not-a-number", now)).toBe(false);
  });
});
