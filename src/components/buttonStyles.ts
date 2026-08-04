import { cn } from "@/lib/utils";

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES = {
  default:
    "bg-[var(--color-elevated)] border border-[var(--color-border)] text-[var(--color-fg)] hover:bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]",
  primary:
    "bg-[var(--color-accent)] text-[var(--color-accent-fg)] border border-[color-mix(in_oklab,var(--color-accent)_72%,black)] hover:bg-[var(--color-accent-hover)]",
  ghost:
    "text-[var(--color-fg-muted)] hover:bg-[var(--color-accent-faint)] hover:text-[var(--color-fg)]",
  danger:
    "bg-(--color-error)/12 border border-(--color-error)/40 text-[var(--color-error)] hover:bg-(--color-error)/20 hover:border-(--color-error)/60",
} as const;

const SIZE_CLASSES = {
  sm: "min-h-11 px-3 text-[12px]",
  md: "min-h-11 px-4 text-[13px]",
  lg: "min-h-12 px-5 text-[14px]",
} as const;

/**
 * Single source of button styling. Elements that must be links or anchors
 * yet look like buttons (route links, downloads) reuse this class builder
 * instead of hand-rolling a clone — the corner radius comes from the
 * concentric cascade (`rounded-inner`), never from a literal.
 */
export function buttonClassName({
  variant = "default",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(
    "inline-flex min-w-11 items-center justify-center gap-1.5 rounded-inner font-medium",
    // Motion rides the tokens: --dur-fast for immediate control feedback,
    // the standard easing curve — never a literal duration.
    "transition-[background,border-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-standard)]",
    "active:translate-y-px",
    "disabled:opacity-40 disabled:cursor-not-allowed disabled:active:translate-y-0",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  );
}
