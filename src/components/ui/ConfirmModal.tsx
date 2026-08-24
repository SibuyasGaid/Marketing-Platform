"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";

/**
 * A yes/no confirmation, portaled above everything so it can't be mis-clicked
 * through and isn't trapped by transformed/columned ancestors. The confirm
 * button lives in `children` (the caller owns the form/action).
 */
export function ConfirmModal({
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

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 bg-bg-nav/80"
      />
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
