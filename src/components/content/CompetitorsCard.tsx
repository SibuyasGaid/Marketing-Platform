"use client";

import { useActionState, useState } from "react";
import {
  addCompetitor,
  removeCompetitor,
  type ActionState,
} from "@/app/(app)/content/actions";
import { Button } from "@/components/ui/Button";
import { SubmitText } from "@/components/ui/SubmitButton";

export interface CompetitorView {
  id: string;
  name: string;
  websiteUrl: string | null;
  socialHandles: string[];
}

const initialState: ActionState = { error: null };

const inputClass =
  "w-full rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-border-strong";

/** Watchlist for the weekly digest — stakeholders add competitors here anytime. */
export function CompetitorsCard({
  competitors,
  canEdit,
}: {
  competitors: CompetitorView[];
  canEdit: boolean;
}) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [state, action, isPending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await addCompetitor(prev, formData);
      if (result.ok) setIsFormOpen(false);
      return result;
    },
    initialState,
  );

  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-base font-semibold text-text-primary">
            Competitor watchlist
          </h3>
          <p className="mt-0.5 text-[13px] text-text-faint">
            Monitored every Monday. Digest lands in admin inboxes.
          </p>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setIsFormOpen((open) => !open)}
            className="text-[13px] text-primary-soft hover:text-primary-bright"
          >
            {isFormOpen ? "Close" : "+ Add competitor"}
          </button>
        ) : null}
      </div>

      {isFormOpen ? (
        <form action={action} className="mt-3 flex flex-col gap-2 rounded-xl border border-border-subtle bg-bg-base p-3">
          <input name="name" required placeholder="Competitor name" className={inputClass} />
          <input name="websiteUrl" placeholder="Website URL (optional)" className={inputClass} />
          <input
            name="socialHandles"
            placeholder="Social handles/URLs, comma-separated (optional)"
            className={inputClass}
          />
          <input name="notes" placeholder="Notes for the digest (optional)" className={inputClass} />
          {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
          <Button type="submit" variant="secondary" isLoading={isPending} className="self-start">
            Add to watchlist
          </Button>
        </form>
      ) : null}

      {competitors.length === 0 ? (
        <p className="mt-3 text-sm">
          No competitors yet. The weekly digest is skipped until at least one is added.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {competitors.map((competitor) => (
            <li
              key={competitor.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-bg-base px-3 py-2"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-text-primary">{competitor.name}</span>
                <span className="ml-2 truncate text-[13px] text-text-faint">
                  {[competitor.websiteUrl, ...competitor.socialHandles].filter(Boolean).join(" · ")}
                </span>
              </div>
              {canEdit ? (
                <form action={removeCompetitor}>
                  <input type="hidden" name="competitorId" value={competitor.id} />
                  <SubmitText
                    spinner
                    pendingLabel="Removing…"
                    className="text-[13px] text-text-faint hover:text-danger"
                    aria-label={`Remove ${competitor.name}`}
                  >
                    Remove
                  </SubmitText>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
