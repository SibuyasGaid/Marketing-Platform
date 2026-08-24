import { LibraryGrid, type LibraryItemView } from "@/components/library/LibraryGrid";
import { BRAND_NAMES } from "@/lib/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BUCKETS, signedUrls } from "@/lib/supabase/storage";
import { AccountRepository, fallbackAccounts } from "@/repositories/AccountRepository";
import { ContentItemRepository } from "@/repositories/ContentItemRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";

export const metadata = { title: "Library · Content Studio" };
export const dynamic = "force-dynamic";

const LIBRARY_LIMIT = 200;

export default async function LibraryPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user
    ? await new ProfileRepository(supabase).getById(user.id).catch(() => null)
    : null;

  const admin = createSupabaseAdminClient();
  const [items, accountList] = await Promise.all([
    new ContentItemRepository(admin).listAll(LIBRARY_LIMIT).catch(() => []),
    new AccountRepository(admin).listActive().catch(() => fallbackAccounts()),
  ]);
  const accounts = accountList.length > 0 ? accountList : fallbackAccounts();
  const accountName = (slug: string) =>
    accounts.find((account) => account.slug === slug)?.name ?? BRAND_NAMES[slug] ?? slug;

  // Batch-sign media + thumbnails up front, grouped by bucket (media assets span
  // buckets — images in brandAssets, videos in generatedMedia), instead of one
  // round-trip per row.
  const libPathsByBucket = new Map<string, string[]>();
  const addLibPath = (bucket: string, path: string) => {
    const list = libPathsByBucket.get(bucket) ?? [];
    list.push(path);
    libPathsByBucket.set(bucket, list);
  };
  const thumbPathOf = (item: (typeof items)[number]) =>
    typeof item.rawGenerationInputs.thumbnailPath === "string"
      ? item.rawGenerationInputs.thumbnailPath
      : null;
  for (const item of items) {
    const asset = item.outputAssets[0];
    if (asset) addLibPath(asset.bucket, asset.path);
    const thumbPath = thumbPathOf(item);
    if (thumbPath) addLibPath(BUCKETS.generatedMedia, thumbPath);
  }
  const libBucketEntries = await Promise.all(
    [...libPathsByBucket].map(
      async ([bucket, paths]) => [bucket, await signedUrls(admin, bucket, paths)] as const,
    ),
  );
  const libUrlsByBucket = new Map(libBucketEntries);
  const libUrl = (bucket: string, path: string) => libUrlsByBucket.get(bucket)?.get(path) ?? null;

  const views: LibraryItemView[] = items.map((item) => {
    const asset = item.outputAssets[0] ?? null;
    const isVideo = item.type === "clip" || item.type === "heygen_video";
    const mediaUrl = asset ? libUrl(asset.bucket, asset.path) : null;
    const thumbPath = thumbPathOf(item);
    const thumbUrl = thumbPath ? libUrl(BUCKETS.generatedMedia, thumbPath) : null;
    return {
      id: item.id,
      type: item.type,
      platform: item.platform,
      targetPlatforms: item.targetPlatforms,
      brandName: accountName(item.brand),
      status: item.status,
      caption: item.caption ?? item.generationInputs.prompt ?? "",
      createdAt: item.createdAt,
      imageUrl: isVideo ? null : mediaUrl,
      isVideo,
      thumbUrl,
      mediaUrl,
      slideCount: item.generationInputs.slides.length >= 2 ? item.outputAssets.length : 1,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        Everything you have made, images, clips, and videos, across every account and status. Filter
        by status, type, platform, account, or date to find a piece.
      </p>
      <LibraryGrid items={views} canManage={profile?.role !== "reviewer"} />
    </div>
  );
}
