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
      "bg-[var(--color-accent)] text-white border border-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] hover:bg-[var(--color-accent-hover)]",
    ghost:
      "text-[var(--color-fg-muted)] hover:bg-[rgba(249,115,22,0.06)] hover:text-[var(--color-fg)]",
    danger:
      "bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.4)] text-[var(--color-error)] hover:bg-[rgba(239,68,68,0.2)] hover:border-[rgba(239,68,68,0.6)]",
  } as const;

  const sizeClasses = {
    sm: "h-6 px-2 text-[11px]",
    md: "h-7.5 px-3 text-[12px]",
    lg: "h-9 px-4 text-[13px]",
  } as const;

  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-sm font-medium",
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
