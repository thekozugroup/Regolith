import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  getFocusLoopIndex,
  getModalFocusableElements,
} from "@/lib/modal";

interface ModalSurfaceProps {
  ariaLabel?: string;
  labelledBy?: string;
  describedBy?: string;
  children: ReactNode;
  onDismiss: () => void;
  dismissLocked?: boolean;
  overlayClassName?: string;
  panelClassName?: string;
}

export function ModalSurface({
  ariaLabel,
  labelledBy,
  describedBy,
  children,
  onDismiss,
  dismissLocked = false,
  overlayClassName,
  panelClassName,
}: ModalSurfaceProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(onDismiss);
  const lockedRef = useRef(dismissLocked);

  useEffect(() => {
    dismissRef.current = onDismiss;
    lockedRef.current = dismissLocked;
  }, [dismissLocked, onDismiss]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const appRoot = document.getElementById("root");
    const previousInert = appRoot?.inert ?? false;
    const previousAriaHidden = appRoot?.getAttribute("aria-hidden") ?? null;
    const previousOverflow = document.body.style.overflow;
    const panel = panelRef.current;

    if (appRoot) {
      appRoot.inert = true;
      appRoot.setAttribute("aria-hidden", "true");
    }
    document.body.style.overflow = "hidden";

    const focusFirst = () => {
      const preferred = panel?.querySelector<HTMLElement>("[data-autofocus]");
      const first = panel ? getModalFocusableElements(panel)[0] : null;
      (preferred ?? first ?? panel)?.focus();
    };
    const frame = requestAnimationFrame(focusFirst);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!lockedRef.current) {
          event.preventDefault();
          dismissRef.current();
        }
        return;
      }
      if (event.key !== "Tab" || !panel) return;

      const items = getModalFocusableElements(panel);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      const nextIndex = getFocusLoopIndex(
        currentIndex,
        items.length,
        event.shiftKey,
      );
      if (nextIndex == null) return;
      event.preventDefault();
      items[nextIndex].focus();
    };

    const onFocusIn = (event: FocusEvent) => {
      if (panel && !panel.contains(event.target as Node)) focusFirst();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      document.body.style.overflow = previousOverflow;
      if (appRoot) {
        appRoot.inert = previousInert;
        if (previousAriaHidden == null) appRoot.removeAttribute("aria-hidden");
        else appRoot.setAttribute("aria-hidden", previousAriaHidden);
      }
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const dismissFromBackdrop = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !dismissLocked) onDismiss();
  };

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4",
        overlayClassName,
      )}
      onPointerDown={dismissFromBackdrop}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={cn(
          "w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-2xl",
          panelClassName,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
