import { HistoryGrid, type HistoryItemView } from "@/components/images/HistoryGrid";
import {
  ImageWorkspace,
  type AvatarView,
  type BrandReferenceView,
  type PresetView,
} from "@/components/images/ImageWorkspace";
import { BRAND_NAMES } from "@/lib/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BUCKETS, signedUrls } from "@/lib/supabase/storage";
import { AccountRepository, fallbackAccounts } from "@/repositories/AccountRepository";
import { AvatarReferenceRepository } from "@/repositories/AvatarReferenceRepository";
import { BrandPresetRepository } from "@/repositories/BrandPresetRepository";
import { BrandReferenceRepository } from "@/repositories/BrandReferenceRepository";
import { ContentItemRepository } from "@/repositories/ContentItemRepository";
import { JobRepository, type Job } from "@/repositories/JobRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";

export const metadata = { title: "Brand Images · Content Studio" };
export const dynamic = "force-dynamic";

export default async function BrandImagesPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Defensive: a transient profile-read hiccup must not white-screen the tab.
  // The (app) layout already gated auth; worst case we treat the user as
  // non-admin/non-manager here rather than crashing.
  const profile = user
    ? await new ProfileRepository(supabase).getById(user.id).catch(() => null)
    : null;

  const admin = createSupabaseAdminClient();
  // Read presets via the admin client (same as the rest of this page). Using the
  // session/anon client here made the whole tab fail for a user whose RLS/session
  // state differed; presets are non-sensitive reference data, and every write
  // still goes through role-checked server actions.
  const [presets, avatarRefs, items] = await Promise.all([
    new BrandPresetRepository(admin).listActive().catch(() => []),
    new AvatarReferenceRepository(admin).listActive().catch(() => []),
    // Load a wider window so the history date filter is useful as volume grows.
    new ContentItemRepository(admin).listByType("image_post", 200).catch(() => []),
  ]);
  // Brand references are newer than the rest of the tab — if their migration
  // hasn't been applied yet, degrade to empty rather than crashing the page.
  const brandRefs = await new BrandReferenceRepository(admin).listActive().catch(() => []);
  const jobs = await new JobRepository(admin)
    .latestByContentItems(items.map((i) => i.id))
    .catch(() => new Map<string, Job>());
  // Accounts drive the brand picker; fall back to built-ins pre-migration.
  const accountList = await new AccountRepository(admin).listActive().catch(() => fallbackAccounts());
  const accounts = accountList.length > 0 ? accountList : fallbackAccounts();
  const accountName = (slug: string) =>
    accounts.find((account) => account.slug === slug)?.name ?? BRAND_NAMES[slug] ?? slug;

  // Batch-sign per bucket in one call each instead of one round-trip per
  // thumbnail/slide. History assets can span buckets, so group them by their
  // own bucket rather than assuming one.
  const historyPathsByBucket = new Map<string, string[]>();
  for (const item of items) {
    for (const asset of item.outputAssets) {
      const list = historyPathsByBucket.get(asset.bucket) ?? [];
      list.push(asset.path);
      historyPathsByBucket.set(asset.bucket, list);
    }
  }
  const [avatarUrls, brandRefUrls, historyBucketEntries] = await Promise.all([
    signedUrls(admin, BUCKETS.avatarReferences, avatarRefs.map((ref) => ref.storagePath)),
    signedUrls(admin, BUCKETS.brandAssets, brandRefs.map((ref) => ref.storagePath)),
    Promise.all(
      [...historyPathsByBucket].map(
        async ([bucket, paths]) => [bucket, await signedUrls(admin, bucket, paths)] as const,
      ),
    ),
  ]);
  const historyUrlsByBucket = new Map(historyBucketEntries);
  const historyUrl = (asset: { bucket: string; path: string }) =>
    historyUrlsByBucket.get(asset.bucket)?.get(asset.path) ?? null;

  const avatars: AvatarView[] = avatarRefs.map((ref) => ({
    id: ref.id,
    personName: ref.personName,
    thumbUrl: avatarUrls.get(ref.storagePath) ?? null,
    accountSlug: ref.accountSlug,
  }));

  const brandReferences: BrandReferenceView[] = brandRefs.map((ref) => ({
    id: ref.id,
    name: ref.name,
    thumbUrl: brandRefUrls.get(ref.storagePath) ?? null,
  }));

  const historyItems: HistoryItemView[] = items.map((item) => {
    const latestAsset = item.outputAssets[0] ?? null;
    const job = jobs.get(item.id) ?? null;
    const imageUrl = latestAsset ? historyUrl(latestAsset) : null;
    const isCarousel = item.generationInputs.slides.length >= 2 && item.outputAssets.length > 1;
    // For a carousel, list every slide (in order) so the modal can scroll them.
    const slideUrls = isCarousel
      ? item.outputAssets.map(historyUrl).filter((url): url is string => Boolean(url))
      : [];
    return {
      id: item.id,
      status: item.status,
      platform: item.platform,
      targetPlatforms: item.targetPlatforms,
      brandName: accountName(item.brand),
      prompt: item.generationInputs.prompt,
      imageUrl,
      downloadUrl: imageUrl,
      slideCount: isCarousel ? item.outputAssets.length : 1,
      slideUrls,
      jobStatus: job?.status ?? null,
      jobError: job?.errorMessage ?? null,
      createdAt: item.createdAt,
      ageMinutes: ageMinutes(item.createdAt),
    };
  });

  const presetViews: PresetView[] = presets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    tone: preset.tone,
    palette: preset.palette,
    styleRules: preset.styleRules,
    campaignContext: preset.campaignContext,
  }));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        Create branded graphics. Pick the account and a preset, describe the image, choose
        platforms, and Generate. New images appear below as drafts; use Send to queue to move one
        into review.
      </p>
      <ImageWorkspace
        presets={presetViews}
        avatars={avatars}
        brandReferences={brandReferences}
        accounts={accounts.map((account) => ({ slug: account.slug, name: account.name }))}
        isAdmin={profile?.role === "admin"}
        canManageReferences={profile?.role !== "reviewer"}
      />
      <HistoryGrid items={historyItems} canManage={profile?.role !== "reviewer"} />
    </div>
  );
}

/** Whole minutes since an ISO timestamp (server clock). Drives the stall hint. */
function ageMinutes(createdAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000));
}
