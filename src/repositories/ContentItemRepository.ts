import type { SupabaseClient } from "@supabase/supabase-js";
import type { Brand, ContentStatus, ContentType, Platform } from "@/lib/domain";
import { NotFoundError } from "@/lib/errors";

export interface OutputAsset {
  bucket: string;
  path: string;
  mimeType: string;
}

export interface ImageGenerationInputs {
  /** Single image: the content (the exact text/message to render). */
  prompt: string;
  /** Single image: optional design note (styling only; never rendered as text). */
  designNote: string;
  brandPresetId: string;
  avatarReferenceIds: string[];
  /** Saved reusable brand references (logos, product shots, style boards). */
  brandReferenceIds: string[];
  /** One-off style/brand reference uploads for this generation (storage paths). */
  referenceImagePaths: string[];
  /**
   * One-off uploads of PEOPLE to depict in this generation (storage paths).
   * Unlike referenceImagePaths (style guidance), these are likenesses the
   * model is told to reproduce accurately.
   */
  personImagePaths: string[];
  /** Per-slide content (the exact text/message) for a carousel (2+ = carousel). */
  slides: string[];
  /** Per-slide design notes, parallel to slides (styling only; never rendered). */
  slideDesignNotes: string[];
  /** Carousel slide indexes that carry the account logo. Empty = none. */
  logoSlideIndexes: number[];
  /** Carousel: slide indexes to regenerate on the next run. Empty = all. */
  pendingSlideRegen: number[];
  adjustmentNotes: string[];
  /**
   * Set when the next run is an in-place edit of the current output rather
   * than a fresh regeneration. Cleared once the edit is applied.
   */
  pendingEdit: string | null;
  /** One-off storage path of a region mask for the pending edit, if any. */
  pendingEditMaskPath: string | null;
  /** Instructions applied by past edits, for the version trail. */
  editHistory: string[];
  [key: string]: unknown;
}

/** Free-form inputs for clips, copy sets, and video hooks (Phase 3). */
export type GenerationInputs = Record<string, unknown>;

export interface ContentItem {
  id: string;
  type: ContentType;
  /** Primary platform — drives the output shape and is the first destination. */
  platform: Platform;
  /** All platforms this one post publishes to on approval (includes platform). */
  targetPlatforms: Platform[];
  brand: Brand;
  status: ContentStatus;
  title: string | null;
  caption: string | null;
  generationInputs: ImageGenerationInputs;
  /** Untouched generation_inputs for non-image types (clip/copy_set/hook). */
  rawGenerationInputs: GenerationInputs;
  outputAssets: OutputAsset[];
  editComment: string | null;
  scheduledDate: string | null;
  /** Exact publish time for a scheduled item (null unless status=scheduled). */
  scheduledFor: string | null;
  sourceVideoId: string | null;
  brandPresetId: string | null;
  platformPostUrl: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface ContentItemRow {
  id: string;
  type: ContentType;
  platform: Platform;
  target_platforms?: unknown;
  brand: Brand;
  status: ContentStatus;
  title: string | null;
  caption: string | null;
  generation_inputs: unknown;
  output_assets: unknown;
  edit_comment: string | null;
  scheduled_date: string | null;
  scheduled_for: string | null;
  source_video_id: string | null;
  brand_preset_id: string | null;
  platform_post_url: string | null;
  created_by: string | null;
  created_at: string;
}

const COLUMNS =
  "id, type, platform, target_platforms, brand, status, title, caption, generation_inputs, output_assets, edit_comment, scheduled_date, scheduled_for, source_video_id, brand_preset_id, platform_post_url, created_by, created_at";

/**
 * Only code allowed to touch content_items. Service-role only — clients have
 * read-only RLS so the state machine can't be bypassed (docs/SECURITY.md §2).
 * Status writes must come from services that ran assertTransition.
 */
export class ContentItemRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async create(input: {
    type: ContentType;
    platform: Platform;
    /** All destination platforms; defaults to [platform] when omitted. */
    targetPlatforms?: Platform[];
    brand: Brand;
    generationInputs: GenerationInputs;
    brandPresetId: string | null;
    createdBy: string;
    title?: string | null;
    caption?: string | null;
    scheduledDate?: string | null;
    sourceVideoId?: string | null;
  }): Promise<ContentItem> {
    const targets =
      input.targetPlatforms && input.targetPlatforms.length > 0
        ? input.targetPlatforms
        : [input.platform];
    const { data, error } = await this.supabase
      .from("content_items")
      .insert({
        type: input.type,
        platform: input.platform,
        target_platforms: targets,
        brand: input.brand,
        status: "draft",
        title: input.title ?? null,
        caption: input.caption ?? null,
        scheduled_date: input.scheduledDate ?? null,
        source_video_id: input.sourceVideoId ?? null,
        generation_inputs: input.generationInputs,
        brand_preset_id: input.brandPresetId,
        created_by: input.createdBy,
      })
      .select(COLUMNS)
      .single<ContentItemRow>();
    if (error) throw new Error(`content_items insert failed: ${error.message}`);
    return toDomain(data);
  }

  async getById(id: string): Promise<ContentItem> {
    const { data, error } = await this.supabase
      .from("content_items")
      .select(COLUMNS)
      .eq("id", id)
      .maybeSingle<ContentItemRow>();
    if (error) throw new Error(`content_items query failed: ${error.message}`);
    if (!data) throw new NotFoundError("Content item", id);
    return toDomain(data);
  }

  async listByType(type: ContentType, limit: number): Promise<ContentItem[]> {
    const { data, error } = await this.supabase
      .from("content_items")
      .select(COLUMNS)
      .eq("type", type)
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<ContentItemRow[]>();
    if (error) throw new Error(`content_items query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }

  /**
   * Count of studio videos still rendering — draft, no output yet (output_assets
   * is `[]`, its non-null default), studio-flagged, and not failed — for the nav
   * "working" cue. A head-count returns just the number (no rows to transfer or
   * parse), and it runs on every app navigation, so it's kept cheap. Falls back
   * to a row-scan if the jsonb/array filters aren't supported, so the badge can
   * never break — it just gets slower.
   */
  async countRenderingStudioVideos(): Promise<number> {
    try {
      const { count, error } = await this.supabase
        .from("content_items")
        .select("id", { count: "exact", head: true })
        .eq("type", "heygen_video")
        .eq("status", "draft")
        .eq("output_assets", "[]")
        .eq("generation_inputs->>studio", "true")
        .is("generation_inputs->>studioError", null);
      if (error) throw new Error(error.message);
      return count ?? 0;
    } catch {
      const items = await this.listByType("heygen_video", 60);
      return items.filter(
        (item) =>
          item.status === "draft" &&
          item.rawGenerationInputs.studio === true &&
          item.outputAssets.length === 0 &&
          !item.rawGenerationInputs.studioError,
      ).length;
    }
  }

  /**
   * A compact signature of studio videos still rendering (sorted ids) for the
   * client status poll. It changes when a render starts, completes (gains
   * output), or fails (gains a studioError) — i.e. when the Generate Videos page
   * needs to pull fresh content. Same filter as countRenderingStudioVideos, with
   * the same row-scan fallback so a jsonb-filter quirk can't break polling.
   */
  async renderingStudioVideosSignature(): Promise<string> {
    try {
      const { data, error } = await this.supabase
        .from("content_items")
        .select("id")
        .eq("type", "heygen_video")
        .eq("status", "draft")
        .eq("output_assets", "[]")
        .eq("generation_inputs->>studio", "true")
        .is("generation_inputs->>studioError", null)
        .order("id", { ascending: true })
        .returns<{ id: string }[]>();
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => row.id).join(",");
    } catch {
      const items = await this.listByType("heygen_video", 60);
      return items
        .filter(
          (item) =>
            item.status === "draft" &&
            item.rawGenerationInputs.studio === true &&
            item.outputAssets.length === 0 &&
            !item.rawGenerationInputs.studioError,
        )
        .map((item) => item.id)
        .sort()
        .join(",");
    }
  }

  /** Library: every item of every type/status, newest first. */
  async listAll(limit: number): Promise<ContentItem[]> {
    const { data, error } = await this.supabase
      .from("content_items")
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<ContentItemRow[]>();
    if (error) throw new Error(`content_items query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }

  /** Queue board: everything past draft, newest first. */
  async listForQueue(limit: number): Promise<ContentItem[]> {
    const { data, error } = await this.supabase
      .from("content_items")
      .select(COLUMNS)
      .neq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<ContentItemRow[]>();
    if (error) throw new Error(`content_items query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }

  async setStatus(id: string, status: ContentStatus): Promise<ContentItem> {
    const { data, error } = await this.supabase
      .from("content_items")
      .update({ status })
      .eq("id", id)
      .select(COLUMNS)
      .single<ContentItemRow>();
    if (error) throw new Error(`content_items update failed: ${error.message}`);
    return toDomain(data);
  }

  /**
   * Compare-and-set status: only writes when the row still holds `from`.
   * Returns null when another writer already moved it — the guard that keeps
   * a double-clicked Approve from dispatching twice.
   */
  async setStatusIfCurrent(
    id: string,
    from: ContentStatus,
    to: ContentStatus,
  ): Promise<ContentItem | null> {
    const { data, error } = await this.supabase
      .from("content_items")
      .update({ status: to })
      .eq("id", id)
      .eq("status", from)
      .select(COLUMNS)
      .maybeSingle<ContentItemRow>();
    if (error) throw new Error(`content_items update failed: ${error.message}`);
    return data ? toDomain(data) : null;
  }

  async setOutputs(id: string, outputAssets: OutputAsset[]): Promise<void> {
    const { error } = await this.supabase
      .from("content_items")
      .update({ output_assets: outputAssets })
      .eq("id", id);
    if (error) throw new Error(`content_items update failed: ${error.message}`);
  }

  async setGenerationInputs(id: string, generationInputs: GenerationInputs): Promise<void> {
    const { error } = await this.supabase
      .from("content_items")
      .update({ generation_inputs: generationInputs })
      .eq("id", id);
    if (error) throw new Error(`content_items update failed: ${error.message}`);
  }

  /** Where the item went live, reported by the n8n publish-status callback. */
  async setPlatformPostUrl(id: string, platformPostUrl: string | null): Promise<void> {
    const { error } = await this.supabase
      .from("content_items")
      .update({ platform_post_url: platformPostUrl })
      .eq("id", id);
    if (error) throw new Error(`content_items update failed: ${error.message}`);
  }

  /** Sets (or clears) the planned calendar day (date only) for an item. */
  async setScheduledDate(id: string, scheduledDate: string | null): Promise<void> {
    const { error } = await this.supabase
      .from("content_items")
      .update({ scheduled_date: scheduledDate })
      .eq("id", id);
    if (error) throw new Error(`content_items update failed: ${error.message}`);
  }

  /** Sets (or clears) the exact publish time for a scheduled item. */
  async setScheduledFor(id: string, scheduledFor: string | null): Promise<void> {
    const { error } = await this.supabase
      .from("content_items")
      .update({ scheduled_for: scheduledFor })
      .eq("id", id);
    if (error) throw new Error(`content_items update failed: ${error.message}`);
  }

  /** Updates the destination platforms for an item (before it publishes). */
  async setTargetPlatforms(id: string, platforms: Platform[]): Promise<void> {
    const { error } = await this.supabase
      .from("content_items")
      .update({ target_platforms: platforms })
      .eq("id", id);
    if (error) throw new Error(`content_items update failed: ${error.message}`);
  }

  /** Scheduled items whose publish time has arrived (for the dispatch cron). */
  async listDueScheduled(nowIso: string, limit: number): Promise<ContentItem[]> {
    const { data, error } = await this.supabase
      .from("content_items")
      .select(COLUMNS)
      .eq("status", "scheduled")
      .lte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(limit)
      .returns<ContentItemRow[]>();
    if (error) throw new Error(`content_items query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }

  async setEditComment(id: string, editComment: string | null): Promise<void> {
    const { error } = await this.supabase
      .from("content_items")
      .update({ edit_comment: editComment })
      .eq("id", id);
    if (error) throw new Error(`content_items update failed: ${error.message}`);
  }

  /** Reviewer edit of the post's caption/description before publishing. */
  async setCaption(id: string, caption: string): Promise<void> {
    const { error } = await this.supabase
      .from("content_items")
      .update({ caption })
      .eq("id", id);
    if (error) throw new Error(`content_items update failed: ${error.message}`);
  }

  /**
   * Permanently deletes the item. `approval_events` cascade; `jobs` and
   * `ai_usage_log` detach (on delete set null) so spend history is preserved.
   * Storage objects are removed separately by the caller (service layer).
   */
  async deleteById(id: string): Promise<void> {
    const { error } = await this.supabase.from("content_items").delete().eq("id", id);
    if (error) throw new Error(`content_items delete failed: ${error.message}`);
  }
}

function toDomain(row: ContentItemRow): ContentItem {
  const raw = (row.generation_inputs ?? {}) as GenerationInputs;
  const inputs = raw as ImageGenerationInputs;
  const targetPlatforms =
    Array.isArray(row.target_platforms) && row.target_platforms.length > 0
      ? (row.target_platforms as Platform[])
      : [row.platform];
  return {
    id: row.id,
    type: row.type,
    platform: row.platform,
    targetPlatforms,
    brand: row.brand,
    status: row.status,
    title: row.title,
    caption: row.caption,
    generationInputs: {
      prompt: typeof inputs.prompt === "string" ? inputs.prompt : "",
      designNote: typeof inputs.designNote === "string" ? inputs.designNote : "",
      brandPresetId: typeof inputs.brandPresetId === "string" ? inputs.brandPresetId : "",
      avatarReferenceIds: Array.isArray(inputs.avatarReferenceIds)
        ? (inputs.avatarReferenceIds as string[])
        : [],
      brandReferenceIds: Array.isArray(inputs.brandReferenceIds)
        ? (inputs.brandReferenceIds as string[])
        : [],
      referenceImagePaths: Array.isArray(inputs.referenceImagePaths)
        ? (inputs.referenceImagePaths as string[])
        : [],
      personImagePaths: Array.isArray(inputs.personImagePaths)
        ? (inputs.personImagePaths as string[])
        : [],
      slides: Array.isArray(inputs.slides) ? (inputs.slides as string[]) : [],
      slideDesignNotes: Array.isArray(inputs.slideDesignNotes)
        ? (inputs.slideDesignNotes as string[])
        : [],
      logoSlideIndexes: Array.isArray(inputs.logoSlideIndexes)
        ? (inputs.logoSlideIndexes as number[])
        : [],
      pendingSlideRegen: Array.isArray(inputs.pendingSlideRegen)
        ? (inputs.pendingSlideRegen as number[])
        : [],
      adjustmentNotes: Array.isArray(inputs.adjustmentNotes)
        ? (inputs.adjustmentNotes as string[])
        : [],
      pendingEdit: typeof inputs.pendingEdit === "string" ? inputs.pendingEdit : null,
      pendingEditMaskPath:
        typeof inputs.pendingEditMaskPath === "string" ? inputs.pendingEditMaskPath : null,
      editHistory: Array.isArray(inputs.editHistory) ? (inputs.editHistory as string[]) : [],
    },
    rawGenerationInputs: raw,
    outputAssets: Array.isArray(row.output_assets) ? (row.output_assets as OutputAsset[]) : [],
    editComment: row.edit_comment,
    scheduledDate: row.scheduled_date,
    scheduledFor: row.scheduled_for,
    sourceVideoId: row.source_video_id,
    brandPresetId: row.brand_preset_id,
    platformPostUrl: row.platform_post_url,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
