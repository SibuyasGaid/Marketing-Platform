"use client";

import { Reorder } from "framer-motion";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createMergeSourceUploadUrl,
  requestCombineVideo,
} from "@/app/(app)/avatar/actions";
import { Button } from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { BUCKETS } from "@/lib/supabase/storage";

export interface CombineAccountOption {
  slug: string;
  name: string;
}

/** A video already in our storage that can be picked as a merge source. */
export interface CombineSourceOption {
  id: string;
  label: string;
  /** Human tag: Avatar / Clip / Merged / Upload. */
  kindLabel: string;
  createdAt: string;
}

const COMBINE_PLATFORMS = [
  { key: "instagram", label: "Instagram Reel" },
  { key: "facebook", label: "Facebook video" },
  { key: "youtube", label: "YouTube Short" },
] as const;

const MAX_SOURCES = 6;

type Source =
  | { key: string; kind: "library"; itemId: string; label: string }
  | { key: string; kind: "upload"; path: string; label: string };

/**
 * Combine tab: stitch several videos (generated clips, avatar videos, prior
 * uploads, or freshly uploaded files) into one, in a drag-to-reorder sequence.
 * Merged via ffmpeg on the server — no AI credits. The result lands in the
 * Generated videos holding to caption, subtitle, download, or send to the queue.
 */
export function CombineStudio({
  accounts,
  library,
  canCreate,
}: {
  accounts: CombineAccountOption[];
  library: CombineSourceOption[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [brand, setBrand] = useState(accounts[0]?.slug ?? "");
  const [platforms, setPlatforms] = useState<Set<string>>(new Set(["instagram"]));
  const [sources, setSources] = useState<Source[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const usedLibraryIds = new Set(
    sources.filter((s): s is Extract<Source, { kind: "library" }> => s.kind === "library").map((s) => s.itemId),
  );
  const atCap = sources.length >= MAX_SOURCES;

  const togglePlatform = (key: string) =>
    setPlatforms((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const addLibrary = (option: CombineSourceOption) => {
    if (atCap || usedLibraryIds.has(option.id)) return;
    setSources((current) => [
      ...current,
      { key: crypto.randomUUID(), kind: "library", itemId: option.id, label: option.label },
    ]);
  };

  const removeSource = (key: string) =>
    setSources((current) => current.filter((s) => s.key !== key));

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    if (atCap) return setError(`Combine up to ${MAX_SOURCES} videos at once.`);
    setError(null);
    setUploading(true);
    try {
      const prepared = await createMergeSourceUploadUrl({ mimeType: file.type, sizeBytes: file.size });
      if (prepared.error || !prepared.token || !prepared.path) {
        setError(prepared.error ?? "Could not prepare the upload.");
        return;
      }
      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from(BUCKETS.generatedMedia)
        .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
      if (uploadError) {
        setError("Upload failed. Check your connection and retry.");
        return;
      }
      setSources((current) => [
        ...current,
        { key: crypto.randomUUID(), kind: "upload", path: prepared.path!, label: file.name },
      ]);
    } finally {
      setUploading(false);
    }
  };

  const canSubmit = canCreate && brand && platforms.size >= 1 && sources.length >= 2 && !uploading;

  const submit = () => {
    setError(null);
    setOk(null);
    startSubmit(async () => {
      const result = await requestCombineVideo({
        brand,
        platforms: [...platforms],
        sources: sources.map((s) =>
          s.kind === "library"
            ? { kind: "library" as const, itemId: s.itemId }
            : { kind: "upload" as const, path: s.path },
        ),
      });
      if (!result.ok) {
        setError(result.error ?? "Could not start the merge.");
        return;
      }
      setSources([]);
      setOk("Combining — see the Generated videos tab. It renders without using credits.");
      router.refresh();
    });
  };

  if (accounts.length === 0) {
    return (
      <section className="rounded-2xl border border-border-subtle bg-bg-raised p-6">
        <p className="text-sm text-text-faint">No accounts yet. Create one first.</p>
      </section>
    );
  }

  const availableLibrary = library.filter((option) => !usedLibraryIds.has(option.id));

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-4 rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <div>
          <span className="type-utility font-semibold text-text-primary">Account / page</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {accounts.map((account) => (
              <button
                key={account.slug}
                type="button"
                onClick={() => setBrand(account.slug)}
                className={`rounded-full px-3.5 py-1.5 font-display text-[13px] font-medium transition-colors ${
                  brand === account.slug
                    ? "bg-primary text-on-primary"
                    : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                }`}
              >
                {account.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="type-utility font-semibold text-text-primary">Post to</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {COMBINE_PLATFORMS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => togglePlatform(option.key)}
                aria-pressed={platforms.has(option.key)}
                className={`rounded-full px-3.5 py-1.5 font-display text-[13px] font-medium transition-colors ${
                  platforms.has(option.key)
                    ? "bg-primary text-on-primary"
                    : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[13px] text-text-faint">
            Vertical 9:16 output. Clips play back in the order below — drag to reorder. Combining
            uses ffmpeg on our side, so it never spends AI credits.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <div className="flex items-center justify-between">
          <span className="type-utility font-semibold text-text-primary">
            Sequence ({sources.length}/{MAX_SOURCES})
          </span>
        </div>

        {sources.length === 0 ? (
          <p className="text-sm text-text-faint">
            Add at least two videos to combine — from your library or by uploading.
          </p>
        ) : (
          <Reorder.Group axis="y" values={sources} onReorder={setSources} className="flex flex-col gap-2">
            {sources.map((source, index) => (
              <Reorder.Item
                key={source.key}
                value={source}
                className="flex cursor-grab items-center gap-3 rounded-xl border border-border-subtle bg-bg-base px-3 py-2 active:cursor-grabbing"
              >
                <span className="text-text-faint" aria-hidden>
                  ⠿
                </span>
                <span className="w-5 shrink-0 text-[13px] font-medium text-text-faint">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">
                  {source.kind === "upload" ? "⬆ " : ""}
                  {source.label}
                </span>
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => removeSource(source.key)}
                  className="text-[13px] text-text-faint hover:text-danger"
                >
                  ×
                </button>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            disabled={atCap}
            className="rounded-lg border border-border-subtle px-3.5 py-1.5 font-display text-[13px] font-medium text-text-primary hover:bg-bg-hover disabled:opacity-50"
          >
            {pickerOpen ? "Close library" : "+ Add from library"}
          </button>
          <label
            className={`cursor-pointer rounded-full border border-border-subtle px-3.5 py-1.5 font-display text-[13px] font-medium text-text-primary hover:bg-bg-hover ${
              atCap || uploading ? "pointer-events-none opacity-50" : ""
            }`}
          >
            {uploading ? "Uploading…" : "+ Upload a video"}
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={(event) => {
                void handleUpload(event.target.files?.[0] ?? undefined);
                event.target.value = "";
              }}
            />
          </label>
          {atCap ? (
            <span className="type-utility text-text-faint">Max {MAX_SOURCES} reached</span>
          ) : null}
        </div>

        {pickerOpen ? (
          <div className="max-h-64 overflow-y-auto rounded-xl border border-border-subtle bg-bg-base p-2">
            {availableLibrary.length === 0 ? (
              <p className="p-2 text-[13px] text-text-faint">
                No more videos to add. Generate or upload some first.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {availableLibrary.map((option) => (
                  <li key={option.id}>
                    <button
                      type="button"
                      onClick={() => addLibrary(option)}
                      disabled={atCap}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-bg-hover disabled:opacity-50"
                    >
                      <span className="type-utility shrink-0 rounded-full bg-bg-hover px-1.5 py-0.5 text-text-faint">
                        {option.kindLabel}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">
                        {option.label}
                      </span>
                      <span className="shrink-0 text-[11px] text-text-faint">
                        {option.createdAt.slice(0, 10)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        {canCreate ? (
          <Button type="button" onClick={submit} isLoading={submitting} disabled={!canSubmit}>
            Combine {sources.length >= 2 ? `${sources.length} videos` : "videos"}
          </Button>
        ) : (
          <p className="text-[13px] text-text-faint">Reviewers can’t create content.</p>
        )}
        {sources.length === 1 ? (
          <span className="text-[13px] text-text-faint">Add one more to combine.</span>
        ) : null}
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {ok ? <p className="text-sm text-success">{ok}</p> : null}
    </div>
  );
}
