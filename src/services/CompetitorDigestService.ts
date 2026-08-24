import { pricing } from "@/lib/config";
import { ProviderCreditsError } from "@/lib/errors";
import { COMPETITOR_DIGEST_SYSTEM } from "@/lib/prompts/contentPrompts";
import { stripEmDashes } from "@/lib/text";
import type { CompetitorRepository } from "@/repositories/CompetitorRepository";
import type { CompetitorReportRepository } from "@/repositories/CompetitorReportRepository";
import type { ProfileRepository } from "@/repositories/ProfileRepository";
import type { EmailProvider } from "@/providers/interfaces/EmailProvider";
import type { ResearchProvider } from "@/providers/interfaces/ResearchProvider";
import type { UsageService } from "@/services/UsageService";

const MAX_SEARCHES = 12;

/**
 * Weekly competitor digest (PROJECT_PROMPT.md §6.6): one research call with
 * web search across the whole watchlist, persisted to competitor_reports,
 * delivered via EmailProvider to all admins.
 */
export class CompetitorDigestService {
  constructor(
    private readonly competitorRepo: CompetitorRepository,
    private readonly reportRepo: CompetitorReportRepository,
    private readonly profileRepo: ProfileRepository,
    private readonly research: ResearchProvider,
    private readonly email: EmailProvider,
    private readonly usage: UsageService,
  ) {}

  async run(): Promise<{ status: "sent" | "skipped" | "compiled_not_sent" }> {
    const competitors = await this.competitorRepo.listActive();
    if (competitors.length === 0) return { status: "skipped" };

    const weekStart = mondayOfCurrentWeek();

    // Idempotency: one report per week — a retried cron never re-researches.
    const existing = await this.reportRepo.findByWeek(weekStart);
    if (existing?.deliveryStatus === "delivered") return { status: "sent" };

    const html =
      existing?.contentHtml ??
      (await this.compile(competitors.map((competitor) => describeCompetitor(competitor)), weekStart));
    if (!existing) await this.reportRepo.create(weekStart, html);

    const admins = await this.profileRepo.listAdmins();
    if (admins.length === 0) return { status: "compiled_not_sent" };

    try {
      await this.email.send({
        to: admins.map((admin) => admin.email),
        subject: `Competitor digest — week of ${weekStart}`,
        html,
        idempotencyKey: `digest:${weekStart}`,
      });
    } catch (error) {
      if (error instanceof ProviderCreditsError) {
        await this.usage.reportCreditsExhausted(error.provider, error.message);
      }
      await this.reportRepo.setDeliveryStatus(weekStart, "failed");
      return { status: "compiled_not_sent" };
    }

    await this.reportRepo.setDeliveryStatus(weekStart, "delivered");
    return { status: "sent" };
  }

  private async compile(competitorLines: string[], weekStart: string): Promise<string> {
    try {
      const result = await this.research.research({
        system: COMPETITOR_DIGEST_SYSTEM,
        user: ["<competitors>", ...competitorLines, "</competitors>"].join("\n"),
        maxSearches: MAX_SEARCHES,
        idempotencyKey: `digest:${weekStart}`,
      });
      await this.usage.recordTextUsage({
        provider: "anthropic",
        model: result.model,
        taskType: "competitorDigest",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        extraCostUsd: result.searchesUsed * pricing.webSearchPerRequestUsd,
        createdBy: null,
      });
      return stripEmDashes(result.text);
    } catch (error) {
      if (error instanceof ProviderCreditsError) {
        await this.usage.reportCreditsExhausted(error.provider, error.message);
      }
      throw error;
    }
  }
}

function describeCompetitor(competitor: {
  name: string;
  websiteUrl: string | null;
  socialHandles: string[];
  notes: string | null;
}): string {
  const parts = [competitor.name];
  if (competitor.websiteUrl) parts.push(competitor.websiteUrl);
  if (competitor.socialHandles.length > 0) parts.push(competitor.socialHandles.join(" "));
  if (competitor.notes) parts.push(`(${competitor.notes})`);
  return `- ${parts.join(" — ")}`;
}

function mondayOfCurrentWeek(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  now.setUTCDate(now.getUTCDate() - diff);
  return now.toISOString().slice(0, 10);
}
