"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { addVideoCaptions, editCaption, switchVideoVersion, type ActionState } from "@/app/(app)/queue/actions";
import { Button } from "@/components/ui/Button";
import { useActiveRefresh } from "@/components/hooks/useActiveRefresh";
import { PencilIcon } from "@/components/queue/queueParts";
import { initialState } from "@/components/queue/queueTypes";

/**
 * Subtitles (burned-in) control for a rendered video. If the video has no
 * captioned version yet, offers "Add captions" (transcribe + burn in the
 * background). Once both versions exist, offers a toggle to switch which one is
 * served + published, keeping the original either way.
 */
export function CaptionsControl({
  itemId,
  hasCaptionedVersion,
  captionsActive,
  captionsRequested,
  captionsPending,
  hasOutro,
  canEdit,
}: {
  itemId: string;
  hasCaptionedVersion: boolean;
  captionsActive: boolean;
  captionsRequested: boolean;
  captionsPending: boolean;
  hasOutro: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [switchState, switchAction, isSwitching] = useActionState(switchVideoVersion, initialState);
  // "started" flips true when the user clicks; the server-persisted
  // captionsPending flag keeps the state across navigation. Deriving `burning`
  // (rather than syncing state in an effect) avoids a set-state-in-effect.
  const [started, setStarted] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const burning = started || captionsPending;

  // While burning, poll the server so the captioned version appears on its own.
  useActiveRefresh(burning, 10_000);

  const startCaptions = async () => {
    setAddError(null);
    setStarted(true);
    // Hand off to the server-persisted captionsPending flag shortly after firing
    // (the Inngest handler sets it within a poll). This avoids a stuck spinner
    // on regeneration, where hasCaptionedVersion never flips off.
    window.setTimeout(() => setStarted(false), 20_000);
    const formData = new FormData();
    formData.set("itemId", itemId);
    const result = await addVideoCaptions({ error: null }, formData);
    if (!result.ok) {
      setStarted(false);
      setAddError(result.error ?? "Could not start — try again.");
    } else {
      router.refresh();
    }
  };

  if (!canEdit && !hasCaptionedVersion) return null;

  return (
    <section className="mt-4">
      <h3 className="type-utility font-semibold text-text-secondary">Subtitles</h3>
      {!hasCaptionedVersion && captionsRequested && canEdit && !burning ? (
        <p className="mt-1 text-[13px] text-primary-soft">
          Subtitles were requested for this video — click “Generate captions” to burn them in.
        </p>
      ) : null}
      {burning ? (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-primary-bright" />
          <span className="text-[13px] text-text-secondary">
            Burning captions into the video… this can take a minute or two. It updates here
            automatically.
          </span>
        </div>
      ) : hasCaptionedVersion ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-text-secondary">
            {captionsActive ? "Captioned version active" : "Original (no captions) active"}
          </span>
          {canEdit ? (
            <>
              {/* Switching the base version is blocked once an outro is on top
                  (the outro was built on one version). Regenerate to reset. */}
              {!hasOutro ? (
                <form action={switchAction}>
                  <input type="hidden" name="itemId" value={itemId} />
                  <button
                    type="submit"
                    disabled={isSwitching}
                    className="rounded-lg border border-border-subtle px-3 py-1.5 font-display text-[13px] font-medium text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-50"
                  >
                    {isSwitching
                      ? "Switching…"
                      : captionsActive
                        ? "Use original"
                        : "Use captioned"}
                  </button>
                </form>
              ) : null}
              <button
                type="button"
                onClick={startCaptions}
                className="rounded-lg border border-border-subtle px-3 py-1.5 font-display text-[13px] font-medium text-text-secondary transition-colors hover:bg-bg-hover"
              >
                Regenerate captions
              </button>
            </>
          ) : null}
          {switchState.error ? (
            <span className="text-[13px] text-danger">{switchState.error}</span>
          ) : null}
          {addError ? <span className="text-[13px] text-danger">{addError}</span> : null}
        </div>
      ) : canEdit ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={startCaptions}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 font-display text-[13px] font-medium text-primary-soft transition-colors hover:bg-primary/20 hover:text-primary-bright"
          >
            Generate captions
          </button>
          {addError ? <span className="text-[13px] text-danger">{addError}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Caption/description with an inline editor. Reviewers can tweak the copy
 * before it publishes; hidden (read-only) once publishing/posted.
 */
export function CaptionSection({
  itemId,
  caption,
  canEdit,
}: {
  itemId: string;
  caption: string | null;
  canEdit: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(caption ?? "");
  const [state, action, isSaving] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await editCaption(prev, formData);
      if (result.ok) setIsEditing(false);
      return result;
    },
    initialState,
  );

  if (!caption && !canEdit) return null;

  return (
    <section className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="type-utility font-semibold text-text-secondary">Caption</h3>
        {canEdit && !isEditing ? (
          <button
            type="button"
            onClick={() => {
              setDraft(caption ?? "");
              setIsEditing(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 font-display text-[13px] font-medium text-primary-soft transition-colors hover:bg-primary/20 hover:text-primary-bright"
          >
            <PencilIcon />
            Edit caption
          </button>
        ) : null}
      </div>

      {isEditing ? (
        <form action={action} className="mt-2 flex flex-col gap-2 rounded-xl border border-primary/40 bg-bg-base p-3">
          <input type="hidden" name="itemId" value={itemId} />
          <span className="type-utility text-text-faint">Editing caption</span>
          <textarea
            name="caption"
            rows={5}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
            placeholder="Write the caption / description for this post."
            className="w-full resize-y rounded-xl border border-border-subtle bg-bg-raised px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
          />
          {state.error ? <p className="text-[13px] text-danger">{state.error}</p> : null}
          <div className="flex items-center gap-2">
            <Button type="submit" isLoading={isSaving} className="!px-4 !py-1.5 text-[13px]">
              Save caption
            </Button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="text-[13px] text-text-faint hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-1">
          <p className="whitespace-pre-wrap text-sm text-text-secondary">
            {caption || "No caption yet."}
          </p>
          {canEdit && !caption ? (
            <button
              type="button"
              onClick={() => {
                setDraft("");
                setIsEditing(true);
              }}
              className="mt-1 text-[13px] text-primary-soft hover:text-primary-bright"
            >
              + Add a caption
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
