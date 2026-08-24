"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { completeVodIngest, createVodUploadUrl } from "@/app/(app)/content/actions";
import { Button } from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { BUCKETS } from "@/lib/supabase/storage";

const inputClass =
  "w-full rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-border-strong";

/** VOD ingestion: direct-to-storage upload (signed URL) or a pasted media URL. */
export function IngestPanel() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "finalizing">("idle");

  const isBusy = phase !== "idle";

  const submit = async () => {
    setError(null);
    if (!title.trim()) {
      setError("Give the video a title.");
      return;
    }
    if (!selectedFile && !sourceUrl.trim()) {
      setError("Choose a file or paste a direct media URL.");
      return;
    }

    try {
      let storagePath: string | null = null;
      let mimeType: string | null = null;
      let sizeBytes: number | null = null;

      if (selectedFile) {
        setPhase("uploading");
        const prepared = await createVodUploadUrl({
          mimeType: selectedFile.type,
          sizeBytes: selectedFile.size,
        });
        if (prepared.error || !prepared.token || !prepared.path) {
          setError(prepared.error ?? "Upload preparation failed.");
          setPhase("idle");
          return;
        }
        // Officially-supported direct-to-storage upload with the signed token.
        const supabase = createSupabaseBrowserClient();
        const { error: uploadError } = await supabase.storage
          .from(BUCKETS.sourceVideos)
          .uploadToSignedUrl(prepared.path, prepared.token, selectedFile, {
            contentType: selectedFile.type,
          });
        if (uploadError) {
          setError("Upload failed. Check your connection and retry.");
          setPhase("idle");
          return;
        }
        storagePath = prepared.path;
        mimeType = selectedFile.type;
        sizeBytes = selectedFile.size;
      }

      setPhase("finalizing");
      const result = await completeVodIngest({
        title: title.trim(),
        description: description.trim(),
        storagePath,
        sourceUrl: sourceUrl.trim(),
        mimeType,
        sizeBytes,
      });
      if (result.error) {
        setError(result.error);
        setPhase("idle");
        return;
      }
      setTitle("");
      setDescription("");
      setSourceUrl("");
      setSelectedFile(null);
      setPhase("idle");
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
      setPhase("idle");
    }
  };

  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
      <h3 className="font-display text-base font-semibold text-text-primary">Ingest a video</h3>
      <p className="mt-0.5 text-[13px] text-text-faint">
        Upload a VOD or live-training recording. It is transcribed once, then segments are
        ranked for clipping.
      </p>

      {/* File input is a SIBLING of the drop zone (never nested inside a
          button — that is invalid HTML and blocks the browse dialog). */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/wav"
        className="hidden"
        onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
      />

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragOver(false);
            const file = event.dataTransfer.files[0];
            if (file) setSelectedFile(file);
          }}
          className={`flex min-h-[104px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-4 text-center text-sm transition-colors ${
            isDragOver ? "border-border-strong bg-bg-hover" : "border-border-subtle"
          }`}
        >
          {selectedFile ? (
            <>
              <span className="font-medium text-text-primary">{selectedFile.name}</span>
              <span className="mt-1 text-[13px] text-text-faint">
                {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB, click to change
              </span>
            </>
          ) : (
            <>
              <span className="text-text-secondary">Drop a video here or click to browse</span>
              <span className="mt-1 text-[13px] text-text-faint">MP4/MOV/WebM or audio, up to 2GB</span>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title (e.g. Live training on client onboarding systems)"
            className={inputClass}
          />
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Description (optional)"
            className={inputClass}
          />
          <input
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="…or paste a direct media URL (.mp4/.mp3)"
            className={inputClass}
          />
        </div>
      </div>

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

      <div className="mt-3">
        <Button onClick={submit} isLoading={isBusy}>
          {phase === "uploading" ? "Uploading…" : "Ingest video"}
        </Button>
      </div>
    </section>
  );
}
