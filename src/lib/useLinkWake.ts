import { useEffect } from "react";
import { moonraker } from "./moonraker";

/**
 * Make the link prove itself whenever the environment says it might be a
 * ghost.
 *
 * A suspended machine does not close its sockets. Shut a laptop lid, put a
 * phone in a pocket, walk between access points: the tab comes back with a
 * WebSocket that still reports OPEN and a connection that no longer exists on
 * the printer's side. Nothing fires — no close, no error — so the dashboard
 * simply keeps rendering whatever it last received. That is the failure this
 * hook exists for, because it is the one that LOOKS fine: a frozen job
 * progress and a frozen nozzle temperature are indistinguishable from a
 * printer that is running steadily.
 *
 * Waking never disconnects and never sends a printer command. It asks the
 * transport to verify what it has and, if it cannot, to reconnect now rather
 * than sit out a backoff that was scheduled before the machine went to sleep.
 *
 * Deliberately NOT paired with a disconnect-on-hide: a print running while
 * the tab is in the background still has to reach the notification path.
 */
export function useLinkWake(): void {
  useEffect(() => {
    const wake = () => moonraker.wake();
    const onVisibility = () => {
      if (document.visibilityState === "visible") wake();
    };

    document.addEventListener("visibilitychange", onVisibility);
    // bfcache restore (iOS Safari's back/forward and app-switch path) does
    // not fire visibilitychange in every browser, so it is covered too.
    window.addEventListener("pageshow", wake);
    // The network coming back is the other moment a socket is likely a ghost.
    window.addEventListener("online", wake);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("online", wake);
    };
  }, []);
}
