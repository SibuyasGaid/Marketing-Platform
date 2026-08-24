import type { SupabaseClient } from "@supabase/supabase-js";
import { NotFoundError } from "@/lib/errors";

export interface BrandReference {
  id: string;
  name: string;
  storagePath: string;
  isActive: boolean;
  /** The account this reference belongs to, or null if shared across accounts. */
  accountSlug: string | null;
  /** True when this is the account's designated logo (always used in generation). */
  isLogo: boolean;
}

interface BrandReferenceRow {
  id: string;
  name: string;
  storage_path: string;
  is_active: boolean;
  account_slug?: string | null;
  is_logo?: boolean | null;
}

const COLUMNS = "id, name, storage_path, is_active";
const COLUMNS_WITH_ACCOUNT = "id, name, storage_path, is_active, account_slug, is_logo";

/**
 * Only code allowed to query brand_references. Reusable reference images
 * (logos, product shots, style boards) for image generation — not people's
 * likenesses, so admin/editor may write (enforced via RLS + action layer).
 */
export class BrandReferenceRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listActive(): Promise<BrandReference[]> {
    const { data, error } = await this.supabase
      .from("brand_references")
      .select(COLUMNS)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .returns<BrandReferenceRow[]>();
    if (error) throw new Error(`brand_references query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }

  async getByIds(ids: string[]): Promise<BrandReference[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.supabase
      .from("brand_references")
      .select(COLUMNS)
      .in("id", ids)
      .eq("is_active", true)
      .returns<BrandReferenceRow[]>();
    if (error) throw new Error(`brand_references query failed: ${error.message}`);
    const found = (data ?? []).map(toDomain);
    if (found.length !== ids.length) {
      const foundIds = new Set(found.map((ref) => ref.id));
      const missing = ids.find((id) => !foundIds.has(id));
      throw new NotFoundError("Brand reference", missing);
    }
    return found;
  }

  /** References attached to a specific account (used in the account editor and
   * auto-applied to that account's generations). */
  async listForAccount(accountSlug: string): Promise<BrandReference[]> {
    const primary = await this.supabase
      .from("brand_references")
      .select(COLUMNS_WITH_ACCOUNT)
      .eq("account_slug", accountSlug)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .returns<BrandReferenceRow[]>();
    if (!primary.error) return (primary.data ?? []).map(toDomain);

    // Pre-migration: is_logo column absent. Fall back to the account columns.
    const legacy = await this.supabase
      .from("brand_references")
      .select("id, name, storage_path, is_active, account_slug")
      .eq("account_slug", accountSlug)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .returns<BrandReferenceRow[]>();
    if (legacy.error) throw new Error(`brand_references query failed: ${legacy.error.message}`);
    return (legacy.data ?? []).map(toDomain);
  }

  /** The account's designated logo, if one is set. */
  async getLogoForAccount(accountSlug: string): Promise<BrandReference | null> {
    const { data, error } = await this.supabase
      .from("brand_references")
      .select(COLUMNS_WITH_ACCOUNT)
      .eq("account_slug", accountSlug)
      .eq("is_active", true)
      .eq("is_logo", true)
      .limit(1)
      .maybeSingle<BrandReferenceRow>();
    if (error) return null; // Column not migrated yet, or none set.
    return data ? toDomain(data) : null;
  }

  /**
   * Marks one reference as the account's logo, clearing the flag on any other
   * reference for the same account (only one logo per account). Pass isLogo
   * false to just unset this one.
   */
  async setLogo(id: string, accountSlug: string, isLogo: boolean): Promise<void> {
    if (isLogo) {
      const cleared = await this.supabase
        .from("brand_references")
        .update({ is_logo: false })
        .eq("account_slug", accountSlug);
      if (cleared.error) throw new Error(`brand_references update failed: ${cleared.error.message}`);
    }
    const { error } = await this.supabase
      .from("brand_references")
      .update({ is_logo: isLogo })
      .eq("id", id);
    if (error) throw new Error(`brand_references update failed: ${error.message}`);
  }

  async create(input: {
    name: string;
    storagePath: string;
    createdBy: string;
    accountSlug?: string | null;
  }): Promise<BrandReference> {
    const row: Record<string, unknown> = {
      name: input.name,
      storage_path: input.storagePath,
      created_by: input.createdBy,
    };
    // Only reference the column when scoping to an account, so the shared-library
    // create path keeps working even before the account_slug migration is run.
    if (input.accountSlug !== undefined) row.account_slug = input.accountSlug;

    const { data, error } = await this.supabase
      .from("brand_references")
      .insert(row)
      .select(input.accountSlug !== undefined ? COLUMNS_WITH_ACCOUNT : COLUMNS)
      .single<BrandReferenceRow>();
    if (error) throw new Error(`brand_references insert failed: ${error.message}`);
    return toDomain(data);
  }

  async deactivate(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("brand_references")
      .update({ is_active: false })
      .eq("id", id);
    if (error) throw new Error(`brand_references update failed: ${error.message}`);
  }
}

function toDomain(row: BrandReferenceRow): BrandReference {
  return {
    id: row.id,
    name: row.name,
    storagePath: row.storage_path,
    isActive: row.is_active,
    accountSlug: row.account_slug ?? null,
    isLogo: row.is_logo ?? false,
  };
}
