"use client";

import { useState } from "react";
import { addVideoOutro } from "@/app/(app)/queue/actions";
import { useActiveRefresh } from "@/components/hooks/useActiveRefresh";

/**
 * Outro control: appends the account's ending clip to the video (once). Shown on
 * every rendered video; when the account has no outro configured it explains how
 * to add one (so the button's absence is never a silent mystery). Mirrors the
 * captions progress pattern — a persistent spinner that auto-refreshes.
 */
export function OutroControl({
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 font-display text-[13px] font-medium text-primary-soft transition-colors hover:bg-primary/20 hover:text-primary-bright"
          >
            Add outro
          </button>
          {error ? <span className="text-[13px] text-danger">{error}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
