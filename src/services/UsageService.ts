import { estimateTextCostUsd, generationLimits, pricing } from "@/lib/config";
import { BudgetExceededError, RateLimitedError } from "@/lib/errors";
import type { AiUsageEntry, AiUsageRepository, AiUsageRun } from "@/repositories/AiUsageRepository";
import type { ProviderAlert, ProviderAlertRepository } from "@/repositories/ProviderAlertRepository";

export interface DailySpend {
  date: string;
  usd: number;
  runs: number;
}

export interface GroupedSpend {
  key: string;
  usd: number;
  runs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageSummary {
  todayUsd: number;
  todayRuns: number;
  softDailyBudgetUsd: number;
  last7Days: DailySpend[];
  byProvider: GroupedSpend[];
  byTaskType: GroupedSpend[];
  recentRuns: AiUsageRun[];
}

type RecordArgs = Omit<AiUsageEntry, "estimatedCostUsd">;

/**
 * The single path for AI spend: every paid call is recorded here with a dollar
 * estimate, budget/caps are checked here, and credit-exhaustion alerts are
 * raised here (docs/API_OPTIMIZATION.md §7).
 */
export class UsageService {
  constructor(
    private readonly usageRepo: AiUsageRepository,
    private readonly alertRepo: ProviderAlertRepository,
  ) {}

  /** Text calls: cost derived from model token pricing in config.
   * extraCostUsd covers per-request surcharges (e.g. web search). */
  async recordTextUsage(args: RecordArgs & { extraCostUsd?: number }): Promise<void> {
    const { extraCostUsd = 0, ...entry } = args;
    await this.usageRepo.record({
      ...entry,
      estimatedCostUsd:
        estimateTextCostUsd(entry.model, entry.inputTokens, entry.outputTokens) + extraCostUsd,
    });
  }

  /**
   * Media calls (image/video). Images bill per generation. Video bills per
   * SECOND when the provider has a per-second rate and the final duration is
   * known (a 4s clip and a 60s clip cost differently); otherwise it falls back
   * to the flat per-generation estimate.
   */
  async recordMediaUsage(
    args: RecordArgs & { unit: "image" | "video"; durationSeconds?: number },
  ): Promise<void> {
    const { durationSeconds, ...entry } = args;
    let estimatedCostUsd: number;
    if (args.unit === "image") {
      estimatedCostUsd = pricing.imagePerGenerationUsd[args.provider] ?? 0;
    } else {
      const perSecond = pricing.videoPerSecondUsd[args.provider];
      estimatedCostUsd =
        perSecond !== undefined && durationSeconds && durationSeconds > 0
          ? perSecond * durationSeconds
          : (pricing.videoPerGenerationUsd[args.provider] ?? 0);
    }
    await this.usageRepo.record({ ...entry, estimatedCostUsd });
  }

  async getTodayTotalUsd(): Promise<number> {
    const runs = await this.usageRepo.listSince(startOfTodayUtc());
    return sumUsd(runs);
  }

  /**
   * Gate for user-triggered (non-scheduled) generation. Throws
   * BudgetExceededError past the soft daily budget, RateLimitedError past the
   * per-user daily cap. Postgres counters — no Redis needed at this scale.
   */
  async assertCanGenerate(userId: string): Promise<void> {
    // A limit <= 0 means "no cap" — the check is skipped entirely. Both caps
    // are currently off (config); usage is still recorded for the dashboard.
    const budget = generationLimits.softDailyBudgetUsd;
    const perUser = generationLimits.perUserDailyGenerations;
    if (budget <= 0 && perUser <= 0) return;

    const since = startOfTodayUtc();
    const [todayRuns, userCount] = await Promise.all([
      budget > 0 ? this.usageRepo.listSince(since) : Promise.resolve([]),
      perUser > 0 ? this.usageRepo.countByUserSince(userId, since) : Promise.resolve(0),
    ]);
    if (budget > 0 && sumUsd(todayRuns) >= budget) {
      throw new BudgetExceededError();
    }
    if (perUser > 0 && userCount >= perUser) {
      throw new RateLimitedError("Daily generation cap reached — resumes tomorrow");
    }
  }

  /** Paid runs recorded against one content item since a timestamp (regen caps). */
  async countRunsForItemSince(contentItemId: string, sinceIso: string): Promise<number> {
    return this.usageRepo.countByContentItemSince(contentItemId, sinceIso);
  }

  /** Called by providers/services when a vendor reports exhausted credits. */
  async reportCreditsExhausted(provider: string, message: string): Promise<void> {
    await this.alertRepo.raise(provider, message);
  }

  /**
   * Raised when storage rejects an upload in a way that looks like the project
   * storage quota is full. Surfaces the same app-wide alert as credit exhaustion
   * (one active alert per provider) so an admin resolves it on /admin.
   */
  async reportStorageIssue(message: string): Promise<void> {
    await this.alertRepo.raise("supabase-storage", message, "storage_full");
  }

  async getActiveAlerts(): Promise<ProviderAlert[]> {
    return this.alertRepo.listActive();
  }

  async resolveAlert(id: string): Promise<void> {
    await this.alertRepo.resolve(id);
  }

  async getSummary(): Promise<UsageSummary> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);
    const [runs, recentRuns] = await Promise.all([
      this.usageRepo.listSince(sevenDaysAgo.toISOString()),
      this.usageRepo.recentRuns(25),
    ]);

    const today = startOfTodayUtc();
    const todayRuns = runs.filter((run) => run.createdAt >= today);

    return {
      todayUsd: sumUsd(todayRuns),
      todayRuns: todayRuns.length,
      softDailyBudgetUsd: generationLimits.softDailyBudgetUsd,
      last7Days: groupByDay(runs),
      byProvider: groupBy(runs, (run) => run.provider),
      byTaskType: groupBy(runs, (run) => run.taskType),
      recentRuns,
    };
  }
}

function startOfTodayUtc(): string {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString();
}

function sumUsd(runs: AiUsageRun[]): number {
  return runs.reduce((total, run) => total + run.estimatedCostUsd, 0);
}

function groupBy(runs: AiUsageRun[], keyOf: (run: AiUsageRun) => string): GroupedSpend[] {
  const groups = new Map<string, GroupedSpend>();
  for (const run of runs) {
    const key = keyOf(run);
    const group = groups.get(key) ?? { key, usd: 0, runs: 0, inputTokens: 0, outputTokens: 0 };
    group.usd += run.estimatedCostUsd;
    group.runs += 1;
    group.inputTokens += run.inputTokens;
    group.outputTokens += run.outputTokens;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.usd - a.usd);
}

function groupByDay(runs: AiUsageRun[]): DailySpend[] {
  const days = new Map<string, DailySpend>();
  for (const run of runs) {
    const date = run.createdAt.slice(0, 10);
    const day = days.get(date) ?? { date, usd: 0, runs: 0 };
    day.usd += run.estimatedCostUsd;
    day.runs += 1;
    days.set(date, day);
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}
