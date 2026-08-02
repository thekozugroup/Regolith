import { useId, type ReactNode } from "react";
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
  const titleId = useId();

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]",
        className
      )}
    >
      <header className="relative flex min-h-12 items-center justify-between gap-3 border-b border-[var(--color-border)] px-3.5">
        <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
          {icon && (
            <span className="text-[var(--color-accent)] [&>svg]:w-3.5 [&>svg]:h-3.5">
              {icon}
            </span>
          )}
          <h2 id={titleId} className="truncate">{title}</h2>
        </div>
        {action}
      </header>
      <div className="p-3.5">{children}</div>
    </section>
  );
}
