"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  createQueueVideoFromUpload,
  createQueueVideoUploadUrl,
  flagQueueStorageFull,
} from "@/app/(app)/queue/actions";
import { Button } from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { BUCKETS } from "@/lib/supabase/storage";
import { PLATFORMS, type Platform } from "@/lib/domain";

export interface UploadAccountOption {
  slug: string;
  name: string;
}

type Phase = "idle" | "uploading" | "finalizing";

/** Classifies a direct-upload failure so we can warn precisely. */
function storageErrorKind(error: unknown): "full" | "too-large" | "other" {
  const record = error as { message?: unknown; statusCode?: unknown; status?: unknown } | null;
  const message = String(record?.message ?? "").toLowerCase();
  const status = String(record?.statusCode ?? record?.status ?? "");
  if (status === "507" || /quota|insufficient storage|capacity|storage is full|storage full/.test(message)) {
    return "full";
  }
  if (status === "413" || /payload too large|too large|exceeded|maximum allowed/.test(message)) {
    return "too-large";
  }
  return "other";
}

/**
 * Upload a video edited outside the app straight into the Approval Queue. The
 * file goes DIRECTLY to storage via a short-lived signed token (no server-action
 * body limit), then a tiny action creates the queue item from the stored path.
 * Once queued, the usual video controls (Add outro, Generate captions, schedule,
 * approve) apply.
 */
export function UploadVideoModal({
  accounts,
  onClose,
}: {
  accounts: UploadAccountOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [brand, setBrand] = useState(accounts[0]?.slug ?? "");
  const [platforms, setPlatforms] = useState<Set<Platform>>(new Set<Platform>(["instagram"]));
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const togglePlatform = (platform: Platform) =>
    setPlatforms((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });

  const busy = phase !== "idle";

  const submit = async () => {
    setError(null);
    if (!file) return setError("Choose a video file.");
    if (!brand) return setError("Pick an account.");
    if (platforms.size === 0) return setError("Pick at least one platform.");

    try {
      // 1) Mint a signed upload URL (server validates type/size + role).
      setPhase("uploading");
      const prepared = await createQueueVideoUploadUrl({
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (prepared.error || !prepared.token || !prepared.path) {
        setPhase("idle");
        return setError(prepared.error ?? "Could not prepare the upload.");
      }

      // 2) PUT the bytes straight to storage with the signed token.
      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from(BUCKETS.generatedMedia)
        .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
      if (uploadError) {
        setPhase("idle");
        const kind = storageErrorKind(uploadError);
        if (kind === "full") {
          void flagQueueStorageFull(String((uploadError as { message?: unknown }).message ?? ""));
          return setError("Storage appears to be full — free up space or contact an admin, then retry.");
        }
        if (kind === "too-large") {
          return setError("That file is too large for storage. Compress it and try again.");
        }
        return setError("Upload failed. Check your connection and retry.");
      }

      // 3) Create the queue item from the stored path.
      setPhase("finalizing");
      const result = await createQueueVideoFromUpload({
        storagePath: prepared.path,
        mimeType: file.type,
        brand,
        platforms: [...platforms],
        caption: caption.trim(),
      });
      if (result.error) {
        setPhase("idle");
        return setError(result.error);
      }
      onClose();
      router.refresh();
    } catch {
      setPhase("idle");
      setError("Something went wrong. Try again.");
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Upload edited video"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => !busy && onClose()}
        className="absolute inset-0 bg-bg-nav/80"
      />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <h3 className="font-display text-lg font-semibold text-text-primary">Upload an edited video</h3>
        <p className="mt-1 text-[13px] text-text-secondary">
          Bring a video you edited elsewhere into the queue. Once it&rsquo;s here you can schedule
          it, and add the outro or burn subtitles just like a generated video.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
            Video file (mp4, mov, or webm)
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              disabled={busy}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="text-[13px] text-text-secondary file:mr-2 file:rounded-full file:border-0 file:bg-bg-hover file:px-3 file:py-1.5 file:font-display file:text-[13px] file:text-text-primary"
            />
            <span className="text-[12px] text-text-faint">
              Uploads straight to storage — large edits are fine (up to 1 GB).
            </span>
          </label>

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
              {PLATFORMS.map((platform) => (
                <button
                  key={platform}
                  type="button"
                  onClick={() => togglePlatform(platform)}
                  aria-pressed={platforms.has(platform)}
                  className={`rounded-full px-3.5 py-1.5 font-display text-[13px] font-medium capitalize transition-colors ${
                    platforms.has(platform)
                      ? "bg-primary text-on-primary"
                      : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {platform}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
            Caption (optional — you can also add or edit it in the queue)
            <textarea
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              rows={2}
              placeholder="What this post says. YouTube uses it as the description."
              className="w-full resize-y rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-[13px] text-text-primary outline-none focus:border-border-strong"
            />
          </label>

          {error ? <p className="text-[13px] text-danger">{error}</p> : null}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submit}
              isLoading={busy}
              disabled={busy || !file || !brand || platforms.size === 0}
            >
              {phase === "uploading" ? "Uploading…" : phase === "finalizing" ? "Adding…" : "Add to queue"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
