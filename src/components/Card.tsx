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
      {/* panel-header: one --header-pad inset on ALL four sides (even-inset
          law) — the header's own, tighter rhythm, derived from --card-pad in
          index.css — so header controls run concentric at the header's inset
          (see the cascade note there). The min-h is 44px (a control's tap
          floor) + 2·pad + the 1px border-b: the pad cancels out of the
          content box, so the tap floor is untouched at any pad, and headers
          WITHOUT an action must stay the same height as headers with one,
          or the card titles stop sharing a baseline. */}
      <header className="panel-header relative flex min-h-[calc(2.75rem+2*var(--header-pad)+1px)] items-center justify-between gap-3 border-b border-[var(--color-border)] p-[var(--header-pad)]">
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
