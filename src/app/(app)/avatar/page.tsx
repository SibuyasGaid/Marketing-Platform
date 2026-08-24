import { type AccountAvatars } from "@/components/avatar/AvatarStudio";
import { type CombineSourceOption } from "@/components/avatar/CombineStudio";
import { type GeneratedVideoView } from "@/components/avatar/GeneratedVideos";
import { VideoStudioTabs } from "@/components/avatar/VideoStudioTabs";
import { BRAND_NAMES } from "@/lib/domain";
import type { ContentItem } from "@/repositories/ContentItemRepository";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BUCKETS, signedUrls } from "@/lib/supabase/storage";
import { AccountRepository, fallbackAccounts } from "@/repositories/AccountRepository";
import { AvatarReferenceRepository } from "@/repositories/AvatarReferenceRepository";
import { ContentItemRepository } from "@/repositories/ContentItemRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";

export const metadata = { title: "Generate Videos · Content Studio" };
export const dynamic = "force-dynamic";

export default async function GenerateVideosPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user
    ? await new ProfileRepository(supabase).getById(user.id).catch(() => null)
    : null;

  const admin = createSupabaseAdminClient();
  const accountList = await new AccountRepository(admin).listActive().catch(() => fallbackAccounts());
  const accounts = accountList.length > 0 ? accountList : fallbackAccounts();

  // For each account, its people (avatars) with signed thumbnails to pick from.
  // Fetch each account's refs in parallel, then batch-sign every thumbnail in one
  // call (all live in the avatarReferences bucket) instead of one per avatar.
  const avatarRepo = new AvatarReferenceRepository(admin);
  const refsByAccount = await Promise.all(
    accounts.map(async (account) => ({
      account,
      refs: await avatarRepo.listForAccount(account.slug).catch(() => []),
    })),
  );
  const avatarThumbUrls = await signedUrls(
    admin,
    BUCKETS.avatarReferences,
    refsByAccount.flatMap((entry) => entry.refs.map((ref) => ref.storagePath)),
  );
  const perAccount: AccountAvatars[] = refsByAccount.map(({ account, refs }) => ({
    slug: account.slug,
    name: account.name,
    avatars: refs.map((ref) => ({
      id: ref.id,
      personName: ref.personName,
      thumbUrl: avatarThumbUrls.get(ref.storagePath) ?? null,
    })),
  }));

  const accountName = (slug: string) =>
    accounts.find((account) => account.slug === slug)?.name ?? BRAND_NAMES[slug] ?? slug;

  // Studio videos (avatar + clips) generated from this tab. They stay `draft`
  // and hold here (not the queue). State: rendered output = ready; studioError =
  // failed; neither = still rendering. Served via the range-capable /api/media.
  const contentRepo = new ContentItemRepository(admin);
  const [recent, clipItems] = await Promise.all([
    contentRepo.listByType("heygen_video", 40).catch(() => []),
    contentRepo.listByType("clip", 40).catch(() => []),
  ]);
  const videos: GeneratedVideoView[] = recent
    .filter((item) => item.rawGenerationInputs.studio === true && item.status === "draft")
    .map((item) => {
      const rawKind = item.rawGenerationInputs.kind;
      const kind =
        rawKind === "clip_video"
          ? "clip_video"
          : rawKind === "merged_video"
            ? "merged_video"
            : "avatar_video";
      const error =
        typeof item.rawGenerationInputs.studioError === "string"
          ? item.rawGenerationInputs.studioError
          : null;
      const hasOutput = item.outputAssets.length > 0;
      const label = firstWords(
        kind === "clip_video"
          ? String(item.rawGenerationInputs.visualsPrompt ?? "") ||
              String(item.rawGenerationInputs.textToDisplay ?? "")
          : kind === "merged_video"
            ? item.caption ?? ""
            : String(item.rawGenerationInputs.rawScript ?? item.rawGenerationInputs.script ?? ""),
      );
      const fallbackLabel =
        kind === "clip_video" ? "Visual clip" : kind === "merged_video" ? "Merged video" : "Avatar video";
      return {
        id: item.id,
        kind,
        label: label || fallbackLabel,
        brandName: accountName(item.brand),
        state: error ? "failed" : hasOutput ? "ready" : "rendering",
        videoUrl: hasOutput ? `/api/media/${item.id}` : null,
        error,
        caption: item.caption ?? "",
        createdAt: item.createdAt,
        ageMinutes: ageMinutes(item.createdAt),
      };
    });

  // Combine picker: any video (avatar / clip / merged / uploaded) with a rendered
  // file, newest first, selectable as a merge source.
  const combineLibrary: CombineSourceOption[] = [...recent, ...clipItems]
    .filter((item) => item.outputAssets.length > 0)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 60)
    .map((item) => ({
      id: item.id,
      label: combineLabel(item),
      kindLabel: combineKind(item),
      createdAt: item.createdAt,
    }));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        Generate vertical videos — an avatar speaking your script, or a prompt-driven visual clip.
        Renders land in <strong>Generated videos</strong> to download, caption, and send to the
        Approval Queue. Captions are added there, not now.
      </p>
      <VideoStudioTabs
        accounts={perAccount}
        canCreate={profile?.role !== "reviewer"}
        videos={videos}
        combineLibrary={combineLibrary}
      />
    </div>
  );
}

/** Human tag for the Combine picker. */
function combineKind(item: ContentItem): string {
  if (item.type === "clip") return "Clip";
  const kind = item.rawGenerationInputs.kind;
  if (kind === "avatar_video") return "Avatar";
  if (kind === "clip_video") return "Clip";
  if (kind === "merged_video") return "Merged";
  if (kind === "uploaded_video") return "Upload";
  return "Video";
}

/** Compact label for the Combine picker. */
function combineLabel(item: ContentItem): string {
  const gi = item.rawGenerationInputs;
  const raw =
    item.caption ||
    String(gi.visualsPrompt ?? gi.rawScript ?? gi.script ?? gi.prompt ?? gi.textToDisplay ?? "");
  return firstWords(raw) || combineKind(item);
}

/** Whole minutes since an ISO timestamp (server clock). Drives the stall hint. */
function ageMinutes(createdAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000));
}

/** First few words of a caption/script for a compact label. */
function firstWords(text: string, max = 80): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}
