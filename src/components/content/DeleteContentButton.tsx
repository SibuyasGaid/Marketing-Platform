"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteContentItem,
  deleteSourceVideo,
  type DeleteState,
} from "@/app/(app)/content-actions";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

const initialState: DeleteState = { error: null };

/**
 * Delete control shared by the image history, content engine, and library.
 * `kind: "item"` deletes a content_item (removes it from every tab);
 * `kind: "source-video"` deletes a Content Engine recording. Always confirms
 * first via a modal.
 */
export function DeleteContentButton({
  itemId,
  label = "Delete",
  className = "",
  kind = "item",
}: {
  itemId: string;
  /** What this item is, for the confirm copy (e.g. "post", "clip", "video"). */
  label?: string;
  className?: string;
  kind?: "item" | "source-video";
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, action, isPending] = useActionState(
    async (prev: DeleteState, formData: FormData) => {
      const result =
        kind === "source-video"
          ? await deleteSourceVideo(prev, formData)
          : await deleteContentItem(prev, formData);
      if (result.ok) {
        setConfirming(false);
        router.refresh();
      }
      return result;
    },
    initialState,
  );

  const confirmMessage =
    kind === "source-video"
      ? `This permanently deletes the ${label} and its transcript. Clips already made from it stay in the queue and library. This can't be undone.`
      : `This permanently deletes the ${label} and removes it from every tab (history, queue, and library). This can't be undone.`;

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={`text-[13px] text-text-faint hover:text-danger ${className}`}
      >
        Delete
      </button>

      {confirming ? (
        <ConfirmModal
          title="Delete this content?"
          message={confirmMessage}
          onCancel={() => setConfirming(false)}
        >
          <form action={action}>
            <input type="hidden" name="itemId" value={itemId} />
            <Button type="submit" variant="destructive" isLoading={isPending}>
              Yes, delete
            </Button>
          </form>
        </ConfirmModal>
      ) : null}
      {state.error ? <p className="mt-1 text-[12px] text-danger">{state.error}</p> : null}
    </>
  );
}
