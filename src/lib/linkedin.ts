import { appBaseUrl, getServerEnv } from "@/lib/config";
import { ProviderError } from "@/lib/errors";

/**
 * LinkedIn OAuth + Company Page (organization) publishing.
 *
 * Posting as an organization needs the Community Management API
 * (`w_organization_social`), which LinkedIn approves per app. Until then the
 * connect flow still works but publishing returns a clear error.
 *
 * API surface used:
 *  - OAuth 2.0 authorization code flow (accounts.linkedin.com).
 *  - `GET /rest/organizationAcls?q=roleAssignee` to list Pages the member
 *    administers.
 *  - Images: `POST /rest/images?action=initializeUpload` → PUT the binary to
 *    the returned uploadUrl → reference the image URN in the post.
 *  - `POST /rest/posts` with an organization author URN.
 */
const OAUTH_AUTH = "https://www.linkedin.com/oauth/v2/authorization";
const OAUTH_TOKEN = "https://www.linkedin.com/oauth/v2/accessToken";
const REST = "https://api.linkedin.com/rest";
/** LinkedIn versions its REST API by month; pin one and bump deliberately. */
const LINKEDIN_VERSION = "202405";

/**
 * Scopes requested at connect time. `w_organization_social` is the one gated by
 * Community Management API approval; the OpenID scopes identify the connector.
 */
export const LINKEDIN_SCOPES = ["openid", "profile", "email", "w_organization_social"].join(" ");

export function linkedinRedirectUri(): string {
  return `${appBaseUrl(getServerEnv())}/api/oauth/linkedin/callback`;
}

export function linkedinAuthUrl(state: string): string {
  const env = getServerEnv();
  if (!env.LINKEDIN_CLIENT_ID) {
    throw new ProviderError("linkedin", "LINKEDIN_CLIENT_ID is not configured");
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.LINKEDIN_CLIENT_ID,
    redirect_uri: linkedinRedirectUri(),
    state,
    scope: LINKEDIN_SCOPES,
  });
  return `${OAUTH_AUTH}?${params.toString()}`;
}

interface LinkedInError {
  message?: string;
  serviceErrorCode?: number;
}

function restHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "linkedin-version": LINKEDIN_VERSION,
    "x-restli-protocol-version": "2.0.0",
  };
}

async function readError(res: Response): Promise<string> {
  const json = (await res.json().catch(() => ({}))) as LinkedInError;
  return json.message ?? `LinkedIn error ${res.status}`;
}

export interface LinkedInTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresInS: number | null;
}

async function tokenRequest(body: URLSearchParams): Promise<LinkedInTokens> {
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
    throw new ProviderError("linkedin", json.error_description ?? `Token error ${res.status}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresInS: typeof json.expires_in === "number" ? json.expires_in : null,
  };
}

export async function exchangeCodeForToken(code: string): Promise<LinkedInTokens> {
  const env = getServerEnv();
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: linkedinRedirectUri(),
      client_id: env.LINKEDIN_CLIENT_ID ?? "",
      client_secret: env.LINKEDIN_CLIENT_SECRET ?? "",
    }),
  );
}

export async function refreshAccessToken(refreshToken: string): Promise<LinkedInTokens> {
  const env = getServerEnv();
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.LINKEDIN_CLIENT_ID ?? "",
      client_secret: env.LINKEDIN_CLIENT_SECRET ?? "",
    }),
  );
}

export interface LinkedInOrganization {
  /** URN, e.g. "urn:li:organization:12345". */
  urn: string;
  id: string;
  name: string | null;
}

/**
 * Company Pages the connected member administers. Returns organization URNs;
 * names are resolved in a second lightweight call so a rename on LinkedIn is
 * reflected in the connection label.
 */
export async function listOrganizations(token: string): Promise<LinkedInOrganization[]> {
  const url =
    `${REST}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100`;
  const res = await fetch(url, { headers: restHeaders(token) });
  if (!res.ok) throw new ProviderError("linkedin", await readError(res));
  const json = (await res.json()) as { elements?: Array<{ organization?: string }> };
  const urns = [...new Set((json.elements ?? []).map((el) => el.organization).filter(Boolean))] as string[];

  return Promise.all(
    urns.map(async (urn) => {
      const id = urn.split(":").pop() ?? urn;
      const name = await organizationName(token, id).catch(() => null);
      return { urn, id, name };
    }),
  );
}

async function organizationName(token: string, id: string): Promise<string | null> {
  const res = await fetch(`${REST}/organizations/${id}`, { headers: restHeaders(token) });
  if (!res.ok) return null;
  const json = (await res.json()) as { localizedName?: string; name?: { localized?: Record<string, string> } };
  if (json.localizedName) return json.localizedName;
  const localized = json.name?.localized;
  return localized ? Object.values(localized)[0] ?? null : null;
}

/**
 * Registers an image upload, PUTs the binary, and returns the image URN to
 * attach to a post.
 */
async function uploadImage(
  token: string,
  authorUrn: string,
  bytes: Uint8Array,
): Promise<string> {
  const initRes = await fetch(`${REST}/images?action=initializeUpload`, {
    method: "POST",
    headers: restHeaders(token),
    body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn } }),
  });
  if (!initRes.ok) throw new ProviderError("linkedin", await readError(initRes));
  const init = (await initRes.json()) as { value?: { uploadUrl?: string; image?: string } };
  const uploadUrl = init.value?.uploadUrl;
  const imageUrn = init.value?.image;
  if (!uploadUrl || !imageUrn) throw new ProviderError("linkedin", "Image upload was not initialized");

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body: new Blob([bytes as BlobPart]),
  });
  if (!putRes.ok) throw new ProviderError("linkedin", `Image binary upload failed (${putRes.status})`, true);
  return imageUrn;
}

/**
 * Publishes a post to a Company Page. `images` are raw bytes (already fetched
 * from storage); 0 = text only, 1 = single image, 2+ = multi-image post.
 * Returns the created post URN.
 */
export async function publishOrganizationPost(
  token: string,
  organizationUrn: string,
  caption: string,
  images: Uint8Array[],
): Promise<string> {
  const imageUrns = await Promise.all(images.map((bytes) => uploadImage(token, organizationUrn, bytes)));

  const content =
    imageUrns.length === 0
      ? undefined
      : imageUrns.length === 1
        ? { media: { id: imageUrns[0] } }
        : { multiImage: { images: imageUrns.map((id) => ({ id })) } };

  const body: Record<string, unknown> = {
    author: organizationUrn,
    commentary: caption,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (content) body.content = content;

  const res = await fetch(`${REST}/posts`, {
    method: "POST",
    headers: restHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ProviderError("linkedin", await readError(res), res.status >= 500);
  // The created post URN is returned in the x-restli-id header.
  return res.headers.get("x-restli-id") ?? organizationUrn;
}
