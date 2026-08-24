import { resolveProviderAlert } from "@/app/(app)/admin/actions";
import { CostBadge, formatUsd } from "@/components/usage/CostBadge";
import { getUsageService } from "@/lib/container";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ApprovalEventRepository, type ApprovalEvent } from "@/repositories/ApprovalEventRepository";
import { JobRepository, type Job, type JobStatus } from "@/repositories/JobRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";
import type { UsageSummary } from "@/services/UsageService";
import type { ProviderAlert } from "@/repositories/ProviderAlertRepository";

export const metadata = { title: "Admin · Content Studio" };
export const dynamic = "force-dynamic";

const EMPTY_SUMMARY: UsageSummary = {
  todayUsd: 0,
  todayRuns: 0,
  softDailyBudgetUsd: 0,
  last7Days: [],
  byProvider: [],
  byTaskType: [],
  recentRuns: [],
};

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await new ProfileRepository(supabase).getById(user.id) : null;
  const isAdmin = profile?.role === "admin";

  // Admin holds spend and system internals — gate the whole page server-side,
  // not just the resolve button (docs/SECURITY.md §3).
  if (!isAdmin) {
    return (
      <section className="rounded-2xl border border-border-subtle bg-bg-raised p-6">
        <h2 className="font-display text-xl font-semibold text-text-primary">Admin</h2>
        <p className="mt-2 text-sm">
          This area is limited to admins. Ask an admin if you need spend or system visibility.
        </p>
      </section>
    );
  }

  let summary = EMPTY_SUMMARY;
  let alerts: ProviderAlert[] = [];
  let jobs: Job[] = [];
  let jobCounts: Record<JobStatus, number> = { queued: 0, running: 0, completed: 0, failed: 0 };
  let activity: ApprovalEvent[] = [];
  let loadError = false;
  try {
    const usageService = getUsageService();
    const admin = createSupabaseAdminClient();
    const jobRepo = new JobRepository(admin);
    [summary, alerts, jobs, jobCounts, activity] = await Promise.all([
      usageService.getSummary(),
      usageService.getActiveAlerts(),
      jobRepo.listRecent(15),
      jobRepo.countsByStatus(),
      new ApprovalEventRepository(admin).listRecent(15),
    ]);
  } catch {
    loadError = true;
  }

  return (
    <div className="flex flex-col gap-4">
      {loadError ? (
        <section className="rounded-2xl border border-danger/40 bg-bg-raised p-6 text-sm">
          Usage data failed to load — check the Supabase connection, then reload.
        </section>
      ) : null}

      {/* Spend overview */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
          <p className="type-utility text-text-faint">AI spend today</p>
          <p className="mt-2 font-display text-[28px] font-bold text-text-primary">
            {formatUsd(summary.todayUsd)}
          </p>
          <p className="mt-1 text-[13px] text-text-faint">
            {summary.todayRuns} runs · soft budget {formatUsd(summary.softDailyBudgetUsd)}/day
          </p>
        </div>
        <div className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
          <p className="type-utility text-text-faint">Last 7 days</p>
          <p className="mt-2 font-display text-[28px] font-bold text-text-primary">
            {formatUsd(summary.last7Days.reduce((total, day) => total + day.usd, 0))}
          </p>
          <p className="mt-1 text-[13px] text-text-faint">
            {summary.last7Days.reduce((total, day) => total + day.runs, 0)} runs
          </p>
        </div>
        <div className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
          <p className="type-utility text-text-faint">API alerts</p>
          <p
            className={`mt-2 font-display text-[28px] font-bold ${
              alerts.length > 0 ? "text-danger" : "text-text-primary"
            }`}
          >
            {alerts.length}
          </p>
          <p className="mt-1 text-[13px] text-text-faint">
            {alerts.length > 0 ? "providers out of credits" : "all providers OK"}
          </p>
        </div>
      </section>

      {/* Active provider alerts */}
      {alerts.length > 0 ? (
        <section className="rounded-2xl border border-danger/40 bg-bg-raised p-6">
          <h3 className="font-display text-base font-semibold text-text-primary">
            Providers needing credits
          </h3>
          <ul className="mt-3 flex flex-col gap-2">
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-bg-base p-3.5"
              >
                <div>
                  <span className="text-sm font-medium capitalize text-text-primary">
                    {alert.provider}
                  </span>
                  <p className="mt-0.5 text-[13px]">{alert.message}</p>
                </div>
                {isAdmin ? (
                  <form action={resolveProviderAlert}>
                    <input type="hidden" name="alertId" value={alert.id} />
                    <button
                      type="submit"
                      className="rounded-full border border-border-subtle px-3.5 py-1.5 font-display text-[13px] font-medium text-text-primary hover:bg-bg-hover"
                    >
                      Mark resolved
                    </button>
                  </form>
                ) : (
                  <span className="type-utility text-text-faint">Admin resolves</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Breakdown tables */}
      <section className="grid gap-4 lg:grid-cols-3">
        <BreakdownCard title="By provider (7 days)" rows={summary.byProvider} />
        <BreakdownCard title="By task type (7 days)" rows={summary.byTaskType} />
        <div className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
          <h3 className="font-display text-base font-semibold text-text-primary">
            By day (7 days)
          </h3>
          {summary.last7Days.length === 0 ? (
            <EmptyRows />
          ) : (
            <table className="mt-3 w-full text-[13px]">
              <tbody>
                {summary.last7Days.map((day) => (
                  <tr key={day.date} className="border-t border-border-subtle">
                    <td className="py-2 text-text-secondary">{day.date}</td>
                    <td className="py-2 text-right text-text-faint">{day.runs} runs</td>
                    <td className="py-2 text-right font-medium text-text-primary">
                      {formatUsd(day.usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Recent runs */}
      <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <h3 className="font-display text-base font-semibold text-text-primary">Recent runs</h3>
        <p className="mt-1 text-[13px] text-text-faint">
          Every AI call, the API it used, tokens, and its estimated cost.
        </p>
        {summary.recentRuns.length === 0 ? (
          <p className="mt-3 text-sm">
            No AI runs logged yet. Costs appear here per generation once the agents go live.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="type-utility text-left text-text-faint">
                  <th className="pb-2 font-medium">When</th>
                  <th className="pb-2 font-medium">API</th>
                  <th className="pb-2 font-medium">Model</th>
                  <th className="pb-2 font-medium">Task</th>
                  <th className="pb-2 text-right font-medium">Tokens in/out</th>
                  <th className="pb-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentRuns.map((run) => (
                  <tr key={run.id} className="border-t border-border-subtle">
                    <td className="py-2 text-text-faint">
                      {new Date(run.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 capitalize text-text-primary">{run.provider}</td>
                    <td className="py-2 text-text-secondary">{run.model}</td>
                    <td className="py-2 text-text-secondary">{run.taskType}</td>
                    <td className="py-2 text-right text-text-secondary">
                      {run.inputTokens.toLocaleString()} / {run.outputTokens.toLocaleString()}
                    </td>
                    <td className="py-2 text-right">
                      <CostBadge usd={run.estimatedCostUsd} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Job health */}
      <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base font-semibold text-text-primary">Job health</h3>
          <div className="flex flex-wrap gap-2">
            {(["running", "queued", "completed", "failed"] as JobStatus[]).map((status) => (
              <span
                key={status}
                className={`type-utility rounded-full px-2.5 py-1 ${
                  status === "failed" && jobCounts.failed > 0
                    ? "bg-danger/12 text-danger"
                    : "border border-border-subtle text-text-secondary"
                }`}
              >
                {jobCounts[status]} {status}
              </span>
            ))}
          </div>
        </div>
        {jobs.length === 0 ? (
          <EmptyRows />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="type-utility text-left text-text-faint">
                  <th className="pb-2 font-medium">When</th>
                  <th className="pb-2 font-medium">Job</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-t border-border-subtle">
                    <td className="py-2 text-text-faint">
                      {new Date(job.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 text-text-secondary">{job.jobName}</td>
                    <td className="py-2">
                      <span
                        className={
                          job.status === "failed"
                            ? "text-danger"
                            : job.status === "completed"
                              ? "text-success"
                              : "text-info"
                        }
                      >
                        {job.status}
                      </span>
                    </td>
                    <td className="py-2 text-text-faint">{job.errorMessage ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent approval activity */}
      <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <h3 className="font-display text-base font-semibold text-text-primary">
          Recent review activity
        </h3>
        {activity.length === 0 ? (
          <EmptyRows />
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {activity.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-[13px]"
              >
                <span className="text-text-secondary">
                  <span className="font-medium text-text-primary">
                    {event.action === "approved" ? "Approved" : "Edits requested"}
                  </span>{" "}
                  by {event.reviewerEmail ?? "unknown"}
                  {event.comment ? `: “${event.comment}”` : ""}
                </span>
                <span className="text-text-faint">
                  {new Date(event.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string;
  rows: UsageSummary["byProvider"];
}) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
      <h3 className="font-display text-base font-semibold text-text-primary">{title}</h3>
      {rows.length === 0 ? (
        <EmptyRows />
      ) : (
        <table className="mt-3 w-full text-[13px]">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-border-subtle">
                <td className="py-2 capitalize text-text-secondary">{row.key}</td>
                <td className="py-2 text-right text-text-faint">{row.runs} runs</td>
                <td className="py-2 text-right font-medium text-text-primary">
                  {formatUsd(row.usd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function EmptyRows() {
  return <p className="mt-3 text-sm text-text-faint">Nothing logged yet.</p>;
}
