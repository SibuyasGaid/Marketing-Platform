import type { SupabaseClient } from "@supabase/supabase-js";

export interface AiUsageEntry {
  provider: string;
  model: string;
  taskType: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  contentItemId?: string | null;
  jobRef?: string | null;
  createdBy?: string | null;
}

export interface AiUsageRun extends AiUsageEntry {
  id: string;
  createdAt: string;
}

interface AiUsageRow {
  id: string;
  provider: string;
  model: string;
  task_type: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number | string;
  content_item_id: string | null;
  job_ref: string | null;
  created_by: string | null;
  created_at: string;
}

const COLUMNS =
  "id, provider, model, task_type, input_tokens, output_tokens, estimated_cost_usd, content_item_id, job_ref, created_by, created_at";

/** Only code allowed to touch ai_usage_log. Server-side (service role) only. */
export class AiUsageRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async record(entry: AiUsageEntry): Promise<void> {
    const { error } = await this.supabase.from("ai_usage_log").insert({
      provider: entry.provider,
      model: entry.model,
      task_type: entry.taskType,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      estimated_cost_usd: entry.estimatedCostUsd,
      content_item_id: entry.contentItemId ?? null,
      job_ref: entry.jobRef ?? null,
      created_by: entry.createdBy ?? null,
    });
    if (error) throw new Error(`ai_usage_log insert failed: ${error.message}`);
  }

  /** All runs since the given ISO timestamp (internal scale — aggregate in the service). */
  async listSince(sinceIso: string): Promise<AiUsageRun[]> {
    const { data, error } = await this.supabase
      .from("ai_usage_log")
      .select(COLUMNS)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .returns<AiUsageRow[]>();
    if (error) throw new Error(`ai_usage_log query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }

  async recentRuns(limit: number): Promise<AiUsageRun[]> {
    const { data, error } = await this.supabase
      .from("ai_usage_log")
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<AiUsageRow[]>();
    if (error) throw new Error(`ai_usage_log query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }

  /** Count of runs for one content item since the given ISO timestamp (per-item regen cap). */
  async countByContentItemSince(contentItemId: string, sinceIso: string): Promise<number> {
    const { count, error } = await this.supabase
      .from("ai_usage_log")
      .select("id", { count: "exact", head: true })
      .eq("content_item_id", contentItemId)
      .gte("created_at", sinceIso);
    if (error) throw new Error(`ai_usage_log count failed: ${error.message}`);
    return count ?? 0;
  }

  /** Count of runs a user triggered since the given ISO timestamp (per-user caps). */
  async countByUserSince(userId: string, sinceIso: string): Promise<number> {
    const { count, error } = await this.supabase
      .from("ai_usage_log")
      .select("id", { count: "exact", head: true })
      .eq("created_by", userId)
      .gte("created_at", sinceIso);
    if (error) throw new Error(`ai_usage_log count failed: ${error.message}`);
    return count ?? 0;
  }
}

function toDomain(row: AiUsageRow): AiUsageRun {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    taskType: row.task_type,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedCostUsd: Number(row.estimated_cost_usd),
    contentItemId: row.content_item_id,
    jobRef: row.job_ref,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
