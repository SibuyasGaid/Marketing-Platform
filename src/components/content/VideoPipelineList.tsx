"use client";

import { useActionState, useState } from "react";
import {
  createContentFromSegments,
  type ActionState,
} from "@/app/(app)/content/actions";
import { Button } from "@/components/ui/Button";
import { useActiveRefresh } from "@/components/hooks/useActiveRefresh";
import { DeleteContentButton } from "@/components/content/DeleteContentButton";
import { PLATFORMS, type Brand, type Platform } from "@/lib/domain";
import type { AccountOption } from "@/components/images/ImageWorkspace";

export interface SegmentView {
  id: string;
  title: string;
  excerpt: string;
  score: number;
  rationale: string;
  startS: number;
  endS: number;
}

export interface VideoView {
  id: string;
  title: string;
  transcriptStatus: "pending" | "processing" | "completed" | "failed";
  hasAnalysis: boolean;
  segments: SegmentView[];
  createdAt: string;
}

const initialState: ActionState = { error: null };

/** Per-video pipeline stepper (Transcribe → Analyze → Rank) + ranked segments. */
export function VideoPipelineList({
  videos,
  accounts,
  canManage = false,
}: {
  videos: VideoView[];
  accounts: AccountOption[];
  canManage?: boolean;
}) {
  const hasActive = videos.some(
    (video) =>
      video.transcriptStatus === "pending" ||
      video.transcriptStatus === "processing" ||
      (video.transcriptStatus === "completed" && !video.hasAnalysis),
  );

  // Transcribe/analyze runs a few minutes; poll only while one is in flight.
  useActiveRefresh(hasActive, 6000);

  // Collapsible list so ingested videos don't stack endlessly; the most recent
  // one is open by default, the rest are collapsed to a single row each.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(videos.length > 0 ? [videos[0].id] : []),
  );
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (videos.length === 0) {
    return (
      <section className="rounded-2xl border border-border-subtle bg-bg-raised p-6">
        <p className="text-sm">No videos ingested yet. Upload one above to get started.</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-text-primary">Your videos</h3>
        <span className="text-[13px] text-text-faint">
          {videos.length} total{hasActive ? " · processing" : ""}
        </span>
      </div>
      {videos.map((video) => (
        <VideoCard
          key={video.id}
          video={video}
          accounts={accounts}
          canManage={canManage}
          isOpen={expanded.has(video.id)}
          onToggle={() => toggle(video.id)}
        />
      ))}
    </div>
  );
}

function summarize(video: VideoView): string {
  if (video.transcriptStatus === "failed") return "Transcription failed";
  if (video.segments.length > 0) {
    return `${video.segments.length} segment${video.segments.length === 1 ? "" : "s"} ready`;
  }
  if (video.transcriptStatus === "completed" && !video.hasAnalysis) return "Ranking segments…";
  if (video.transcriptStatus === "processing" || video.transcriptStatus === "pending") {
    return "Transcribing…";
  }
  return "No segments";
}

function VideoCard({
  video,
  accounts,
  canManage,
  isOpen,
  onToggle,
}: {
  video: VideoView;
  accounts: AccountOption[];
  canManage: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const steps = deriveSteps(video);
  const isFailed = video.transcriptStatus === "failed";

  return (
    <section className="overflow-hidden rounded-2xl border border-border-subtle bg-bg-raised">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-bg-hover"
      >
        <svg
          viewBox="0 0 20 20"
          className={`h-4 w-4 shrink-0 fill-none stroke-current stroke-2 text-text-faint transition-transform ${
            isOpen ? "rotate-90" : ""
          }`}
        >
          <path d="m8 5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="min-w-0 flex-1">
          <span className="block truncate font-display text-base font-semibold text-text-primary">
            {video.title}
          </span>
          <span className={`mt-0.5 block text-[13px] ${isFailed ? "text-danger" : "text-text-faint"}`}>
            {summarize(video)}
          </span>
        </div>
        <div className="hidden items-center gap-3 sm:flex">
          {steps.map((step) => (
            <span key={step.label} className="flex items-center gap-1.5">
              <StepDot state={step.state} />
              <span
                className={`type-utility ${
                  step.state === "done"
                    ? "text-success"
                    : step.state === "active"
                      ? "text-info"
                      : step.state === "failed"
                        ? "text-danger"
                        : "text-text-faint"
                }`}
              >
                {step.label}
              </span>
            </span>
          ))}
        </div>
      </button>

      {isOpen ? (
        <div className="border-t border-border-subtle p-4">
          {isFailed ? (
            <p className="text-sm text-danger">Transcription failed. Re-ingest to try again.</p>
          ) : video.segments.length > 0 ? (
            <SegmentSelector video={video} accounts={accounts} />
          ) : (
            <p className="text-sm text-text-faint">
              Transcribing and ranking the best segments. This can take a few minutes for a long
              video.
            </p>
          )}
          {canManage ? (
            <div className="mt-4 flex justify-end border-t border-border-subtle pt-3">
              <DeleteContentButton itemId={video.id} label="video" kind="source-video" />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function StepDot({ state }: { state: "done" | "active" | "failed" | "pending" }) {
  if (state === "active") {
    return <span className="h-2 w-2 animate-spinner-dot rounded-full border border-info border-t-transparent" />;
  }
  return (
    <span
      className={`h-2 w-2 rounded-full ${
        state === "done" ? "bg-success" : state === "failed" ? "bg-danger" : "bg-text-faint"
      }`}
    />
  );
}

function deriveSteps(video: VideoView): Array<{ label: string; state: "done" | "active" | "failed" | "pending" }> {
  const t = video.transcriptStatus;
  const transcribe =
    t === "completed" ? "done" : t === "processing" ? "active" : t === "failed" ? "failed" : "active";
  const analyze = t === "completed" ? (video.hasAnalysis ? "done" : "active") : "pending";
  const rank = video.hasAnalysis ? "done" : "pending";
  return [
    { label: "Transcribe", state: transcribe },
    { label: "Analyze", state: analyze },
    { label: "Rank", state: rank },
  ];
}

function SegmentSelector({ video, accounts }: { video: VideoView; accounts: AccountOption[] }) {
  const [selectedSegments, setSelectedSegments] = useState<Set<string>>(new Set());
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(
    new Set(["instagram", "linkedin"]),
  );
  const [brand, setBrand] = useState<Brand>(accounts[0]?.slug ?? "");
  const [state, action, isPending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await createContentFromSegments(prev, formData);
      if (result.ok) setSelectedSegments(new Set());
      return result;
    },
    initialState,
  );

  const toggle = <T,>(set: Set<T>, value: T, update: (next: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  return (
    <form action={action} className="mt-4">
      <input type="hidden" name="sourceVideoId" value={video.id} />
      <input type="hidden" name="brand" value={brand} />
      {[...selectedSegments].map((id) => (
        <input key={id} type="hidden" name="segmentIds" value={id} />
      ))}
      {[...selectedPlatforms].map((platform) => (
        <input key={platform} type="hidden" name="platforms" value={platform} />
      ))}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="type-utility mr-1 text-text-faint">Account / page:</span>
        {accounts.map((option) => (
          <button
            key={option.slug}
            type="button"
            onClick={() => setBrand(option.slug)}
            className={`rounded-full px-3 py-1 font-display text-[13px] font-medium transition-colors ${
              brand === option.slug
                ? "bg-primary text-text-primary"
                : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {option.name}
          </button>
        ))}
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {video.segments.map((segment) => {
          const isSelected = selectedSegments.has(segment.id);
          return (
            <button
              key={segment.id}
              type="button"
              onClick={() => toggle(selectedSegments, segment.id, setSelectedSegments)}
              aria-pressed={isSelected}
              className={`rounded-xl border p-3 text-left transition-colors ${
                isSelected ? "border-border-strong bg-bg-hover" : "border-border-subtle hover:bg-bg-hover"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-text-primary">{segment.title}</span>
                <span className="type-utility rounded-full bg-primary-soft/12 px-2 py-0.5 text-primary-soft">
                  {Math.round(segment.score)}
                </span>
              </span>
              <span className="mt-1 block text-[13px] italic text-text-secondary">
                “{segment.excerpt}”
              </span>
              <span className="mt-1 block text-[13px] text-text-faint">
                {formatTime(segment.startS)}-{formatTime(segment.endS)} · {segment.rationale}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map((platform) => (
            <button
              key={platform}
              type="button"
              onClick={() => toggle(selectedPlatforms, platform, setSelectedPlatforms)}
              className={`rounded-full px-3 py-1 font-display text-[13px] font-medium capitalize transition-colors ${
                selectedPlatforms.has(platform)
                  ? "bg-primary text-text-primary"
                  : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
              }`}
            >
              {platform}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[13px] text-text-secondary">
          <input type="checkbox" name="vertical" defaultChecked className="accent-[color:var(--primary)]" />
          Vertical 9:16 (Reels/Shorts)
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-text-secondary">
          <input type="checkbox" name="generateThumbnail" className="accent-[color:var(--primary)]" />
          Generate thumbnail
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-text-secondary">
          <input type="checkbox" name="generateHeygenHook" className="accent-[color:var(--primary)]" />
          Create avatar hook (HeyGen)
        </label>
        <Button
          type="submit"
          isLoading={isPending}
          disabled={selectedSegments.size === 0 || selectedPlatforms.size === 0}
          className="!px-4 !py-2 text-[13px]"
        >
          Create content ({selectedSegments.size})
        </Button>
      </div>
      {state.error ? <p className="mt-2 text-sm text-danger">{state.error}</p> : null}
      {state.ok ? (
        <p className="mt-2 text-sm text-success">
          Queued. Clips and copy will land in the Approval Queue shortly.
        </p>
      ) : null}
    </form>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
