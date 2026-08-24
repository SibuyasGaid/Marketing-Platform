"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Backoff ceiling — a long job still gets checked, just not hammered. */
const MAX_INTERVAL_MS = 60_000;
/**
 * Hard stop. A condition that never clears (a render that failed, a publish that
 * never settled) must not poll forever: without this, one stuck row makes every
 * open tab re-run the whole route every few seconds for as long as the browser
 * stays open.
 */
const DEFAULT_MAX_DURATION_MS = 5 * 60_000;

/**
 * Refreshes the current route while `active`, without turning the page into a
 * load generator.
 *
 * `router.refresh()` re-runs the entire server route — every query on the page
 * plus storage URL signing — so a bare `setInterval(() => router.refresh(), 6000)`
 * is self-inflicted DoS: it keeps firing in a background tab nobody is watching,
 * and if its `active` condition never clears it never stops. Three guards:
 *
 *  - a hidden tab never refreshes (and gets one immediate refresh on return),
 *  - the interval backs off 1.5x per tick, capped at a minute,
 *  - polling gives up entirely after `maxDurationMs`.
 *
 * `active` must be a plain boolean so the effect survives the refreshes it
 * triggers; passing a fresh object/array would restart the backoff every tick.
 */
export function useActiveRefresh(
  active: boolean,
  intervalMs: number,
  maxDurationMs: number = DEFAULT_MAX_DURATION_MS,
): void {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = intervalMs;
    let startedAt = Date.now();
    let stopped = false;

    const stop = () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };

    const tick = () => {
      if (stopped) return;
      // Nobody is looking at a hidden tab — wait it out rather than refresh.
      // `onVisible` below catches the user up the moment they return.
      if (document.hidden) {
        timer = setTimeout(tick, delay);
        return;
      }
      if (Date.now() - startedAt >= maxDurationMs) {
        stop();
        return;
      }
      router.refresh();
      delay = Math.min(Math.round(delay * 1.5), MAX_INTERVAL_MS);
      timer = setTimeout(tick, delay);
    };

    // Back on screen: catch up once immediately and restart the backoff, so a
    // returning user sees current state without waiting out a long interval.
    const onVisible = () => {
      if (stopped || document.hidden) return;
      delay = intervalMs;
      startedAt = Date.now();
      if (timer !== undefined) clearTimeout(timer);
      router.refresh();
      timer = setTimeout(tick, delay);
    };

    document.addEventListener("visibilitychange", onVisible);
    timer = setTimeout(tick, delay);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, intervalMs, maxDurationMs, router]);
}
