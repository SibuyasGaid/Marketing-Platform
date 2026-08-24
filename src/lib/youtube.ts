import { appBaseUrl, getServerEnv } from "@/lib/config";
import { ProviderError } from "@/lib/errors";

/**
 * YouTube (Google) OAuth + video upload via the YouTube Data API v3.
 *
 * Channels stay owned by us: one Google Cloud OAuth client connects each
 * channel separately (a different Google login per account at connect time).
 * Keeping the connectors to our own accounts lets the app stay in Google's
 * "Testing" mode and skip the sensitive-scope verification review.
 *
 * API surface:
 *  - OAuth 2.0 authorization code flow (accounts.google.com), `access_type=
 *    offline` + `prompt=consent` so we get a refresh token.
 *  - `GET /youtube/v3/channels?mine=true` to resolve the connected channel.
 *  - Resumable `POST /upload/youtube/v3/videos` for the upload.
 */
const OAUTH_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";

/**
 * upload = publish videos; readonly = resolve the connected channel at connect
 * time (channels.list?mine=true rejects the upload scope alone with
 * "insufficient authentication scopes"). Both are "sensitive" scopes — in
 * Google's Testing mode, test users consent without app verification.
 */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

/** YouTube caps the title at 100 chars; description at 5000. */
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 5000;

export function youtubeRedirectUri(): string {
  return `${appBaseUrl(getServerEnv())}/api/oauth/youtube/callback`;
}

export function youtubeAuthUrl(state: string): string {
  const env = getServerEnv();
  if (!env.GOOGLE_CLIENT_ID) {
    throw new ProviderError("youtube", "GOOGLE_CLIENT_ID is not configured");
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: youtubeRedirectUri(),
    state,
    scope: YOUTUBE_SCOPES,
    // Offline + forced consent so Google returns a refresh token every time.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${OAUTH_AUTH}?${params.toString()}`;
}

export interface YouTubeTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresInS: number | null;
}

async function tokenRequest(body: URLSearchParams): Promise<YouTubeTokens> {
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new ProviderError("youtube", json.error_description ?? `Token error ${res.status}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresInS: typeof json.expires_in === "number" ? json.expires_in : null,
  };
}

export async function exchangeCodeForToken(code: string): Promise<YouTubeTokens> {
  const env = getServerEnv();
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: youtubeRedirectUri(),
      client_id: env.GOOGLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  );
}

export async function refreshAccessToken(refreshToken: string): Promise<YouTubeTokens> {
  const env = getServerEnv();
  const tokens = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  );
  // Refresh responses don't return a new refresh token; keep the caller's.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

export interface YouTubeChannel {
  id: string;
  title: string | null;
}

/** The channel the connected Google account owns. */
export async function getChannel(token: string): Promise<YouTubeChannel | null> {
  const res = await fetch(`${API}/channels?part=snippet&mine=true`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new ProviderError("youtube", json.error?.message ?? `Channel lookup failed (${res.status})`);
  }
  const json = (await res.json()) as {
    items?: Array<{ id: string; snippet?: { title?: string } }>;
  };
  const channel = json.items?.[0];
  return channel ? { id: channel.id, title: channel.snippet?.title ?? null } : null;
}

export type YouTubePrivacy = "public" | "unlisted" | "private";

/**
 * Uploads a video via a resumable session and returns the video id. `bytes` is
 * the full file (clips/avatar videos are small, so a single-PUT resumable
 * upload is fine). Vertical clips/Shorts are detected by YouTube automatically.
 */
export async function uploadVideo(
  token: string,
  input: {
    title: string;
    description: string;
    bytes: Uint8Array;
    mimeType: string;
    privacy: YouTubePrivacy;
  },
): Promise<string> {
  const metadata = {
    snippet: {
      title: input.title.slice(0, MAX_TITLE) || "Untitled",
      description: input.description.slice(0, MAX_DESCRIPTION),
    },
    status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: false },
  };

  // 1) Open a resumable session with the metadata.
  const initRes = await fetch(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": input.mimeType,
      "x-upload-content-length": String(input.bytes.byteLength),
    },
    body: JSON.stringify(metadata),
  });
  if (!initRes.ok) {
    const json = (await initRes.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new ProviderError(
      "youtube",
      json.error?.message ?? `Could not start the upload (${initRes.status})`,
      initRes.status >= 500,
    );
  }
  const sessionUrl = initRes.headers.get("location");
  if (!sessionUrl) throw new ProviderError("youtube", "Upload session URL was not returned");

  // 2) Upload the bytes in one PUT (files here are short-form and small).
  const putRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "content-type": input.mimeType },
    body: new Blob([input.bytes as BlobPart], { type: input.mimeType }),
  });
  if (!putRes.ok) {
    const json = (await putRes.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new ProviderError(
      "youtube",
      json.error?.message ?? `Video upload failed (${putRes.status})`,
      putRes.status >= 500,
    );
  }
  const json = (await putRes.json()) as { id?: string };
  if (!json.id) throw new ProviderError("youtube", "YouTube did not return a video id");
  return json.id;
}
