import type { SupabaseClient } from "@supabase/supabase-js";
import { NotFoundError } from "@/lib/errors";

export interface PlatformVariant {
  aspect_ratio?: string;
  tone?: string;
  visual_treatment?: string;
}

export interface BrandPreset {
  id: string;
  name: string;
  tone: string;
  palette: string[];
  styleRules: string;
  campaignContext: string | null;
  platformVariants: Record<string, PlatformVariant>;
  isActive: boolean;
}

export interface CreateBrandPresetInput {
  name: string;
  tone: string;
  palette: string[];
  styleRules: string;
  campaignContext?: string | null;
  createdBy: string;
}

interface BrandPresetRow {
  id: string;
  name: string;
  tone: string;
  palette: unknown;
  style_rules: string;
  campaign_context: string | null;
  platform_variants: unknown;
  is_active: boolean;
}

const COLUMNS = "id, name, tone, palette, style_rules, campaign_context, platform_variants, is_active";

/** Only code allowed to query brand_presets. RLS permits admin/editor writes. */
export class BrandPresetRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listActive(): Promise<BrandPreset[]> {
    const { data, error } = await this.supabase
      .from("brand_presets")
      .select(COLUMNS)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .returns<BrandPresetRow[]>();
    if (error) throw new Error(`brand_presets query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }

  async getById(id: string): Promise<BrandPreset> {
    const { data, error } = await this.supabase
      .from("brand_presets")
      .select(COLUMNS)
      .eq("id", id)
      .maybeSingle<BrandPresetRow>();
    if (error) throw new Error(`brand_presets query failed: ${error.message}`);
    if (!data) throw new NotFoundError("Brand preset", id);
    return toDomain(data);
  }

  async update(
    id: string,
    input: {
      name: string;
      tone: string;
      palette: string[];
      styleRules: string;
      campaignContext: string | null;
    },
  ): Promise<BrandPreset> {
    const { data, error } = await this.supabase
      .from("brand_presets")
      .update({
        name: input.name,
        tone: input.tone,
        palette: input.palette,
        style_rules: input.styleRules,
        campaign_context: input.campaignContext,
      })
      .eq("id", id)
      .select(COLUMNS)
      .single<BrandPresetRow>();
    if (error) throw new Error(`brand_presets update failed: ${error.message}`);
    return toDomain(data);
  }

  /** Soft delete: keeps historical content_items that referenced the preset. */
  async deactivate(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("brand_presets")
      .update({ is_active: false })
      .eq("id", id);
    if (error) throw new Error(`brand_presets update failed: ${error.message}`);
  }

  async create(input: CreateBrandPresetInput): Promise<BrandPreset> {
    const { data, error } = await this.supabase
      .from("brand_presets")
      .insert({
        name: input.name,
        tone: input.tone,
        palette: input.palette,
        style_rules: input.styleRules,
        campaign_context: input.campaignContext ?? null,
        created_by: input.createdBy,
      })
      .select(COLUMNS)
      .single<BrandPresetRow>();
    if (error) throw new Error(`brand_presets insert failed: ${error.message}`);
    return toDomain(data);
  }
}

function toDomain(row: BrandPresetRow): BrandPreset {
  return {
    id: row.id,
    name: row.name,
    tone: row.tone,
    palette: Array.isArray(row.palette) ? (row.palette as string[]) : [],
    styleRules: row.style_rules,
    campaignContext: row.campaign_context,
    platformVariants:
      row.platform_variants && typeof row.platform_variants === "object"
        ? (row.platform_variants as Record<string, PlatformVariant>)
        : {},
    isActive: row.is_active,
  };
}
