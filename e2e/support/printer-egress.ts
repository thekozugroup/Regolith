/**
 * The printer namespaces, and the ledger that proves nothing used them.
 *
 * WHY THIS MODULE EXISTS
 *
 * `vite preview` used to inherit `server.proxy`, so the e2e gate's own web
 * server held live routes to the real machine. Every spec called
 * `assertSealed()` and every spec passed — because the seal was asserted at
 * the BROWSER, and a relative URL like `/server/history/list` resolves to the
 * preview origin. "Same origin as the app" was read as "safe to serve", the
 * request was `route.continue()`d, and the preview server proxied it onward.
 * 519 requests reached a printer in under half a suite before anyone noticed.
 *
 * Two facts fell out of that, and this module encodes both:
 *
 *   1. A SEAL MUST SIT AT THE OUTERMOST LAYER THAT CAN EGRESS. The browser is
 *      one layer too high. `PRINTER_NAMESPACES` is the list of prefixes the
 *      preview server would forward, and it is the SAME list the browser-side
 *      catch-all refuses — so the two can never drift into disagreement.
 *   2. A GREEN SUITE MUST BE EVIDENCE, NOT A VIBE. A leak that only shows up
 *      as `ECONNREFUSED` in a log nobody reads is not caught, it is merely
 *      recorded. Both layers append to one ledger, and the run fails on it.
 *
 * The ledger is a JSONL file, appended to from three processes (the preview
 * server, the Playwright workers, and read by global teardown), so it is
 * keyed off the preview port rather than any module's own location — nothing
 * here depends on `__dirname` or `import.meta.url`, which differ wildly
 * between a bundled Vite config and a Playwright worker.
 */

import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Path prefixes the Vite proxy tables forward — dev at the printer, preview
 * at the discard sink. Matching is `startsWith`, which is exactly how
 * `http-proxy`'s own table matches, so this predicate answers precisely the
 * question "would the preview server forward this?" and not an approximation
 * of it.
 */
export const PRINTER_NAMESPACES = [
  "/printer",
  "/server",
  "/machine",
  "/access",
  "/webcam",
  "/api",
  "/websocket",
] as const;

/** True when the preview server's proxy table would forward this path. */
export function isPrinterNamespace(pathname: string): boolean {
  return PRINTER_NAMESPACES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * One ledger per preview server, keyed by port so a run on an alternate
 * `REGOLITH_E2E_PORT` cannot read another run's tally. The preview plugin
 * truncates it at boot — Playwright waits for the server's URL before the
 * first test, so truncation always precedes the first browser-side append.
 */
export const EGRESS_LOG_PATH = path.join(
  tmpdir(),
  `regolith-e2e-egress-${process.env.REGOLITH_E2E_PORT ?? "default"}.jsonl`,
);

export type EgressStage =
  /** Written once when the preview middleware installs. Its ABSENCE is a
   *  failure: it proves the server-side half of the guard was actually
   *  armed, so a silently-removed plugin cannot read as "zero leaks". */
  | "armed"
  /** The harness catch-all refused an unmocked printer-namespace request.
   *  Nothing left the browser — but the spec is missing a mock. */
  | "refused-at-browser"
  /** A request reached the preview server on a proxied namespace. This is a
   *  real leak: only the sink at 127.0.0.1:9 stopped it. */
  | "reached-preview-server";

export interface EgressEntry {
  stage: EgressStage;
  method?: string;
  pathname?: string;
  /** Playwright title path, when the append happens inside a test. */
  spec?: string;
  /**
   * Wall clock, stamped by `recordEgress`. Teardown checks the `armed`
   * entry's stamp against its own process start: a ledger left behind by an
   * earlier `vite preview` would otherwise satisfy the armed check and
   * report a clean run for a suite whose server-side guard never installed.
   */
  at?: number;
}

/**
 * Append one entry. Deliberately unguarded: if the ledger cannot be written
 * the guard is blind, and a blind guard must fail loudly rather than let a
 * run report zero.
 */
export function recordEgress(entry: EgressEntry): void {
  const stamped: EgressEntry = { ...entry, at: Date.now() };
  appendFileSync(EGRESS_LOG_PATH, `${JSON.stringify(stamped)}\n`);
}
