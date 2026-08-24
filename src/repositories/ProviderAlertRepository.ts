import type { SupabaseClient } from "@supabase/supabase-js";

export interface ProviderAlert {
  id: string;
  provider: string;
  kind: string;
  message: string;
  createdAt: string;
}

interface ProviderAlertRow {
  id: string;
  provider: string;
  kind: string;
  message: string;
  created_at: string;
}

/** Only code allowed to touch provider_alerts. Writes are service-role only. */
export class ProviderAlertRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listActive(): Promise<ProviderAlert[]> {
    const { data, error } = await this.supabase
      .from("provider_alerts")
      .select("id, provider, kind, message, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .returns<ProviderAlertRow[]>();
    if (error) throw new Error(`provider_alerts query failed: ${error.message}`);
    return (data ?? []).map((row) => ({
      id: row.id,
      provider: row.provider,
      kind: row.kind,
      message: row.message,
      createdAt: row.created_at,
    }));
  }

  /** Idempotent: the partial unique index allows one active alert per provider. */
  async raise(provider: string, message: string, kind = "credits_exhausted"): Promise<void> {
    const { error } = await this.supabase
      .from("provider_alerts")
      .insert({ provider, message, kind });
    // 23505 = unique violation → an active alert for this provider already exists.
    if (error && error.code !== "23505") {
      throw new Error(`provider_alerts insert failed: ${error.message}`);
    }
  }

  async resolve(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("provider_alerts")
      .update({ is_active: false, resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`provider_alerts update failed: ${error.message}`);
  }
}
