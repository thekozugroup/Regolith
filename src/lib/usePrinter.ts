import { useEffect, useRef, useState } from "react";
import { moonraker, type PrinterState } from "./moonraker";
import { profileFields } from "@/profiles";
import { useProfile } from "./useProfile";
import { selectionEquals } from "./selection";

export interface UsePrinterOptions {
  /**
   * Claim the `motion_report` subscription while mounted. Pass true only
   * from consumers that actually render live motion (Control's position
   * readout, the Dashboard expert velocity tile) — the field streams at
   * full batch cadence and is dropped from the server set when the last
   * claimant unmounts (WP-PERF).
   */
  motion?: boolean;
}

export function usePrinter(options: UsePrinterOptions = {}) {
  const motion = options.motion === true;
  const profile = useProfile();
  const [state, setState] = useState<PrinterState>(moonraker.getState());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    moonraker.connect();
    const unsubState = moonraker.subscribe(
      profileFields(profile, { motion }),
      setState,
    );
    const unsubConn = moonraker.onConnect(setConnected);
    return () => {
      unsubState();
      unsubConn();
    };
  }, [profile, motion]);

  return { state, connected, mr: moonraker, profile };
}

/**
 * Subscribe to a SLICE of printer state. The component re-renders only when
 * the selected value actually changes (selectionEquals), not on every
 * notify_status_update — a temperature tick no longer commits the app shell.
 *
 * Every push still runs the selector synchronously in its own message event,
 * so consecutive state EDGES (printing → error → standby) each produce their
 * own render exactly as usePrinter does — HealthAlerts/useNotifications
 * safety semantics are unchanged.
 */
export function usePrinterSelector<T>(
  selector: (state: PrinterState, connected: boolean) => T,
  options: UsePrinterOptions = {},
): T {
  const motion = options.motion === true;
  const profile = useProfile();
  const selectorRef = useRef(selector);
  const [selected, setSelected] = useState<T>(() =>
    selector(moonraker.getState(), moonraker.isConnected()),
  );

  // Keep the latest selector closure without re-subscribing (declared before
  // the subscription effect so it runs first after every commit).
  useEffect(() => {
    selectorRef.current = selector;
  });

  useEffect(() => {
    let connected = moonraker.isConnected();
    const update = () => {
      const next = selectorRef.current(moonraker.getState(), connected);
      setSelected((prev) => (selectionEquals(prev, next) ? prev : next));
    };
    moonraker.connect();
    const unsubState = moonraker.subscribe(
      profileFields(profile, { motion }),
      update,
    );
    const unsubConn = moonraker.onConnect((isUp) => {
      connected = isUp;
      update();
    });
    update();
    return () => {
      unsubState();
      unsubConn();
    };
  }, [profile, motion]);

  return selected;
}
