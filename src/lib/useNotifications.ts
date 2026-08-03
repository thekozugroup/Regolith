import { useEffect, useRef } from "react";
import { usePrinterSelector } from "./usePrinter";

/**
 * Browser-level notifications for major print state transitions.
 *
 * Fires:
 *   - Print started → soft toast
 *   - Print paused → warning
 *   - Print completed → success notification + sound (browser permission)
 *   - Print cancelled → info
 *   - Klipper error → error notification
 *
 * Requests notification permission on first install.
 */

type State =
  | "standby"
  | "printing"
  | "paused"
  | "complete"
  | "cancelled"
  | "error";

const TITLE_BY_STATE: Record<State, string> = {
  standby: "",
  printing: "Print started",
  paused: "Print paused",
  complete: "✓ Print complete",
  cancelled: "Print cancelled",
  error: "⚠ Klipper error",
};

export function useNotifications() {
  // Selector, not the whole state: this hook mounts in AppShell, so before
  // WP-MEMO every temperature tick re-rendered the entire app through it.
  // The selector re-renders only on the two fields the notifier reads —
  // every print_stats.state EDGE still arrives (each push runs the selector
  // in its own message event; see usePrinterSelector).
  const { printState, filename } = usePrinterSelector((state) => ({
    printState: state.print_stats?.state,
    filename: state.print_stats?.filename ?? "",
  }));
  const lastState = useRef<State | null>(null);
  const permRef = useRef<NotificationPermission | null>(null);

  // Request permission once
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().then((p) => {
        permRef.current = p;
      });
    } else {
      permRef.current = Notification.permission;
    }
  }, []);

  useEffect(() => {
    const cur = printState as State | undefined;
    if (!cur) return;

    // Skip first observation
    if (lastState.current === null) {
      lastState.current = cur;
      return;
    }
    if (cur === lastState.current) return;

    const title = TITLE_BY_STATE[cur];
    if (
      title &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      try {
        new Notification(title, {
          body: filename || "Forge",
          icon: "/forge-favicon.svg",
          tag: "forge-print",
        });
      } catch {
        // Some browsers throw on notification creation in non-secure contexts
      }
    }
    lastState.current = cur;
  }, [printState, filename]);
}
