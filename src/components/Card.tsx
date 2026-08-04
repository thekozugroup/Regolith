import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({
  title,
  icon,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Extra classes on the body (the flex-1 region below the header). Lets a
   *  stretched dashboard card distribute its slack — e.g. center a short
   *  instrument group — instead of leaving a hollow tail below the content. */
  bodyClassName?: string;
}) {
  const titleId = useId();

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "instrument-panel flex flex-col overflow-hidden",
        className
      )}
    >
      {/* panel-header: the slot squares its children's corners (skew corner
          against the panel's top border — see the cascade note in index.css). */}
      <header className="panel-header relative flex min-h-11 items-center justify-between gap-3 border-b border-[var(--color-border)] px-[var(--card-pad)]">
        <div className="flex min-w-0 items-center gap-2 text-[14px] font-semibold tracking-[-0.01em]">
          {icon && (
            <span aria-hidden="true" className="text-[var(--color-accent)] [&>svg]:h-3.5 [&>svg]:w-3.5">
              {icon}
            </span>
          )}
          <h2 id={titleId} className="truncate">{title}</h2>
        </div>
        {action}
      </header>
      {/* flex-1: when a grid row stretches the card, the body absorbs the
          extra height instead of leaving a blank tail below it. */}
      <div className={cn("min-h-0 flex-1 p-[var(--card-pad)]", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}
