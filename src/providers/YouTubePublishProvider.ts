import { ProviderError } from "@/lib/errors";
import { refreshAccessToken, uploadVideo, type YouTubePrivacy } from "@/lib/youtube";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SocialConnectionRepository } from "@/repositories/SocialConnectionRepository";
import type { DispatchResult, PublishPayload, PublishProvider } from "@/providers/interfaces/PublishProvider";

/** Refresh the access token when it expires within this window. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** Approved videos publish live immediately, matching the other platforms. */
const DEFAULT_PRIVACY: YouTubePrivacy = "public";

/**
 * Uploads approved clips and avatar videos to the account's connected YouTube
 * channel. Video only — image posts are never routed here. Synchronous: returns
 * `posted: true` with the watch URL.
 */
export class YouTubePublishProvider implements PublishProvider {
  async dispatch(payload: PublishPayload): Promise<DispatchResult> {
    if (payload.type === "image_post") {
      throw new ProviderError("youtube", "YouTube only accepts video, not image posts.");
    }

    const repo = new SocialConnectionRepository(createSupabaseAdminClient());
    const connection = await repo.get(payload.brand, "youtube");
    if (!connection) {
      throw new ProviderError(
        "youtube",
        "YouTube is not connected for this account. Connect it on the Accounts page.",
      );
    }

    const videoUrl = payload.asset_urls[0];
    if (!videoUrl) throw new ProviderError("youtube", "There is no video file to upload.");

    const token = await this.freshToken(repo, payload.brand, connection);

    const res = await fetch(videoUrl);
    if (!res.ok) throw new ProviderError("youtube", `Could not fetch the video (${res.status})`, true);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") ?? "video/mp4";

    const videoId = await uploadVideo(token, {
      title: deriveTitle(payload.caption),
      description: payload.caption,
      bytes,
      mimeType,
      privacy: DEFAULT_PRIVACY,
    });

    return {
      dispatchId: videoId,
      posted: true,
      postUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }

  /** Refreshes and persists the access token if it is expired or near expiry. */
  private async freshToken(
    repo: SocialConnectionRepository,
    accountSlug: string,
    connection: { accessToken: string; refreshToken: string | null; expiresAt: string | null },
  ): Promise<string> {
    const expiresSoon =
      connection.expiresAt !== null &&
      new Date(connection.expiresAt).getTime() - Date.now() < REFRESH_SKEW_MS;
    if (!expiresSoon || !connection.refreshToken) return connection.accessToken;

    const refreshed = await refreshAccessToken(connection.refreshToken);
    const expiresAt = refreshed.expiresInS
      ? new Date(Date.now() + refreshed.expiresInS * 1000).toISOString()
      : null;
    await repo.updateTokens({
      accountSlug,
      platform: "youtube",
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt,
    });
    return refreshed.accessToken;
  }
}

/** YouTube needs a title; use the caption's first non-empty line. */
function deriveTitle(caption: string): string {
  const firstLine = caption
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? "New video";
}
