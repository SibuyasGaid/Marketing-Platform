import type { SupabaseClient } from "@supabase/supabase-js";

export interface Competitor {
  id: string;
  name: string;
  websiteUrl: string | null;
  socialHandles: string[];
  notes: string | null;
  isActive: boolean;
}

interface CompetitorRow {
  id: string;
  name: string;
  website_url: string | null;
  social_handles: unknown;
  notes: string | null;
  is_active: boolean;
}

const COLUMNS = "id, name, website_url, social_handles, notes, is_active";

/** Only code allowed to query competitors. Writes are server-action driven. */
export class CompetitorRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listActive(): Promise<Competitor[]> {
    const { data, error } = await this.supabase
      .from("competitors")
      .select(COLUMNS)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .returns<CompetitorRow[]>();
    if (error) throw new Error(`competitors query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }

  async create(input: {
    name: string;
    websiteUrl: string | null;
    socialHandles: string[];
    notes: string | null;
    createdBy: string;
  }): Promise<Competitor> {
    const { data, error } = await this.supabase
      .from("competitors")
      .insert({
        name: input.name,
        website_url: input.websiteUrl,
        social_handles: input.socialHandles,
        notes: input.notes,
        created_by: input.createdBy,
      })
      .select(COLUMNS)
      .single<CompetitorRow>();
    if (error) throw new Error(`competitors insert failed: ${error.message}`);
    return toDomain(data);
  }

  async deactivate(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("competitors")
      .update({ is_active: false })
      .eq("id", id);
    if (error) throw new Error(`competitors update failed: ${error.message}`);
  }
}

function toDomain(row: CompetitorRow): Competitor {
  return {
    id: row.id,
    name: row.name,
    websiteUrl: row.website_url,
    socialHandles: Array.isArray(row.social_handles) ? (row.social_handles as string[]) : [],
    notes: row.notes,
    isActive: row.is_active,
  };
}
