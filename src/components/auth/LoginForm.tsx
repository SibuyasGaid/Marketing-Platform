"use client";

import { useActionState } from "react";
import { signIn, type LoginFormState } from "@/app/login/actions";
import { Button } from "@/components/ui/Button";

const initialState: LoginFormState = { error: null };

const inputClass =
  "rounded-xl border border-border-subtle bg-bg-base px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-border-strong focus:ring-2 focus:ring-primary-soft/30";

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
        Email
        <input type="email" name="email" required autoComplete="email" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
        Password
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </label>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" isLoading={isPending} className="mt-2 w-full">
        Sign in
      </Button>
    </form>
  );
}
