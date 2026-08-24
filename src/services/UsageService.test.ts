import { describe, expect, it } from "vitest";
import { estimateTextCostUsd, generationLimits } from "@/lib/config";
import type { AiUsageEntry, AiUsageRepository, AiUsageRun } from "@/repositories/AiUsageRepository";
import type { ProviderAlert, ProviderAlertRepository } from "@/repositories/ProviderAlertRepository";
import { UsageService } from "@/services/UsageService";

class FakeUsageRepo implements Pick<AiUsageRepository, never> {
  recorded: AiUsageEntry[] = [];
  runs: AiUsageRun[] = [];
  userCount = 0;

  async record(entry: AiUsageEntry): Promise<void> {
    this.recorded.push(entry);
  }
  async listSince(_sinceIso: string): Promise<AiUsageRun[]> {
    return this.runs;
  }
  async recentRuns(_limit: number): Promise<AiUsageRun[]> {
    return this.runs;
  }
  async countByUserSince(_userId: string, _sinceIso: string): Promise<number> {
    return this.userCount;
  }
}

class FakeAlertRepo implements Pick<ProviderAlertRepository, never> {
  raised: Array<{ provider: string; message: string }> = [];
  active: ProviderAlert[] = [];

  async listActive(): Promise<ProviderAlert[]> {
    return this.active;
  }
  async raise(provider: string, message: string): Promise<void> {
    this.raised.push({ provider, message });
  }
  async resolve(_id: string): Promise<void> {}
}

function run(costUsd: number, overrides: Partial<AiUsageRun> = {}): AiUsageRun {
  return {
    id: "r",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    taskType: "segmentScoring",
    inputTokens: 1000,
    outputTokens: 200,
    estimatedCostUsd: costUsd,
    contentItemId: null,
    jobRef: null,
    createdBy: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeService() {
  const usageRepo = new FakeUsageRepo();
  const alertRepo = new FakeAlertRepo();
  const service = new UsageService(
    usageRepo as unknown as AiUsageRepository,
    alertRepo as unknown as ProviderAlertRepository,
  );
  return { service, usageRepo, alertRepo };
}

describe("estimateTextCostUsd", () => {
  it("prices haiku by the configured per-MTok rates", () => {
    // 1M input @ $1 + 1M output @ $5
    expect(estimateTextCostUsd("claude-haiku-4-5", 1_000_000, 1_000_000)).toBeCloseTo(6);
  });

  it("returns 0 for unknown models instead of guessing", () => {
    expect(estimateTextCostUsd("unknown-model", 1_000_000, 1_000_000)).toBe(0);
  });
});

describe("UsageService", () => {
  it("records text usage with a derived cost estimate", async () => {
    const { service, usageRepo } = makeService();
    await service.recordTextUsage({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      taskType: "captions",
      inputTokens: 2000,
      outputTokens: 500,
    });
    expect(usageRepo.recorded).toHaveLength(1);
    // 2000/1M * $3 + 500/1M * $15
    expect(usageRepo.recorded[0].estimatedCostUsd).toBeCloseTo(0.0135);
  });

  it("records media usage at the per-generation rate for the provider", async () => {
    const { service, usageRepo } = makeService();
    await service.recordMediaUsage({
      provider: "gemini",
      model: "gemini-image",
      taskType: "imageGeneration",
      inputTokens: 0,
      outputTokens: 0,
      unit: "image",
    });
    expect(usageRepo.recorded[0].estimatedCostUsd).toBeCloseTo(0.04);
  });

  it("bills video per second when a duration is given ($0.05/s HeyGen)", async () => {
    const { service, usageRepo } = makeService();
    await service.recordMediaUsage({
      provider: "heygen",
      model: "avatar-video",
      taskType: "avatarHook",
      inputTokens: 0,
      outputTokens: 0,
      unit: "video",
      durationSeconds: 4,
    });
    // 4s * $0.05 = $0.20 — a short clip is far cheaper than the old flat $2.00.
    expect(usageRepo.recorded[0].estimatedCostUsd).toBeCloseTo(0.2);
  });

  it("scales video cost with length (60s costs 15x a 4s clip)", async () => {
    const { service, usageRepo } = makeService();
    await service.recordMediaUsage({
      provider: "heygen",
      model: "avatar-video",
      taskType: "avatarHook",
      inputTokens: 0,
      outputTokens: 0,
      unit: "video",
      durationSeconds: 60,
    });
    expect(usageRepo.recorded[0].estimatedCostUsd).toBeCloseTo(3.0);
  });

  it("falls back to the flat per-video estimate when duration is unknown", async () => {
    const { service, usageRepo } = makeService();
    await service.recordMediaUsage({
      provider: "heygen",
      model: "avatar-video",
      taskType: "avatarHook",
      inputTokens: 0,
      outputTokens: 0,
      unit: "video",
    });
    expect(usageRepo.recorded[0].estimatedCostUsd).toBeCloseTo(2.0);
  });

  // Daily caps are disabled (config values 0 = no limit) per stakeholder
  // request. assertCanGenerate must not block regardless of usage; usage is
  // still recorded for the dashboard. If a positive cap is ever restored,
  // re-add block tests here.
  it("does not block generation when the daily caps are disabled (0)", async () => {
    expect(generationLimits.softDailyBudgetUsd).toBe(0);
    expect(generationLimits.perUserDailyGenerations).toBe(0);
    const { service, usageRepo } = makeService();
    usageRepo.runs = [run(9999)];
    usageRepo.userCount = 9999;
    await expect(service.assertCanGenerate("user-1")).resolves.toBeUndefined();
  });

  it("raises a provider alert when credits are exhausted", async () => {
    const { service, alertRepo } = makeService();
    await service.reportCreditsExhausted("heygen", "HeyGen returned insufficient credits");
    expect(alertRepo.raised).toEqual([
      { provider: "heygen", message: "HeyGen returned insufficient credits" },
    ]);
  });

  it("summarizes spend by day, provider, and task type", async () => {
    const { service, usageRepo } = makeService();
    usageRepo.runs = [
      run(1, { provider: "anthropic", taskType: "captions" }),
      run(2, { provider: "gemini", taskType: "imageGeneration" }),
      run(0.5, { provider: "anthropic", taskType: "segmentScoring" }),
    ];
    const summary = await service.getSummary();
    expect(summary.todayUsd).toBeCloseTo(3.5);
    expect(summary.byProvider[0]).toMatchObject({ key: "gemini", usd: 2 });
    expect(summary.byProvider[1]).toMatchObject({ key: "anthropic", usd: 1.5, runs: 2 });
    expect(summary.byTaskType).toHaveLength(3);
    expect(summary.last7Days).toHaveLength(1);
  });
});
