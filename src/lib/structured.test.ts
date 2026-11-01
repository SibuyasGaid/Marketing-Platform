import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ProviderError } from "@/lib/errors";
import { completeStructured } from "@/lib/structured";
import type {
  TextCompletionInput,
  TextCompletionResult,
  TextModelProvider,
} from "@/providers/interfaces/TextModelProvider";

/** Replays scripted responses and records every call it receives. */
class ScriptedTextProvider implements TextModelProvider {
  calls: TextCompletionInput[] = [];
  constructor(private readonly responses: string[]) {}

  async complete(input: TextCompletionInput): Promise<TextCompletionResult> {
    this.calls.push(input);
    const text = this.responses[this.calls.length - 1] ?? "";
    return { text, model: "test-model", inputTokens: 10, outputTokens: 5 };
  }
}

const HookSchema = z.object({ hook: z.string().min(1), score: z.number().min(0).max(10) });

const input: TextCompletionInput = {
  system: "system prompt",
  user: "write a hook",
  taskType: "hookScript",
  tier: "fast",
  idempotencyKey: "job-1",
};

describe("completeStructured: the AI output guardrail", () => {
  it("returns the parsed value when the first answer is valid", async () => {
    const provider = new ScriptedTextProvider(['{"hook":"Stop scrolling","score":8}']);
    const result = await completeStructured(provider, input, HookSchema);
    expect(result.value).toEqual({ hook: "Stop scrolling", score: 8 });
    expect(provider.calls).toHaveLength(1);
    expect(result.completions).toHaveLength(1);
  });

  it("accepts JSON wrapped in a markdown code fence", async () => {
    const provider = new ScriptedTextProvider(['```json\n{"hook":"Fenced","score":5}\n```']);
    const result = await completeStructured(provider, input, HookSchema);
    expect(result.value.hook).toBe("Fenced");
  });

  it("makes ONE repair call with the validation error, then succeeds", async () => {
    const provider = new ScriptedTextProvider([
      '{"hook":"Too confident","score":42}',
      '{"hook":"Fixed","score":9}',
    ]);
    const result = await completeStructured(provider, input, HookSchema);
    expect(result.value).toEqual({ hook: "Fixed", score: 9 });
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].user).toContain("score");
    expect(provider.calls[1].idempotencyKey).toBe("job-1:repair");
    // Both paid calls are returned so the caller logs usage for each.
    expect(result.completions).toHaveLength(2);
  });

  it("fails the job after the repair also fails: never a third paid call", async () => {
    const provider = new ScriptedTextProvider(["not json", '{"hook":""}', '{"hook":"never asked","score":1}']);
    await expect(completeStructured(provider, input, HookSchema)).rejects.toBeInstanceOf(ProviderError);
    expect(provider.calls).toHaveLength(2);
  });
});
