import type { MetaPage } from "@/lib/meta";
import type { SocialConnectionRepository } from "@/repositories/SocialConnectionRepository";

/**
 * Stores the facebook (and, if linked, instagram) connection for one account
 * from a chosen Page. Shared by the OAuth callback (single-Page case) and the
 * Page picker (multi-Page case). The Page access token is what gets stored, so
 * publishing later routes by account → Page.
 */
export async function connectMetaPage(args: {
  repo: SocialConnectionRepository;
  accountSlug: string;
  userId: string;
  page: MetaPage;
  expiresInS: number | null;
}): Promise<"connected" | "connected_fb_only"> {
  const { repo, accountSlug, userId, page, expiresInS } = args;
  const expiresAt = expiresInS ? new Date(Date.now() + expiresInS * 1000).toISOString() : null;

  await repo.upsert({
    accountSlug,
    platform: "facebook",
    accessToken: page.accessToken,
    expiresAt,
    externalId: page.id,
    externalName: page.name,
    meta: { page_id: page.id },
    connectedBy: userId,
  });

  if (page.igUserId) {
    await repo.upsert({
      accountSlug,
      platform: "instagram",
      accessToken: page.accessToken,
      expiresAt,
      externalId: page.igUserId,
      externalName: page.name,
      meta: { page_id: page.id, ig_user_id: page.igUserId },
      connectedBy: userId,
    });
  }

  // Clear the pending record if one existed (multi-Page picker path).
  await repo.remove(accountSlug, "meta_pending");

  return page.igUserId ? "connected" : "connected_fb_only";
}
