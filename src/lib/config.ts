import { z } from "zod";
import type { Platform } from "@/lib/domain";

/**
 * Server-side configuration. Validated lazily on first access so `next build`
 * (which runs without secrets) does not crash, but any runtime code path
 * touching config fails fast — with the *name* of the missing var only
 * (docs/SECURITY.md §1).
 *
 * Model IDs and token caps live here exclusively — never hardcoded at call
 * sites (docs/API_OPTIMIZATION.md §1, §3).
 */

/**
 * Optional vars arrive after launch (a key still with the team, an n8n
 * instance not yet provisioned). Blank/placeholder values are treated as
 * absent so the app boots; the owning provider throws a clear ProviderError
 * at call time instead.
 */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalSecret = z.preprocess(blankToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(blankToUndefined, z.url().optional());

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: optionalSecret,
  GOOGLE_GEMINI_API_KEY: z.string().min(1),
  HEYGEN_API_KEY: z.string().min(1),
  RESEND_API_KEY: optionalSecret,
  SENDGRID_API_KEY: optionalSecret,
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  // Publishing stays optional until n8n is provisioned. One webhook per
  // platform (approved posts route by platform); one shared HMAC secret.
  N8N_WEBHOOK_URL_INSTAGRAM: optionalUrl,
  N8N_WEBHOOK_URL_FACEBOOK: optionalUrl,
  N8N_WEBHOOK_URL_LINKEDIN: optionalUrl,
  N8N_WEBHOOK_URL_YOUTUBE: optionalUrl,
  N8N_WEBHOOK_SECRET: optionalSecret,
  // Direct social publishing (OAuth apps). Optional until provisioned; the
  // provider throws a clear error at call time when a platform isn't configured.
  META_APP_ID: optionalSecret,
  META_APP_SECRET: optionalSecret,
  LINKEDIN_CLIENT_ID: optionalSecret,
  LINKEDIN_CLIENT_SECRET: optionalSecret,
  GOOGLE_CLIENT_ID: optionalSecret,
  GOOGLE_CLIENT_SECRET: optionalSecret,
  // Base URL for OAuth redirect URIs. Set this per deployment; there is no
  // production domain baked into the repo.
  APP_URL: optionalUrl,
  // Optional key (hex or base64, 32 bytes) to encrypt stored OAuth tokens.
  SOCIAL_TOKEN_ENC_KEY: optionalSecret,
});

const DEFAULT_APP_URL = "http://localhost:3000";

/**
 * Base URL used to build OAuth redirect URIs. Deployments must set APP_URL;
 * the localhost fallback keeps local dev working and deliberately points at
 * nothing hosted.
 */
export function appBaseUrl(env: ServerEnv): string {
  return (env.APP_URL ?? DEFAULT_APP_URL).replace(/\/+$/, "");
}

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedEnv) return cachedEnv;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    // Names only — never values.
    throw new Error(`Invalid or missing environment variables: ${missing}`);
  }
  // Email keys are optional at boot (the key may arrive after launch);
  // EmailProvider throws a clear ProviderError at send time if absent.
  cachedEnv = parsed.data;
  return cachedEnv;
}

/** Test hook: reset the memoized env (used by config tests only). */
export function resetServerEnvCache(): void {
  cachedEnv = null;
}

/** Model tiering — docs/API_OPTIMIZATION.md §1. No top-tier models in MVP. */
export const modelTiers = {
  /** Segment scoring, classification, tagging, metadata extraction. */
  fast: "claude-haiku-4-5",
  /** Final marketing copy, LinkedIn long-form, email copy, digest synthesis. */
  mid: "claude-sonnet-4-6",
} as const;

/** Per-task max_tokens caps — docs/API_OPTIMIZATION.md §3. */
export const maxTokensByTask = {
  segmentScoring: 1000,
  segmentRanking: 1500,
  captions: 800,
  copySet: 2000,
  hookScript: 500,
  longFormCopy: 1500,
  competitorDigest: 2500,
} as const;

export type AiTaskType = keyof typeof maxTokensByTask;

/** Image generation — model ID lives here only (docs/API_OPTIMIZATION.md §1). */
export const imageGenConfig = {
  model: "gemini-3.1-flash-image",
  /**
   * Platform-aware output shapes (PROJECT_PROMPT.md §2: LinkedIn style is
   * distinct from IG/FB). Presets can override per platform via
   * platform_variants.aspect_ratio. IG + FB default to 4:5 portrait
   * (the 1080x1350 shape) — the brand's standard feed size.
   */
  aspectRatioByPlatform: {
    instagram: "4:5",
    facebook: "4:5",
    linkedin: "16:9",
    youtube: "16:9",
  } satisfies Record<Platform, string>,
} as const;

/** Transcription (Gemini multimodal) — a VOD is transcribed exactly once. */
export const transcriptionConfig = {
  model: "gemini-3.6-flash",
  /** Files at or below this size are sent inline; larger ones stream via the Files API. */
  maxInlineBytes: 15 * 1024 * 1024,
  maxOutputTokens: 60000,
} as const;

/** HeyGen avatar video hooks — the most expensive call in the system. */
export const heygenConfig = {
  /**
   * HeyGen voice_id used for avatar videos. This is our ElevenLabs voice,
   * imported into HeyGen via the ElevenLabs integration. Empty = fall back to
   * the first English voice on the account at runtime.
   */
  voiceId: "3ebf2b2870cf4195a131cdcdcd7cf0e5",
  /** Vertical short-form by default (IG/FB hooks). */
  dimension: { width: 720, height: 1280 },
  pollIntervalSeconds: 15,
  // ~20 min window. HeyGen renders take 5-10x the video length and can exceed
  // 10 min for longer scripts / under load; a too-short window abandoned videos
  // that were still rendering, leaving the item stuck in draft.
  maxPollAttempts: 80,
  /**
   * v3 render defaults. We call the v3 Photo Avatar pipeline (POST /v3/videos,
   * type:"avatar", avatar_iv engine) so the body/gestures animate — the old v2
   * talking_photo path only moved the mouth. `expressiveness` + `motionPrompt`
   * drive the dynamism; both are overridable per item from the composer.
   */
  engine: "avatar_iv" as const,
  resolution: "1080p" as const,
  aspectRatio: "9:16" as const,
  defaultExpressiveness: "high" as const,
  defaultMotionPrompt: "speaking to camera with natural hand gestures",
} as const;

/**
 * Vendor pricing estimates for ai_usage_log (docs/API_OPTIMIZATION.md §7).
 * These are estimates for spend transparency, not invoices — tune when vendors
 * change prices. Text models are priced per million tokens; media generation
 * is priced per unit because those vendors bill per generation, not per token.
 */
export const pricing = {
  textPerMTokUsd: {
    "claude-haiku-4-5": { input: 1, output: 5 },
    "claude-sonnet-4-6": { input: 3, output: 15 },
    "gemini-3.6-flash": { input: 0.3, output: 2.5 },
  } as Record<string, { input: number; output: number }>,
  /** Anthropic server-side web search: $10 per 1,000 searches. */
  webSearchPerRequestUsd: 0.01,
  imagePerGenerationUsd: {
    gemini: 0.04,
  } as Record<string, number>,
  /**
   * Per-SECOND video pricing (vendors that bill by length). HeyGen Avatar IV
   * Photo Avatar = $0.05/s (the engine we use). When a provider is here, cost is
   * rate × video duration; a 4s clip and a 60s clip differ accordingly.
   */
  videoPerSecondUsd: {
    heygen: 0.05,
  } as Record<string, number>,
  /**
   * Flat per-video pricing (vendors that bill per generation, not per second).
   * Also the fallback estimate for a per-second provider when the final duration
   * isn't known at log time.
   */
  videoPerGenerationUsd: {
    heygen: 2.0,
  } as Record<string, number>,
} as const;

export function estimateTextCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = pricing.textPerMTokUsd[model];
  if (!rate) return 0;
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}

/**
 * Abuse/spend controls — docs/SECURITY.md §7, docs/API_OPTIMIZATION.md §7.
 * Caps are enforced with Postgres counters (ai_usage_log), not Redis — at
 * internal-tool scale a DB count is plenty, and the real cost protections are
 * idempotent steps + persisted results + this budget.
 */
export const generationLimits = {
  /**
   * Daily generation guardrails. 0 = NO LIMIT (disabled per stakeholder
   * request 2026-07-30). Usage is still recorded to ai_usage_log for the spend
   * dashboard; these just don't block. Set a positive value to re-enable.
   */
  softDailyBudgetUsd: 0,
  perUserDailyGenerations: 0,
  /** Inngest concurrency ceilings per provider. */
  concurrency: { heygen: 3, llm: 5, imageGen: 5 },
} as const;

/** Max age for inbound webhook timestamps (replay defense) — docs/SECURITY.md §5. */
export const webhookMaxAgeMs = 5 * 60 * 1000;

/** The n8n webhook URL for a given platform (one workflow per platform). */
export function n8nWebhookUrlForPlatform(env: ServerEnv, platform: Platform): string | undefined {
  switch (platform) {
    case "instagram":
      return env.N8N_WEBHOOK_URL_INSTAGRAM;
    case "facebook":
      return env.N8N_WEBHOOK_URL_FACEBOOK;
    case "linkedin":
      return env.N8N_WEBHOOK_URL_LINKEDIN;
    case "youtube":
      return env.N8N_WEBHOOK_URL_YOUTUBE;
  }
}
