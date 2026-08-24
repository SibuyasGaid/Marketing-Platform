import { appBaseUrl, getServerEnv } from "@/lib/config";
import { ProviderError } from "@/lib/errors";

/** Meta Graph API helpers for OAuth + Facebook Page / Instagram publishing. */
const GRAPH = "https://graph.facebook.com/v21.0";
const OAUTH_DIALOG = "https://www.facebook.com/v21.0/dialog/oauth";

export const META_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
].join(",");

export function metaRedirectUri(): string {
  return `${appBaseUrl(getServerEnv())}/api/oauth/meta/callback`;
}

export function metaAuthUrl(state: string): string {
  const env = getServerEnv();
  if (!env.META_APP_ID) throw new ProviderError("meta", "META_APP_ID is not configured");
  const params = new URLSearchParams({
    client_id: env.META_APP_ID,
    redirect_uri: metaRedirectUri(),
    state,
    scope: META_SCOPES,
    response_type: "code",
  });
  return `${OAUTH_DIALOG}?${params.toString()}`;
}

interface GraphError {
  error?: { message?: string };
}

async function graphGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok) {
    throw new ProviderError("meta", json.error?.message ?? `Graph error ${res.status}`, res.status >= 500);
  }
  return json;
}

async function graphPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok) {
    throw new ProviderError("meta", json.error?.message ?? `Graph error ${res.status}`, res.status >= 500);
  }
  return json;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const env = getServerEnv();
  const params = new URLSearchParams({
    client_id: env.META_APP_ID ?? "",
    client_secret: env.META_APP_SECRET ?? "",
    redirect_uri: metaRedirectUri(),
    code,
  });
  const json = await graphGet<{ access_token: string }>(`${GRAPH}/oauth/access_token?${params}`);
  return json.access_token;
}

export async function longLivedToken(
  shortToken: string,
): Promise<{ token: string; expiresInS: number | null }> {
  const env = getServerEnv();
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: env.META_APP_ID ?? "",
    client_secret: env.META_APP_SECRET ?? "",
    fb_exchange_token: shortToken,
  });
  const json = await graphGet<{ access_token: string; expires_in?: number }>(
    `${GRAPH}/oauth/access_token?${params}`,
  );
  return { token: json.access_token, expiresInS: typeof json.expires_in === "number" ? json.expires_in : null };
}

export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  igUserId: string | null;
}

export async function listPages(userToken: string): Promise<MetaPage[]> {
  const json = await graphGet<{
    data?: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string } }>;
  }>(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account&limit=100&access_token=${encodeURIComponent(userToken)}`,
  );
  return (json.data ?? []).map((page) => ({
    id: page.id,
    name: page.name,
    accessToken: page.access_token,
    igUserId: page.instagram_business_account?.id ?? null,
  }));
}

// ---------------------------------------------------------------- publishing

export async function publishFacebookPhoto(
  pageId: string,
  pageToken: string,
  imageUrl: string,
  caption: string,
): Promise<string> {
  const json = await graphPost<{ post_id?: string; id: string }>(`${GRAPH}/${pageId}/photos`, {
    url: imageUrl,
    caption,
    access_token: pageToken,
  });
  return json.post_id ?? json.id;
}

export async function publishFacebookVideo(
  pageId: string,
  pageToken: string,
  videoUrl: string,
  caption: string,
  coverUrl?: string | null,
): Promise<string> {
  // Best-effort custom thumbnail: FB's /videos takes the cover as a multipart
  // `thumb` file (not a URL), so fetch the cover bytes and send them alongside
  // the video's file_url. If anything about the cover fails, fall through to a
  // plain URL post so the video still publishes with an auto-picked frame.
  if (coverUrl) {
    try {
      const coverRes = await fetch(coverUrl);
      if (coverRes.ok) {
        const bytes = new Uint8Array(await coverRes.arrayBuffer());
        const type = coverRes.headers.get("content-type") || "image/jpeg";
        const form = new FormData();
        form.append("file_url", videoUrl);
        form.append("description", caption);
        form.append("access_token", pageToken);
        form.append("thumb", new Blob([bytes], { type }), "cover.jpg");
        const res = await fetch(`${GRAPH}/${pageId}/videos`, { method: "POST", body: form });
        if (res.ok) {
          const json = (await res.json().catch(() => ({}))) as { id?: string };
          if (json.id) return json.id;
        }
      }
    } catch {
      // Ignore — fall back to the plain URL post below.
    }
  }

  const json = await graphPost<{ id: string }>(`${GRAPH}/${pageId}/videos`, {
    file_url: videoUrl,
    description: caption,
    access_token: pageToken,
  });
  return json.id;
}

/**
 * FB multi-photo post: upload each photo unpublished to get a media id, then
 * create one feed post that attaches them all (the Page's native carousel).
 */
export async function publishFacebookCarousel(
  pageId: string,
  pageToken: string,
  imageUrls: string[],
  caption: string,
): Promise<string> {
  const mediaFbids: string[] = [];
  for (const imageUrl of imageUrls.slice(0, 10)) {
    const uploaded = await graphPost<{ id: string }>(`${GRAPH}/${pageId}/photos`, {
      url: imageUrl,
      published: false,
      access_token: pageToken,
    });
    mediaFbids.push(uploaded.id);
  }
  const attachedMedia = mediaFbids.map((id) => ({ media_fbid: id }));
  const json = await graphPost<{ id: string }>(`${GRAPH}/${pageId}/feed`, {
    message: caption,
    attached_media: attachedMedia,
    access_token: pageToken,
  });
  return json.id;
}

async function igCreateContainer(
  igUserId: string,
  pageToken: string,
  fields: Record<string, unknown>,
): Promise<string> {
  const json = await graphPost<{ id: string }>(`${GRAPH}/${igUserId}/media`, {
    ...fields,
    access_token: pageToken,
  });
  return json.id;
}

async function igPublish(igUserId: string, pageToken: string, creationId: string): Promise<string> {
  const json = await graphPost<{ id: string }>(`${GRAPH}/${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: pageToken,
  });
  return json.id;
}

/**
 * IG containers process asynchronously — even images: Instagram fetches the
 * URL and validates format/size before the container is publishable. Poll until
 * FINISHED; surface Instagram's own error text when it fails so the queue shows
 * a useful reason instead of a vague "Media ID is not available".
 */
async function waitForContainer(
  creationId: string,
  pageToken: string,
  { attempts = 20, intervalMs = 3000 }: { attempts?: number; intervalMs?: number } = {},
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const json = await graphGet<{ status_code?: string; status?: string }>(
      `${GRAPH}/${creationId}?fields=status_code,status&access_token=${encodeURIComponent(pageToken)}`,
    );
    if (json.status_code === "FINISHED") return;
    if (json.status_code === "ERROR") {
      // `status` carries Instagram's human-readable reason (e.g. unsupported
      // format, aspect ratio out of range, URL not reachable).
      throw new ProviderError(
        "meta",
        `Instagram rejected the media: ${json.status ?? "processing failed"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new ProviderError("meta", "Instagram media did not finish processing in time", true);
}

export async function publishInstagramImage(
  igUserId: string,
  pageToken: string,
  imageUrl: string,
  caption: string,
): Promise<string> {
  const creationId = await igCreateContainer(igUserId, pageToken, { image_url: imageUrl, caption });
  // Images are usually ready in a second or two, but publishing before the
  // container is FINISHED is exactly what caused "Media ID is not available".
  await waitForContainer(creationId, pageToken, { attempts: 15, intervalMs: 2000 });
  return igPublish(igUserId, pageToken, creationId);
}

export async function publishInstagramReel(
  igUserId: string,
  pageToken: string,
  videoUrl: string,
  caption: string,
  coverUrl?: string | null,
): Promise<string> {
  const creationId = await igCreateContainer(igUserId, pageToken, {
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    // Custom Reel cover, when provided (Graph fetches it during processing).
    ...(coverUrl ? { cover_url: coverUrl } : {}),
  });
  // Reels transcode server-side and can take a while — poll longer than images
  // (up to ~4 min) so a normal clip doesn't fail with a premature timeout.
  await waitForContainer(creationId, pageToken, { attempts: 40, intervalMs: 6000 });
  return igPublish(igUserId, pageToken, creationId);
}

/** IG carousel: one child container per image, then a CAROUSEL container. */
export async function publishInstagramCarousel(
  igUserId: string,
  pageToken: string,
  imageUrls: string[],
  caption: string,
): Promise<string> {
  const children: string[] = [];
  for (const imageUrl of imageUrls.slice(0, 10)) {
    const childId = await igCreateContainer(igUserId, pageToken, {
      image_url: imageUrl,
      is_carousel_item: true,
    });
    // Each child must finish processing before it can go in the carousel.
    await waitForContainer(childId, pageToken, { attempts: 15, intervalMs: 2000 });
    children.push(childId);
  }
  const carouselId = await igCreateContainer(igUserId, pageToken, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption,
  });
  await waitForContainer(carouselId, pageToken, { attempts: 15, intervalMs: 2000 });
  return igPublish(igUserId, pageToken, carouselId);
}
