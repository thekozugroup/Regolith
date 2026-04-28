import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({
  title,
  icon,
  action,
  children,
  className,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md overflow-hidden",
        className
      )}
    >
      <header className="relative h-9 flex items-center justify-between px-3.5 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.05em] uppercase">
          {icon && (
            <span className="text-[var(--color-accent)] [&>svg]:w-3.5 [&>svg]:h-3.5">
              {icon}
            </span>
          )}
          <span>{title}</span>
        </div>
        {action}
        {/* Accent underline */}
        <span className="absolute -bottom-px left-3.5 w-6 h-px bg-[var(--color-accent)] opacity-50" />
      </header>
      <div className="p-3.5">{children}</div>
    </section>
  );
}
