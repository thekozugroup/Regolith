/**
 * Chamber-light policy — the APP's half of it.
 *
 * Owner's rule: the light should come on for a print, can be switched off by
 * hand at any time, and should go out ten minutes after the print ends or the
 * printer goes quiet.
 *
 * THE OFF HALF IS NOT IMPLEMENTED HERE AND MUST NEVER BE.
 * `scripts/light-watchdog.py` (user-owned, on the printer, run every minute
 * from cron) already owns it: it treats printing/paused, an idle_timeout of
 * "Printing", and toolhead movement as activity, and after 600s of none it
 * sends `SET_PIN PIN=LED VALUE=0`. It only ever writes 0. A browser-side
 * off-timer would be a second clock racing it for the same pin — two systems
 * fighting over one lamp is a bug, not redundancy. Do not add one.
 *
 * HONEST LIMITATION: everything below runs in the browser, so auto-ON happens
 * only while a Regolith tab is open. It is a convenience, not a printer-side
 * guarantee. Making it hold headless means extending the owner's watchdog to
 * also switch the lamp ON — their file, their call.
 */

export interface LightAutoState {
  /** A printer state has been observed at least once this session. */
  observed: boolean;
  /** A job identity while one is running: "" means no job. */
  job: string;
  /** The owner took the lamp under manual control during the current job. */
  manualOverride: boolean;
}

export const INITIAL_LIGHT_AUTO_STATE: LightAutoState = {
  observed: false,
  job: "",
  manualOverride: false,
};

/** A paused job is still the same job — resuming must not re-assert the lamp. */
function jobIdentity(printState: string | undefined, filename: string | undefined): string {
  if (printState !== "printing" && printState !== "paused") return "";
  return `${filename ?? ""}`;
}

/**
 * Fold one telemetry observation in and say whether auto-ON should fire.
 *
 * Fires on the EDGE into a job and nowhere else, so a telemetry tick storm
 * produces exactly one command. Three deliberate refusals:
 *
 *  - the FIRST observation never fires, even if it reads "printing". Opening
 *    a tab mid-job is not a print starting; re-asserting there would undo a
 *    lamp the owner had already switched off by hand.
 *  - a job already running never fires again, so a manual OFF mid-print
 *    sticks — including across a pause and resume, which is the same job.
 *  - a job the owner has taken manual control of never fires, even if the
 *    edge is somehow re-detected. The override is scoped to that job and
 *    dies with it, so the NEXT print still lights up.
 */
export function reduceLightAuto(
  prev: LightAutoState,
  printState: string | undefined,
  filename: string | undefined,
): { state: LightAutoState; autoOn: boolean } {
  // Before the first subscription resolves the app holds an EMPTY state, and
  // an empty state is not an observation. Counting it as one made the first
  // real telemetry frame look like a transition, so merely opening a tab onto
  // a running print fired auto-ON — exactly the re-assertion this is meant to
  // refuse. No print_stats means nothing has been seen yet.
  if (printState === undefined) return { state: prev, autoOn: false };

  const job = jobIdentity(printState, filename);

  if (!prev.observed) {
    return { state: { observed: true, job, manualOverride: false }, autoOn: false };
  }
  if (job === prev.job) return { state: prev, autoOn: false };
  // Job ended, or a different job began. Either way the manual override that
  // belonged to the old job dies with it.
  const edgeIntoJob = job !== "";
  return {
    state: { observed: true, job, manualOverride: false },
    autoOn: edgeIntoJob && !prev.manualOverride,
  };
}

/**
 * Record that the owner switched the lamp by hand.
 *
 * Scoped to a running job on purpose. A manual toggle while the printer is
 * idle is not a standing instruction about the next print — the owner's rule
 * is that a print assumes the light on — so it records nothing.
 */
export function withManualLightIntent(prev: LightAutoState): LightAutoState {
  if (prev.job === "") return prev;
  return { ...prev, manualOverride: true };
}

// Module-scoped because two consumers share it: the auto-ON hook watches the
// print state, and the readiness chip records manual intent. One app, one
// printer, one lamp — a context would be ceremony around a single value.
let autoState = INITIAL_LIGHT_AUTO_STATE;

/**
 * Call when the owner toggles the lamp by hand. Their choice then outranks
 * auto-ON for the rest of the current job: manual OFF mid-print STICKS.
 */
export function noteManualLightIntent(): void {
  autoState = withManualLightIntent(autoState);
}

/**
 * Fold one observation into the shared state and report whether auto-ON is
 * due. Idempotent by construction: replaying the same observation folds to
 * the same state and answers false the second time, so a StrictMode double
 * effect or a re-render cannot double-send.
 */
export function foldLightAuto(
  printState: string | undefined,
  filename: string | undefined,
): boolean {
  const folded = reduceLightAuto(autoState, printState, filename);
  autoState = folded.state;
  return folded.autoOn;
}
