"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";

export function PencilIcon() {
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
export function ConfirmDialog({
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

export function PlayGlyph() {
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
export function SegmentVideo({ url }: { url: string; startS?: number | null; endS?: number | null }) {
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
