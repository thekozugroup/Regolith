/**
 * GUARD 2 — a green suite must be evidence, not a vibe.
 *
 * `vite.config.ts` points the preview proxy at a discard sink so that a leak
 * FAILS instead of being quietly answered by a real printer. That made leaks
 * visible. It did not make them CAUGHT: the only thing standing between a
 * regression and a green run was a human noticing `ECONNREFUSED 127.0.0.1:9`
 * in a log. This teardown closes that gap — the run itself fails.
 *
 * It reads the ledger both halves of the guard append to:
 *
 *   - `refused-at-browser`      the harness catch-all refused an unmocked
 *                               printer-namespace request (Guard 1)
 *   - `reached-preview-server`  a request actually reached the server on a
 *                               proxied namespace (a real leak)
 *
 * and fails the run when either exceeds its explicit allowance, naming the
 * endpoints so the next person does not have to reconstruct the leak from a
 * request count.
 */

import { readFileSync } from "node:fs";

import {
  EGRESS_LOG_PATH,
  type EgressEntry,
  type EgressStage,
} from "./printer-egress";

/**
 * Requests permitted to reach the preview server on a namespace its proxy
 * would forward.
 *
 * ZERO, and it must stay zero. Every printer read the app makes is answered
 * inside the browser by a spec's own route or by the active-state harness;
 * nothing legitimately needs the server to forward a printer path. A
 * non-zero number here means some spec is relying on the sink to swallow its
 * traffic, which is the exact posture that let 519 requests reach a live
 * machine — safe only for as long as the proxy happens to point somewhere
 * harmless.
 */
const PREVIEW_EGRESS_ALLOWANCE = 0;

/**
 * Requests the harness catch-all refused because no mock claimed them.
 *
 * ZERO. These never leave the browser, so they are not dangerous — they are
 * a correctness signal: an unmocked printer read means a spec is exercising
 * the app's error path by accident rather than the state it meant to pin.
 * Kept as its own allowance so the two failure modes stay legible; raising
 * it would mean accepting that some spec renders against a fixture nobody
 * wrote.
 */
const HARNESS_REFUSAL_ALLOWANCE = 0;

const ALLOWANCES: Record<
  Exclude<EgressStage, "armed">,
  { limit: number; what: string }
> = {
  "reached-preview-server": {
    limit: PREVIEW_EGRESS_ALLOWANCE,
    what: "reached the preview server and were forwarded to the sink",
  },
  "refused-at-browser": {
    limit: HARNESS_REFUSAL_ALLOWANCE,
    what: "were refused by the harness catch-all as unmocked printer calls",
  },
};

function readLedger(): EgressEntry[] {
  let raw: string;
  try {
    raw = readFileSync(EGRESS_LOG_PATH, "utf8");
  } catch {
    throw new Error(
      `Printer-egress ledger missing at ${EGRESS_LOG_PATH}. The preview ` +
        "server's egress middleware (regolith:preview-egress-ledger in " +
        "vite.config.ts) never armed, so this run has NO evidence that it " +
        "stayed sealed. Treating that as a failure is the point: an absent " +
        "guard must never read as a clean run.",
    );
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EgressEntry);
}

/** `GET /server/history/list × 12` lines, worst offender first. */
function tally(entries: EgressEntry[]): string[] {
  const counts = new Map<string, { n: number; specs: Set<string> }>();
  for (const entry of entries) {
    const key = `${entry.method ?? "?"} ${entry.pathname ?? "?"}`;
    const bucket = counts.get(key) ?? { n: 0, specs: new Set<string>() };
    bucket.n += 1;
    if (entry.spec) bucket.specs.add(entry.spec);
    counts.set(key, bucket);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .map(([key, bucket]) => {
      const specs = [...bucket.specs].slice(0, 3).join("; ");
      const more = bucket.specs.size > 3 ? ` (+${bucket.specs.size - 3} more)` : "";
      return `    ${key} × ${bucket.n}${specs ? `\n      first seen in: ${specs}${more}` : ""}`;
    });
}

export default function assertNoPrinterEgress(): void {
  const entries = readLedger();

  const armed = entries.find((entry) => entry.stage === "armed");
  if (!armed) {
    throw new Error(
      `Printer-egress ledger at ${EGRESS_LOG_PATH} has no "armed" record. ` +
        "The preview server never installed its egress middleware, so a " +
        "count of zero proves nothing. Check regolith:preview-egress-ledger " +
        "in vite.config.ts.",
    );
  }

  // ...and armed BY THIS RUN. A ledger left behind by an earlier
  // `vite preview` carries a valid "armed" line and no leaks, which would
  // otherwise let a suite whose server-side guard failed to install report
  // a clean run off someone else's evidence.
  const runStartedAt = Date.now() - process.uptime() * 1000;
  if ((armed.at ?? 0) < runStartedAt) {
    throw new Error(
      `Printer-egress ledger at ${EGRESS_LOG_PATH} was armed at ` +
        `${new Date(armed.at ?? 0).toISOString()}, before this run started ` +
        `(${new Date(runStartedAt).toISOString()}). It is a stale file from ` +
        "an earlier preview server, so it is not evidence about this run. " +
        "Delete it and check that Playwright is starting its own webServer.",
    );
  }

  const failures: string[] = [];
  for (const [stage, { limit, what }] of Object.entries(ALLOWANCES)) {
    const hits = entries.filter((entry) => entry.stage === stage);
    if (hits.length <= limit) continue;
    failures.push(
      [
        `${hits.length} request(s) ${what} — allowance is ${limit}.`,
        ...tally(hits),
      ].join("\n"),
    );
  }

  if (failures.length > 0) {
    throw new Error(
      [
        "PRINTER EGRESS GUARD FAILED.",
        "",
        ...failures,
        "",
        "Mock the endpoint in the spec that needs specific data, or in",
        "e2e/support/active-state-harness.ts when a generic idle-machine",
        "answer will do. Do not raise the allowance to make this pass: the",
        "seal is the reason this suite may run while a print is on the bed.",
      ].join("\n"),
    );
  }
}
