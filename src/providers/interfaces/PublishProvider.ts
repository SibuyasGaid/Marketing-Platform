import type { Brand, ContentType, Platform } from "@/lib/domain";

/** Payload contract for social dispatch (PROJECT_PROMPT.md §7). */
export interface PublishPayload {
  content_item_id: string;
  platform: Platform;
  /** Machine key of the brand/page this post belongs to. */
  brand: Brand;
  /** Human-readable account name (e.g. "Demo Brand"). */
  brand_name: string;
  type: Exclude<ContentType, "copy_set">;
  caption: string;
  /** Short-lived signed Supabase Storage URLs. */
  asset_urls: string[];
  /**
   * Optional custom video cover/thumbnail (short-lived signed URL). Used for
   * IG Reels (cover_url) and, best-effort, Facebook video. Null = the platform
   * auto-picks a frame.
   */
  cover_url?: string | null;
  scheduled_for: string | null;
}

export interface DispatchResult {
  /** Provider-side reference (n8n dispatch id, or the platform post id). */
  dispatchId: string;
  /**
   * True when the provider published synchronously (e.g. direct platform APIs):
   * the item is `posted` now, no status callback will arrive. n8n leaves this
   * false and settles the item later via the publish-status webhook.
   */
  posted?: boolean;
  /** The live post URL, when known at dispatch time. */
  postUrl?: string | null;
}

/**
 * n8n webhook by default; Zernio drop-in behind the same interface.
 * Callers must have server-verified approval before calling dispatch —
 * this is the approval gate boundary (docs/SECURITY.md §4).
 */
export interface PublishProvider {
  dispatch(payload: PublishPayload): Promise<DispatchResult>;
}
