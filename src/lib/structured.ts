import type { z } from "zod";
import { ProviderError } from "@/lib/errors";
import type {
  TextCompletionInput,
  TextCompletionResult,
  TextModelProvider,
} from "@/providers/interfaces/TextModelProvider";

/**
 * Structured-output guardrail (docs/API_OPTIMIZATION.md §4): parse the model's
 * JSON against a zod schema; on failure, ONE repair attempt with the error
 * appended, then fail the job. Never unbounded retries against a paid API.
 * Returns every completion made so the caller can log usage for each.
 */
export async function completeStructured<Schema extends z.ZodType>(
  provider: TextModelProvider,
  input: TextCompletionInput,
  schema: Schema,
): Promise<{ value: z.infer<Schema>; completions: TextCompletionResult[] }> {
  const completions: TextCompletionResult[] = [];

  const first = await provider.complete(input);
  completions.push(first);
  const firstAttempt = tryParse(first.text, schema);
  if (firstAttempt.ok) return { value: firstAttempt.value, completions };

  const repair = await provider.complete({
    ...input,
    idempotencyKey: `${input.idempotencyKey}:repair`,
    user: `${input.user}\n\nYour previous response failed validation with: ${firstAttempt.error}\nRespond again with ONLY valid JSON matching the required schema.`,
  });
  completions.push(repair);
  const secondAttempt = tryParse(repair.text, schema);
  if (secondAttempt.ok) return { value: secondAttempt.value, completions };

  throw new ProviderError("anthropic", "Structured output failed validation twice");
}

function tryParse<Schema extends z.ZodType>(
  text: string,
  schema: Schema,
): { ok: true; value: z.infer<Schema> } | { ok: false; error: string } {
  // Models occasionally wrap JSON in code fences despite instructions.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed: unknown = JSON.parse(cleaned);
    const result = schema.safeParse(parsed);
    if (result.success) return { ok: true, value: result.data };
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "invalid JSON" };
  }
}
