import { notFound } from "next/navigation";
import {
  AccountEditor,
  type AccountReferenceView,
  type PersonView,
} from "@/components/accounts/AccountEditor";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BUCKETS, signedUrls } from "@/lib/supabase/storage";
import { AccountRepository, fallbackAccounts } from "@/repositories/AccountRepository";
import { AvatarReferenceRepository } from "@/repositories/AvatarReferenceRepository";
import { BrandReferenceRepository } from "@/repositories/BrandReferenceRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";
import { SocialConnectionRepository } from "@/repositories/SocialConnectionRepository";

export const dynamic = "force-dynamic";

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ meta?: string; linkedin?: string; youtube?: string }>;
}) {
  const { slug } = await params;
  const {
    meta: metaStatus,
    linkedin: linkedinStatus,
    youtube: youtubeStatus,
  } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await new ProfileRepository(supabase).getById(user.id) : null;

  const admin = createSupabaseAdminClient();
  let account = await new AccountRepository(admin).getBySlug(slug).catch(() => null);
  if (!account) account = fallbackAccounts().find((entry) => entry.slug === slug) ?? null;
  if (!account) notFound();

  // Brand refs + people (avatar likenesses, incl. legacy shared ones) for this
  // account. Fetch both lists in parallel, then batch-sign each bucket's
  // thumbnails in one call instead of one round-trip per thumbnail.
  const [refs, avatars] = await Promise.all([
    new BrandReferenceRepository(admin).listForAccount(slug).catch(() => []),
    new AvatarReferenceRepository(admin).listForAccount(slug).catch(() => []),
  ]);
  const [refUrls, avatarUrls] = await Promise.all([
    signedUrls(admin, BUCKETS.brandAssets, refs.map((reference) => reference.storagePath)),
    signedUrls(admin, BUCKETS.avatarReferences, avatars.map((avatar) => avatar.storagePath)),
  ]);
  const references: AccountReferenceView[] = refs.map((reference) => ({
    id: reference.id,
    name: reference.name,
    thumbUrl: refUrls.get(reference.storagePath) ?? null,
    isLogo: reference.isLogo,
  }));
  const people: PersonView[] = avatars.map((avatar) => ({
    id: avatar.id,
    personName: avatar.personName,
    thumbUrl: avatarUrls.get(avatar.storagePath) ?? null,
  }));

  // Publishing connection status for this account (never exposes tokens).
  const connectionRepo = new SocialConnectionRepository(admin);
  const status = await connectionRepo.listStatus().catch(() => []);
  const forAccount = status.filter((row) => row.accountSlug === account.slug);
  const connections = {
    facebookName: forAccount.find((row) => row.platform === "facebook")?.externalName ?? null,
    instagramName: forAccount.find((row) => row.platform === "instagram")?.externalName ?? null,
    linkedinName: forAccount.find((row) => row.platform === "linkedin")?.externalName ?? null,
    youtubeName: forAccount.find((row) => row.platform === "youtube")?.externalName ?? null,
  };

  // If a multi-Page connect is awaiting a choice, surface the candidate Pages
  // (no tokens — just id/name/hasInstagram from the pending record's meta).
  const pending = await connectionRepo.get(account.slug, "meta_pending").catch(() => null);
  const pendingPages =
    pending && Array.isArray(pending.meta.pages)
      ? (pending.meta.pages as Array<{ id: string; name: string; hasInstagram: boolean }>)
      : [];

  return (
    <AccountEditor
      slug={account.slug}
      name={account.name}
      description={account.description}
      visualIdentity={account.visualIdentity}
      hasOutro={Boolean(account.outroVideoPath)}
      references={references}
      people={people}
      connections={connections}
      metaStatus={metaStatus ?? null}
      linkedinStatus={linkedinStatus ?? null}
      youtubeStatus={youtubeStatus ?? null}
      pendingPages={pendingPages}
      isAdmin={profile?.role === "admin"}
      canManage={profile?.role !== "reviewer"}
    />
  );
}
