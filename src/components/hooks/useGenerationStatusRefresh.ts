"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * While `active`, polls the lightweight /api/generation-status endpoint and calls
 * router.refresh() ONLY when this section's signature changes (a generation
 * started, finished, or failed) — instead of a full-page refresh every tick,
 * which re-runs the whole route (layout, queries, URL signing). The cheap JSON
 * poll runs on the interval; the expensive refresh runs only on real change.
 *
 * - Baseline is fetched immediately on mount (≈ server-render time), so the first
 *   real change is caught rather than absorbed.
 * - Skips polling while the tab is hidden.
 * - A periodic full refresh (every ~12 ticks) is a safety backstop in case a
 *   change slipped through the brief mount window or the signature undercounts.
 * - Gives up after MAX_POLL_MS. A job that never settles (a failed render whose
 *   row keeps `active` true) would otherwise poll for as long as the tab lives.
 */

/** Stop polling after this long — no generation legitimately runs longer. */
const MAX_POLL_MS = 15 * 60_000;
export function useGenerationStatusRefresh(
  section: "images" | "videos",
  active: boolean,
  intervalMs: number,
): void {
  const router = useRouter();
  const lastSignature = useRef<string | null>(null);
  const ticks = useRef(0);

  useEffect(() => {
    if (!active) {
      lastSignature.current = null;
      ticks.current = 0;
      return;
    }
    let cancelled = false;

    const readSignature = async (): Promise<string | null> => {
      if (document.hidden) return null;
      try {
        const response = await fetch("/api/generation-status", { cache: "no-store" });
        if (!response.ok) return null;
        const data = (await response.json()) as Partial<Record<"images" | "videos", string>>;
        return String(data[section] ?? "");
      } catch {
        return null; // transient — try again next tick
      }
    };

    // Establish the baseline right away so a change since server render is caught.
    void readSignature().then((signature) => {
      if (!cancelled && signature !== null) lastSignature.current = signature;
    });

    const startedAt = Date.now();

    const timer = setInterval(() => {
      // A never-settling job must not poll forever.
      if (Date.now() - startedAt >= MAX_POLL_MS) {
        clearInterval(timer);
        return;
      }
      ticks.current += 1;
      // Safety backstop: pull fresh occasionally regardless of the signature.
      if (ticks.current % 12 === 0) {
        if (!document.hidden) router.refresh();
        return;
      }
      void readSignature().then((signature) => {
        if (cancelled || signature === null) return;
        if (lastSignature.current === null) {
          lastSignature.current = signature;
          return;
        }
        if (signature !== lastSignature.current) {
          lastSignature.current = signature;
          router.refresh();
        }
      });
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [section, active, intervalMs, router]);
}
