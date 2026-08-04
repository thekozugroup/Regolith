import { useEffect } from "react";
import { foldLightAuto } from "./lightControl";
import { runPrinterAction } from "./printerActions";
import { usePrinterSelector } from "./usePrinter";
import { useProfile } from "./useProfile";

/**
 * Light the chamber when a print starts.
 *
 * Mounted once in the app shell, not on a page: watching from the dashboard
 * would mean the lamp only came on when the owner happened to be looking at
 * the dashboard. The policy — when to fire, and why a manual OFF sticks —
 * lives in lightControl.ts; this is only the wire.
 *
 * The matching auto-OFF is NOT here and must not be added: the owner's
 * on-printer watchdog already owns it. See lightControl.ts.
 */
export function useLightAutoOn(): void {
  const profile = useProfile();
  const object = profile.statusPins?.[0]?.klipper;
  const t = usePrinterSelector((state) => ({
    printState: state.print_stats?.state,
    filename: state.print_stats?.filename,
  }));

  useEffect(() => {
    if (!foldLightAuto(t.printState, t.filename) || !object) return;
    // Fire and forget. The lamp is a courtesy: a printer without the pin, a
    // dropped link, or a refused command must never raise an error the owner
    // did not ask for, and must never touch the print itself.
    void runPrinterAction({ type: "set-light", on: true, object }).catch(() => {});
  }, [object, t.printState, t.filename]);
}
