/** Optional scene background for the video. */
export type VideoBackground =
  | { type: "color"; value: string }
  | { type: "image"; url: string };

/** Energy/range of avatar body movement (HeyGen Avatar IV). */
export type AvatarExpressiveness = "low" | "medium" | "high";

export interface GenerateAvatarVideoInput {
  /** Script the avatar speaks. */
  script: string;
  /** Provider-side avatar/asset ID (uploaded once, referenced thereafter). */
  avatarAssetId: string;
  /** Optional background (solid color or image URL); omitted = provider default. */
  background?: VideoBackground;
  /**
   * Natural-language body-motion/gesture control (e.g. "gesturing while
   * presenting"). Omitted = provider default. Makes the avatar dynamic instead
   * of only moving the mouth.
   */
  motionPrompt?: string;
  /** Movement energy; omitted = provider default. */
  expressiveness?: AvatarExpressiveness;
  /** Stable key: HeyGen is the most expensive call in the system — never re-bill on retry. */
  idempotencyKey: string;
}

export interface AvatarVideoJob {
  providerJobId: string;
  status: "queued" | "processing" | "completed" | "failed";
  /** Clean render. Download + store immediately when set (we caption on demand). */
  videoUrl?: string;
  /** Final video length in seconds (set when completed) — HeyGen bills per second. */
  durationSeconds?: number;
  errorMessage?: string;
}

/**
 * A prompt-driven "visual clip" (HeyGen Video Agent): a whole scene composed
 * from a text prompt, with an optional voice and reference images to steer it.
 * No registered avatar. Text-to-display is folded into the prompt by the caller.
 */
export interface GenerateClipInput {
  /** Full composed prompt: visuals + on-screen text + the narration script. */
  prompt: string;
  /** Voice for narration; omitted = the agent picks one. */
  voiceId?: string;
  /** Reference image asset IDs (uploaded to HeyGen) that steer the visuals. */
  referenceAssetIds?: string[];
  /** "portrait" (9:16) or "landscape" (16:9). */
  orientation?: "portrait" | "landscape";
  /** Stable key: never re-bill on retry. */
  idempotencyKey: string;
}

/**
 * The Video Agent is two-phase: a session is created first, then a video_id is
 * assigned once rendering begins. We carry the sessionId through polling.
 */
export interface ClipJob {
  /** Video Agent session id (poll target until a video_id is assigned). */
  sessionId: string;
}

/** HeyGen implementation in MVP. Poll-based — no unauthenticated callbacks (docs/SECURITY.md §5). */
export interface VideoProvider {
  /** Upload a reference image once; the returned asset ID is stored and reused. */
  uploadAvatarAsset(input: { base64Data: string; mimeType: string }): Promise<{ assetId: string }>;
  startGeneration(input: GenerateAvatarVideoInput): Promise<AvatarVideoJob>;
  getJobStatus(providerJobId: string): Promise<AvatarVideoJob>;
  /** Upload an image to the provider and return its asset id (for clip references). */
  uploadImageAsset(input: { base64Data: string; mimeType: string }): Promise<{ assetId: string }>;
  /** Start a prompt-driven visual clip (Video Agent); returns the session id. */
  startClip(input: GenerateClipInput): Promise<ClipJob>;
  /**
   * Poll a clip by session id. Resolves the session's video_id then the video's
   * status, so callers see the same shape as avatar jobs (queued/…/completed).
   */
  getClipStatus(sessionId: string): Promise<AvatarVideoJob>;
}
