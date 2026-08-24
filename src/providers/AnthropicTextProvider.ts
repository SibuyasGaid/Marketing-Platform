import { getServerEnv, maxTokensByTask, modelTiers } from "@/lib/config";
import { ProviderCreditsError, ProviderError } from "@/lib/errors";
import type {
  TextCompletionInput,
  TextCompletionResult,
  TextModelProvider,
} from "@/providers/interfaces/TextModelProvider";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  model?: string;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

/**
 * Anthropic Messages API over REST (no SDK dependency).
 * System prompts are static per task and sent with cache_control so repeated
 * calls hit the prompt cache (docs/API_OPTIMIZATION.md §3). Model IDs and
 * max_tokens caps come from config only.
 */
export class AnthropicTextProvider implements TextModelProvider {
  async complete(input: TextCompletionInput): Promise<TextCompletionResult> {
    const env = getServerEnv();
    const model = modelTiers[input.tier];
    const maxTokens = maxTokensByTask[input.taskType];

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: [
            {
              type: "text",
              text: input.system,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: input.user }],
        }),
      });
    } catch {
      throw new ProviderError("anthropic", "Network error calling text API", true);
    }

    const payload = (await response.json()) as AnthropicResponse;

    if (!response.ok) {
      if (response.status === 400 && payload.error?.type === "billing_error") {
        throw new ProviderCreditsError("anthropic", "Anthropic credits exhausted");
      }
      if (response.status === 429) {
        // Rate limit — retryable; sustained 429s from zero balance surface via billing_error.
        throw new ProviderError("anthropic", "Rate limited by text API", true);
      }
      const retryable = response.status >= 500;
      throw new ProviderError("anthropic", `Text API returned ${response.status}`, retryable);
    }

    const text = (payload.content ?? [])
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n");
    if (!text) {
      throw new ProviderError("anthropic", "Text API returned no text content");
    }

    return {
      text,
      model: payload.model ?? model,
      inputTokens: payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
    };
  }
}
