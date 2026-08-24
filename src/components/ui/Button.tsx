import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // Solid primary pill with glow — the "Watch Free Training" treatment.
  primary:
    "bg-primary text-text-primary shadow-glow hover:bg-primary-bright hover:shadow-glow-hover",
  // Transparent with subtle border — the "Explore the Blueprint" treatment.
  secondary:
    "border border-border-subtle text-text-primary hover:bg-bg-hover",
  destructive:
    "border border-danger text-danger hover:bg-danger/10",
  ghost: "text-primary-soft hover:text-primary-bright",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  isLoading?: boolean;
}

/**
 * The only button in the app (docs/DESIGN.md §3). Pill shape, Poppins 500 14px.
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
      className={`relative inline-flex items-center justify-center rounded-full px-[22px] py-[10px] font-display text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
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
