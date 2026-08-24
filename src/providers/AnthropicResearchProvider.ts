import { getServerEnv, maxTokensByTask, modelTiers } from "@/lib/config";
import { ProviderCreditsError, ProviderError } from "@/lib/errors";
import type {
  ResearchInput,
  ResearchProvider,
  ResearchResult,
} from "@/providers/interfaces/ResearchProvider";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

interface AnthropicResearchResponse {
  content?: Array<{ type: string; text?: string }>;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  };
  error?: { type?: string; message?: string };
}

/**
 * Anthropic Messages API with the server-side web search tool — used only by
 * the weekly competitor digest. Search count is reported for cost logging.
 */
export class AnthropicResearchProvider implements ResearchProvider {
  async research(input: ResearchInput): Promise<ResearchResult> {
    const env = getServerEnv();
    const model = modelTiers.mid;

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
          max_tokens: maxTokensByTask.competitorDigest,
          system: [
            { type: "text", text: input.system, cache_control: { type: "ephemeral" } },
          ],
          tools: [
            { type: "web_search_20260209", name: "web_search", max_uses: input.maxSearches },
          ],
          messages: [{ role: "user", content: input.user }],
        }),
      });
    } catch {
      throw new ProviderError("anthropic", "Network error calling research API", true);
    }

    const payload = (await response.json()) as AnthropicResearchResponse;

    if (!response.ok) {
      if (response.status === 400 && payload.error?.type === "billing_error") {
        throw new ProviderCreditsError("anthropic", "Anthropic credits exhausted");
      }
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError("anthropic", `Research API returned ${response.status}`, retryable);
    }

    const text = (payload.content ?? [])
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n");
    if (!text) throw new ProviderError("anthropic", "Research API returned no text");

    return {
      text,
      model: payload.model ?? model,
      inputTokens: payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
      searchesUsed: payload.usage?.server_tool_use?.web_search_requests ?? 0,
    };
  }
}
