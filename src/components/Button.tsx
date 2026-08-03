import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "primary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export function Button({
  variant = "default",
  size = "md",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}) {
  const variantClasses = {
    default:
      "bg-[var(--color-elevated)] border border-[var(--color-border)] text-[var(--color-fg)] hover:bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]",
    primary:
      "bg-[var(--color-accent)] text-[var(--color-accent-fg)] border border-[color-mix(in_oklab,var(--color-accent)_72%,black)] hover:bg-[var(--color-accent-hover)]",
    ghost:
      "text-[var(--color-fg-muted)] hover:bg-[var(--color-accent-faint)] hover:text-[var(--color-fg)]",
    danger:
      "bg-(--color-error)/12 border border-(--color-error)/40 text-[var(--color-error)] hover:bg-(--color-error)/20 hover:border-(--color-error)/60",
  } as const;

  const sizeClasses = {
    sm: "min-h-11 px-3 text-[12px]",
    md: "min-h-11 px-4 text-[13px]",
    lg: "min-h-12 px-5 text-[14px]",
  } as const;

  return (
    <button
      {...props}
      className={cn(
        "inline-flex min-w-11 items-center justify-center gap-1.5 rounded-md font-medium",
        "transition-[background,border-color,color,transform] duration-100",
        "active:translate-y-px",
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:active:translate-y-0",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
    >
      {children}
    </button>
  );
}
