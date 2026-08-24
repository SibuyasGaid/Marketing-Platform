import { createHmac, timingSafeEqual } from "node:crypto";
import { webhookMaxAgeMs } from "@/lib/config";

/**
 * Shared HMAC-SHA256 scheme for both directions of the n8n integration
 * (docs/SECURITY.md §5). The timestamp is signed together with the body so a
 * captured request cannot be replayed with a fresh timestamp.
 *
 * Headers: `x-timestamp` (epoch ms) + `x-signature` (hex digest of
 * "<timestamp>.<rawBody>").
 */
export const SIGNATURE_HEADER = "x-signature";
export const TIMESTAMP_HEADER = "x-timestamp";

export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/** Constant-time compare; length mismatch is rejected without leaking timing. */
export function verifySignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  candidateSignature: string,
): boolean {
  const expected = Buffer.from(signPayload(secret, timestamp, rawBody), "utf8");
  const candidate = Buffer.from(candidateSignature, "utf8");
  if (expected.length !== candidate.length) return false;
  return timingSafeEqual(expected, candidate);
}

/** Rejects stale timestamps (>5 min by config) to block replays. */
export function isFreshTimestamp(timestamp: string, now: number = Date.now()): boolean {
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed)) return false;
  return Math.abs(now - parsed) <= webhookMaxAgeMs;
}
