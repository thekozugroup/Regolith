import { useId } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./Button";
import { ModalSurface } from "./ModalSurface";
import { cn } from "@/lib/utils";
import type { ActionConfirmation } from "@/lib/printerActions";

/**
 * In-app confirmation for guarded printer actions, in PrintDialog's visual
 * language. Replaces `window.confirm`, which BLOCKS the main thread: while a
 * native confirm sat open, live telemetry froze, the alert stack froze, and
 * the cockpit could neither render a thermal alarm nor update the very state
 * the owner was being asked to confirm against.
 */
export function ActionConfirmDialog({
  details,
  onConfirm,
  onCancel,
}: {
  details: ActionConfirmation;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <ModalSurface
      labelledBy={titleId}
      describedBy={descriptionId}
      onDismiss={onCancel}
      panelClassName="max-w-md"
    >
      <header className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
        <AlertTriangle
          aria-hidden="true"
          className={cn(
            "w-4 h-4 shrink-0",
            details.risk === "critical"
              ? "text-[var(--color-error)]"
              : "text-[var(--color-warning)]",
          )}
        />
        <h2 id={titleId} className="text-[17px] font-semibold tracking-tight">
          {details.title}
        </h2>
      </header>

      <p
        id={descriptionId}
        className="whitespace-pre-line p-4 text-[14px] leading-relaxed text-[var(--color-fg-muted)]"
      >
        {details.message}
      </p>

      <footer className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] px-4 py-3 sm:flex-row sm:justify-end">
        <div className="grid grid-cols-2 gap-2 sm:flex">
          {/* Focus lands on Cancel: every action routed here is destructive
              enough to have earned a confirmation, so Enter must not fire it. */}
          <Button size="md" variant="ghost" onClick={onCancel} data-autofocus>
            Cancel
          </Button>
          <Button
            size="md"
            variant={details.risk === "critical" ? "danger" : "primary"}
            onClick={onConfirm}
          >
            {details.confirmLabel}
          </Button>
        </div>
      </footer>
    </ModalSurface>
  );
}
