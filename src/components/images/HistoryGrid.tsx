"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  editImage,
  regenerateImage,
  sendToQueue,
  type ActionState,
} from "@/app/(app)/images/actions";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { DeleteContentButton } from "@/components/content/DeleteContentButton";
import { useGenerationStatusRefresh } from "@/components/hooks/useGenerationStatusRefresh";
import { OneoffReferences, type OneoffRef } from "@/components/images/ImageWorkspace";
import { RegionEditModal } from "@/components/images/RegionEditModal";
import { StatusPill } from "@/components/ui/StatusPill";
import type { ContentStatus } from "@/lib/domain";

export interface HistoryItemView {
  id: string;
  status: ContentStatus;
  platform: string;
  /** All destination platforms this post publishes to. */
  targetPlatforms: string[];
  brandName: string;
  prompt: string;
  imageUrl: string | null;
  downloadUrl: string | null;
  /** >1 marks a carousel: shows a badge and hides per-image in-place edits. */
  slideCount: number;
  /** All slide images in order (carousel only); drives the viewer modal. */
  slideUrls: string[];
  jobStatus: "queued" | "running" | "completed" | "failed" | null;
  jobError: string | null;
  createdAt: string;
  /** Minutes since creation, computed server-side — drives the "taking longer" hint. */
  ageMinutes: number;
}

const initialState: ActionState = { error: null };

/** Short platform labels for the card (IG, FB, L-in, YT). */
const PLATFORM_LABEL: Record<string, string> = {
  instagram: "IG",
  facebook: "FB",
  linkedin: "L-in",
  youtube: "YT",
};

function platformLabels(platforms: string[]): string {
  const list = platforms.length > 0 ? platforms : [];
  return list
    .map((p) => PLATFORM_LABEL[p] ?? p.slice(0, 2).toUpperCase())
    .join(" · ");
}

export function HistoryGrid({
  items,
  canManage = false,
}: {
  items: HistoryItemView[];
  canManage?: boolean;
}) {
  const hasActiveJobs = items.some(
    (item) => item.jobStatus === "queued" || item.jobStatus === "running",
  );

  // While a generation is in flight, poll the lightweight status endpoint and
  // only pull fresh content when it actually changes — instead of a full-page
  // refresh every 5s.
  useGenerationStatusRefresh("images", hasActiveJobs, 5000);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const day = item.createdAt.slice(0, 10); // YYYY-MM-DD (UTC)
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
  }, [items, from, to]);

  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-border-subtle bg-bg-raised p-6">
        <p className="text-sm">
          No generations yet. Pick a preset, describe an image, and hit Generate.
        </p>
      </section>
    );
  }

  const dateInputClass =
    "rounded-xl border border-border-subtle bg-bg-base px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-border-strong";

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-semibold text-text-primary">History</h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[13px] text-text-faint">
            From
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={dateInputClass} />
          </label>
          <label className="flex items-center gap-1 text-[13px] text-text-faint">
            To
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={dateInputClass} />
          </label>
          {from || to ? (
            <button
              type="button"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
              className="text-[13px] text-primary-soft hover:text-primary-bright"
            >
              Clear
            </button>
          ) : null}
          <span className="text-[13px] text-text-faint">
            {filtered.length} of {items.length}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-3 text-sm text-text-faint">No generations in that date range.</p>
      ) : (
        <div className="mt-3 columns-1 gap-4 sm:columns-2 xl:columns-3 [&>*]:mb-4">
          {filtered.map((item) => (
            <HistoryCard key={item.id} item={item} canManage={canManage} />
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryCard({ item, canManage }: { item: HistoryItemView; canManage: boolean }) {
  const router = useRouter();
  const [openPanel, setOpenPanel] = useState<"none" | "edit" | "regen" | "queue">("none");
  const [queueDate, setQueueDate] = useState("");
  const [isRegionOpen, setIsRegionOpen] = useState(false);
  // Photos attached in the regenerate panel to fix wrong faces / add references.
  const [regenPersonRefs, setRegenPersonRefs] = useState<OneoffRef[]>([]);
  const [regenStyleRefs, setRegenStyleRefs] = useState<OneoffRef[]>([]);
  // Carousel: which slide indexes to regenerate. Empty = all slides.
  const [regenSlides, setRegenSlides] = useState<Set<number>>(new Set());
  // Optional per-slide new content text, keyed by slide index.
  const [regenSlidePrompts, setRegenSlidePrompts] = useState<Record<number, string>>({});
  // Optional per-slide new design note (styling only), keyed by slide index.
  const [regenSlideDesigns, setRegenSlideDesigns] = useState<Record<number, string>>({});
  // Optimistic busy: remember the job status at submit time. We stay "busy"
  // while the shown status still equals that pre-submit value — i.e. the poll
  // hasn't yet reflected the new job. Derived (no effect) so a fresh render
  // with a queued/running/completed status naturally ends the optimistic state.
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const isWorking = item.jobStatus === "queued" || item.jobStatus === "running";

  const [editState, editAction, isEditPending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await editImage(prev, formData);
      if (result.ok) {
        setOpenPanel("none");
        setPendingFrom(item.jobStatus ?? "none");
        // Pull the new "running" job in fast so the parent starts polling.
        router.refresh();
      }
      return result;
    },
    initialState,
  );
  const [regenState, regenAction, isRegenPending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await regenerateImage(prev, formData);
      if (result.ok) {
        setOpenPanel("none");
        setRegenPersonRefs([]);
        setRegenStyleRefs([]);
        setRegenSlides(new Set());
        setRegenSlidePrompts({});
        setRegenSlideDesigns({});
        setPendingFrom(item.jobStatus ?? "none");
        router.refresh();
      }
      return result;
    },
    initialState,
  );
  const [queueState, queueAction, isQueuePending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await sendToQueue(prev, formData);
      if (result.ok) {
        setOpenPanel("none");
        setQueueDate("");
      }
      return result;
    },
    initialState,
  );
  const [viewerOpen, setViewerOpen] = useState(false);
  const isCarousel = item.slideCount > 1;

  // Optimistic window: after submit, `pendingFrom` holds the pre-submit status.
  // We're still "waiting for the new job to register" only while the shown
  // status hasn't changed from that value. Any new status (queued/running via
  // isWorking, or completed/failed) ends it — no effect needed.
  const optimisticPending = pendingFrom !== null && (item.jobStatus ?? "none") === pendingFrom;
  const isBusy = isWorking || isEditPending || isRegenPending || optimisticPending;

  // Minutes a brand-new generation has been running — server-computed (the page
  // re-runs each poll) so render stays pure. Only meaningful before the first
  // image exists; regenerations keep the old image and use the overlay instead.
  const generatingMinutes = isWorking && !item.imageUrl ? item.ageMinutes : 0;

  return (
    <article className="card-hover break-inside-avoid rounded-2xl border border-border-subtle bg-bg-raised p-3 hover:bg-bg-hover">
      {item.imageUrl ? (
        <div className="relative">
          {isCarousel && !isBusy ? (
            <button
              type="button"
              onClick={() => setViewerOpen(true)}
              className="group block w-full"
              aria-label={`View all ${item.slideCount} slides`}
            >
              <Image
                src={item.imageUrl}
                alt={item.prompt.slice(0, 80)}
                width={640}
                height={640}
                unoptimized
                className="w-full rounded-xl transition group-hover:brightness-90"
              />
              <span className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded-full bg-bg-nav/85 px-3 py-1 text-[12px] font-medium text-text-primary opacity-0 transition-opacity group-hover:opacity-100">
                Click to view all {item.slideCount} slides
              </span>
            </button>
          ) : (
            <Image
              src={item.imageUrl}
              alt={item.prompt.slice(0, 80)}
              width={640}
              height={640}
              unoptimized
              className={`w-full rounded-xl transition ${isBusy ? "blur-sm brightness-75" : ""}`}
            />
          )}
          {isCarousel ? (
            <span className="absolute right-2 top-2 rounded-full bg-bg-nav/85 px-2 py-0.5 text-[11px] font-medium text-text-primary">
              ▦ {item.slideCount} slides
            </span>
          ) : null}
          {isBusy ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-bg-nav/40">
              <span className="rounded-full bg-bg-nav/85 px-2.5 py-1 text-[13px] font-medium text-text-primary">
                Regenerating…
              </span>
              <ProgressBar className="w-32 bg-bg-nav/85" />
              <span className="text-[11px] text-text-primary/80">Usually under a minute</span>
            </div>
          ) : item.jobStatus === "failed" ? (
            // The last regenerate/edit failed but the previous image is still
            // here — say so, instead of silently showing the unchanged image.
            <div className="absolute inset-x-2 bottom-2 rounded-lg bg-danger/90 px-2.5 py-1.5 text-[12px] text-text-primary">
              Regeneration failed{item.jobError ? `: ${item.jobError}` : ""}. Showing the previous
              version — try again.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-bg-base">
          {isWorking ? (
            <div className="flex flex-col items-center gap-2 px-4 text-center">
              <span className="text-sm text-text-secondary">Generating…</span>
              <ProgressBar className="w-40 bg-bg-hover" />
              {generatingMinutes >= 2 ? (
                <span className="text-[11px] text-warning">
                  Taking longer than usual — if it doesn&rsquo;t finish, regenerate to retry.
                </span>
              ) : (
                <span className="text-[11px] text-text-faint">Usually under a minute</span>
              )}
            </div>
          ) : (
            <span className="px-4 text-center text-[13px] text-danger">
              {item.jobError ?? "Generation failed. Regenerate to retry."}
            </span>
          )}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="type-utility truncate text-text-faint">
          {item.brandName} · {platformLabels(item.targetPlatforms)}
        </span>
        <StatusPill status={item.status} />
      </div>
      <p className="mt-1.5 line-clamp-2 text-[13px] text-text-secondary">{item.prompt}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.imageUrl && !isCarousel ? (
          <button
            type="button"
            onClick={() => setOpenPanel((panel) => (panel === "edit" ? "none" : "edit"))}
            disabled={isBusy}
            className="rounded-full border border-border-subtle px-3 py-1.5 font-display text-[13px] font-medium text-text-primary hover:bg-bg-base disabled:opacity-50"
          >
            Edit
          </button>
        ) : null}
        {item.imageUrl && !isCarousel ? (
          <button
            type="button"
            onClick={() => setIsRegionOpen(true)}
            disabled={isBusy}
            className="rounded-full border border-border-subtle px-3 py-1.5 font-display text-[13px] font-medium text-text-primary hover:bg-bg-base disabled:opacity-50"
          >
            Edit region
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setOpenPanel((panel) => (panel === "regen" ? "none" : "regen"))}
          disabled={isBusy}
          className="rounded-full border border-border-subtle px-3 py-1.5 font-display text-[13px] font-medium text-text-primary hover:bg-bg-base disabled:opacity-50"
        >
          Regenerate
        </button>
        {item.status === "draft" && item.imageUrl ? (
          <Button
            type="button"
            onClick={() => setOpenPanel((panel) => (panel === "queue" ? "none" : "queue"))}
            className="!px-3 !py-1.5 text-[13px]"
          >
            Send to queue
          </Button>
        ) : null}
        {item.downloadUrl ? (
          <button
            type="button"
            onClick={() => downloadImage(item.downloadUrl!, `${item.id}.png`)}
            className="text-[13px] text-primary-soft hover:text-primary-bright"
          >
            Download
          </button>
        ) : null}
        {canManage ? (
          <DeleteContentButton itemId={item.id} label={isCarousel ? "carousel" : "post"} className="ml-auto" />
        ) : null}
      </div>
      {queueState.error ? <p className="mt-1.5 text-[13px] text-danger">{queueState.error}</p> : null}

      {openPanel === "queue" ? (
        <form action={queueAction} className="mt-3 flex flex-col gap-2 border-t border-border-subtle pt-3">
          <input type="hidden" name="itemId" value={item.id} />
          <p className="text-[13px] text-text-faint">
            Send this to the approval queue. Optionally plan a day — it shows on that day in the
            queue calendar. It still needs approval before publishing.
          </p>
          <label className="flex flex-col gap-1 text-[13px] text-text-secondary">
            Planned day (optional)
            <input
              type="date"
              name="plannedDate"
              value={queueDate}
              onChange={(event) => setQueueDate(event.target.value)}
              className="rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-[13px] text-text-primary outline-none focus:border-border-strong"
            />
          </label>
          <Button
            type="submit"
            isLoading={isQueuePending}
            className="self-start !px-3 !py-1.5 text-[13px]"
          >
            {queueDate ? "Queue for this day" : "Send to queue"}
          </Button>
        </form>
      ) : null}

      {openPanel === "edit" ? (
        <form action={editAction} className="mt-3 flex flex-col gap-2 border-t border-border-subtle pt-3">
          <input type="hidden" name="itemId" value={item.id} />
          <p className="text-[13px] text-text-faint">
            Edits this image in place, keeping the composition and changing only what you describe.
          </p>
          <textarea
            name="instruction"
            rows={2}
            required
            placeholder="e.g. change the background to navy, remove the logo, make the text bold"
            className="w-full resize-y rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-[13px] text-text-primary outline-none focus:border-border-strong"
          />
          {editState.error ? <p className="text-[13px] text-danger">{editState.error}</p> : null}
          <Button
            type="submit"
            isLoading={isEditPending}
            className="self-start !px-3 !py-1.5 text-[13px]"
          >
            Apply edit
          </Button>
        </form>
      ) : null}

      {openPanel === "regen" ? (
        <form action={regenAction} className="mt-3 flex flex-col gap-2 border-t border-border-subtle pt-3">
          <input type="hidden" name="itemId" value={item.id} />
          {regenPersonRefs.map((ref) => (
            <input key={ref.path} type="hidden" name="personImagePaths" value={ref.path} />
          ))}
          {regenStyleRefs.map((ref) => (
            <input key={ref.path} type="hidden" name="referenceImagePaths" value={ref.path} />
          ))}
          {[...regenSlides].map((slideIndex) => (
            <input key={slideIndex} type="hidden" name="slideIndexes" value={slideIndex} />
          ))}
          {[...regenSlides]
            .filter((slideIndex) => (regenSlidePrompts[slideIndex] ?? "").trim())
            .map((slideIndex) => (
              <span key={`p-${slideIndex}`}>
                <input type="hidden" name="slidePromptIndexes" value={slideIndex} />
                <input type="hidden" name="slidePromptTexts" value={regenSlidePrompts[slideIndex]} />
              </span>
            ))}
          {[...regenSlides]
            .filter((slideIndex) => (regenSlideDesigns[slideIndex] ?? "").trim())
            .map((slideIndex) => (
              <span key={`d-${slideIndex}`}>
                <input type="hidden" name="slideDesignIndexes" value={slideIndex} />
                <input type="hidden" name="slideDesignTexts" value={regenSlideDesigns[slideIndex]} />
              </span>
            ))}
          <p className="text-[13px] text-text-faint">
            Fresh re-roll with your note. The composition may change. Attach the right people below
            to fix faces.
          </p>

          {isCarousel ? (
            <div className="flex flex-col gap-1.5 rounded-xl border border-border-subtle bg-bg-base p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="type-utility text-text-faint">
                  Slides to regenerate {regenSlides.size === 0 ? "(all)" : `(${regenSlides.size})`}
                </span>
                {regenSlides.size > 0 ? (
                  <button
                    type="button"
                    onClick={() => setRegenSlides(new Set())}
                    className="text-[12px] text-primary-soft hover:text-primary-bright"
                  >
                    All slides
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: item.slideCount }).map((_, slideIndex) => {
                  const selected = regenSlides.has(slideIndex);
                  return (
                    <button
                      key={slideIndex}
                      type="button"
                      onClick={() =>
                        setRegenSlides((current) => {
                          const next = new Set(current);
                          if (next.has(slideIndex)) next.delete(slideIndex);
                          else next.add(slideIndex);
                          return next;
                        })
                      }
                      aria-pressed={selected}
                      className={`h-8 w-8 rounded-lg text-[13px] font-medium transition-colors ${
                        selected
                          ? "bg-primary text-text-primary"
                          : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                      }`}
                    >
                      {slideIndex + 1}
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] text-text-faint">
                Pick specific slides to re-roll just those; leave none selected to regenerate the
                whole carousel. Add a new prompt per slide to steer it precisely.
              </span>

              {[...regenSlides].sort((a, b) => a - b).map((slideIndex) => (
                <div key={`ta-${slideIndex}`} className="flex flex-col gap-1.5">
                  <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
                    New content for slide {slideIndex + 1} (optional)
                    <textarea
                      rows={2}
                      value={regenSlidePrompts[slideIndex] ?? ""}
                      onChange={(event) =>
                        setRegenSlidePrompts((current) => ({
                          ...current,
                          [slideIndex]: event.target.value,
                        }))
                      }
                      placeholder="Exact wording for this slide (the only text drawn). Leave blank to reuse the original."
                      className="w-full resize-y rounded-lg border border-border-subtle bg-bg-raised px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-border-strong"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
                    New design note for slide {slideIndex + 1} (optional)
                    <textarea
                      rows={1}
                      value={regenSlideDesigns[slideIndex] ?? ""}
                      onChange={(event) =>
                        setRegenSlideDesigns((current) => ({
                          ...current,
                          [slideIndex]: event.target.value,
                        }))
                      }
                      placeholder="Styling only. Leave blank to keep the original design."
                      className="w-full resize-y rounded-lg border border-border-subtle bg-bg-raised px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-border-strong"
                    />
                  </label>
                </div>
              ))}
            </div>
          ) : null}

          <textarea
            name="adjustmentNote"
            rows={2}
            required
            placeholder="What should change? e.g. use the attached photos for the speakers' faces"
            className="w-full resize-y rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-[13px] text-text-primary outline-none focus:border-border-strong"
          />
          <OneoffReferences
            refs={regenPersonRefs}
            onChange={setRegenPersonRefs}
            label="People to feature (faces matched)"
            hint="Upload the correct photos of the people. Their faces are reproduced accurately."
          />
          <OneoffReferences
            refs={regenStyleRefs}
            onChange={setRegenStyleRefs}
            label="Style / brand reference images (optional)"
            hint="Logos or layout references to guide the look."
          />
          {regenState.error ? <p className="text-[13px] text-danger">{regenState.error}</p> : null}
          <Button type="submit" isLoading={isRegenPending} className="mt-1 w-full">
            Send for regeneration
          </Button>
        </form>
      ) : null}

      {isRegionOpen && item.imageUrl ? (
        <RegionEditModal
          itemId={item.id}
          imageUrl={item.imageUrl}
          onClose={() => setIsRegionOpen(false)}
          onApplied={() => {
            setIsRegionOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      {viewerOpen ? (
        <CarouselViewer
          slides={item.slideUrls}
          onClose={() => setViewerOpen(false)}
          onDownload={(url, index) => downloadImage(url, `${item.id}-slide-${index + 1}.png`)}
        />
      ) : null}
    </article>
  );
}

/**
 * Full-screen viewer to scroll through a carousel's separate slide images.
 * Portaled above everything; arrow keys / on-screen arrows navigate; each slide
 * can be downloaded individually.
 */
function CarouselViewer({
  slides,
  onClose,
  onDownload,
}: {
  slides: string[];
  onClose: () => void;
  onDownload: (url: string, index: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const count = slides.length;
  const go = useCallback(
    (delta: number) => setIndex((i) => (i + delta + count) % count),
    [count],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, go]);

  if (typeof document === "undefined" || count === 0) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Carousel slides"
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
    >
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-bg-nav/90" />
      <div className="relative flex w-full max-w-xl flex-col items-center gap-3">
        <div className="flex w-full items-center justify-between">
          <span className="type-utility text-text-secondary">
            Slide {index + 1} of {count}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-bg-raised text-text-secondary hover:text-text-primary"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="relative w-full">
          <Image
            src={slides[index]}
            alt={`Slide ${index + 1}`}
            width={800}
            height={800}
            unoptimized
            className="max-h-[70vh] w-full rounded-xl object-contain"
          />
          {count > 1 ? (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous slide"
                className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-bg-nav/80 text-lg text-text-primary hover:bg-bg-nav"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next slide"
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-bg-nav/80 text-lg text-text-primary hover:bg-bg-nav"
              >
                ›
              </button>
            </>
          ) : null}
        </div>

        {/* Thumbnail strip to jump between slides. */}
        <div className="flex w-full snap-x gap-2 overflow-x-auto pb-1">
          {slides.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`relative shrink-0 snap-start overflow-hidden rounded-lg border-2 transition ${
                i === index ? "border-primary" : "border-transparent opacity-70 hover:opacity-100"
              }`}
            >
              <Image src={url} alt="" width={64} height={64} unoptimized className="h-14 w-14 object-cover" />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onDownload(slides[index], index)}
          className="text-[13px] text-primary-soft hover:text-primary-bright"
        >
          Download this slide
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Downloads the image directly instead of navigating to it. The asset lives on
 * a different origin (signed Supabase URL), so the anchor `download` attribute
 * is ignored by browsers — fetch the bytes and save a blob URL instead. Falls
 * back to opening in a new tab if the fetch is blocked.
 */
async function downloadImage(url: string, filename: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`status ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
