export interface TranscriptSegment {
  startS: number;
  endS: number;
  text: string;
}

export interface TranscribeInput {
  /** Short-lived signed URL of the stored VOD (or a direct media URL). */
  sourceUrl: string;
  mimeType: string;
  sizeBytes: number | null;
  /** Stable key: a VOD is transcribed exactly once (docs/API_OPTIMIZATION.md §2). */
  idempotencyKey: string;
}

export interface TranscribeResult {
  fullText: string;
  segments: TranscriptSegment[];
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Gemini multimodal implementation in MVP (~cents per hour of video). */
export interface TranscriptionProvider {
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}
