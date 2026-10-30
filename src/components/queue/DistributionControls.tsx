"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { repostToMorePlatforms, updateTargetPlatforms } from "@/app/(app)/queue/actions";
import { Button } from "@/components/ui/Button";
import { useActiveRefresh } from "@/components/hooks/useActiveRefresh";
import { PLATFORMS, type Platform } from "@/lib/domain";
import { initialState } from "@/components/queue/queueTypes";

/**
 * Repost control: for an already-POSTED item, publish it to platforms it wasn't
 * sent to before (a change of mind after it went live). Only shows platforms not
 * already posted (never re-posts a live one) and valid for the type. Publishing
 * runs in the background; the reposted platforms drop off the list when done.
 */
export function RepostControl({
  itemId,
  type,
  postedPlatforms,
  canPublish,
}: {
  itemId: string;
  type: string;
  postedPlatforms: Platform[];
  canPublish: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<Platform>>(new Set());
  const [reposting, setReposting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Platforms not yet posted and valid for this type (images can't do YouTube).
  const posted = new Set(postedPlatforms);
  const remaining = (type === "image_post"
    ? PLATFORMS.filter((p) => p !== "youtube")
    : PLATFORMS
  ).filter((p) => !posted.has(p));

  // While reposting, poll so the newly-posted platforms drop off on completion.
  useActiveRefresh(reposting, 10_000);
  useEffect(() => {
    if (!reposting) return;
    const stop = setTimeout(() => setReposting(false), 60_000);
    return () => clearTimeout(stop);
  }, [reposting]);

  const start = async () => {
    if (selected.size === 0) return;
    setError(null);
    setReposting(true);
    const formData = new FormData();
    formData.set("itemId", itemId);
    for (const p of selected) formData.append("platforms", p);
    const result = await repostToMorePlatforms({ error: null }, formData);
    if (!result.ok) {
      setReposting(false);
      setError(result.error ?? "Could not repost — try again.");
    } else {
      setSelected(new Set());
      router.refresh();
    }
  };

  if (remaining.length === 0) {
    return (
      <section className="mt-4">
        <h3 className="type-utility font-semibold text-text-secondary">Repost</h3>
        <p className="mt-1 text-[13px] text-text-faint">Posted to every available platform.</p>
      </section>
    );
  }
  if (!canPublish) return null;

  return (
    <section className="mt-4">
      <h3 className="type-utility font-semibold text-text-secondary">Repost to more platforms</h3>
      <p className="mt-1 text-[13px] text-text-faint">
        Already live. Publish it to platforms it wasn&rsquo;t posted to — the ones it&rsquo;s already
        on aren&rsquo;t shown, so nothing is doubled up.
      </p>
      {/* The picker stays visible during a repost (the reposted platforms simply
          drop off as they go live), so nothing is blocked. */}
      <div className="mt-1.5 flex flex-col gap-2">
          {reposting ? (
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-primary-bright" />
              <span className="text-[13px] text-text-secondary">
                Reposting… platforms drop off the list once live. Updates automatically.
              </span>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {remaining.map((platform) => {
              const on = selected.has(platform);
              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() =>
                    setSelected((cur) => {
                      const next = new Set(cur);
                      if (next.has(platform)) next.delete(platform);
                      else next.add(platform);
                      return next;
                    })
                  }
                  aria-pressed={on}
                  className={`rounded-full px-3 py-1.5 font-display text-[13px] font-medium capitalize transition-colors ${
                    on
                      ? "bg-primary text-on-primary"
                      : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {platform}
                </button>
              );
            })}
          </div>
          {selected.size > 0 ? (
            <Button
              type="button"
              onClick={start}
              isLoading={reposting}
              variant="secondary"
              className="self-start !px-4 !py-1.5 text-[13px]"
            >
              Repost to {selected.size} {selected.size === 1 ? "platform" : "platforms"}
            </Button>
          ) : null}
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      </div>
    </section>
  );
}

/**
 * Destinations: shows where a queued post will publish and lets a reviewer add
 * or remove platforms before it goes out (in case they change their mind). Image
 * posts can't target YouTube (video-only); videos can target any platform.
 */
export function DestinationsControl({
  itemId,
  type,
  targetPlatforms,
  canEdit,
}: {
  itemId: string;
  type: string;
  targetPlatforms: Platform[];
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState<Set<Platform>>(new Set(targetPlatforms));
  const [state, action, isSaving] = useActionState(updateTargetPlatforms, initialState);

  // Image posts are image-only platforms; videos can go anywhere.
  const options = (type === "image_post"
    ? PLATFORMS.filter((p) => p !== "youtube")
    : PLATFORMS) as readonly Platform[];

  const dirty =
    selected.size !== targetPlatforms.length ||
    targetPlatforms.some((p) => !selected.has(p));

  return (
    <section className="mt-4">
      <h3 className="type-utility font-semibold text-text-secondary">Destinations</h3>
      {canEdit ? (
        <form action={action} className="mt-1.5 flex flex-col gap-2">
          <input type="hidden" name="itemId" value={itemId} />
          {[...selected].map((p) => (
            <input key={p} type="hidden" name="platforms" value={p} />
          ))}
          <div className="flex flex-wrap gap-1.5">
            {options.map((platform) => {
              const on = selected.has(platform);
              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() =>
                    setSelected((cur) => {
                      const next = new Set(cur);
                      if (next.has(platform)) next.delete(platform);
                      else next.add(platform);
                      return next;
                    })
                  }
                  aria-pressed={on}
                  className={`rounded-full px-3 py-1.5 font-display text-[13px] font-medium capitalize transition-colors ${
                    on
                      ? "bg-primary text-on-primary"
                      : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {platform}
                </button>
              );
            })}
          </div>
          {dirty && selected.size > 0 ? (
            <Button
              type="submit"
              variant="secondary"
              isLoading={isSaving}
              className="self-start !px-4 !py-1.5 text-[13px]"
            >
              Save destinations
            </Button>
          ) : null}
          {state.error ? <p className="text-[13px] text-danger">{state.error}</p> : null}
          {state.ok ? <p className="text-[13px] text-success">Destinations updated.</p> : null}
        </form>
      ) : (
        <p className="mt-1 text-[13px] text-text-secondary capitalize">
          {targetPlatforms.join(", ")}
        </p>
      )}
    </section>
  );
}
