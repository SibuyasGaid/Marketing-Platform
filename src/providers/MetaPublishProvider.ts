import { ProviderError } from "@/lib/errors";
import {
  publishFacebookCarousel,
  publishFacebookPhoto,
  publishFacebookVideo,
  publishInstagramCarousel,
  publishInstagramImage,
  publishInstagramReel,
} from "@/lib/meta";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SocialConnectionRepository } from "@/repositories/SocialConnectionRepository";
import type { DispatchResult, PublishPayload, PublishProvider } from "@/providers/interfaces/PublishProvider";

/**
 * Publishes directly to Facebook Pages and Instagram via the Graph API, using
 * the OAuth connection stored for the item's account. Synchronous: the returned
 * result is `posted: true` with the live URL (no status callback).
 */
export class MetaPublishProvider implements PublishProvider {
  async dispatch(payload: PublishPayload): Promise<DispatchResult> {
    const repo = new SocialConnectionRepository(createSupabaseAdminClient());
    const connection = await repo.get(payload.brand, payload.platform);
    if (!connection) {
      throw new ProviderError(
        "meta",
        `${payload.platform} is not connected for this account. Connect it on the Accounts page.`,
      );
    }

    const pageToken = connection.accessToken;
    const isVideo = payload.type !== "image_post";
    const urls = payload.asset_urls;
    const first = urls[0];

    if (payload.platform === "facebook") {
      const pageId = String(connection.meta.page_id ?? connection.externalId ?? "");
      let postId: string;
      if (isVideo) {
        postId = await publishFacebookVideo(
          pageId,
          pageToken,
          first,
          payload.caption,
          payload.cover_url,
        );
      } else if (urls.length > 1) {
        postId = await publishFacebookCarousel(pageId, pageToken, urls, payload.caption);
      } else {
        postId = await publishFacebookPhoto(pageId, pageToken, first, payload.caption);
      }
      return { dispatchId: postId, posted: true, postUrl: `https://www.facebook.com/${postId}` };
    }

    if (payload.platform === "instagram") {
      const igUserId = String(connection.meta.ig_user_id ?? connection.externalId ?? "");
      let mediaId: string;
      if (isVideo) {
        mediaId = await publishInstagramReel(
          igUserId,
          pageToken,
          first,
          payload.caption,
          payload.cover_url,
        );
      } else if (urls.length > 1) {
        mediaId = await publishInstagramCarousel(igUserId, pageToken, urls, payload.caption);
      } else {
        mediaId = await publishInstagramImage(igUserId, pageToken, first, payload.caption);
      }
      return { dispatchId: mediaId, posted: true, postUrl: null };
    }

    throw new ProviderError("meta", `Meta provider does not handle ${payload.platform}`);
  }
}
