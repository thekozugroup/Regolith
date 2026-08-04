import { useCallback, useState } from "react";
import { ActionConfirmDialog } from "./ActionConfirmDialog";
import type { ActionConfirmation } from "@/lib/printerActions";

interface ConfirmRequest {
  details: ActionConfirmation;
  resolve: (accepted: boolean) => void;
}

/**
 * Promise-shaped confirm for `runPrinterAction`, backed by ActionConfirmDialog.
 *
 * Every guarded-action page must use this instead of `window.confirm`: the
 * native dialog blocks the main thread, so HealthAlerts' 1s watchdog stops
 * ticking, stale-telemetry and runaway alerts stop evaluating, and the very
 * state the owner is being asked to confirm against freezes for as long as
 * the dialog sits open. MissionTimeline adopted this pattern first; the hook
 * exists so no call site ever falls back to the blocking primitive.
 *
 * Usage: `const { confirm, confirmDialog } = useActionConfirm();`, pass
 * `confirm` to `runPrinterAction`, render `{confirmDialog}` in the tree.
 * (Own file rather than a second export of ActionConfirmDialog.tsx so the
 * component file keeps Fast Refresh — same split as Button/buttonStyles.)
 */
export function useActionConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const confirm = useCallback(
    (details: ActionConfirmation) =>
      new Promise<boolean>((resolve) => setRequest({ details, resolve })),
    [],
  );

  const settle = (accepted: boolean) => {
    if (!request) return;
    request.resolve(accepted);
    setRequest(null);
  };

  const confirmDialog = request ? (
    <ActionConfirmDialog
      details={request.details}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, confirmDialog };
}
