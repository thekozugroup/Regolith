import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { formatMb, prePrintHostAdvisory } from "@/lib/hostHealth";
import { useHostHealth } from "@/lib/useHostHealth";

/**
 * Pre-print HOST LOAD advisory — a heads-up, never a gate.
 *
 * THE LAW, restated where it lives: this is wired to NOTHING. The Start
 * button does not read it, `guardPrinterAction` does not know it exists,
 * `safety.ts` has never heard of it, and there is no confirm step behind
 * it. A host-health false positive that refused to print would be its own
 * outage — optional checks never block a print (same law as KAMP and the
 * timelapse write). Unknown host = null = silence.
 *
 * It lives in its own component so the PrintDialog can wrap it in an error
 * boundary. `/print` is the only route in the app that starts a print, and
 * it renders inside the shared RouteErrorBoundary: a throw anywhere on this
 * advisory path — the proc-stat hook, the verdict, this markup — would have
 * blanked the whole page and taken the Start button with it. An optional
 * warning must never be able to remove the control it is warning about, so
 * the hook and the verdict are INSIDE the component, not passed in: a
 * boundary around a prop computed by the parent would catch nothing.
 */
export function HostLoadAdvisory({ printState }: { printState?: string }) {
  const { prePrintLoad } = useHostHealth();
  const [dismissed, setDismissed] = useState(false);
  const advisory = prePrintHostAdvisory(prePrintLoad, printState);
  if (!advisory || dismissed) return null;

  return (
    <>
      {/* The visible copy interpolates live numbers, so the stable
          screen-reader announcement lives in an sr-only sibling
          (HealthAlerts pattern). */}
      <p className="sr-only" role="status">
        The printer&rsquo;s computer is under heavy load. Starting a print now
        is more likely to fail.
      </p>
      <div
        data-testid="host-load-advisory"
        className="flex items-start gap-2 p-3 bg-(--color-warning)/8 border border-(--color-warning)/35 rounded-inner"
      >
        <AlertTriangle className="w-4 h-4 text-[var(--color-warning)] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1.5 text-[11px] leading-relaxed text-[var(--color-warning)]">
          <p>
            <strong>
              {/* The figure is a MEDIAN over the readings inside a 30 s
                  window (≥ 20 of them), not a level held for 30 s. Say
                  which, or the number claims more than it measured. */}
              {advisory.level === "strong"
                ? `Host heavily loaded — ${Math.round(advisory.cpuMedian)}% CPU, median over the last 30 seconds, with nothing printing.`
                : `Host busy — the printer's computer has been at ${Math.round(advisory.cpuMedian)}% CPU, median over the last 30 seconds, with nothing printing.`}
            </strong>{" "}
            {advisory.level === "strong" &&
              "This is the condition that ended the 12 Aug jobs. "}
            A loaded host can fall behind mid-print and stop the job with a
            timer or probe error that looks like a hardware fault. Stopping
            background work first makes the print more likely to finish.
            Starting anyway is fine — this is a heads-up, not a block.
          </p>
          {advisory.memoryAmplified &&
            advisory.memAvailKb != null &&
            advisory.memTotalKb != null && (
              <p data-testid="host-load-advisory-memory">
                Free memory is also low ({formatMb(advisory.memAvailKb)} of{" "}
                {formatMb(advisory.memTotalKb)}). When memory runs out the
                printer swaps to its eMMC, which starves Klipper the same way
                a pegged CPU does.
              </p>
            )}
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center font-medium">
              What to stop →
            </summary>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Video encoding first: no timelapse renders on this machine
                until it is idle (already enforced on the print path).
              </li>
              <li>
                Remote-access daemons in userspace-networking mode, cloud
                sync, backups, log shippers. Move their watchdog cron aside
                first, and put it back afterwards — losing remote access is
                its own hazard.
              </li>
              <li>
                Prefer stopping work over renicing it: on this SoC, nice does
                not save you from iowait.
              </li>
              <li>
                Full checklist with the K1 specifics: docs/load-shedding.md in
                the Regolith repository.
              </li>
            </ul>
          </details>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss host load warning"
          className="press-flat inline-flex min-h-11 min-w-11 items-center justify-center rounded-inner text-[16px] leading-none text-[var(--color-fg-muted)] hover:bg-(--color-fg)/8 hover:text-[var(--color-fg)]"
        >
          ×
        </button>
      </div>
    </>
  );
}
