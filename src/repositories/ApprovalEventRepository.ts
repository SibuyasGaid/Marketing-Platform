import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalAction } from "@/lib/domain";

export interface ApprovalEvent {
  id: string;
  contentItemId: string;
  reviewerId: string;
  reviewerEmail: string | null;
  action: ApprovalAction;
  comment: string | null;
  createdAt: string;
}

interface ApprovalEventRow {
  id: string;
  content_item_id: string;
  reviewer_id: string;
  action: ApprovalAction;
  comment: string | null;
  created_at: string;
  profiles?: { email: string | null } | null;
}

const COLUMNS =
  "id, content_item_id, reviewer_id, action, comment, created_at, profiles:reviewer_id (email)";

/**
 * The audit log (docs/SECURITY.md §4). Append-only by policy: this class
 * intentionally exposes no update or delete method, and the table has no
 * update/delete RLS policies.
 */
export class ApprovalEventRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async record(input: {
    contentItemId: string;
    reviewerId: string;
    action: ApprovalAction;
    comment?: string | null;
  }): Promise<ApprovalEvent> {
    const { data, error } = await this.supabase
      .from("approval_events")
      .insert({
        content_item_id: input.contentItemId,
        reviewer_id: input.reviewerId,
        action: input.action,
        comment: input.comment ?? null,
      })
      .select(COLUMNS)
      .single<ApprovalEventRow>();
    if (error) throw new Error(`approval_events insert failed: ${error.message}`);
    return toDomain(data);
  }

  async listByItem(contentItemId: string): Promise<ApprovalEvent[]> {
    const { data, error } = await this.supabase
      .from("approval_events")
      .select(COLUMNS)
      .eq("content_item_id", contentItemId)
      .order("created_at", { ascending: false })
      .returns<ApprovalEventRow[]>();
    if (error) throw new Error(`approval_events query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }

  /**
   * Batched audit fetch for a set of items — one query instead of N, grouped
   * by item and newest-first (the queue board renders many items at once).
   */
  async listByItems(contentItemIds: string[]): Promise<Map<string, ApprovalEvent[]>> {
    const grouped = new Map<string, ApprovalEvent[]>();
    if (contentItemIds.length === 0) return grouped;
    const { data, error } = await this.supabase
      .from("approval_events")
      .select(COLUMNS)
      .in("content_item_id", contentItemIds)
      .order("created_at", { ascending: false })
      .returns<ApprovalEventRow[]>();
    if (error) throw new Error(`approval_events query failed: ${error.message}`);
    for (const row of data ?? []) {
      const event = toDomain(row);
      const list = grouped.get(event.contentItemId) ?? [];
      list.push(event);
      grouped.set(event.contentItemId, list);
    }
    return grouped;
  }

  /**
   * The publish gate's second half: proof that a human approved THIS item.
   * The content/approved handler calls this before dispatching — an event
   * payload alone is never sufficient (docs/SECURITY.md §4).
   */
  async hasApprovalFor(contentItemId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from("approval_events")
      .select("id", { count: "exact", head: true })
      .eq("content_item_id", contentItemId)
      .eq("action", "approved");
    if (error) throw new Error(`approval_events count failed: ${error.message}`);
    return (count ?? 0) > 0;
  }

  /** Latest events across all items, for the admin activity view. */
  async listRecent(limit: number): Promise<ApprovalEvent[]> {
    const { data, error } = await this.supabase
      .from("approval_events")
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<ApprovalEventRow[]>();
    if (error) throw new Error(`approval_events query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }
}

function toDomain(row: ApprovalEventRow): ApprovalEvent {
  return {
    id: row.id,
    contentItemId: row.content_item_id,
    reviewerId: row.reviewer_id,
    reviewerEmail: row.profiles?.email ?? null,
    action: row.action,
    comment: row.comment,
    createdAt: row.created_at,
  };
}
