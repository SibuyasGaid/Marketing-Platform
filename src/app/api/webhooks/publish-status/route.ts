import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/lib/config";
import { getContentApprovalService } from "@/lib/container";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  isFreshTimestamp,
  verifySignature,
} from "@/lib/webhookSignature";

/**
 * n8n publish-status callback (PROJECT_PROMPT.md §7).
 * Excluded from the auth proxy: it authenticates with an HMAC signature over
 * the raw body plus a freshness window instead of a session cookie
 * (docs/SECURITY.md §5). Mismatches get a bare 401 — no detail leaks.
 */

const PublishStatusSchema = z.object({
  content_item_id: z.uuid(),
  status: z.enum(["posted", "failed"]),
  platform_post_url: z.url().optional(),
  error: z.string().max(500).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const env = getServerEnv();
  if (!env.N8N_WEBHOOK_SECRET) {
    // Nothing can be verified without the shared secret — refuse rather than
    // accept unauthenticated status changes.
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const signature = request.headers.get(SIGNATURE_HEADER);
  const timestamp = request.headers.get(TIMESTAMP_HEADER);
  if (!signature || !timestamp) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isFreshTimestamp(timestamp)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Verify against the exact bytes received, before any parsing.
  const rawBody = await request.text();
  if (!verifySignature(env.N8N_WEBHOOK_SECRET, timestamp, rawBody, signature)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: z.infer<typeof PublishStatusSchema>;
  try {
    payload = PublishStatusSchema.parse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const approvals = getContentApprovalService();
  try {
    // The referenced item is looked up and transitioned through the state
    // machine — attacker-controlled fields are never written directly.
    if (payload.status === "posted") {
      await approvals.markPosted(payload.content_item_id, payload.platform_post_url ?? null);
    } else {
      await approvals.markFailed(payload.content_item_id);
    }
  } catch {
    // Unknown ID or an illegal transition (e.g. a duplicate callback for an
    // item already settled) — acknowledge without leaking internals.
    return NextResponse.json({ error: "not_applicable" }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
