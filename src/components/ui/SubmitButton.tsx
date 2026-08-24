"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/Button";

/**
 * A submit button that reflects its parent <form action> pending state
 * automatically via useFormStatus — no manual isLoading wiring. Use inside any
 * server-action form so the click gives immediate feedback (spinner + disabled)
 * until the action resolves.
 */
export function SubmitButton(props: Omit<ButtonProps, "type" | "isLoading">) {
  const { pending } = useFormStatus();
  return <Button type="submit" isLoading={pending} disabled={pending} {...props} />;
}

/**
 * A plain text/icon submit link (not the pill Button) that still shows a pending
 * state — for inline "Remove"/"Disconnect"/"×" actions inside a form. Swaps to a
 * small spinner while the action runs and disables to prevent double-submits.
 */
export function SubmitText({
  children,
  className = "",
  pendingLabel,
  spinner = false,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingLabel?: string;
  /** When true, show a spinner glyph instead of a pending label while working. */
  spinner?: boolean;
}) {
  const { pending } = useFormStatus();
  // While pending with a spinner and no explicit label, show ONLY the spinner
  // (so tiny icon buttons like "×" don't overflow). With a pendingLabel, show
  // the spinner + that label. Otherwise show the normal children.
  const showChildren = !pending || (!spinner && !pendingLabel);
  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex items-center gap-1 transition-opacity disabled:opacity-60 ${className}`}
      aria-busy={pending}
      {...rest}
    >
      {pending && spinner ? (
        <span
          aria-hidden
          className="h-3 w-3 animate-spinner-dot rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {pending && pendingLabel ? pendingLabel : showChildren ? children : null}
    </button>
  );
}
