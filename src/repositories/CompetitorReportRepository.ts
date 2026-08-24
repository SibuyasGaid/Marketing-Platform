import type { SupabaseClient } from "@supabase/supabase-js";

export interface CompetitorReport {
  id: string;
  weekStart: string;
  contentHtml: string;
  deliveryStatus: string;
}

interface ReportRow {
  id: string;
  week_start: string;
  content_html: string;
  delivery_status: string;
}

const COLUMNS = "id, week_start, content_html, delivery_status";

/** Only code allowed to touch competitor_reports. Service-role only. */
export class CompetitorReportRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findByWeek(weekStart: string): Promise<CompetitorReport | null> {
    const { data, error } = await this.supabase
      .from("competitor_reports")
      .select(COLUMNS)
      .eq("week_start", weekStart)
      .maybeSingle<ReportRow>();
    if (error) throw new Error(`competitor_reports query failed: ${error.message}`);
    return data ? toDomain(data) : null;
  }

  async create(weekStart: string, contentHtml: string): Promise<CompetitorReport> {
    const { data, error } = await this.supabase
      .from("competitor_reports")
      .insert({ week_start: weekStart, content_html: contentHtml, delivery_status: "pending" })
      .select(COLUMNS)
      .single<ReportRow>();
    if (error) throw new Error(`competitor_reports insert failed: ${error.message}`);
    return toDomain(data);
  }

  async setDeliveryStatus(weekStart: string, status: string): Promise<void> {
    const patch: Record<string, unknown> = { delivery_status: status };
    if (status === "delivered") patch.delivered_at = new Date().toISOString();
    const { error } = await this.supabase
      .from("competitor_reports")
      .update(patch)
      .eq("week_start", weekStart);
    if (error) throw new Error(`competitor_reports update failed: ${error.message}`);
  }
}

function toDomain(row: ReportRow): CompetitorReport {
  return {
    id: row.id,
    weekStart: row.week_start,
    contentHtml: row.content_html,
    deliveryStatus: row.delivery_status,
  };
}
