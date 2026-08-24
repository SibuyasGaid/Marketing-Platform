"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

/**
 * App-group error boundary. States what happened and the next step, no
 * apologies (docs/DESIGN.md §3 feedback rules). Never surfaces internals —
 * the raw error is logged, the user sees a generic line.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Logged server-side by the platform; digest correlates to that entry.
    console.error("app-group error boundary:", error.digest ?? error.message);
  }, [error]);

  return (
    <section className="rounded-2xl border border-danger/40 bg-bg-raised p-6">
      <h2 className="font-display text-xl font-semibold text-text-primary">
        Something went wrong on this page
      </h2>
      <p className="mt-2 max-w-prose text-sm">
        The screen failed to load. This is usually temporary, so try again, and if it keeps
        happening, check the Admin page for job or provider errors.
      </p>
      <div className="mt-4">
        <Button onClick={() => reset()}>Try again</Button>
      </div>
    </section>
  );
}
