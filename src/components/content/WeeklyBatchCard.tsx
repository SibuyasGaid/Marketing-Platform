"use client";

import { useActionState, useState } from "react";
import { requestWeeklyBatch, type ActionState } from "@/app/(app)/content/actions";
import { Button } from "@/components/ui/Button";
import { type Brand } from "@/lib/domain";
import type { AccountOption } from "@/components/images/ImageWorkspace";

const initialState: ActionState = { error: null };

/** The prominent one-click weekly batch (docs/DESIGN.md §3, Content Engine). */
export function WeeklyBatchCard({ accounts }: { accounts: AccountOption[] }) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [brand, setBrand] = useState<Brand>(accounts[0]?.slug ?? "");
  const [state, action, isPending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await requestWeeklyBatch(prev, formData);
      if (result.ok) setIsConfirmOpen(false);
      return result;
    },
    initialState,
  );

  return (
    <section className="rounded-2xl border border-border-strong bg-bg-raised p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-semibold text-text-primary">
            Generate this <span className="text-gradient-brand">week&apos;s</span> content
          </h3>
          <p className="mt-0.5 text-sm text-text-secondary">
            One run: 10 image posts (Mon to Fri, Instagram and LinkedIn), queued for approval.
          </p>
        </div>
        {!isConfirmOpen ? (
          <Button onClick={() => setIsConfirmOpen(true)}>Generate</Button>
        ) : null}
      </div>

      {isConfirmOpen ? (
        <form action={action} className="mt-4 flex flex-col gap-2 rounded-xl border border-border-subtle bg-bg-base p-3">
          <input type="hidden" name="brand" value={brand} />
          <div className="flex flex-col gap-1 text-[13px] text-text-secondary">
            Brand / page
            <div className="flex flex-wrap gap-1.5">
              {accounts.map((option) => (
                <button
                  key={option.slug}
                  type="button"
                  onClick={() => setBrand(option.slug)}
                  className={`rounded-full px-3 py-1 font-display text-[13px] font-medium transition-colors ${
                    brand === option.slug
                      ? "bg-primary text-on-primary"
                      : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {option.name}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[13px] text-text-faint">
            Will produce: 10 image posts scheduled across next week using your first brand
            preset. Videos are not generated speculatively; create hooks from ranked
            segments below. Nothing posts without approval.
          </p>
          <textarea
            name="theme"
            rows={2}
            required
            placeholder="Theme for the week, e.g. Spring launch push, emphasize customer results"
            className="w-full resize-y rounded-xl border border-border-subtle bg-bg-raised px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
          />
          {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
          <div className="flex items-center gap-2">
            <Button type="submit" isLoading={isPending}>
Confirm and generate week
            </Button>
            <Button type="button" variant="secondary" onClick={() => setIsConfirmOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {state.ok && !isConfirmOpen ? (
        <p className="mt-2 text-sm text-success">
          Batch queued. Items will appear in the Approval Queue as they generate.
        </p>
      ) : null}
    </section>
  );
}
