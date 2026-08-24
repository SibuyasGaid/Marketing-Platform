export interface ReferenceImage {
  /** Base64-encoded image bytes. */
  base64Data: string;
  mimeType: string;
}

export interface GenerateImageInput {
  prompt: string;
  /** Platform-derived aspect ratio, e.g. "1:1" (IG), "16:9" (LinkedIn). */
  aspectRatio: string;
  /** Avatar reference images to condition the output on (Alex/Jordan). */
  referenceImages: ReferenceImage[];
  /** Stable key: retried jobs must not re-bill generation. */
  idempotencyKey: string;
}

export interface GenerateImageResult {
  /** Raw image bytes; caller stores in Supabase Storage immediately. */
  imageBytes: Uint8Array;
  mimeType: string;
  model: string;
}

/** Google Gemini implementation in MVP. */
export interface ImageGenProvider {
  generate(input: GenerateImageInput): Promise<GenerateImageResult>;
}
