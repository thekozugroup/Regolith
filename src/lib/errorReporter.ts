/**
 * Last-resort catcher for the two failures React's error boundaries cannot
 * see: a rejected promise nobody handled, and an exception thrown outside a
 * render (a timer, an event listener, an async callback).
 *
 * Neither of those crashes the app — which is the problem. They fail
 * invisibly: a fetch that never settles leaves a spinner turning, a rejected
 * printer action leaves a control looking armed. On a machine that prints
 * unattended, "it looked fine" is the expensive outcome.
 *
 * Nothing here is sent anywhere. There is no endpoint, no beacon, no
 * telemetry: the printer is on the owner's LAN and it stays there. Reports
 * go to the dev console, and to a small in-memory ring that the e2e suite
 * asserts is empty against the PRODUCTION bundle — a promise audit that only
 * held in a dev build would not be an audit of what ships.
 */

export interface ReportedError {
  at: number;
  kind: "unhandledrejection" | "error";
  message: string;
}

/** Bounded on purpose: this must never become a memory leak of its own. */
const MAX_REPORTS = 20;
const reports: ReportedError[] = [];

/** Same handle the e2e console-hygiene spec reads. */
const GLOBAL_KEY = "__regolithErrors";

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function record(kind: ReportedError["kind"], value: unknown): void {
  const entry: ReportedError = { at: Date.now(), kind, message: describe(value) };
  reports.push(entry);
  if (reports.length > MAX_REPORTS) reports.shift();
  if (import.meta.env.DEV) {
    // Loud and greppable. A rejection that reaches here is a missing catch
    // somewhere, and the fix belongs at that call site — not in this file.
    console.error(`[regolith] unhandled ${kind}`, value);
  }
}

export function reportedErrors(): ReportedError[] {
  return [...reports];
}

export function clearReportedErrors(): void {
  reports.length = 0;
}

let installed = false;

/**
 * Idempotent — StrictMode mounts effects twice in development, and a double
 * listener would double every report.
 */
export function installErrorReporter(): () => void {
  if (installed || typeof window === "undefined") return () => {};
  installed = true;

  const onRejection = (event: PromiseRejectionEvent) =>
    record("unhandledrejection", event.reason);
  const onError = (event: ErrorEvent) => record("error", event.error ?? event.message);

  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("error", onError);

  const globals = window as unknown as Record<string, unknown>;
  globals[GLOBAL_KEY] = reportedErrors;

  return () => {
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("error", onError);
    delete globals[GLOBAL_KEY];
    installed = false;
  };
}
