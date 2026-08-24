import type { AiTaskType } from "@/lib/config";

export interface TextCompletionInput {
  /** Static, cacheable system prompt (docs/API_OPTIMIZATION.md §3). */
  system: string;
  /** Dynamic user-turn content only. */
  user: string;
  /** Tier + cap are resolved from config by task type — never per-call model IDs. */
  taskType: AiTaskType;
  tier: "fast" | "mid";
  /** Stable key so retried Inngest steps never re-bill the vendor. */
  idempotencyKey: string;
}

export interface TextCompletionResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Anthropic primary; OpenAI optional secondary behind the same interface. */
export interface TextModelProvider {
  complete(input: TextCompletionInput): Promise<TextCompletionResult>;
}
