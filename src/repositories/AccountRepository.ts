import type { SupabaseClient } from "@supabase/supabase-js";
import { BRANDS, BRAND_NAMES, BRAND_STYLE_GUIDES } from "@/lib/domain";

export interface Account {
  id: string;
  slug: string;
  name: string;
  /** Prompt context / brand voice, injected into generation. */
  description: string;
  /** The visual identity (colors, type, look), injected into image generation. */
  visualIdentity: string;
  /** Storage path (brand-assets) of the account's outro clip, or null. */
  outroVideoPath: string | null;
  isActive: boolean;
}

interface AccountRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  visual_identity: string;
  outro_video_path?: string | null;
  is_active: boolean;
}

const COLUMNS = "id, slug, name, description, visual_identity, outro_video_path, is_active";
// Used before the outro_video_path migration is applied (column absent).
const COLUMNS_LEGACY = "id, slug, name, description, visual_identity, is_active";

/** Only code allowed to query accounts. Members read; admin/editor write (RLS). */
export class AccountRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listActive(): Promise<Account[]> {
    const primary = await this.supabase
      .from("accounts")
      .select(COLUMNS)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .returns<AccountRow[]>();
    if (!primary.error) return (primary.data ?? []).map(toDomain);

    // Pre-migration: outro_video_path column absent — fall back without it.
    const legacy = await this.supabase
      .from("accounts")
      .select(COLUMNS_LEGACY)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .returns<AccountRow[]>();
    if (legacy.error) throw new Error(`accounts query failed: ${legacy.error.message}`);
    return (legacy.data ?? []).map(toDomain);
  }

  async getBySlug(slug: string): Promise<Account | null> {
    const primary = await this.supabase
      .from("accounts")
      .select(COLUMNS)
      .eq("slug", slug)
      .maybeSingle<AccountRow>();
    if (!primary.error) return primary.data ? toDomain(primary.data) : null;

    const legacy = await this.supabase
      .from("accounts")
      .select(COLUMNS_LEGACY)
      .eq("slug", slug)
      .maybeSingle<AccountRow>();
    if (legacy.error) throw new Error(`accounts query failed: ${legacy.error.message}`);
    return legacy.data ? toDomain(legacy.data) : null;
  }

  /** Sets or clears the account's outro clip storage path. */
  async setOutroVideoPath(slug: string, outroVideoPath: string | null): Promise<void> {
    const { error } = await this.supabase
      .from("accounts")
      .update({ outro_video_path: outroVideoPath })
      .eq("slug", slug);
    if (error) throw new Error(`accounts update failed: ${error.message}`);
  }

  async create(input: {
    name: string;
    slug: string;
    description: string;
    visualIdentity: string;
    createdBy: string;
  }): Promise<Account> {
    const { data, error } = await this.supabase
      .from("accounts")
      .insert({
        name: input.name,
        slug: input.slug,
        description: input.description,
        visual_identity: input.visualIdentity,
        created_by: input.createdBy,
      })
      .select(COLUMNS)
      .single<AccountRow>();
    if (error) throw new Error(`accounts insert failed: ${error.message}`);
    return toDomain(data);
  }

  async update(
    slug: string,
    input: { name: string; description: string; visualIdentity: string },
  ): Promise<Account> {
    const { data, error } = await this.supabase
      .from("accounts")
      .update({
        name: input.name,
        description: input.description,
        visual_identity: input.visualIdentity,
      })
      .eq("slug", slug)
      .select(COLUMNS)
      .single<AccountRow>();
    if (error) throw new Error(`accounts update failed: ${error.message}`);
    return toDomain(data);
  }
}

/**
 * Built-in accounts, used as a fallback when the accounts table is not available
 * yet (so the app is safe to deploy before the migration runs). Mirrors the seed.
 */
export function fallbackAccounts(): Account[] {
  return BRANDS.map((slug) => {
    const guide = BRAND_STYLE_GUIDES[slug];
    const visualIdentity = guide
      ? [guide.artDirection, guide.palette, guide.typography, guide.layout].filter(Boolean).join(" ")
      : "";
    return {
      id: slug,
      slug,
      name: BRAND_NAMES[slug] ?? slug,
      description: "",
      visualIdentity,
      outroVideoPath: null,
      isActive: true,
    };
  });
}

function toDomain(row: AccountRow): Account {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    visualIdentity: row.visual_identity,
    outroVideoPath: row.outro_video_path ?? null,
    isActive: row.is_active,
  };
}
