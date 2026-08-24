"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addStudioVideoSubtitles,
  moveStudioVideoToQueue,
  regenerateStudioVideo,
  suggestStudioCaption,
  type ActionState,
} from "@/app/(app)/avatar/actions";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DeleteContentButton } from "@/components/content/DeleteContentButton";
import { ProgressBar } from "@/components/ui/ProgressBar";

export interface GeneratedVideoView {
  id: string;
  kind: "avatar_video" | "clip_video" | "merged_video";
  label: string;
  brandName: string;
  /** rendering = still generating; ready = has a video; failed = errored. */
  state: "rendering" | "ready" | "failed";
  videoUrl: string | null;
  error: string | null;
  caption: string;
  createdAt: string;
  /** Minutes since creation, computed server-side — drives the "taking longer" hint. */
  ageMinutes: number;
}

export function GeneratedVideos({
  videos,
  canManage,
}: {
  videos: GeneratedVideoView[];
  canManage: boolean;
}) {
  // Polling lives in the parent VideoStudioTabs so the "N rendering" badge stays
  // live on any sub-tab; this view just renders whatever it's handed.
  if (videos.length === 0) {
    return (
      <section className="rounded-2xl border border-border-subtle bg-bg-raised p-8 text-center">
        <p className="text-sm text-text-secondary">
          No generated videos yet. Create one in the Compose tab — it appears here to review,
          caption, and send to the Approval Queue.
        </p>
      </section>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {videos.map((video) => (
        <GeneratedVideoCard key={video.id} video={video} canManage={canManage} />
      ))}
    </div>
  );
}

function GeneratedVideoCard({
  video,
  canManage,
}: {
  video: GeneratedVideoView;
  canManage: boolean;
}) {
  const router = useRouter();
  const [caption, setCaption] = useState(video.caption);
  const [busy, setBusy] = useState<null | "move" | "regen">(null);
  const [suggesting, setSuggesting] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [subtitling, setSubtitling] = useState(false);
  const [subtitlesRequested, setSubtitlesRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);

  const run = async (
    kind: "move" | "regen",
    fn: () => Promise<ActionState | { error: string | null; ok?: boolean }>,
  ) => {
    setBusy(kind);
    setError(null);
    const result = await fn();
    if (!result.ok) {
      setBusy(null);
      setError(result.error ?? "Something went wrong.");
      return;
    }
    // Reset before refreshing: on Regenerate the card stays mounted (same key)
    // and would otherwise keep its spinner / disabled buttons once the re-roll
    // finishes. On move/delete the card unmounts, so this is harmless.
    setBusy(null);
    router.refresh();
  };

  const fd = (extra?: Record<string, string>) => {
    const data = new FormData();
    data.set("itemId", video.id);
    for (const [k, v] of Object.entries(extra ?? {})) data.set(k, v);
    return data;
  };

  // Burn subtitles into the video (transcribe → burn), on demand. Runs in the
  // background; the captioned version manages fully once sent to the queue.
  const addSubtitles = async () => {
    setSubtitling(true);
    setError(null);
    const result = await addStudioVideoSubtitles(video.id);
    setSubtitling(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSubtitlesRequested(true);
  };

  // On-demand caption suggestion (no AI call unless the user asks). Fills the box.
  const suggestCaption = async () => {
    setSuggesting(true);
    setError(null);
    const result = await suggestStudioCaption(video.id);
    setSuggesting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.caption) setCaption(result.caption);
  };

  // Minutes rendering — computed server-side (the page re-runs each poll ~10s),
  // so the stall hint appears on its own and this render stays pure.
  const renderingMinutes = video.state === "rendering" ? video.ageMinutes : 0;

  const kindLabel =
    video.kind === "clip_video"
      ? "Visual clip"
      : video.kind === "merged_video"
        ? "Merged video"
        : "Avatar video";
  const renderingVerb =
    video.kind === "clip_video"
      ? "Composing the clip"
      : video.kind === "merged_video"
        ? "Combining the videos"
        : "Rendering the avatar";
  const downloadPrefix =
    video.kind === "clip_video" ? "clip" : video.kind === "merged_video" ? "merged" : "avatar";

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-raised">
      <div className="relative aspect-[9/16] bg-black">
        {video.state === "ready" && video.videoUrl ? (
          <video src={video.videoUrl} controls playsInline preload="metadata" className="h-full w-full" />
        ) : video.state === "failed" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-danger text-base font-bold text-bg-base">
              !
            </span>
            <span className="text-[13px] text-text-secondary">Generation failed</span>
            <button
              type="button"
              onClick={() => setShowError(true)}
              className="text-[12px] text-primary-soft hover:text-primary-bright"
            >
              View details
            </button>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
            <ProgressBar />
            <span className="text-[13px] text-text-secondary">Generating…</span>
            <span className="text-[11px] text-text-faint">
              {renderingVerb} — usually a few minutes. It updates here automatically.
            </span>
            {renderingMinutes >= 5 ? (
              <span className="text-[11px] text-warning">
                Taking longer than usual ({renderingMinutes} min). If it stalls it&rsquo;s marked
                failed automatically so you can retry — you don&rsquo;t need to wait here.
              </span>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="type-utility text-text-faint">{kindLabel}</span>
          <span className="type-utility text-text-faint">{video.brandName}</span>
        </div>
        <p className="line-clamp-2 text-[13px] text-text-secondary">{video.label}</p>

        {video.state === "ready" ? (
          <div className="mt-1 flex flex-col gap-2">
            {video.videoUrl ? (
              <a
                href={video.videoUrl}
                target="_blank"
                rel="noreferrer"
                download={`${downloadPrefix}-${video.id}.mp4`}
                className="text-[13px] text-primary-soft hover:text-primary-bright"
              >
                Download clip
              </a>
            ) : null}
            {canManage ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="type-utility text-text-faint">Caption</span>
                  <button
                    type="button"
                    onClick={suggestCaption}
                    disabled={suggesting || busy !== null}
                    className="text-[12px] text-primary-soft hover:text-primary-bright disabled:opacity-50"
                  >
                    {suggesting ? "Suggesting…" : "✨ Suggest caption"}
                  </button>
                </div>
                <textarea
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  rows={2}
                  placeholder="Add a caption (or use Suggest), then send to the Approval Queue — you can also edit it there."
                  className="w-full resize-y rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-[13px] text-text-primary outline-none focus:border-border-strong"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    isLoading={busy === "move"}
                    onClick={() =>
                      run("move", () => moveStudioVideoToQueue({ error: null }, fd({ caption })))
                    }
                    className="!px-4 !py-1.5 text-[13px]"
                  >
                    Send to Approval Queue
                  </Button>
                  <button
                    type="button"
                    disabled={busy !== null || subtitling || subtitlesRequested}
                    onClick={addSubtitles}
                    className="rounded-full border border-border-subtle px-3 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-bg-hover disabled:opacity-50"
                  >
                    {subtitling
                      ? "Requesting…"
                      : subtitlesRequested
                        ? "Subtitles queued ✓"
                        : "Add subtitles"}
                  </button>
                  {video.kind !== "merged_video" ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => setConfirmRegen(true)}
                      className="rounded-full border border-border-subtle px-3 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-bg-hover disabled:opacity-50"
                    >
                      Regenerate
                    </button>
                  ) : null}
                  <DeleteContentButton
                    itemId={video.id}
                    label={video.kind === "clip_video" ? "clip" : "video"}
                    className="ml-auto"
                  />
                </div>
                {subtitlesRequested ? (
                  <p className="text-[12px] text-text-faint">
                    Subtitles are burning in the background — they&rsquo;ll appear on the video
                    shortly. You can also manage them after sending to the queue.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : video.state === "failed" && canManage ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              isLoading={busy === "regen"}
              onClick={() => setConfirmRegen(true)}
              className="!px-4 !py-1.5 text-[13px]"
            >
              Regenerate
            </Button>
            <DeleteContentButton
              itemId={video.id}
              label={video.kind === "clip_video" ? "clip" : "video"}
              className="ml-auto"
            />
          </div>
        ) : null}

        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      </div>

      {showError ? (
        <ErrorModal
          message={video.error ?? "The video failed to generate."}
          onClose={() => setShowError(false)}
        />
      ) : null}

      {confirmRegen ? (
        <ConfirmModal
          title="Regenerate this video?"
          message={
            video.kind === "merged_video"
              ? "This re-runs the merge with the same clips — no credits used. The current version can't be recovered afterward."
              : "This starts a fresh render and replaces the current video. It uses HeyGen credits, and the current version can't be recovered afterward."
          }
          onCancel={() => setConfirmRegen(false)}
        >
          <Button
            variant="destructive"
            onClick={() => {
              setConfirmRegen(false);
              run("regen", () => regenerateStudioVideo({ error: null }, fd()));
            }}
          >
            Yes, regenerate
          </Button>
        </ConfirmModal>
      ) : null}
    </section>
  );
}

function ErrorModal({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Generation failed"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
    >
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-bg-nav/80" />
      <div className="relative w-full max-w-sm rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <h3 className="font-display text-lg font-semibold text-text-primary">Generation failed</h3>
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-text-secondary">{message}</p>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
