import { getServerEnv, imageGenConfig } from "@/lib/config";
import { ProviderCreditsError, ProviderError } from "@/lib/errors";
import type {
  GenerateImageInput,
  GenerateImageResult,
  ImageGenProvider,
} from "@/providers/interfaces/ImageGenProvider";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  promptFeedback?: { blockReason?: string };
}

/**
 * Google Gemini image generation over REST (no SDK dependency).
 * Model ID comes from config only. Vendor errors are wrapped; quota/credit
 * exhaustion becomes ProviderCreditsError so an app-wide alert is raised.
 */
export class GeminiImageProvider implements ImageGenProvider {
  async generate(input: GenerateImageInput): Promise<GenerateImageResult> {
    const env = getServerEnv();
    const model = imageGenConfig.model;

    const parts: Array<Record<string, unknown>> = input.referenceImages.map((ref) => ({
      inlineData: { mimeType: ref.mimeType, data: ref.base64Data },
    }));
    parts.push({ text: input.prompt });

    let response: Response;
    try {
      response = await fetch(`${API_BASE}/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": env.GOOGLE_GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: input.aspectRatio },
          },
        }),
      });
    } catch {
      throw new ProviderError("gemini", "Network error calling image API", true);
    }

    if (!response.ok) {
      // 429 RESOURCE_EXHAUSTED = out of quota/credits → app-wide alert path.
      if (response.status === 429) {
        throw new ProviderCreditsError("gemini", "Gemini API quota/credits exhausted");
      }
      const retryable = response.status >= 500;
      throw new ProviderError("gemini", `Image API returned ${response.status}`, retryable);
    }

    const payload = (await response.json()) as GeminiResponse;

    if (payload.promptFeedback?.blockReason) {
      throw new ProviderError(
        "gemini",
        `Prompt blocked (${payload.promptFeedback.blockReason}) — rephrase and retry`,
      );
    }

    const imagePart = payload.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData?.data,
    );
    if (!imagePart?.inlineData) {
      throw new ProviderError("gemini", "Response contained no image data");
    }

    return {
      imageBytes: Uint8Array.from(Buffer.from(imagePart.inlineData.data, "base64")),
      mimeType: imagePart.inlineData.mimeType,
      model,
    };
  }
}
