import type { ActionState } from "@/app/(app)/queue/actions";
import type { ContentStatus, Platform } from "@/lib/domain";

export interface AuditEntryView {
  id: string;
  action: "approved" | "edits_requested";
  reviewerEmail: string | null;
  comment: string | null;
  createdAt: string;
}

export interface QueueItemView {
  id: string;
  type: string;
  platform: Platform;
  /** All destinations this one post publishes to. */
  targetPlatforms: Platform[];
  /** Platforms already posted to (for reposting to new ones after it's live). */
  postedPlatforms: Platform[];
  brandName: string;
  status: ContentStatus;
  caption: string | null;
  previewUrl: string | null;
  /** All slide images, in order, when this is a carousel (else empty). */
  slideUrls: string[];
  /** Playable video: a clip's source video, or a finished HeyGen render. */
  videoUrl: string | null;
  /** For clips, the segment in/out (seconds) to preview within the source. */
  clipStartS: number | null;
  clipEndS: number | null;
  isVideo: boolean;
  /** True when a captioned version has been generated alongside the original. */
  hasCaptionedVersion: boolean;
  /** True when the captioned version is the active (served + published) one. */
  captionsActive: boolean;
  /** True when subtitles were requested at generation (a hint to add them now). */
  captionsRequested: boolean;
  /** True while a caption burn is in progress (server-persisted). */
  captionsPending: boolean;
  /** True when the account's outro has been appended. */
  hasOutro: boolean;
  /** True while an outro append is in progress (server-persisted). */
  outroPending: boolean;
  /** True when this item's account has an outro clip configured. */
  accountHasOutro: boolean;
  editComment: string | null;
  platformPostUrl: string | null;
  bucketDate: string;
  scheduledDate: string | null;
  /** Exact publish time (ISO) when this item is scheduled; else null. */
  scheduledFor: string | null;
  prompt: string;
  audit: AuditEntryView[];
}

export const initialState: ActionState = { error: null };

export const PLATFORM_ICON: Record<Platform, string> = {
  instagram: "IG",
  facebook: "FB",
  linkedin: "LI",
  youtube: "YT",
};

/** Statuses that still need a human decision. */
export const ACTIONABLE: ContentStatus[] = ["pending_approval"];
