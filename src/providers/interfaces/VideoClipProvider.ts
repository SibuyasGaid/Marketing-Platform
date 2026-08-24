export interface ClipInput {
  /** Signed URL to the source video; the provider range-seeks over HTTP. */
  sourceUrl: string;
  /** Segment in-point and out-point, in seconds. */
  startS: number;
  endS: number;
  /** Render 9:16 (Reels/Shorts) by center-cropping/scaling; else keep source. */
  vertical: boolean;
}

export interface ClipResult {
  bytes: Buffer;
  mimeType: string;
  durationS: number;
}

export interface ThumbnailInput {
  sourceUrl: string;
  /** Timestamp (seconds) to grab the frame from. */
  atS: number;
  /** Match the clip's framing (9:16 when the clip is vertical). */
  vertical: boolean;
}

export interface ThumbnailResult {
  bytes: Buffer;
  mimeType: string;
}

export interface BurnCaptionsInput {
  /** Signed URL to the source video (the clean render). */
  sourceUrl: string;
  /** SRT subtitle text to style and burn in. */
  srt: string;
}

export interface BurnCaptionsResult {
  bytes: Buffer;
  mimeType: string;
}

export interface AppendOutroInput {
  /** Signed URL to the main video. */
  sourceUrl: string;
  /** Signed URL to the outro clip appended to the end. */
  outroUrl: string;
}

export interface AppendOutroResult {
  bytes: Buffer;
  mimeType: string;
}

export interface MergeClipsInput {
  /** Signed URLs of the videos to stitch, in playback order (2 or more). */
  sourceUrls: string[];
}

export interface MergeClipsResult {
  bytes: Buffer;
  mimeType: string;
}

/**
 * Cuts a segment out of a source video into a small, web-ready clip, grabs a
 * thumbnail frame, and burns styled captions into a video. Behind an interface
 * so the ffmpeg implementation can be swapped for a media API (Mux, Cloudinary)
 * without touching the service layer (AGENTS.md rule 2).
 */
export interface VideoClipProvider {
  clip(input: ClipInput): Promise<ClipResult>;
  thumbnail(input: ThumbnailInput): Promise<ThumbnailResult>;
  /** Burns bold, centered, lower-third styled captions (from SRT) into a video. */
  burnCaptions(input: BurnCaptionsInput): Promise<BurnCaptionsResult>;
  /** Appends an outro clip to the end of a video (both normalized to 9:16). */
  appendOutro(input: AppendOutroInput): Promise<AppendOutroResult>;
  /** Stitches 2+ videos into one, each normalized to 9:16 (no AI, pure ffmpeg). */
  mergeClips(input: MergeClipsInput): Promise<MergeClipsResult>;
}
