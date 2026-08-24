import type { SupabaseClient } from "@supabase/supabase-js";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface Job {
  id: string;
  jobName: string;
  status: JobStatus;
  contentItemId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface JobRow {
  id: string;
  job_name: string;
  status: JobStatus;
  content_item_id: string | null;
  error_message: string | null;
  created_at: string;
}

const COLUMNS = "id, job_name, status, content_item_id, error_message, created_at";

/** Inngest job mirror for UI status display. Service-role only. */
export class JobRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async create(input: { jobName: string; contentItemId: string }): Promise<Job> {
    const { data, error } = await this.supabase
      .from("jobs")
      .insert({ job_name: input.jobName, content_item_id: input.contentItemId })
      .select(COLUMNS)
      .single<JobRow>();
    if (error) throw new Error(`jobs insert failed: ${error.message}`);
    return toDomain(data);
  }

  async setStatus(id: string, status: JobStatus, errorMessage?: string): Promise<void> {
    const { error } = await this.supabase
      .from("jobs")
      .update({ status, error_message: errorMessage ?? null })
      .eq("id", id);
    if (error) throw new Error(`jobs update failed: ${error.message}`);
  }

  /** Most recent jobs across all content, for the admin job-health view. */
  async listRecent(limit: number): Promise<Job[]> {
    const { data, error } = await this.supabase
      .from("jobs")
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<JobRow[]>();
    if (error) throw new Error(`jobs query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }

  /** Counts by status over the recent window, for the health summary tiles. */
  async countsByStatus(): Promise<Record<JobStatus, number>> {
    const counts: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
    };
    const { data, error } = await this.supabase
      .from("jobs")
      .select("status")
      .order("created_at", { ascending: false })
      .limit(500)
      .returns<{ status: JobStatus }[]>();
    if (error) throw new Error(`jobs query failed: ${error.message}`);
    for (const row of data ?? []) counts[row.status] += 1;
    return counts;
  }

  /**
   * Count of in-flight image generations (queued or running), for the nav
   * "working" cue. Scoped to image job names so a video/clip job doesn't light
   * up the Brand Images tab. Cheap head-count, no rows returned.
   */
  async countActiveImageJobs(): Promise<number> {
    const { count, error } = await this.supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "running"])
      .in("job_name", ["image-generation", "image-regeneration", "image-edit", "weekly-batch-image"]);
    if (error) throw new Error(`jobs count failed: ${error.message}`);
    return count ?? 0;
  }

  /**
   * A compact signature of in-flight image generations (`jobId:status`, sorted)
   * for the client status poll. It changes the moment a job starts, advances
   * queued→running, or finishes (drops out of the active set), which is exactly
   * when the images page needs to pull fresh content. Scoped to image job names
   * so a video/clip job doesn't trigger an images refresh.
   */
  async activeImageJobsSignature(): Promise<string> {
    const { data, error } = await this.supabase
      .from("jobs")
      .select("id, status")
      .in("status", ["queued", "running"])
      .in("job_name", ["image-generation", "image-regeneration", "image-edit", "weekly-batch-image"])
      .order("id", { ascending: true })
      .returns<{ id: string; status: JobStatus }[]>();
    if (error) throw new Error(`jobs signature failed: ${error.message}`);
    return (data ?? []).map((row) => `${row.id}:${row.status}`).join(",");
  }

  /**
   * Marks jobs stuck in queued/running past the cutoff as failed — a safety net
   * for runs that died without settling their status (the same failure mode the
   * video reconciliation covers). Keeps the nav "working" cue and history cards
   * from showing a phantom in-flight job forever. One bulk UPDATE; returns how
   * many were cleared.
   */
  async failStuckActive(olderThanMinutes: number): Promise<{ failed: number }> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();
    const { data, error } = await this.supabase
      .from("jobs")
      .update({ status: "failed", error_message: "Generation stalled and was stopped." })
      .in("status", ["queued", "running"])
      .lt("created_at", cutoff)
      .select("id")
      .returns<{ id: string }[]>();
    if (error) throw new Error(`jobs reconcile failed: ${error.message}`);
    return { failed: (data ?? []).length };
  }

  /** Latest job per content item, for status display next to history cards. */
  async latestByContentItems(contentItemIds: string[]): Promise<Map<string, Job>> {
    if (contentItemIds.length === 0) return new Map();
    const { data, error } = await this.supabase
      .from("jobs")
      .select(COLUMNS)
      .in("content_item_id", contentItemIds)
      .order("created_at", { ascending: false })
      .returns<JobRow[]>();
    if (error) throw new Error(`jobs query failed: ${error.message}`);
    const latest = new Map<string, Job>();
    for (const row of data ?? []) {
      if (row.content_item_id && !latest.has(row.content_item_id)) {
        latest.set(row.content_item_id, toDomain(row));
      }
    }
    return latest;
  }
}

function toDomain(row: JobRow): Job {
  return {
    id: row.id,
    jobName: row.job_name,
    status: row.status,
    contentItemId: row.content_item_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}
