import type { SupabaseClient } from "@supabase/supabase-js";
import { NotFoundError } from "@/lib/errors";

export interface AvatarReference {
  id: string;
  personName: string;
  storagePath: string;
  providerAssetId: string | null;
  isActive: boolean;
  /** Account this person belongs to; null = legacy shared (all accounts). */
  accountSlug: string | null;
}

interface AvatarReferenceRow {
  id: string;
  person_name: string;
  storage_path: string;
  provider_asset_id: string | null;
  is_active: boolean;
  account_slug: string | null;
}

const COLUMNS = "id, person_name, storage_path, provider_asset_id, is_active, account_slug";
// Used before the account_slug migration is applied (column absent).
const COLUMNS_LEGACY = "id, person_name, storage_path, provider_asset_id, is_active";

/**
 * Only code allowed to query avatar_references. These are real people's
 * likenesses — writes are admin-only (enforced in the service/action layer
 * on top of RLS).
 */
export class AvatarReferenceRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listActive(): Promise<AvatarReference[]> {
    // Fall back to the pre-migration column set if account_slug isn't there yet.
    const primary = await this.supabase
      .from("avatar_references")
      .select(COLUMNS)
      .eq("is_active", true)
      .order("person_name", { ascending: true })
      .returns<AvatarReferenceRow[]>();
    if (!primary.error) return (primary.data ?? []).map(toDomain);

    const legacy = await this.supabase
      .from("avatar_references")
      .select(COLUMNS_LEGACY)
      .eq("is_active", true)
      .order("person_name", { ascending: true })
      .returns<Omit<AvatarReferenceRow, "account_slug">[]>();
    if (legacy.error) throw new Error(`avatar_references query failed: ${legacy.error.message}`);
    return (legacy.data ?? []).map((row) => toDomain({ ...row, account_slug: null }));
  }

  /**
   * People for one account: the account's own people plus legacy shared ones
   * (account_slug is null). Falls back to all-active if the column isn't
   * migrated yet, so the app keeps working pre-migration.
   */
  async listForAccount(accountSlug: string): Promise<AvatarReference[]> {
    const { data, error } = await this.supabase
      .from("avatar_references")
      .select(COLUMNS)
      .eq("is_active", true)
      .or(`account_slug.eq.${accountSlug},account_slug.is.null`)
      .order("person_name", { ascending: true })
      .returns<AvatarReferenceRow[]>();
    if (error) return this.listActive();
    return (data ?? []).map(toDomain);
  }

  async getByIds(ids: string[]): Promise<AvatarReference[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.supabase
      .from("avatar_references")
      .select(COLUMNS)
      .in("id", ids)
      .eq("is_active", true)
      .returns<AvatarReferenceRow[]>();
    if (error) throw new Error(`avatar_references query failed: ${error.message}`);
    const found = (data ?? []).map(toDomain);
    if (found.length !== ids.length) {
      const foundIds = new Set(found.map((ref) => ref.id));
      const missing = ids.find((id) => !foundIds.has(id));
      throw new NotFoundError("Avatar reference", missing);
    }
    return found;
  }

  async create(input: {
    personName: string;
    storagePath: string;
    accountSlug?: string | null;
  }): Promise<AvatarReference> {
    const primary = await this.supabase
      .from("avatar_references")
      .insert({
        person_name: input.personName,
        storage_path: input.storagePath,
        account_slug: input.accountSlug ?? null,
      })
      .select(COLUMNS)
      .single<AvatarReferenceRow>();
    if (!primary.error) return toDomain(primary.data);

    // Pre-migration: no account_slug column — insert without it.
    const legacy = await this.supabase
      .from("avatar_references")
      .insert({ person_name: input.personName, storage_path: input.storagePath })
      .select(COLUMNS_LEGACY)
      .single<Omit<AvatarReferenceRow, "account_slug">>();
    if (legacy.error) throw new Error(`avatar_references insert failed: ${legacy.error.message}`);
    return toDomain({ ...legacy.data, account_slug: null });
  }

  /** Provider asset IDs are stored so references upload to HeyGen exactly once. */
  async setProviderAssetId(id: string, providerAssetId: string): Promise<void> {
    const { error } = await this.supabase
      .from("avatar_references")
      .update({ provider_asset_id: providerAssetId })
      .eq("id", id);
    if (error) throw new Error(`avatar_references update failed: ${error.message}`);
  }

  async deactivate(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("avatar_references")
      .update({ is_active: false })
      .eq("id", id);
    if (error) throw new Error(`avatar_references update failed: ${error.message}`);
  }
}

function toDomain(row: AvatarReferenceRow): AvatarReference {
  return {
    id: row.id,
    personName: row.person_name,
    storagePath: row.storage_path,
    providerAssetId: row.provider_asset_id,
    isActive: row.is_active,
    accountSlug: row.account_slug ?? null,
  };
}
