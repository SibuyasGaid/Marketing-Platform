import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // Solid cobalt: the one action that moves work forward on a screen.
  primary:
    "bg-primary text-on-primary shadow-glow hover:bg-primary-bright hover:shadow-glow-hover active:translate-y-px",
  // White sheet with a hairline border: everything else.
  secondary:
    "border border-border-subtle bg-bg-raised text-text-primary hover:border-border-strong hover:bg-bg-hover",
  destructive:
    "border border-danger text-danger hover:bg-danger/10",
  ghost: "text-primary-soft hover:text-primary-bright",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  isLoading?: boolean;
}

/**
 * The only button in the app (docs/DESIGN.md §3). 8px radius, 14px/600.
 * Loading state swaps the label for a spinner with width locked so nothing jumps.
 */
export function Button({
  variant = "primary",
  isLoading = false,
  disabled,
  className = "",
  // Default to "button" so an onClick Button never accidentally submits a
  // surrounding form; callers that want submission pass type="submit".
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      className={`relative inline-flex items-center justify-center rounded-lg px-4 py-2.5 font-display text-sm font-semibold transition-[background-color,box-shadow,transform,border-color] disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      <span className={isLoading ? "invisible" : undefined}>{children}</span>
      {isLoading ? (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center"
        >
          <span className="h-4 w-4 animate-spinner-dot rounded-full border-2 border-current border-t-transparent" />
        </span>
      ) : null}
    </button>
  );
}
