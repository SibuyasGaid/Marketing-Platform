import { getServerEnv, n8nWebhookUrlForPlatform } from "@/lib/config";
import { ProviderError } from "@/lib/errors";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signPayload,
} from "@/lib/webhookSignature";
import type {
  DispatchResult,
  PublishPayload,
  PublishProvider,
} from "@/providers/interfaces/PublishProvider";

/**
 * Default publish provider: POSTs the payload contract (PROJECT_PROMPT.md §7)
 * to the configured n8n webhook, HMAC-SHA256 signed over the raw body.
 * n8n calls back /api/webhooks/publish-status with the same scheme.
 */
export class N8nPublishProvider implements PublishProvider {
  async dispatch(payload: PublishPayload): Promise<DispatchResult> {
    const env = getServerEnv();
    // Each platform has its own n8n workflow; route by the item's platform.
    const webhookUrl = n8nWebhookUrlForPlatform(env, payload.platform);
    if (!webhookUrl || !env.N8N_WEBHOOK_SECRET) {
      throw new ProviderError(
        "n8n",
        `Publishing to ${payload.platform} is not configured. Set its N8N_WEBHOOK_URL and N8N_WEBHOOK_SECRET`,
      );
    }

    // Sign the exact bytes sent; n8n must verify against the raw body.
    const rawBody = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const signature = signPayload(env.N8N_WEBHOOK_SECRET, timestamp, rawBody);

    let response: Response;
    try {
      response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: signature,
        },
        body: rawBody,
      });
    } catch {
      throw new ProviderError("n8n", "Network error dispatching to publish webhook", true);
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError("n8n", `Publish webhook returned ${response.status}`, retryable);
    }

    // n8n may return a workflow/execution id; fall back to our own reference.
    let dispatchId = `dispatch:${payload.content_item_id}`;
    try {
      const body = (await response.json()) as { executionId?: string; id?: string };
      dispatchId = body.executionId ?? body.id ?? dispatchId;
    } catch {
      // Empty or non-JSON 200 is a valid n8n webhook response — keep the fallback.
    }
    return { dispatchId };
  }
}
