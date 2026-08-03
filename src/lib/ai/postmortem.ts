/**
 * (e) Failure post-mortem from klippy.log — manual trigger only, after a job
 * has already stopped. Never in the print-critical path by construction.
 *
 * 🚩 PRIVACY. `klippy.log` embeds the full `printer.cfg` dump, MCU serials,
 * filesystem paths and sometimes network details. So:
 *
 *   · the whole file is NEVER sent — only a bounded excerpt around the
 *     shutdown marker;
 *   · the excerpt is shown to the owner, in full, BEFORE anything is sent.
 *     That preview is not a nicety, it is this feature's core safety
 *     property, and no code path here may send without it;
 *   · nothing is ever sent automatically.
 *
 * The two exported halves are deliberately separate so the UI physically
 * cannot skip the preview: `excerptKlippyLog` produces text to show, and
 * `explainFailure` takes text the owner has already seen.
 */

import { ask } from "./gateway";

/** Lines of context kept around the shutdown marker. */
export const EXCERPT_LINES = 120;
/** Absolute ceiling on what may leave the LAN, whatever the line count. */
export const EXCERPT_MAX_CHARS = 12_000;
/** Klipper's own wording when it gives up. */
const SHUTDOWN_MARKER =
  /(Transition to shutdown state|Shutdown due to|MCU '.*' shutdown|Klipper state: Shutdown|Timer too close|Lost communication with MCU)/i;

/**
 * A bounded window of the log around the last shutdown marker, or the tail
 * of the file when no marker is present. Pure — no fetch, no egress.
 */
export function excerptKlippyLog(log: string | null | undefined): string {
  const text = (log ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return "";
  const lines = text.split("\n");

  let marker = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (SHUTDOWN_MARKER.test(lines[i]!)) {
      marker = i;
      break;
    }
  }

  // Most of the window sits BEFORE the marker: the cause is what led up to
  // the shutdown, not the teardown that followed it.
  const trailing = 20;
  const end = marker >= 0 ? Math.min(lines.length, marker + trailing) : lines.length;
  const start = Math.max(0, end - EXCERPT_LINES);
  const excerpt = lines.slice(start, end).join("\n").trim();
  return excerpt.length > EXCERPT_MAX_CHARS
    ? excerpt.slice(excerpt.length - EXCERPT_MAX_CHARS)
    : excerpt;
}

/**
 * Fetch klippy.log from Moonraker's file API. Returns `null` on any failure —
 * the button that would use it simply does not render.
 */
export async function fetchKlippyLog(): Promise<string | null> {
  try {
    const response = await fetch("/server/files/klippy.log", {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

const SYSTEM = [
  "You read Klipper logs for a home 3D printer user with a Creality K1 Max.",
  "From the excerpt, explain in at most four short sentences of plain English what went wrong and what is worth checking.",
  "Never output G-code, macro names, configuration snippets, commands, or code blocks.",
  "If the excerpt does not show a clear cause, say so plainly instead of guessing.",
].join(" ");

/**
 * Prose post-mortem for an excerpt the owner has already been shown, or
 * `null`. The caller must pass exactly the text it displayed — never a
 * larger slice, and never the whole file.
 */
export async function explainFailure(excerpt: string): Promise<string | null> {
  const text = excerpt.trim();
  if (!text) return null;
  return ask({
    feature: "postmortem",
    system: SYSTEM,
    user: `This is the end of my klippy.log after a failed print:\n\n${text.slice(-EXCERPT_MAX_CHARS)}`,
    maxTokens: 320,
  });
}
