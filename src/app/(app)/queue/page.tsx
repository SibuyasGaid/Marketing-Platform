import { CalendarPanel, type CalendarEntryView } from "@/components/queue/CalendarPanel";
import { QueueBoard, type QueueItemView } from "@/components/queue/QueueBoard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { BRAND_NAMES, PLATFORMS, type Platform } from "@/lib/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signedUrls } from "@/lib/supabase/storage";
import { AccountRepository, fallbackAccounts } from "@/repositories/AccountRepository";
import { ApprovalEventRepository } from "@/repositories/ApprovalEventRepository";
import { BrandPresetRepository } from "@/repositories/BrandPresetRepository";
import { ContentCalendarRepository } from "@/repositories/ContentCalendarRepository";
import { ContentItemRepository } from "@/repositories/ContentItemRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";

export const metadata = { title: "Approval Queue · Content Studio" };
export const dynamic = "force-dynamic";

const QUEUE_LIMIT = 120;

export default async function ApprovalQueuePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user
    ? await new ProfileRepository(supabase).getById(user.id).catch(() => null)
    : null;
  const canReview = profile?.role === "admin" || profile?.role === "reviewer";
  // Content-changing actions (delete, generate captions, add outro, switch
  // version) reject the reviewer role server-side, so only surface them to
  // admins/editors — reviewers approve but don't edit content.
  const canManage = profile?.role === "admin" || profile?.role === "editor";

  const weekDates = currentWeekDates();
  const admin = createSupabaseAdminClient();

  // Calendar list spans this week's Monday through ~12 weeks out, so a day you
  // plan ahead actually shows up (not just entries inside the current week).
  const calendarFrom = weekDates[0];
  const calendarTo = addDays(weekDates[0], 84);

  // Read via the admin client + degrade to empty rather than white-screening the
  // whole board if one query fails for a given session (writes stay role-gated
  // in server actions).
  const [items, calendarEntries, presets] = await Promise.all([
    new ContentItemRepository(admin).listForQueue(QUEUE_LIMIT).catch(() => []),
    new ContentCalendarRepository(admin).listBetween(calendarFrom, calendarTo).catch(() => []),
    new BrandPresetRepository(admin).listActive().catch(() => []),
  ]);
  const accountList = await new AccountRepository(admin).listActive().catch(() => fallbackAccounts());
  const accounts = accountList.length > 0 ? accountList : fallbackAccounts();
  const accountName = (slug: string) =>
    accounts.find((account) => account.slug === slug)?.name ?? BRAND_NAMES[slug] ?? slug;
  // Which accounts have an outro clip configured (drives the "Add outro" button).
  const accountOutro = new Map(
    accounts.map((account) => [account.slug, Boolean(account.outroVideoPath)]),
  );

  // One batched audit query for the whole board, not one per card (N+1).
  const auditByItem = await new ApprovalEventRepository(admin).listByItems(
    items.map((item) => item.id),
  );

  // Batch-sign every non-video image asset up front (grouped by bucket) instead
  // of one round-trip per card. Videos are served via /api/media, not signed.
  const queuePathsByBucket = new Map<string, string[]>();
  for (const item of items) {
    if (item.type === "clip" || item.type === "heygen_video") continue;
    for (const asset of item.outputAssets) {
      const list = queuePathsByBucket.get(asset.bucket) ?? [];
      list.push(asset.path);
      queuePathsByBucket.set(asset.bucket, list);
    }
  }
  const queueBucketEntries = await Promise.all(
    [...queuePathsByBucket].map(
      async ([bucket, paths]) => [bucket, await signedUrls(admin, bucket, paths)] as const,
    ),
  );
  const queueUrlsByBucket = new Map(queueBucketEntries);
  const queueUrl = (asset: { bucket: string; path: string }) =>
    queueUrlsByBucket.get(asset.bucket)?.get(asset.path) ?? null;

  const itemViews: QueueItemView[] = items.map((item) => {
    const isVideo = item.type === "clip" || item.type === "heygen_video";
    let previewUrl: string | null = null;
    let videoUrl: string | null = null;
    let slideUrls: string[] = [];

    const asset = item.outputAssets[0] ?? null;
    // Carousels store one output per slide, in order; sign them all.
    const isCarousel = item.generationInputs.slides.length >= 2 && item.outputAssets.length > 1;
    if (isVideo) {
      // clip = the cut standalone file; heygen = the rendered avatar video.
      // Served through our range-capable /api/media route (Supabase signed
      // object URLs don't range-serve, so <video> stalls/resets on them).
      // Null until the render lands, so the drawer shows a pending state.
      // The ?v token is derived from the active output's path so the URL
      // CHANGES when the user switches captioned<->original — otherwise the
      // <video> keeps the previously loaded bytes and the switch looks like a
      // no-op even though the server now serves the other version.
      if (asset) videoUrl = `/api/media/${item.id}?v=${versionToken(asset.path)}`;
    } else if (isCarousel) {
      slideUrls = item.outputAssets.map(queueUrl).filter((url): url is string => Boolean(url));
      previewUrl = slideUrls[0] ?? null;
    } else {
      previewUrl = asset ? queueUrl(asset) : null;
    }
    const audit = auditByItem.get(item.id) ?? [];

    return {
      id: item.id,
      type: item.type,
      platform: item.platform,
      targetPlatforms: item.targetPlatforms,
      // Platforms actually posted (for the repost control). Falls back to the
      // target set for items posted before we recorded it granularly. Filtered
      // to known platforms so a stray stored value can't corrupt the picker.
      postedPlatforms: Array.isArray(item.rawGenerationInputs.postedPlatforms)
        ? (item.rawGenerationInputs.postedPlatforms as unknown[]).filter(
            (p): p is Platform => PLATFORMS.includes(p as Platform),
          )
        : item.targetPlatforms,
      brandName: accountName(item.brand),
      status: item.status,
      caption: item.caption,
      previewUrl,
      slideUrls,
      videoUrl,
      clipStartS: null,
      clipEndS: null,
      isVideo,
      hasCaptionedVersion: item.rawGenerationInputs.hasCaptionedVersion === true,
      captionsActive: item.rawGenerationInputs.captionsActive === true,
      captionsRequested: item.rawGenerationInputs.subtitles === true,
      captionsPending: item.rawGenerationInputs.captionsPending === true,
      hasOutro: item.rawGenerationInputs.hasOutro === true,
      outroPending: item.rawGenerationInputs.outroPending === true,
      accountHasOutro: Boolean(accountOutro.get(item.brand)),
      editComment: item.editComment,
      platformPostUrl: item.platformPostUrl,
      // Scheduled items sit on their planned day; everything else on the
      // day it was produced, so nothing silently disappears from the board.
      bucketDate: item.scheduledDate ?? item.createdAt.slice(0, 10),
      scheduledDate: item.scheduledDate,
      scheduledFor: item.scheduledFor,
      prompt: item.generationInputs.prompt,
      audit: audit.map((entry) => ({
        id: entry.id,
        action: entry.action,
        reviewerEmail: entry.reviewerEmail,
        comment: entry.comment,
        createdAt: entry.createdAt,
      })),
    };
  });

  const calendarViews: CalendarEntryView[] = calendarEntries.map((entry) => ({
    id: entry.id,
    calendarDate: entry.calendarDate,
    brand: entry.brand,
    platforms: entry.platforms,
    prompt: entry.prompt,
  }));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        Review everything before it goes out. Nothing is published until you approve it. Click a card
        to preview, then Approve or Request edits.
      </p>
      <QueueBoard
        items={itemViews}
        weekDates={weekDates}
        canReview={canReview}
        canManage={canManage}
        accounts={accounts.map((account) => ({ slug: account.slug, name: account.name }))}
      />
      {/* Auto-generation planner: turns a prompt into content each morning.
          Distinct from the scheduled-posts calendar inside QueueBoard. */}
      <CalendarPanel
        entries={calendarViews}
        presets={presets.map((preset) => ({ id: preset.id, name: preset.name }))}
        accounts={accounts.map((account) => ({ slug: account.slug, name: account.name }))}
        canEdit={profile?.role !== "reviewer"}
      />
    </div>
  );
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Short, stable, URL-safe token derived from the active output's storage path.
 * Changes when the active version changes (captioned vs original have different
 * paths), which busts the <video> element's loaded source on a switch.
 */
function versionToken(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i += 1) {
    hash = (hash * 31 + path.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Monday→Sunday of the current week, in UTC. */
function currentWeekDates(): string[] {
  const now = new Date();
  const day = now.getUTCDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + offsetToMonday);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}
