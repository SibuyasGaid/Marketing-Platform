"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { createAccount, type ActionState } from "@/app/(app)/accounts/actions";
import { Button } from "@/components/ui/Button";

export interface AccountListItem {
  slug: string;
  name: string;
  description: string;
  referenceCount: number;
}

const initialState: ActionState = { error: null };
const inputClass =
  "w-full rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-border-strong";

export function AccountsList({
  accounts,
  canManage,
}: {
  accounts: AccountListItem[];
  canManage: boolean;
}) {
  const [query, setQuery] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (account) =>
        account.name.toLowerCase().includes(q) || account.description.toLowerCase().includes(q),
    );
  }, [accounts, query]);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-text-primary">Accounts</h3>
            <p className="mt-0.5 text-[13px] text-text-faint">
              Brands and clients you post for. Open one to edit its description, visual identity, and
              reference photos. Every account here can be picked when creating posts.
            </p>
          </div>
          {canManage ? (
            <Button variant={isFormOpen ? "secondary" : "primary"} onClick={() => setIsFormOpen((open) => !open)}>
              {isFormOpen ? "Close" : "New account"}
            </Button>
          ) : null}
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search accounts…"
          className={`${inputClass} mt-3`}
        />

        {isFormOpen ? <NewAccountForm onDone={() => setIsFormOpen(false)} /> : null}
      </section>

      {filtered.length === 0 ? (
        <section className="rounded-2xl border border-border-subtle bg-bg-raised p-6">
          <p className="text-sm text-text-faint">
            {accounts.length === 0
              ? "No accounts yet."
              : "No accounts match your search."}
          </p>
        </section>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((account) => (
            <Link
              key={account.slug}
              href={`/accounts/${account.slug}`}
              className="card-hover flex flex-col rounded-2xl border border-border-subtle bg-bg-raised p-4 hover:bg-bg-hover"
            >
              <span className="font-display text-base font-semibold text-text-primary">
                {account.name}
              </span>
              <span className="mt-1 line-clamp-3 text-[13px] text-text-secondary">
                {account.description || "No description yet."}
              </span>
              <span className="type-utility mt-3 text-text-faint">
                {account.referenceCount} reference photo{account.referenceCount === 1 ? "" : "s"} · Edit →
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NewAccountForm({ onDone }: { onDone: () => void }) {
  const [state, action, isPending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await createAccount(prev, formData);
      if (result.ok) onDone();
      return result;
    },
    initialState,
  );

  return (
    <form action={action} className="mt-4 flex flex-col gap-2 rounded-xl border border-border-strong bg-bg-base p-3">
      <input name="name" required placeholder="Account name (e.g. Acme Dental)" className={inputClass} />
      <textarea
        name="description"
        rows={2}
        placeholder="Description and voice (used as context for every post). e.g. Local dental clinic; friendly, trustworthy, community-focused."
        className={`${inputClass} resize-y`}
      />
      <textarea
        name="visualIdentity"
        rows={3}
        placeholder="Visual identity: colors, fonts, and overall look (used to style generated images). e.g. Clean white backgrounds, teal accents, rounded sans-serif headings."
        className={`${inputClass} resize-y`}
      />
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" variant="secondary" isLoading={isPending} className="self-start">
        Create account
      </Button>
    </form>
  );
}
