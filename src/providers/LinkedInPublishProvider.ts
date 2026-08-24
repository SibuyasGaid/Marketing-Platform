import { ProviderError } from "@/lib/errors";
import { publishOrganizationPost, refreshAccessToken } from "@/lib/linkedin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SocialConnectionRepository } from "@/repositories/SocialConnectionRepository";
import type { DispatchResult, PublishPayload, PublishProvider } from "@/providers/interfaces/PublishProvider";

/** Refresh the token when it expires within this window. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * Publishes directly to a LinkedIn Company Page via the REST API, using the
 * OAuth connection stored for the item's account. Synchronous: returns
 * `posted: true` with the post URL. Image binaries are uploaded to LinkedIn
 * (it does not pull from a URL like Meta does).
 */
export class LinkedInPublishProvider implements PublishProvider {
  async dispatch(payload: PublishPayload): Promise<DispatchResult> {
    const repo = new SocialConnectionRepository(createSupabaseAdminClient());
    const connection = await repo.get(payload.brand, "linkedin");
    if (!connection) {
      throw new ProviderError(
        "linkedin",
        "LinkedIn is not connected for this account. Connect it on the Accounts page.",
      );
    }

    // Video posts to LinkedIn are not wired yet; fail clearly rather than
    // silently posting text only.
    if (payload.type !== "image_post") {
      throw new ProviderError("linkedin", "LinkedIn video posting is not supported yet.");
    }

    const organizationUrn = String(connection.meta.organization_urn ?? connection.externalId ?? "");
    if (!organizationUrn) {
      throw new ProviderError("linkedin", "This LinkedIn connection has no Company Page.");
    }

    const token = await this.freshToken(repo, payload.brand, connection);

    // LinkedIn uploads the binary, so fetch each asset from its signed URL.
    const images = await Promise.all(
      payload.asset_urls.map(async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new ProviderError("linkedin", `Could not fetch asset (${res.status})`, true);
        return new Uint8Array(await res.arrayBuffer());
      }),
    );

    const postUrn = await publishOrganizationPost(token, organizationUrn, payload.caption, images);
    const postUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}`;
    return { dispatchId: postUrn, posted: true, postUrl };
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
      platform: "linkedin",
      accessToken: refreshed.accessToken,
      // LinkedIn may or may not rotate the refresh token; keep the old one if not.
      refreshToken: refreshed.refreshToken ?? connection.refreshToken,
      expiresAt,
    });
    return refreshed.accessToken;
  }
}
