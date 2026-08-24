import { getServerEnv, heygenConfig } from "@/lib/config";
import { ProviderCreditsError, ProviderError } from "@/lib/errors";
import type {
  AvatarVideoJob,
  ClipJob,
  GenerateAvatarVideoInput,
  GenerateClipInput,
  VideoProvider,
} from "@/providers/interfaces/VideoProvider";

const API_BASE = "https://api.heygen.com";

interface HeyGenEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string } | string | null;
}

/**
 * HeyGen avatar video generation over the v3 REST API. Pay-as-you-go API
 * credits (a prepaid USD wallet — the dashboard Free/Creator/Pro plans are the
 * separate Studio product and don't apply here).
 *
 * We use the Photo Avatar pipeline: a person's photo is registered once as a
 * reusable Photo Avatar (`avatar_id`), then videos are generated with
 * `type:"avatar"` on the Avatar IV engine, which animates body + gestures
 * (`expressiveness` / `motion_prompt`). The old v2 `talking_photo` path only
 * moved the mouth, so the body looked frozen — this replaces it.
 */
export class HeyGenVideoProvider implements VideoProvider {
  private cachedVoiceId: string | null = null;

  /**
   * Registers a person's photo as a reusable Photo Avatar and returns its
   * `avatar_id`. Two calls: upload the bytes as an asset, then create the photo
   * avatar from that asset. The returned id is persisted and reused for every
   * future video of that person.
   */
  async uploadAvatarAsset(input: { base64Data: string; mimeType: string }): Promise<{ assetId: string }> {
    const env = getServerEnv();
    // 1) Upload the image bytes → asset_id.
    const assetId = await this.uploadAsset(input);

    // 2) Create a Photo Avatar from that asset → reusable avatar_id (look id).
    const avatarRes = await fetch(`${API_BASE}/v3/avatars`, {
      method: "POST",
      headers: { "x-api-key": env.HEYGEN_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        type: "photo",
        name: `avatar-${Date.now()}`,
        file: { type: "asset_id", asset_id: assetId },
      }),
    }).catch(() => {
      throw new ProviderError("heygen", "Network error creating photo avatar", true);
    });
    const avatarPayload = (await avatarRes.json()) as HeyGenEnvelope<{
      avatar_item?: { id?: string };
    }>;
    const avatarId = avatarPayload.data?.avatar_item?.id;
    if (!avatarRes.ok || !avatarId) {
      this.throwMapped(avatarRes.status, avatarPayload, "Photo avatar creation failed");
    }
    return { assetId: avatarId! };
  }

  /** Uploads image bytes to HeyGen assets; returns the reusable asset_id. */
  async uploadImageAsset(input: { base64Data: string; mimeType: string }): Promise<{ assetId: string }> {
    return { assetId: await this.uploadAsset(input) };
  }

  /** POST /v3/assets (multipart, ≤32MB) → asset_id. Shared by avatar + clip refs. */
  private async uploadAsset(input: { base64Data: string; mimeType: string }): Promise<string> {
    const env = getServerEnv();
    const bytes = Buffer.from(input.base64Data, "base64");
    const ext = input.mimeType.includes("png") ? "png" : "jpg";
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: input.mimeType || "image/jpeg" }),
      `ref.${ext}`,
    );
    const res = await fetch(`${API_BASE}/v3/assets`, {
      method: "POST",
      headers: { "x-api-key": env.HEYGEN_API_KEY },
      body: form,
    }).catch(() => {
      throw new ProviderError("heygen", "Network error uploading image", true);
    });
    const payload = (await res.json()) as HeyGenEnvelope<{ asset_id?: string }>;
    if (!res.ok || !payload.data?.asset_id) {
      this.throwMapped(res.status, payload, "Image upload failed");
    }
    return payload.data!.asset_id!;
  }

  /**
   * Starts a prompt-driven visual clip via the Video Agent (POST /v3/video-agents,
   * mode "generate"). The agent composes the whole scene from the prompt; optional
   * reference images (files) steer it toward a predictable look. Returns the
   * session id — the video_id is assigned later and resolved during polling.
   */
  async startClip(input: GenerateClipInput): Promise<ClipJob> {
    const env = getServerEnv();
    const voiceId = input.voiceId ?? (await this.resolveVoiceId().catch(() => undefined));
    const files = (input.referenceAssetIds ?? []).map((assetId) => ({
      type: "asset_id",
      asset_id: assetId,
    }));
    const response = await fetch(`${API_BASE}/v3/video-agents`, {
      method: "POST",
      headers: { "x-api-key": env.HEYGEN_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        prompt: input.prompt,
        mode: "generate",
        orientation: input.orientation ?? "portrait",
        ...(voiceId ? { voice_id: voiceId } : {}),
        ...(files.length > 0 ? { files } : {}),
        callback_id: input.idempotencyKey,
      }),
    }).catch(() => {
      throw new ProviderError("heygen", "Network error starting clip generation", true);
    });
    const payload = (await response.json()) as HeyGenEnvelope<{ session_id?: string }>;
    if (!response.ok || !payload.data?.session_id) {
      this.throwMapped(response.status, payload, "Clip generation request failed");
    }
    return { sessionId: payload.data!.session_id! };
  }

  /**
   * Polls a Video Agent clip: first the session (until a video_id is assigned),
   * then the video itself. Maps both phases onto the shared AvatarVideoJob shape.
   */
  async getClipStatus(sessionId: string): Promise<AvatarVideoJob> {
    const env = getServerEnv();
    const sessionRes = await fetch(
      `${API_BASE}/v3/video-agents/${encodeURIComponent(sessionId)}`,
      { headers: { "x-api-key": env.HEYGEN_API_KEY } },
    ).catch(() => {
      throw new ProviderError("heygen", "Network error checking clip status", true);
    });
    const sessionPayload = (await sessionRes.json()) as HeyGenEnvelope<{
      status?: string;
      video_id?: string | null;
    }>;
    if (!sessionRes.ok || !sessionPayload.data?.status) {
      this.throwMapped(sessionRes.status, sessionPayload, "Clip status check failed");
    }
    const session = sessionPayload.data!;
    if (session.status === "failed") {
      return { providerJobId: sessionId, status: "failed", errorMessage: "Clip generation failed" };
    }
    // Not rendering yet — still thinking/composing.
    if (!session.video_id) {
      return { providerJobId: sessionId, status: "processing" };
    }
    // Rendering has started — poll the concrete video for the final result.
    return this.getJobStatus(session.video_id);
  }

  async startGeneration(input: GenerateAvatarVideoInput): Promise<AvatarVideoJob> {
    const env = getServerEnv();
    const voiceId = await this.resolveVoiceId();

    // Background: solid color or an image URL (v3 shape is identical to v2).
    const background =
      input.background?.type === "color"
        ? { type: "color", value: input.background.value }
        : input.background?.type === "image"
          ? { type: "image", url: input.background.url }
          : undefined;

    const motionPrompt = (input.motionPrompt ?? heygenConfig.defaultMotionPrompt).trim();
    const expressiveness = input.expressiveness ?? heygenConfig.defaultExpressiveness;

    const response = await fetch(`${API_BASE}/v3/videos`, {
      method: "POST",
      headers: { "x-api-key": env.HEYGEN_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        type: "avatar",
        avatar_id: input.avatarAssetId,
        script: input.script,
        voice_id: voiceId,
        engine: { type: heygenConfig.engine },
        resolution: heygenConfig.resolution,
        aspect_ratio: heygenConfig.aspectRatio,
        expressiveness,
        ...(motionPrompt ? { motion_prompt: motionPrompt } : {}),
        ...(background ? { background } : {}),
        // No caption request — HeyGen always returns the clean video_url. We burn
        // our own bold styled captions on demand (via transcription + ffmpeg),
        // so the render step stays fast and never re-encodes here.
        title: input.idempotencyKey,
      }),
    }).catch(() => {
      throw new ProviderError("heygen", "Network error starting video generation", true);
    });

    const payload = (await response.json()) as HeyGenEnvelope<{ video_id?: string }>;
    if (!response.ok || !payload.data?.video_id) {
      this.throwMapped(response.status, payload, "Video generation request failed");
    }
    return { providerJobId: payload.data!.video_id!, status: "queued" };
  }

  async getJobStatus(providerJobId: string): Promise<AvatarVideoJob> {
    const env = getServerEnv();
    const response = await fetch(`${API_BASE}/v3/videos/${encodeURIComponent(providerJobId)}`, {
      headers: { "x-api-key": env.HEYGEN_API_KEY },
    }).catch(() => {
      throw new ProviderError("heygen", "Network error checking video status", true);
    });

    const payload = (await response.json()) as HeyGenEnvelope<{
      status?: string;
      // Clean render — we always store this and caption on demand ourselves.
      video_url?: string;
      // Final length in seconds (set when completed) — used to bill per second.
      duration?: number;
      failure_message?: string;
    }>;
    if (!response.ok || !payload.data?.status) {
      this.throwMapped(response.status, payload, "Video status check failed");
    }

    const data = payload.data!;
    const status =
      data.status === "completed"
        ? "completed"
        : data.status === "failed"
          ? "failed"
          : data.status === "pending" || data.status === "waiting"
            ? "queued"
            : "processing";

    return {
      providerJobId,
      status,
      videoUrl: data.video_url,
      durationSeconds: typeof data.duration === "number" ? data.duration : undefined,
      errorMessage: data.failure_message,
    };
  }

  /** Config voice wins; otherwise pick the first English voice on the account once. */
  private async resolveVoiceId(): Promise<string> {
    if (heygenConfig.voiceId) return heygenConfig.voiceId;
    if (this.cachedVoiceId) return this.cachedVoiceId;

    const env = getServerEnv();
    const response = await fetch(`${API_BASE}/v3/voices`, {
      headers: { "x-api-key": env.HEYGEN_API_KEY },
    }).catch(() => {
      throw new ProviderError("heygen", "Network error listing voices", true);
    });
    const payload = (await response.json()) as HeyGenEnvelope<{
      voices?: Array<{ voice_id: string; language?: string }>;
    }>;
    const voices = payload.data?.voices ?? [];
    const english = voices.find((voice) => voice.language?.toLowerCase().startsWith("en"));
    const chosen = english ?? voices[0];
    if (!chosen) throw new ProviderError("heygen", "No voices available on this account");
    this.cachedVoiceId = chosen.voice_id;
    return this.cachedVoiceId;
  }

  private throwMapped(
    status: number,
    payload: HeyGenEnvelope<unknown>,
    fallback: string,
  ): never {
    const code =
      typeof payload.error === "object" && payload.error
        ? (payload.error.code ?? "").toString().toLowerCase()
        : "";
    const message =
      typeof payload.error === "object" && payload.error
        ? (payload.error.message ?? fallback)
        : fallback;
    if (status === 402 || code.includes("quota") || code.includes("credit") || code.includes("insufficient")) {
      throw new ProviderCreditsError("heygen", "HeyGen API credits exhausted — top up the wallet");
    }
    throw new ProviderError("heygen", `${fallback}: ${message}`, status === 429 || status >= 500);
  }
}
