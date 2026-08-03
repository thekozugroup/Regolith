/**
 * Job timing — how long is left, and when we are allowed to claim we know.
 *
 * The previous derivation reached for `toolhead.estimated_print_time`. That
 * field is NOT a job estimate: it is Klipper's own MONOTONIC print-time clock,
 * counting from when the MCU connection was established. On a printer that has
 * been powered up for a while it is simply the machine's uptime in seconds and
 * has no relationship whatsoever to the file being printed. Feeding it into
 * `remaining = est - elapsed` produced a confident, precisely-formatted number
 * that could be wrong for the entire duration of a multi-hour print.
 *
 * The only two signals Moonraker gives us that actually describe THIS job are
 * `print_stats.print_duration` (seconds of real printing so far, pause time
 * excluded) and `virtual_sdcard.progress` (fraction of the gcode file
 * consumed). Linear extrapolation from those two is the honest estimate.
 *
 * It is only honest once there is enough of the job to extrapolate FROM.
 * Early on, the run is all heat-up, homing, purge line and first layer — work
 * that consumes almost no file. At 0.6% progress the extrapolation is off by
 * hours. Below the trust floors we return `null` and the UI renders a
 * placeholder, because on a multi-hour print a wrong time is worse than no
 * time: the owner plans around it.
 */

/** Below this fraction of the file, extrapolation is dominated by start-up. */
export const MIN_TRUSTED_PROGRESS = 0.02;
/** Below this many seconds of printing there is no trend to extrapolate. */
export const MIN_TRUSTED_ELAPSED = 60;
/** 30 days. A job estimate beyond this is arithmetic noise, not a long print. */
export const MAX_TRUSTED_TOTAL = 30 * 24 * 60 * 60;

export interface JobTiming {
  /** Seconds of real printing so far. Always finite, never negative. */
  elapsed: number;
  /** File fraction consumed, clamped to 0..1. Always finite. */
  progress: number;
  /**
   * Seconds remaining, or `null` when no estimate can be trusted. `null` is a
   * first-class result: callers must render a placeholder, never coerce it.
   */
  remaining: number | null;
}

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Derive job timing from the job's own progress and elapsed print time.
 *
 * @param printDuration `print_stats.print_duration`
 * @param sdProgress    `virtual_sdcard.progress`
 */
export function computeJobTiming(
  printDuration: number | null | undefined,
  sdProgress: number | null | undefined,
): JobTiming {
  const elapsed = finiteOrZero(printDuration);
  const progress = Math.min(1, Math.max(0, finiteOrZero(sdProgress)));

  if (progress < MIN_TRUSTED_PROGRESS || elapsed < MIN_TRUSTED_ELAPSED) {
    return { elapsed, progress, remaining: null };
  }

  const total = elapsed / progress;
  if (!Number.isFinite(total) || total > MAX_TRUSTED_TOTAL || total <= elapsed) {
    return { elapsed, progress, remaining: null };
  }

  return { elapsed, progress, remaining: total - elapsed };
}
