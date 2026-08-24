import { z } from "zod";
import { BRAND_NAMES, type Brand, type ImagePlatform } from "@/lib/domain";
import { ProviderCreditsError } from "@/lib/errors";
import { POST_CAPTIONS_SYSTEM } from "@/lib/prompts/contentPrompts";
import { completeStructured } from "@/lib/structured";
import { stripEmDashes } from "@/lib/text";
import type { TextModelProvider } from "@/providers/interfaces/TextModelProvider";
import type { UsageService } from "@/services/UsageService";

const CaptionsSchema = z
  .object({
    instagram: z.string().optional(),
    facebook: z.string().optional(),
    linkedin: z.string().optional(),
  })
  .catchall(z.string());

export interface CaptionRequest {
  brand: Brand;
  /** Display name of the account (falls back to the built-in brand name). */
  brandName?: string;
  /** Account voice / prompt context, if any. */
  brandContext?: string;
  /** The image description / topic the caption should reflect. */
  topic: string;
  /** Brand tone from the selected preset, if any. */
  tone: string;
  platforms: ImagePlatform[];
  idempotencyKey: string;
  createdBy: string | null;
}

/**
 * One text call produces a caption per requested platform (four platforms is
 * one call, not four — docs/API_OPTIMIZATION.md §3). Em dashes are stripped as
 * a hard brand rule. On any failure, falls back to the topic text so a post is
 * never left caption-less.
 */
export class PostCaptionService {
  constructor(
    private readonly textModel: TextModelProvider,
    private readonly usage: UsageService,
  ) {}

  async generate(request: CaptionRequest): Promise<Record<ImagePlatform, string>> {
    const fallback = Object.fromEntries(
      request.platforms.map((platform) => [platform, request.topic]),
    ) as Record<ImagePlatform, string>;

    try {
      const { value, completions } = await completeStructured(
        this.textModel,
        {
          system: POST_CAPTIONS_SYSTEM,
          user: [
            `Brand: ${request.brandName ?? BRAND_NAMES[request.brand] ?? request.brand}`,
            request.brandContext ? `Brand context: ${request.brandContext}` : "",
            `Tone: ${request.tone || "confident, direct"}`,
            `Requested platforms: ${request.platforms.join(", ")}`,
            "<post_brief>",
            request.topic,
            "</post_brief>",
          ]
            .filter((line) => line !== "")
            .join("\n"),
          taskType: "captions",
          tier: "mid",
          idempotencyKey: request.idempotencyKey,
        },
        CaptionsSchema,
      );
      for (const completion of completions) {
        await this.usage.recordTextUsage({
          provider: "anthropic",
          model: completion.model,
          taskType: "captions",
          inputTokens: completion.inputTokens,
          outputTokens: completion.outputTokens,
          createdBy: request.createdBy,
        });
      }
      const captions = {} as Record<ImagePlatform, string>;
      for (const platform of request.platforms) {
        const caption = value[platform];
        captions[platform] = caption ? stripEmDashes(caption) : request.topic;
      }
      return captions;
    } catch (error) {
      if (error instanceof ProviderCreditsError) {
        await this.usage.reportCreditsExhausted(error.provider, error.message);
      }
      // A caption failure must not block the image; fall back to the brief.
      return fallback;
    }
  }
}
