"use client";

import { motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { useActionState, useEffect, useState } from "react";
import { approveItem, cancelSchedule, requestEdits, retryFailedItem } from "@/app/(app)/queue/actions";
import { deleteContentItem } from "@/app/(app)/content-actions";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatSydney, nowSydneyLocal } from "@/lib/timezone";
import { CaptionsControl, CaptionSection } from "@/components/queue/CaptionsControl";
import { RepostControl, DestinationsControl } from "@/components/queue/DistributionControls";
import { OutroControl } from "@/components/queue/OutroControl";
import { ConfirmDialog, SegmentVideo } from "@/components/queue/queueParts";
import { type QueueItemView, initialState, ACTIONABLE } from "@/components/queue/queueTypes";

export function ItemDrawer({
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
