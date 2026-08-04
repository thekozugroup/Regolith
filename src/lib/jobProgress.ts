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
 *
 * ---
 *
 * CALIBRATION (WP-ETA). The floors above leave a real hole: during the first
 * few minutes — exactly when the owner is deciding whether to leave the house
 * — there is no estimate at all. The slicer DID guess a duration, and this
 * printer has a stable, measurable bias against that guess. So:
 *
 *   k = median(print_duration / metadata.estimated_time) over recent
 *       COMPLETED jobs, and calibrated remaining = k · estimate − elapsed.
 *
 * That is arithmetic over recorded history. It is not AI, it is not a model,
 * and it must never be described as either. It is also weaker evidence than
 * the job's own measured progress, so it is crossfaded OUT as the real trend
 * becomes trustworthy, and rendered in a visibly non-measured style.
 *
 * Everything about it fails closed: no history, too few usable jobs, a
 * missing or absurd slicer estimate, a factor outside the plausible band, or
 * two signals that disagree wildly, and this file reduces EXACTLY to the
 * uncalibrated behaviour above — including its `null`.
 *
 * MissionBar and MissionTimeline share this one derivation and must keep
 * doing so. MissionBar passes no options on purpose: it is an 11px
 * peripheral-glance strip with nowhere to carry the `~` prefix, the muted
 * treatment and the provenance text that mark a value as derived, and a
 * calibrated number wearing measured styling is exactly what must never
 * happen. So the bar shows `—` until the job can be measured, and the panel
 * — which has room to say where its number came from — shows the estimate.
 */

/** Below this fraction of the file, extrapolation is dominated by start-up. */
export const MIN_TRUSTED_PROGRESS = 0.02;
/** Below this many seconds of printing there is no trend to extrapolate. */
export const MIN_TRUSTED_ELAPSED = 60;
/** 30 days. A job estimate beyond this is arithmetic noise, not a long print. */
export const MAX_TRUSTED_TOTAL = 30 * 24 * 60 * 60;

/**
 * Where the crossfade ends: at this much of the file consumed, the live
 * extrapolation is trusted on its own and calibration contributes nothing.
 */
export const BLEND_COMPLETE_PROGRESS = 0.15;
/** Fewer usable completed jobs than this and a median means nothing. */
export const MIN_CALIBRATION_JOBS = 3;
/**
 * Plausible band for actual/estimated. A printer that runs 4× its slicer
 * estimate is not calibrated, it is mis-measured — reject rather than scale.
 */
export const MIN_CALIBRATION_FACTOR = 0.25;
export const MAX_CALIBRATION_FACTOR = 4;
/**
 * How far the calibrated and measured answers may diverge before the blend
 * itself is dishonest. Past this the measured value wins outright: it is the
 * one derived from THIS job.
 */
export const MAX_SIGNAL_DISAGREEMENT = 3;

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
  /**
   * True when `remaining` leans on the history calibration rather than purely
   * on this job's own measured progress. Callers MUST render a calibrated
   * value in a visibly weaker style than a measured one — never in the same
   * confident treatment (S5 hard rule 6).
   */
  calibrated: boolean;
}

/** A completed-job record, shaped as Moonraker's history API returns it. */
export interface CalibrationSample {
  status?: string;
  print_duration?: number | null;
  metadata?: { estimated_time?: number | null } | null;
}

export interface JobCalibration {
  /** median(print_duration / estimated_time) across usable completed jobs. */
  factor: number;
  /** How many jobs the median was taken over — provenance for the UI. */
  samples: number;
}

export interface JobTimingOptions {
  /** `metadata.estimated_time` for the file currently printing, seconds. */
  slicerEstimate?: number | null;
  /** Calibration derived from print history, or null when unavailable. */
  calibration?: JobCalibration | null;
}

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function isPositiveFinite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Median of a non-empty list. Median, not mean: one freak job must not move it. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * This printer's systematic bias against this slicer's estimates, or `null`
 * when history cannot support one.
 *
 * Only COMPLETED jobs count. A cancelled job's `print_duration` is the length
 * of the fragment that ran, not of the job the slicer estimated, so including
 * one would drag the factor toward zero — the classic outlier this function
 * exists to be immune to. Ratios outside the plausible band are dropped
 * outright rather than reduced by the median, which means a garbage history
 * disables the feature instead of skewing it.
 */
export function calibrationFactor(
  jobs: readonly CalibrationSample[] | null | undefined,
): JobCalibration | null {
  if (!jobs || jobs.length === 0) return null;

  const ratios: number[] = [];
  for (const job of jobs) {
    if (!job || job.status !== "completed") continue;
    const actual = job.print_duration;
    const estimate = job.metadata?.estimated_time;
    if (!isPositiveFinite(actual) || !isPositiveFinite(estimate)) continue;
    const ratio = actual / estimate;
    if (ratio < MIN_CALIBRATION_FACTOR || ratio > MAX_CALIBRATION_FACTOR) continue;
    ratios.push(ratio);
  }

  if (ratios.length < MIN_CALIBRATION_JOBS) return null;
  return { factor: median(ratios), samples: ratios.length };
}

/**
 * Crossfade weight for the MEASURED signal: 0 at the trust floor (calibration
 * carries the estimate alone), 1 from BLEND_COMPLETE_PROGRESS onward (the job
 * speaks for itself). Continuous across the floor by construction, so the
 * displayed number does not jump when live extrapolation becomes available.
 */
export function measuredWeight(progress: number): number {
  const span = BLEND_COMPLETE_PROGRESS - MIN_TRUSTED_PROGRESS;
  if (!(span > 0)) return 1;
  return Math.min(1, Math.max(0, (progress - MIN_TRUSTED_PROGRESS) / span));
}

/** Calibrated seconds remaining, or null when any input fails its sanity gate. */
function calibratedRemaining(
  elapsed: number,
  options: JobTimingOptions | undefined,
): number | null {
  const calibration = options?.calibration;
  const estimate = options?.slicerEstimate;
  if (!calibration || !isPositiveFinite(estimate)) return null;
  if (calibration.samples < MIN_CALIBRATION_JOBS) return null;
  if (
    !Number.isFinite(calibration.factor) ||
    calibration.factor < MIN_CALIBRATION_FACTOR ||
    calibration.factor > MAX_CALIBRATION_FACTOR
  ) {
    return null;
  }

  const total = calibration.factor * estimate;
  if (!Number.isFinite(total) || total > MAX_TRUSTED_TOTAL || total <= elapsed) {
    // Already past its own calibrated total: the estimate is spent. Say
    // nothing rather than count down from a number that has run out.
    return null;
  }
  return total - elapsed;
}

/**
 * Derive job timing from the job's own progress and elapsed print time,
 * optionally calibrated against print history.
 *
 * With no `options` — or with any unusable option — this is byte-for-byte the
 * original derivation, `null` included.
 *
 * @param printDuration `print_stats.print_duration`
 * @param sdProgress    `virtual_sdcard.progress`
 * @param options       slicer estimate + history calibration (both optional)
 */
export function computeJobTiming(
  printDuration: number | null | undefined,
  sdProgress: number | null | undefined,
  options?: JobTimingOptions,
): JobTiming {
  const elapsed = finiteOrZero(printDuration);
  const progress = Math.min(1, Math.max(0, finiteOrZero(sdProgress)));
  const calibrated = calibratedRemaining(elapsed, options);

  const measured = measuredRemaining(elapsed, progress);
  if (measured == null) {
    // No trustworthy trend yet. Calibration fills the gap if it can; if it
    // cannot, the honest placeholder stands exactly as it always has.
    //
    // Calibration may only fill the EARLY gap. Once the crossfade is complete
    // (measuredWeight == 1 — e.g. virtual_sdcard.progress has hit 1.0 during
    // end gcode while print_stats still says "printing"), the file's own
    // contract says calibration contributes NOTHING, so a null measured
    // answer must stay null rather than resurrect the spent calibrated total.
    const usable = measuredWeight(progress) < 1 ? calibrated : null;
    return { elapsed, progress, remaining: usable, calibrated: usable != null };
  }
  if (calibrated == null) {
    return { elapsed, progress, remaining: measured, calibrated: false };
  }

  // Two independent answers that disagree by more than MAX_SIGNAL_DISAGREEMENT
  // are not a blend, they are a contradiction. Fall back to the one measured
  // from this job rather than average a wrong number into a confident one.
  const ratio = calibrated / measured;
  if (ratio > MAX_SIGNAL_DISAGREEMENT || ratio < 1 / MAX_SIGNAL_DISAGREEMENT) {
    return { elapsed, progress, remaining: measured, calibrated: false };
  }

  const w = measuredWeight(progress);
  const blended = calibrated * (1 - w) + measured * w;
  if (!Number.isFinite(blended) || blended <= 0) {
    return { elapsed, progress, remaining: measured, calibrated: false };
  }
  return { elapsed, progress, remaining: blended, calibrated: w < 1 };
}

/** The original, uncalibrated extrapolation. Unchanged, and still the truth. */
function measuredRemaining(elapsed: number, progress: number): number | null {
  if (progress < MIN_TRUSTED_PROGRESS || elapsed < MIN_TRUSTED_ELAPSED) return null;
  const total = elapsed / progress;
  if (!Number.isFinite(total) || total > MAX_TRUSTED_TOTAL || total <= elapsed) {
    return null;
  }
  return total - elapsed;
}
