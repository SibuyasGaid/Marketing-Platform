"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  addVideoCaptions,
  addVideoOutro,
  approveItem,
  cancelSchedule,
  editCaption,
  repostToMorePlatforms,
  requestEdits,
  retryFailedItem,
  switchVideoVersion,
  updateTargetPlatforms,
  type ActionState,
} from "@/app/(app)/queue/actions";
import { deleteContentItem } from "@/app/(app)/content-actions";
import { Button } from "@/components/ui/Button";
import { useActiveRefresh } from "@/components/hooks/useActiveRefresh";
import { PostCalendar, type CalendarPost } from "@/components/queue/PostCalendar";
import {
  UploadVideoModal,
  type UploadAccountOption,
} from "@/components/queue/UploadVideoModal";
import { StatusPill } from "@/components/ui/StatusPill";
import { CONTENT_STATUSES, PLATFORMS, type ContentStatus, type Platform } from "@/lib/domain";
import { formatSydney, nowSydneyLocal } from "@/lib/timezone";

export interface AuditEntryView {
  id: string;
  action: "approved" | "edits_requested";
  reviewerEmail: string | null;
  comment: string | null;
  createdAt: string;
}

export interface QueueItemView {
  id: string;
  type: string;
  platform: Platform;
  /** All destinations this one post publishes to. */
  targetPlatforms: Platform[];
  /** Platforms already posted to (for reposting to new ones after it's live). */
  postedPlatforms: Platform[];
  brandName: string;
  status: ContentStatus;
  caption: string | null;
  previewUrl: string | null;
  /** All slide images, in order, when this is a carousel (else empty). */
  slideUrls: string[];
  /** Playable video: a clip's source video, or a finished HeyGen render. */
  videoUrl: string | null;
  /** For clips, the segment in/out (seconds) to preview within the source. */
  clipStartS: number | null;
  clipEndS: number | null;
  isVideo: boolean;
  /** True when a captioned version has been generated alongside the original. */
  hasCaptionedVersion: boolean;
  /** True when the captioned version is the active (served + published) one. */
  captionsActive: boolean;
  /** True when subtitles were requested at generation (a hint to add them now). */
  captionsRequested: boolean;
  /** True while a caption burn is in progress (server-persisted). */
  captionsPending: boolean;
  /** True when the account's outro has been appended. */
  hasOutro: boolean;
  /** True while an outro append is in progress (server-persisted). */
  outroPending: boolean;
  /** True when this item's account has an outro clip configured. */
  accountHasOutro: boolean;
  editComment: string | null;
  platformPostUrl: string | null;
  bucketDate: string;
  scheduledDate: string | null;
  /** Exact publish time (ISO) when this item is scheduled; else null. */
  scheduledFor: string | null;
  prompt: string;
  audit: AuditEntryView[];
}

const initialState: ActionState = { error: null };

const PLATFORM_ICON: Record<Platform, string> = {
  instagram: "IG",
  facebook: "FB",
  linkedin: "LI",
  youtube: "YT",
};

/** Statuses that still need a human decision. */
const ACTIONABLE: ContentStatus[] = ["pending_approval"];

export function QueueBoard({
  items,
  weekDates,
  canReview,
  canManage,
  accounts,
}: {
  items: QueueItemView[];
  weekDates: string[];
  canReview: boolean;
  canManage: boolean;
  accounts: UploadAccountOption[];
}) {
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ContentStatus | "all">("all");
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  // Publishing/regenerating states settle asynchronously — keep the board honest.
  // Also poll while a clip or avatar video is still rendering so it appears live.
  const hasInFlight = items.some(
    (item) =>
      ["publishing", "regenerating", "approved"].includes(item.status) ||
      (item.isVideo && !item.videoUrl),
  );
  useActiveRefresh(hasInFlight, 6000);

  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (platformFilter === "all" || item.platform === platformFilter) &&
          (statusFilter === "all" || item.status === statusFilter),
      ),
    [items, platformFilter, statusFilter],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, QueueItemView[]>();
    for (const date of weekDates) map.set(date, []);
    const overflow: QueueItemView[] = [];
    for (const item of filtered) {
      const bucket = map.get(item.bucketDate);
      if (bucket) bucket.push(item);
      else overflow.push(item);
    }
    return { map, overflow };
  }, [filtered, weekDates]);

  const openItem = filtered.find((item) => item.id === openItemId) ?? null;

  // Calendar shows items with a planned day that aren't done yet (posted items
  // leave the plan). Uses all items, independent of the board's filters.
  const calendarPosts = useMemo<CalendarPost[]>(
    () =>
      items
        .filter((item) => item.scheduledDate && item.status !== "posted")
        .map((item) => ({
          id: item.id,
          date: item.scheduledDate as string,
          brandName: item.brandName,
          platform: item.platform,
          status: item.status,
          caption: item.caption,
          previewUrl: item.previewUrl,
        })),
    [items],
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-border-subtle bg-bg-raised p-4">
        <FilterGroup
          label="Platform"
          options={["all", ...PLATFORMS]}
          value={platformFilter}
          onChange={(value) => setPlatformFilter(value as Platform | "all")}
        />
        <FilterGroup
          label="Status"
          options={["all", ...CONTENT_STATUSES.filter((status) => status !== "draft")]}
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as ContentStatus | "all")}
        />
        <div className="ml-auto flex items-center gap-3">
          {canManage ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowUpload(true)}
              className="!px-4 !py-1.5 text-[13px]"
            >
              + Upload edited video
            </Button>
          ) : null}
          <span className="text-[13px] text-text-faint">
            {filtered.length} item{filtered.length === 1 ? "" : "s"}
          </span>
        </div>
      </section>

      {filtered.length === 0 ? (
        <section className="rounded-2xl border border-border-subtle bg-bg-raised p-8 text-center">
          <p className="text-sm text-text-secondary">
            {items.length === 0
              ? "Nothing in the queue yet. Generated posts land here for review."
              : "No items match these filters."}
          </p>
        </section>
      ) : (
        /* Week board: 7 columns on desktop, stacked day list on mobile. */
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {weekDates.map((date) => (
            <DayColumn
              key={date}
              date={date}
              items={byDate.map.get(date) ?? []}
              onOpen={setOpenItemId}
            />
          ))}
        </div>
      )}

      {byDate.overflow.length > 0 ? (
        <section className="rounded-2xl border border-border-subtle bg-bg-raised p-4">
          <h3 className="font-display text-base font-semibold text-text-primary">
            Unscheduled / other weeks
          </h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {byDate.overflow.map((item) => (
              <QueueCard key={item.id} item={item} onOpen={setOpenItemId} />
            ))}
          </div>
        </section>
      ) : null}

      <PostCalendar posts={calendarPosts} onOpen={setOpenItemId} />

      <AnimatePresence>
        {openItem ? (
          <ItemDrawer
            key={openItem.id}
            item={openItem}
            canReview={canReview}
            canManage={canManage}
            onClose={() => setOpenItemId(null)}
          />
        ) : null}
      </AnimatePresence>

      {showUpload ? (
        <UploadVideoModal accounts={accounts} onClose={() => setShowUpload(false)} />
      ) : null}
    </div>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-text-secondary">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-xl border border-border-subtle bg-bg-base px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-border-strong"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "all" ? "All" : option.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

function DayColumn({
  date,
  items,
  onOpen,
}: {
  date: string;
  items: QueueItemView[];
  onOpen: (id: string) => void;
}) {
  const day = new Date(`${date}T00:00:00Z`);
  const isToday = date === new Date().toISOString().slice(0, 10);

  return (
    <div className="rounded-2xl border border-border-subtle bg-bg-raised p-3">
      <div className="flex items-baseline justify-between">
        <span
          className={`type-utility ${isToday ? "text-primary-soft" : "text-text-faint"}`}
        >
          {day.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
        </span>
        <span className="text-[13px] text-text-faint">
          {day.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" })}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="py-3 text-center text-[13px] text-text-faint">·</p>
        ) : (
          items.map((item) => <QueueCard key={item.id} item={item} onOpen={onOpen} />)
        )}
      </div>
    </div>
  );
}

function QueueCard({
  item,
  onOpen,
}: {
  item: QueueItemView;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(item.id);
      }}
      className="card-hover w-full rounded-xl border border-border-subtle bg-bg-base p-2 text-left hover:bg-bg-hover"
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="type-utility text-text-faint">
          {item.targetPlatforms.map((p) => PLATFORM_ICON[p]).join(" · ")}
        </span>
        <StatusPill status={item.status} />
      </div>
      <span className="mt-1 block truncate text-[11px] text-text-faint">{item.brandName}</span>
      {item.previewUrl ? (
        <div className="relative mt-2">
          <Image
            src={item.previewUrl}
            alt=""
            width={320}
            height={320}
            unoptimized
            className="aspect-square w-full rounded-lg object-cover"
          />
          {item.slideUrls.length > 1 ? (
            <span className="absolute right-1.5 top-1.5 rounded-full bg-bg-nav/85 px-2 py-0.5 text-[11px] font-medium text-text-primary">
              ▦ {item.slideUrls.length}
            </span>
          ) : null}
        </div>
      ) : item.isVideo ? (
        <span className="mt-2 flex aspect-video w-full items-center justify-center rounded-lg bg-bg-nav">
          <PlayGlyph />
        </span>
      ) : null}
      <p className="mt-1.5 line-clamp-2 text-[13px] text-text-secondary">
        {item.caption || item.prompt || "No caption"}
      </p>
      {item.status === "scheduled" && item.scheduledFor ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-info">
          <span aria-hidden>🕑</span>
          {formatSydney(item.scheduledFor, { year: undefined })}
        </p>
      ) : null}
    </button>
  );
}

function ItemDrawer({
  item,
  canReview,
  canManage,
  onClose,
}: {
  item: QueueItemView;
  canReview: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  const [isEditsOpen, setIsEditsOpen] = useState(false);
  const [isConfirmingApprove, setIsConfirmingApprove] = useState(false);
  // "now" publishes on approve; "schedule" holds until the chosen time.
  const [approveMode, setApproveMode] = useState<"now" | "schedule">("now");
  const [scheduleAt, setScheduleAt] = useState("");
  const [approveState, approveAction, isApproving] = useActionState(approveItem, initialState);
  const [editsState, editsAction, isRequestingEdits] = useActionState(
    requestEdits,
    initialState,
  );
  const [retryState, retryAction, isRetrying] = useActionState(retryFailedItem, initialState);
  const [cancelState, cancelAction, isCancelling] = useActionState(cancelSchedule, initialState);
  const [deleteState, deleteAction, isDeleting] = useActionState(deleteContentItem, initialState);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isActionable = ACTIONABLE.includes(item.status);
  const reduce = useReducedMotion();

  return (
    <div role="dialog" aria-modal="true" aria-label="Content item" className="fixed inset-0 z-50">
      <motion.button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-bg-nav/80"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      />
      {/* Full-screen sheet on mobile, right-side drawer on desktop.
          220ms slide from the right (docs/DESIGN.md §4). */}
      <motion.div
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto border-l border-border-subtle bg-bg-raised p-5"
        initial={reduce ? { x: 0 } : { x: "100%" }}
        animate={{ x: 0 }}
        exit={reduce ? { opacity: 0 } : { x: "100%" }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-text-primary">
              {item.type.replace(/_/g, " ")}
            </h2>
            <p className="mt-0.5 text-[13px] text-text-faint">
              {item.brandName} · {item.targetPlatforms.join(", ")} · {item.scheduledDate ?? "unscheduled"}
            </p>
          </div>
          <StatusPill status={item.status} />
        </div>

        {item.isVideo ? (
          item.videoUrl ? (
            <SegmentVideo url={item.videoUrl} />
          ) : (
            <div className="mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border border-border-subtle bg-bg-base p-8 text-center">
              <span className="h-4 w-4 animate-spinner-dot rounded-full border-2 border-text-faint border-t-transparent" />
              {item.type === "heygen_video" ? (
                <>
                  <span className="text-sm text-text-secondary">
                    The avatar video is still rendering.
                  </span>
                  <span className="text-[13px] text-text-faint">
                    It appears here automatically when HeyGen finishes, usually a few minutes.
                  </span>
                </>
              ) : (
                <>
                  <span className="text-sm text-text-secondary">This clip is being prepared.</span>
                  <span className="text-[13px] text-text-faint">
                    It appears here automatically once the highlight is cut, usually a few seconds.
                  </span>
                </>
              )}
            </div>
          )
        ) : item.slideUrls.length > 1 ? (
          <div className="mt-4">
            <span className="type-utility text-text-faint">
              Carousel · {item.slideUrls.length} slides
            </span>
            <div className="mt-1.5 flex snap-x gap-2 overflow-x-auto pb-1">
              {item.slideUrls.map((url, index) => (
                <div key={url} className="relative shrink-0 snap-start">
                  <Image
                    src={url}
                    alt={`Slide ${index + 1}`}
                    width={320}
                    height={320}
                    unoptimized
                    className="aspect-square w-64 rounded-xl object-cover"
                  />
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-bg-nav/85 px-2 py-0.5 text-[11px] font-medium text-text-primary">
                    {index + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : item.previewUrl ? (
          <Image
            src={item.previewUrl}
            alt=""
            width={640}
            height={640}
            unoptimized
            className="mt-4 w-full rounded-xl"
          />
        ) : null}

        {item.isVideo && item.videoUrl ? (
          <CaptionsControl
            itemId={item.id}
            hasCaptionedVersion={item.hasCaptionedVersion}
            captionsActive={item.captionsActive}
            captionsRequested={item.captionsRequested}
            captionsPending={item.captionsPending}
            hasOutro={item.hasOutro}
            canEdit={canManage && item.status !== "publishing" && item.status !== "posted"}
          />
        ) : null}

        {item.isVideo && item.videoUrl ? (
          <OutroControl
            itemId={item.id}
            hasOutro={item.hasOutro}
            outroPending={item.outroPending}
            accountHasOutro={item.accountHasOutro}
            canEdit={canManage && item.status !== "publishing" && item.status !== "posted"}
          />
        ) : null}

        <CaptionSection
          itemId={item.id}
          caption={item.caption}
          canEdit={canReview && item.status !== "publishing" && item.status !== "posted"}
        />

        <DestinationsControl
          itemId={item.id}
          type={item.type}
          targetPlatforms={item.targetPlatforms}
          canEdit={canReview && item.status !== "publishing" && item.status !== "posted"}
        />

        {item.status === "posted" ? (
          <RepostControl
            itemId={item.id}
            type={item.type}
            postedPlatforms={item.postedPlatforms}
            canPublish={canReview}
          />
        ) : null}

        {item.prompt ? (
          <section className="mt-4">
            <h3 className="type-utility text-text-faint">Generation inputs</h3>
            <p className="mt-1 whitespace-pre-wrap text-[13px] text-text-faint">{item.prompt}</p>
          </section>
        ) : null}

        {item.editComment ? (
          <section className="mt-4 rounded-xl border border-warning/40 bg-bg-base p-3">
            <h3 className="type-utility text-warning">Changes requested</h3>
            <p className="mt-1 text-[13px] text-text-secondary">{item.editComment}</p>
          </section>
        ) : null}

        {item.platformPostUrl ? (
          <a
            href={item.platformPostUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block text-[13px] text-primary-soft hover:text-primary-bright"
          >
            View the live post ↗
          </a>
        ) : null}

        <section className="mt-4">
          <h3 className="type-utility text-text-faint">Audit log</h3>
          {item.audit.length === 0 ? (
            <p className="mt-1 text-[13px] text-text-faint">No review activity yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {item.audit.map((entry) => (
                <li key={entry.id} className="rounded-xl border border-border-subtle bg-bg-base p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-text-primary">
                      {entry.action === "approved" ? "Approved" : "Edits requested"}
                    </span>
                    <span className="text-[13px] text-text-faint">
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-text-faint">
                    {entry.reviewerEmail ?? "unknown reviewer"}
                  </p>
                  {entry.comment ? (
                    <p className="mt-1 text-[13px] text-text-secondary">{entry.comment}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-auto pt-5">
          {!canReview ? (
            <p className="text-[13px] text-text-faint">
              Only admins and reviewers can approve or request edits.
            </p>
          ) : item.status === "failed" ? (
            <div>
              <p className="mb-2 text-[13px] text-text-faint">
                This item failed. Retry sends it back to the queue for a fresh approval.
              </p>
              <form action={retryAction}>
                <input type="hidden" name="itemId" value={item.id} />
                <Button type="submit" variant="secondary" isLoading={isRetrying}>
                  Retry
                </Button>
              </form>
              {retryState.error ? (
                <p className="mt-2 text-sm text-danger">{retryState.error}</p>
              ) : null}
            </div>
          ) : item.status === "scheduled" ? (
            <div>
              <p className="mb-2 text-[13px] text-text-faint">
                Scheduled to publish{" "}
                <span className="text-text-secondary">
                  {item.scheduledFor ? formatSydney(item.scheduledFor) : "at the set time"}
                </span>
                . It publishes automatically. Cancel to send it back to the queue.
              </p>
              <form action={cancelAction}>
                <input type="hidden" name="itemId" value={item.id} />
                <Button type="submit" variant="secondary" isLoading={isCancelling}>
                  Cancel schedule
                </Button>
              </form>
              {cancelState.error ? (
                <p className="mt-2 text-sm text-danger">{cancelState.error}</p>
              ) : null}
            </div>
          ) : !isActionable ? (
            <p className="text-[13px] text-text-faint">
              No action available while this item is {item.status.replace(/_/g, " ")}.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={() => setIsConfirmingApprove(true)}>
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsEditsOpen((open) => !open)}
                >
                  Request edits
                </Button>
              </div>
              {approveState.error ? (
                <p className="mt-2 text-sm text-danger">{approveState.error}</p>
              ) : null}
              {approveState.ok ? (
                <p className="mt-2 text-sm text-success">
                  {approveMode === "schedule"
                    ? `Scheduled for ${item.targetPlatforms.join(", ")}.`
                    : `Approved. Publishing to ${item.targetPlatforms.join(", ")}.`}
                </p>
              ) : null}

              {isConfirmingApprove && !approveState.ok ? (
                <ConfirmDialog
                  title="Approve this post?"
                  message={`This approves the ${
                    item.slideUrls.length > 1
                      ? `${item.slideUrls.length}-slide carousel`
                      : item.type.replace(/_/g, " ")
                  } and publishes it to ${item.targetPlatforms.join(", ")}. Choose to publish now or schedule it for later.`}
                  onCancel={() => setIsConfirmingApprove(false)}
                >
                  <form action={approveAction} className="flex flex-col gap-3">
                    <input type="hidden" name="itemId" value={item.id} />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setApproveMode("now")}
                        aria-pressed={approveMode === "now"}
                        className={`rounded-full px-3.5 py-1.5 font-display text-[13px] font-medium transition-colors ${
                          approveMode === "now"
                            ? "bg-primary text-text-primary"
                            : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                        }`}
                      >
                        Publish now
                      </button>
                      <button
                        type="button"
                        onClick={() => setApproveMode("schedule")}
                        aria-pressed={approveMode === "schedule"}
                        className={`rounded-full px-3.5 py-1.5 font-display text-[13px] font-medium transition-colors ${
                          approveMode === "schedule"
                            ? "bg-primary text-text-primary"
                            : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                        }`}
                      >
                        Schedule
                      </button>
                    </div>
                    {approveMode === "schedule" ? (
                      <label className="flex flex-col gap-1 text-[13px] text-text-secondary">
                        Publish at (Sydney time)
                        <input
                          type="datetime-local"
                          name="scheduledFor"
                          required
                          value={scheduleAt}
                          min={nowSydneyLocal()}
                          onChange={(event) => setScheduleAt(event.target.value)}
                          className="rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
                        />
                        <span className="text-[11px] text-text-faint">
                          Times are in Australia/Sydney (AEST/AEDT).
                        </span>
                      </label>
                    ) : (
                      <input type="hidden" name="scheduledFor" value="" />
                    )}
                    <Button
                      type="submit"
                      isLoading={isApproving}
                      disabled={approveMode === "schedule" && !scheduleAt}
                    >
                      {approveMode === "schedule" ? "Schedule post" : "Yes, publish now"}
                    </Button>
                  </form>
                </ConfirmDialog>
              ) : null}

              {isEditsOpen ? (
                <form action={editsAction} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="itemId" value={item.id} />
                  <textarea
                    name="comment"
                    rows={3}
                    required
                    placeholder="What needs to change? This is sent back with the item."
                    className="w-full resize-y rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-[13px] text-text-primary outline-none focus:border-border-strong"
                  />
                  {editsState.error ? (
                    <p className="text-[13px] text-danger">{editsState.error}</p>
                  ) : null}
                  <Button
                    type="submit"
                    variant="secondary"
                    isLoading={isRequestingEdits}
                    className="self-start"
                  >
                    Send for regeneration
                  </Button>
                </form>
              ) : null}
            </>
          )}

          {/* Delete: scrap an item that was queued but shouldn't go out (e.g. we
              spotted something to fix). Admin/editor only (reviewers can't delete
              content), for anything not already publishing/posted. */}
          {canManage && item.status !== "publishing" && item.status !== "posted" ? (
            <div className="mt-3 border-t border-border-subtle pt-3">
              <button
                type="button"
                onClick={() => setIsConfirmingDelete(true)}
                className="text-[13px] text-text-faint transition-colors hover:text-danger"
              >
                Delete this item
              </button>
              {deleteState.error ? (
                <p className="mt-1 text-[13px] text-danger">{deleteState.error}</p>
              ) : null}
              {isConfirmingDelete ? (
                <ConfirmDialog
                  title="Delete this item?"
                  message="This permanently removes it from the queue and deletes its generated media. This can't be undone."
                  onCancel={() => setIsConfirmingDelete(false)}
                >
                  <form action={deleteAction}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <Button type="submit" variant="destructive" isLoading={isDeleting}>
                      Yes, delete
                    </Button>
                  </form>
                </ConfirmDialog>
              ) : null}
            </div>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Repost control: for an already-POSTED item, publish it to platforms it wasn't
 * sent to before (a change of mind after it went live). Only shows platforms not
 * already posted (never re-posts a live one) and valid for the type. Publishing
 * runs in the background; the reposted platforms drop off the list when done.
 */
function RepostControl({
  itemId,
  type,
  postedPlatforms,
  canPublish,
}: {
  itemId: string;
  type: string;
  postedPlatforms: Platform[];
  canPublish: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<Platform>>(new Set());
  const [reposting, setReposting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Platforms not yet posted and valid for this type (images can't do YouTube).
  const posted = new Set(postedPlatforms);
  const remaining = (type === "image_post"
    ? PLATFORMS.filter((p) => p !== "youtube")
    : PLATFORMS
  ).filter((p) => !posted.has(p));

  // While reposting, poll so the newly-posted platforms drop off on completion.
  useActiveRefresh(reposting, 10_000);
  useEffect(() => {
    if (!reposting) return;
    const stop = setTimeout(() => setReposting(false), 60_000);
    return () => clearTimeout(stop);
  }, [reposting]);

  const start = async () => {
    if (selected.size === 0) return;
    setError(null);
    setReposting(true);
    const formData = new FormData();
    formData.set("itemId", itemId);
    for (const p of selected) formData.append("platforms", p);
    const result = await repostToMorePlatforms({ error: null }, formData);
    if (!result.ok) {
      setReposting(false);
      setError(result.error ?? "Could not repost — try again.");
    } else {
      setSelected(new Set());
      router.refresh();
    }
  };

  if (remaining.length === 0) {
    return (
      <section className="mt-4">
        <h3 className="type-utility font-semibold text-text-secondary">Repost</h3>
        <p className="mt-1 text-[13px] text-text-faint">Posted to every available platform.</p>
      </section>
    );
  }
  if (!canPublish) return null;

  return (
    <section className="mt-4">
      <h3 className="type-utility font-semibold text-text-secondary">Repost to more platforms</h3>
      <p className="mt-1 text-[13px] text-text-faint">
        Already live. Publish it to platforms it wasn&rsquo;t posted to — the ones it&rsquo;s already
        on aren&rsquo;t shown, so nothing is doubled up.
      </p>
      {/* The picker stays visible during a repost (the reposted platforms simply
          drop off as they go live), so nothing is blocked. */}
      <div className="mt-1.5 flex flex-col gap-2">
          {reposting ? (
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-primary-bright" />
              <span className="text-[13px] text-text-secondary">
                Reposting… platforms drop off the list once live. Updates automatically.
              </span>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {remaining.map((platform) => {
              const on = selected.has(platform);
              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() =>
                    setSelected((cur) => {
                      const next = new Set(cur);
                      if (next.has(platform)) next.delete(platform);
                      else next.add(platform);
                      return next;
                    })
                  }
                  aria-pressed={on}
                  className={`rounded-full px-3 py-1.5 font-display text-[13px] font-medium capitalize transition-colors ${
                    on
                      ? "bg-primary text-text-primary"
                      : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {platform}
                </button>
              );
            })}
          </div>
          {selected.size > 0 ? (
            <Button
              type="button"
              onClick={start}
              isLoading={reposting}
              variant="secondary"
              className="self-start !px-4 !py-1.5 text-[13px]"
            >
              Repost to {selected.size} {selected.size === 1 ? "platform" : "platforms"}
            </Button>
          ) : null}
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      </div>
    </section>
  );
}

/**
 * Destinations: shows where a queued post will publish and lets a reviewer add
 * or remove platforms before it goes out (in case they change their mind). Image
 * posts can't target YouTube (video-only); videos can target any platform.
 */
function DestinationsControl({
  itemId,
  type,
  targetPlatforms,
  canEdit,
}: {
  itemId: string;
  type: string;
  targetPlatforms: Platform[];
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState<Set<Platform>>(new Set(targetPlatforms));
  const [state, action, isSaving] = useActionState(updateTargetPlatforms, initialState);

  // Image posts are image-only platforms; videos can go anywhere.
  const options = (type === "image_post"
    ? PLATFORMS.filter((p) => p !== "youtube")
    : PLATFORMS) as readonly Platform[];

  const dirty =
    selected.size !== targetPlatforms.length ||
    targetPlatforms.some((p) => !selected.has(p));

  return (
    <section className="mt-4">
      <h3 className="type-utility font-semibold text-text-secondary">Destinations</h3>
      {canEdit ? (
        <form action={action} className="mt-1.5 flex flex-col gap-2">
          <input type="hidden" name="itemId" value={itemId} />
          {[...selected].map((p) => (
            <input key={p} type="hidden" name="platforms" value={p} />
          ))}
          <div className="flex flex-wrap gap-1.5">
            {options.map((platform) => {
              const on = selected.has(platform);
              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() =>
                    setSelected((cur) => {
                      const next = new Set(cur);
                      if (next.has(platform)) next.delete(platform);
                      else next.add(platform);
                      return next;
                    })
                  }
                  aria-pressed={on}
                  className={`rounded-full px-3 py-1.5 font-display text-[13px] font-medium capitalize transition-colors ${
                    on
                      ? "bg-primary text-text-primary"
                      : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {platform}
                </button>
              );
            })}
          </div>
          {dirty && selected.size > 0 ? (
            <Button
              type="submit"
              variant="secondary"
              isLoading={isSaving}
              className="self-start !px-4 !py-1.5 text-[13px]"
            >
              Save destinations
            </Button>
          ) : null}
          {state.error ? <p className="text-[13px] text-danger">{state.error}</p> : null}
          {state.ok ? <p className="text-[13px] text-success">Destinations updated.</p> : null}
        </form>
      ) : (
        <p className="mt-1 text-[13px] text-text-secondary capitalize">
          {targetPlatforms.join(", ")}
        </p>
      )}
    </section>
  );
}

/**
 * Outro control: appends the account's ending clip to the video (once). Shown on
 * every rendered video; when the account has no outro configured it explains how
 * to add one (so the button's absence is never a silent mystery). Mirrors the
 * captions progress pattern — a persistent spinner that auto-refreshes.
 */
function OutroControl({
  itemId,
  hasOutro,
  outroPending,
  accountHasOutro,
  canEdit,
}: {
  itemId: string;
  hasOutro: boolean;
  outroPending: boolean;
  accountHasOutro: boolean;
  canEdit: boolean;
}) {
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appending = !hasOutro && (started || outroPending);

  useActiveRefresh(appending, 10_000);

  const start = async () => {
    setError(null);
    setStarted(true);
    const formData = new FormData();
    formData.set("itemId", itemId);
    const result = await addVideoOutro({ error: null }, formData);
    if (!result.ok) {
      setStarted(false);
      setError(result.error ?? "Could not start — try again.");
    }
  };

  if (!canEdit && !hasOutro) return null;

  return (
    <section className="mt-4">
      <h3 className="type-utility font-semibold text-text-secondary">Outro</h3>
      {appending ? (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-primary-bright" />
          <span className="text-[13px] text-text-secondary">
            Appending the outro clip… this can take a minute. It updates here automatically.
          </span>
        </div>
      ) : hasOutro ? (
        <p className="mt-1 text-[13px] text-text-secondary">Outro appended to the end.</p>
      ) : !accountHasOutro ? (
        <p className="mt-1 text-[13px] text-text-faint">
          No outro set for this account. Add one on the account page to enable this.
        </p>
      ) : canEdit ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={start}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-3 py-1.5 font-display text-[13px] font-medium text-primary-soft transition-colors hover:bg-primary/20 hover:text-primary-bright"
          >
            Add outro
          </button>
          {error ? <span className="text-[13px] text-danger">{error}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Subtitles (burned-in) control for a rendered video. If the video has no
 * captioned version yet, offers "Add captions" (transcribe + burn in the
 * background). Once both versions exist, offers a toggle to switch which one is
 * served + published, keeping the original either way.
 */
function CaptionsControl({
  itemId,
  hasCaptionedVersion,
  captionsActive,
  captionsRequested,
  captionsPending,
  hasOutro,
  canEdit,
}: {
  itemId: string;
  hasCaptionedVersion: boolean;
  captionsActive: boolean;
  captionsRequested: boolean;
  captionsPending: boolean;
  hasOutro: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [switchState, switchAction, isSwitching] = useActionState(switchVideoVersion, initialState);
  // "started" flips true when the user clicks; the server-persisted
  // captionsPending flag keeps the state across navigation. Deriving `burning`
  // (rather than syncing state in an effect) avoids a set-state-in-effect.
  const [started, setStarted] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const burning = started || captionsPending;

  // While burning, poll the server so the captioned version appears on its own.
  useActiveRefresh(burning, 10_000);

  const startCaptions = async () => {
    setAddError(null);
    setStarted(true);
    // Hand off to the server-persisted captionsPending flag shortly after firing
    // (the Inngest handler sets it within a poll). This avoids a stuck spinner
    // on regeneration, where hasCaptionedVersion never flips off.
    window.setTimeout(() => setStarted(false), 20_000);
    const formData = new FormData();
    formData.set("itemId", itemId);
    const result = await addVideoCaptions({ error: null }, formData);
    if (!result.ok) {
      setStarted(false);
      setAddError(result.error ?? "Could not start — try again.");
    } else {
      router.refresh();
    }
  };

  if (!canEdit && !hasCaptionedVersion) return null;

  return (
    <section className="mt-4">
      <h3 className="type-utility font-semibold text-text-secondary">Subtitles</h3>
      {!hasCaptionedVersion && captionsRequested && canEdit && !burning ? (
        <p className="mt-1 text-[13px] text-primary-soft">
          Subtitles were requested for this video — click “Generate captions” to burn them in.
        </p>
      ) : null}
      {burning ? (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-primary-bright" />
          <span className="text-[13px] text-text-secondary">
            Burning captions into the video… this can take a minute or two. It updates here
            automatically.
          </span>
        </div>
      ) : hasCaptionedVersion ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-text-secondary">
            {captionsActive ? "Captioned version active" : "Original (no captions) active"}
          </span>
          {canEdit ? (
            <>
              {/* Switching the base version is blocked once an outro is on top
                  (the outro was built on one version). Regenerate to reset. */}
              {!hasOutro ? (
                <form action={switchAction}>
                  <input type="hidden" name="itemId" value={itemId} />
                  <button
                    type="submit"
                    disabled={isSwitching}
                    className="rounded-full border border-border-subtle px-3 py-1.5 font-display text-[13px] font-medium text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-50"
                  >
                    {isSwitching
                      ? "Switching…"
                      : captionsActive
                        ? "Use original"
                        : "Use captioned"}
                  </button>
                </form>
              ) : null}
              <button
                type="button"
                onClick={startCaptions}
                className="rounded-full border border-border-subtle px-3 py-1.5 font-display text-[13px] font-medium text-text-secondary transition-colors hover:bg-bg-hover"
              >
                Regenerate captions
              </button>
            </>
          ) : null}
          {switchState.error ? (
            <span className="text-[13px] text-danger">{switchState.error}</span>
          ) : null}
          {addError ? <span className="text-[13px] text-danger">{addError}</span> : null}
        </div>
      ) : canEdit ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={startCaptions}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-3 py-1.5 font-display text-[13px] font-medium text-primary-soft transition-colors hover:bg-primary/20 hover:text-primary-bright"
          >
            Generate captions
          </button>
          {addError ? <span className="text-[13px] text-danger">{addError}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Caption/description with an inline editor. Reviewers can tweak the copy
 * before it publishes; hidden (read-only) once publishing/posted.
 */
function CaptionSection({
  itemId,
  caption,
  canEdit,
}: {
  itemId: string;
  caption: string | null;
  canEdit: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(caption ?? "");
  const [state, action, isSaving] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await editCaption(prev, formData);
      if (result.ok) setIsEditing(false);
      return result;
    },
    initialState,
  );

  if (!caption && !canEdit) return null;

  return (
    <section className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="type-utility font-semibold text-text-secondary">Caption</h3>
        {canEdit && !isEditing ? (
          <button
            type="button"
            onClick={() => {
              setDraft(caption ?? "");
              setIsEditing(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-3 py-1.5 font-display text-[13px] font-medium text-primary-soft transition-colors hover:bg-primary/20 hover:text-primary-bright"
          >
            <PencilIcon />
            Edit caption
          </button>
        ) : null}
      </div>

      {isEditing ? (
        <form action={action} className="mt-2 flex flex-col gap-2 rounded-xl border border-primary/40 bg-bg-base p-3">
          <input type="hidden" name="itemId" value={itemId} />
          <span className="type-utility text-text-faint">Editing caption</span>
          <textarea
            name="caption"
            rows={5}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
            placeholder="Write the caption / description for this post."
            className="w-full resize-y rounded-xl border border-border-subtle bg-bg-raised px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
          />
          {state.error ? <p className="text-[13px] text-danger">{state.error}</p> : null}
          <div className="flex items-center gap-2">
            <Button type="submit" isLoading={isSaving} className="!px-4 !py-1.5 text-[13px]">
              Save caption
            </Button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="text-[13px] text-text-faint hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-1">
          <p className="whitespace-pre-wrap text-sm text-text-secondary">
            {caption || "No caption yet."}
          </p>
          {canEdit && !caption ? (
            <button
              type="button"
              onClick={() => {
                setDraft("");
                setIsEditing(true);
              }}
              className="mt-1 text-[13px] text-primary-soft hover:text-primary-bright"
            >
              + Add a caption
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.6]" aria-hidden>
      <path d="M4 13.5 13 4.5l2.5 2.5-9 9H4v-2.5z" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A yes/no confirmation, portaled above the drawer so it can't be mis-clicked
 * through and can't be trapped by the card's transformed/columned ancestors.
 */
function ConfirmDialog({
  title,
  message,
  onCancel,
  children,
}: {
  title: string;
  message: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" aria-label="Cancel" onClick={onCancel} className="absolute inset-0 bg-bg-nav/80" />
      <div className="relative w-full max-w-sm rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <h3 className="font-display text-lg font-semibold text-text-primary">{title}</h3>
        <p className="mt-1.5 text-sm text-text-secondary">{message}</p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 text-text-faint">
      <circle cx="12" cy="12" r="9" className="fill-none stroke-current stroke-[1.5]" />
      <path d="M10 8.5 16 12l-6 3.5z" className="fill-current" />
    </svg>
  );
}


/**
 * Plays a rendered video (a standalone clip cut by ffmpeg, or a HeyGen avatar
 * video). The clip file is already trimmed to its segment, so this is a plain,
 * robust player — no in-video seeking. Shows a loading state until it can play
 * and a clear error + download fallback if the stream won't play in-browser.
 */
function SegmentVideo({ url }: { url: string; startS?: number | null; endS?: number | null }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  return (
    <div className="mt-4">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video
          key={url}
          src={url}
          controls
          playsInline
          preload="auto"
          onLoadedData={() => setState("ready")}
          onCanPlay={() => setState("ready")}
          onError={() => setState("error")}
          className="max-h-[70vh] w-full"
        />
        {state === "loading" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="flex items-center gap-2 text-sm text-text-primary">
              <span className="h-3 w-3 animate-spinner-dot rounded-full border-2 border-current border-t-transparent" />
              Loading video…
            </span>
          </div>
        ) : null}
        {state === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-4 text-center">
            <span className="text-sm text-text-primary">This video couldn&rsquo;t play here.</span>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-primary px-4 py-1.5 font-display text-[13px] font-medium text-text-primary hover:bg-primary-bright"
            >
              Open / download
            </a>
          </div>
        ) : null}
      </div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-block text-[13px] text-primary-soft hover:text-primary-bright"
      >
        Open in new tab
      </a>
    </div>
  );
}
