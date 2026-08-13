/**
 * GUARD 1 — the seal every browser-side catch-all ends with.
 *
 * Each e2e fixture in this suite finishes its `page.route("**\/*")` handler
 * the same way: "is this the app's own origin? then serve it." That check is
 * correct about the ORIGIN and wrong about the CONSEQUENCE. `/printer/info`
 * is a relative URL, so it is same-origin by construction — and the server
 * behind that origin holds a proxy table. Continuing the request handed it
 * to a machine on the LAN, while `assertSealed()` reported a clean run
 * because nothing had escaped the browser's own notion of "outside".
 *
 * So a catch-all now ends here instead. Two steps, in order:
 *
 *   1. `serveIdlePrinterRead` answers the reads whose honest fixture is
 *      simply "an idle machine with no history" — the ones every page asks
 *      for on mount regardless of what the spec is about.
 *   2. `refusePrinterNamespace` aborts anything else in a namespace the
 *      preview proxy would forward, records it against the spec that made
 *      it, and appends it to the run-wide ledger so it fails the run even
 *      in a spec that never calls `assertSealed()`.
 *
 * The fix for a refusal is always a mock, never a wider seal.
 */

import { test, type Route } from "@playwright/test";

import { isPrinterNamespace, recordEgress } from "./printer-egress";

/**
 * Which test is on the wire, for the ledger. Route handlers run inside the
 * test's async context so this is normally exact; it degrades to a
 * placeholder rather than throwing if one ever fires outside.
 */
export function currentSpec(): string {
  try {
    return test.info().titlePath.join(" › ");
  } catch {
    return "<outside a test>";
  }
}

/**
 * Settings' expert system panel. The payload mirrors what Moonraker
 * ACTUALLY returns — note the absence of `system_load_avg`, which Moonraker
 * does not expose and which this app used to render as "0.00 · 0.00 · 0.00"
 * from a `?? [0, 0, 0]` fallback. A fixture that invents a field the real
 * API lacks hides exactly that class of bug, so this object is shared rather
 * than restated per harness.
 */
export const IDLE_PROC_STATS: Record<string, unknown> = {
  moonraker_stats: [],
  throttled_state: { bits: 0, flags: [] },
  cpu_temp: 45.2,
  network: {},
  system_cpu_usage: { cpu: 4.2, cpu0: 4.0, cpu1: 4.4 },
  system_uptime: 3_600,
  system_memory: { total: 253_952, available: 133_120, used: 120_832 },
  websocket_connections: 1,
};

/** moonraker-timelapse's stock config, trimmed to what the app reads. */
export const IDLE_TIMELAPSE_SETTINGS: Record<string, unknown> = {
  enabled: false,
  mode: "hyperlapse",
  hyperlapse_cycle: 30,
  autorender: true,
  parkhead: false,
  output_framerate: 30,
  blockedsettings: ["snapshoturl"],
};

/**
 * The generic floor: what a Moonraker on an idle machine with no print
 * history answers.
 *
 * These are exactly the endpoints that were leaking — every page asks for
 * some of them on mount, no matter what the spec is actually about, so
 * making each fixture restate them would be duplication that drifts. A spec
 * that needs specific data still registers its own route, which Playwright
 * matches first (routes are last-registered-wins), and this floor never
 * sees the request.
 *
 * Deliberately NOT here: `/server/files/metadata` (the thumbnail branch it
 * drives is a real fixture decision, not a floor) and anything write-shaped.
 */
const IDLE_READS: Record<string, () => unknown> = {
  "/printer/info": () => ({
    hostname: "forge",
    software_version: "v0.12.0-345-g1a2b3c4",
    state: "ready",
    state_message: "Printer is ready",
  }),
  "/server/info": () => ({
    klippy_connected: true,
    klippy_state: "ready",
    moonraker_version: "v0.8.0-test",
  }),
  "/server/files/list": () => [],
  "/server/history/list": () => ({ count: 0, jobs: [] }),
  "/server/history/totals": () => ({
    job_totals: {
      total_jobs: 0,
      total_time: 0,
      total_filament_used: 0,
      longest_job: 0,
      longest_print: 0,
    },
  }),
  "/server/job_queue/status": () => ({
    queue_state: "ready",
    queued_jobs: [],
  }),
  // An empty status is the honest answer for a fixture that has not
  // declared the object: the app's own absent-field handling then decides
  // what to render, which is the behaviour worth testing.
  "/printer/objects/query": () => ({ eventtime: 0, status: {} }),
  "/machine/system_info": () => ({
    system_info: {
      distribution: { name: "Buildroot", version_id: "2023.02" },
      cpu_info: { cpu_desc: "K1 Max test fixture" },
    },
  }),
  // Only reached once `/machine/system_info` answers: the expert system
  // panel fetches them in sequence, so while system_info was leaking to a
  // 502 this endpoint was never requested at all. Sealing the first read
  // uncovered the second — a fixture gap that had been hidden behind a
  // failure, which is the whole argument for refusing rather than
  // forwarding.
  "/machine/proc_stats": () => IDLE_PROC_STATS,
  "/machine/timelapse/settings": () => ({ ...IDLE_TIMELAPSE_SETTINGS }),
};

/**
 * Answer a generic idle-machine read. Returns true when it handled the
 * route — the caller must not touch the route again.
 */
export async function serveIdlePrinterRead(
  route: Route,
  url: URL,
): Promise<boolean> {
  const method = route.request().method();
  if (method !== "GET" && method !== "HEAD") return false;
  const read = IDLE_READS[url.pathname];
  if (!read) return false;
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ result: read() }),
  });
  return true;
}

/**
 * Abort anything in a namespace the preview proxy would forward, and record
 * it. Returns true when it refused the route.
 *
 * `ledger` is the fixture's own audit array, so `assertSealed()` (or the
 * spec's equivalent) fails immediately with the offending method and path;
 * the run-wide ledger is the backstop for fixtures that have no such
 * assertion.
 */
export async function refusePrinterNamespace(
  route: Route,
  url: URL,
  ledger: string[],
): Promise<boolean> {
  if (!isPrinterNamespace(url.pathname)) return false;
  const method = route.request().method();
  ledger.push(`${method} ${url.pathname}`);
  recordEgress({
    stage: "refused-at-browser",
    method,
    pathname: url.pathname,
    spec: currentSpec(),
  });
  await route.abort("blockedbyclient");
  return true;
}

/**
 * The whole seal, for a catch-all that has no fixture of its own: serve the
 * idle-machine floor, refuse the rest. Returns true when the route is done.
 */
export async function sealPrinterNamespace(
  route: Route,
  url: URL,
  ledger: string[],
): Promise<boolean> {
  if (await serveIdlePrinterRead(route, url)) return true;
  return refusePrinterNamespace(route, url, ledger);
}
