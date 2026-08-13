/**
 * Shared health detectors — the ONE place printer-fault verdicts are decided.
 *
 * HealthAlerts (the interrupt toasts) and TellTaleCluster (the persistent
 * lamp panel) both read these pure functions, so the two surfaces can never
 * disagree about whether a runaway, threshold breach, or link loss is
 * happening. Two divergent runaway detectors is a safety bug waiting — do
 * not fork this logic back into a component.
 *
 * Extracted verbatim from the post-watchdog-fix HealthAlerts (the timer-
 * driven evaluation that fires even when the feed is dead lives in the
 * components; the telemetry-freshness primitives stay in telemetryWatchdog).
 * These are display/alert verdicts only: nothing here may ever reach the
 * printer — Klipper's own `verify_heater` remains the actual safety net.
 */

import type { HeaterReading } from "./telemetryWatchdog";

/** Divergence beyond this many °C from an active setpoint counts as drift. */
export const RUNAWAY_DRIFT_C = 15;

/**
 * Drift must persist this long before it is called a runaway — the anti-flap
 * window HealthAlerts has always used.
 */
export const RUNAWAY_CONFIRM_MS = 15_000;

export interface HeaterDriftIssue {
  /** Display name, matching the profile's primary heater labels. */
  heater: "Hotend" | "Bed";
  /** Signed divergence (actual − target) at detection time, in °C. */
  drift: number;
}

/**
 * A heater actively holding a setpoint whose actual temperature has left the
 * ±RUNAWAY_DRIFT_C band. Extruder is checked first (same precedence the
 * shipped alert always had); heaters with target 0 never drift — a cooling
 * machine is not a runaway.
 */
export function detectHeaterDrift(
  extruder?: HeaterReading | null,
  bed?: HeaterReading | null,
): HeaterDriftIssue | null {
  if (
    extruder &&
    extruder.target > 0 &&
    Math.abs(extruder.temperature - extruder.target) > RUNAWAY_DRIFT_C
  ) {
    return { heater: "Hotend", drift: extruder.temperature - extruder.target };
  }
  if (
    bed &&
    bed.target > 0 &&
    Math.abs(bed.temperature - bed.target) > RUNAWAY_DRIFT_C
  ) {
    return { heater: "Bed", drift: bed.temperature - bed.target };
  }
  return null;
}

/** True once a drift first seen at `since` has outlived the anti-flap window. */
export function isRunawayConfirmed(since: number, now: number): boolean {
  return now - since > RUNAWAY_CONFIRM_MS;
}

export type SensorVerdict = "critical" | "warn" | null;

/**
 * Profile-threshold verdict for an auxiliary temperature sensor. Critical
 * wins over warn; missing readings never alarm (unknown is not unsafe —
 * staleness is telemetryWatchdog's job).
 */
export function sensorVerdict(
  sensor: { warnAbove?: number; criticalAbove?: number },
  temperature: number | null | undefined,
): SensorVerdict {
  if (temperature == null) return null;
  if (sensor.criticalAbove != null && temperature >= sensor.criticalAbove) {
    return "critical";
  }
  if (sensor.warnAbove != null && temperature >= sensor.warnAbove) {
    return "warn";
  }
  return null;
}

/**
 * Klipper wording for a heater-verification failure. Matches both the
 * `verify_heater` shutdown message and the "Heater X not heating at expected
 * rate" phrasing.
 */
const HEATER_FAULT_RE = /verify_heater|Heater .* not heating/i;

export function isHeaterFaultMessage(message: string | undefined): boolean {
  return message != null && HEATER_FAULT_RE.test(message);
}

/**
 * Heater-specific fault: klippy left ready with a heater-verification
 * message, or the print itself errored with one.
 */
export function heaterFaultActive(
  webhooks?: { state: string; state_message: string },
  printStats?: { state: string; message?: string },
): boolean {
  if (
    webhooks &&
    webhooks.state !== "ready" &&
    isHeaterFaultMessage(webhooks.state_message)
  ) {
    return true;
  }
  return printStats?.state === "error" && isHeaterFaultMessage(printStats.message);
}

/** Any klippy-not-ready condition (broader than the heater-specific cause). */
export function firmwareDown(webhooksState: string | undefined): boolean {
  return (
    webhooksState === "shutdown" ||
    webhooksState === "error" ||
    webhooksState === "startup"
  );
}

/* ------------------------------------------------------------------------ *
 * Host-starvation shutdown classifier (host-health guard §4).
 *
 * Klipper's scheduling/timeout shutdowns NAME THE WRONG SUBSYSTEM: a host
 * that cannot run Klipper on time surfaces as a timer fault or — worse — as
 * a probe error ("Unable to obtain 'result_deal_avgs_prtouch' response"
 * cost the owner a debugging session on a probe that was never broken; the
 * strain gauge triggered cleanly and the MCU link showed 9 retransmit bytes
 * in 11 MB). This classifier recognises those wordings so the UI can say
 * "this is usually host CPU/IO starvation, not a hardware fault".
 *
 * The regex set is deliberately NARROW. `lost communication with mcu` is
 * deliberately EXCLUDED — that one really is often a cable, and claiming
 * otherwise would trade one wrong diagnosis for another. Copy built on this
 * verdict says "usually", never "certainly", and the raw state_message
 * stays visible in the FIRMWARE lamp either way.
 * ------------------------------------------------------------------------ */

const HOST_STARVATION_PATTERNS: RegExp[] = [
  /rescheduled timer in the past/i,
  /missed scheduling of next/i,
  /timer too close/i,
  /unable to obtain '[^']*' response/i,
];

/** The probe-as-messenger wording gets its own first line in the explainer. */
const PROBE_RESPONSE_RE = /unable to obtain '[^']*' response/i;

export interface HostStarvationVerdict {
  /** Klippy is down AND the message matches a starvation wording. */
  starvation: boolean;
  /** The match was the "unable to obtain '<x>' response" probe wording. */
  probeMessenger: boolean;
  /** The single LINE that matched, trimmed, for the explainer to quote —
   *  never the whole multi-paragraph state_message. */
  matchedText: string | null;
}

/**
 * Classify a shutdown. Scans `state_message` AND the recent gcode response
 * lines — the gcode arm is not optional: the prtouch wording arrives as a
 * gcode response, not as state_message, and matching only state_message
 * would miss the exact case this feature exists for.
 */
export function classifyHostStarvationShutdown(
  webhooks: { state: string; state_message: string } | undefined,
  recentGcodeLines: readonly string[],
): HostStarvationVerdict {
  const none: HostStarvationVerdict = {
    starvation: false,
    probeMessenger: false,
    matchedText: null,
  };
  // Only a klippy that is actually down gets classified: the same wording
  // scrolling past in the console while the printer is READY is history,
  // not a fault to explain.
  if (!webhooks || !firmwareDown(webhooks.state)) return none;
  // state_message is scanned line-by-line so the explainer quotes the ONE
  // wording that matched, not Klipper's whole multi-paragraph shutdown text.
  const candidates = [
    ...(webhooks.state_message ?? "").split("\n"),
    ...recentGcodeLines.slice(-40),
  ];
  for (const text of candidates) {
    if (!text) continue;
    for (const pattern of HOST_STARVATION_PATTERNS) {
      if (pattern.test(text)) {
        return {
          starvation: true,
          probeMessenger: PROBE_RESPONSE_RE.test(text),
          matchedText: text.trim(),
        };
      }
    }
  }
  return none;
}

/** Boolean face of the classifier, per the design's signature. */
export function isHostStarvationShutdown(
  webhooks: { state: string; state_message: string } | undefined,
  recentGcodeLines: readonly string[],
): boolean {
  return classifyHostStarvationShutdown(webhooks, recentGcodeLines).starvation;
}

/**
 * Honest fan-strain proxy — Moonraker exposes no tach, so this never claims
 * a literal fan fault: "fan flat out, temperature still drifting past the
 * profile's driftWarn" is the strongest statement the data supports.
 */
export function fanStrainFault(
  fan: { temperature: number; target: number; speed: number } | undefined,
  driftWarn: number | undefined,
): boolean {
  if (!fan || driftWarn == null) return false;
  return fan.speed >= 0.95 && fan.temperature - fan.target > driftWarn;
}

/** The WebSocket link verdict — one definition for toast and lamp alike. */
export function linkLost(connected: boolean): boolean {
  return !connected;
}

/* ------------------------------------------------------------------------ *
 * Thermal slope heuristics (WP-THERM)
 *
 * WHAT THIS IS NOT: this is not thermal protection, and it must never be
 * described as protection in code or in copy. Klipper's `verify_heater` runs
 * on the MCU, keeps running when this browser tab is closed, asleep, or on
 * the far side of a dead Wi-Fi link, and it can actually shut the machine
 * down. THAT is the safety net. These rules are an early EXPLAINER: they fire
 * before `verify_heater`'s timeout expires and they say why in plain English
 * instead of dumping a firmware string. Nothing here may ever reach the
 * printer — alerts only.
 *
 * They are also deliberately, unapologetically DEAF. A false thermal warning
 * costs more than a missed one here, because the thermal channel is the one
 * the owner must still believe at 3am, and because the real protection is
 * already running underneath. So every rule below is biased to UNDER-ALARM:
 *
 *   · every precondition must hold for EVERY sample in the window, not just
 *     the newest one — a single odd reading can never trip a rule;
 *   · the confirmation windows are 45–60s, well past the 30s minimum;
 *   · the slope thresholds sit far inside the failure, not at its edge
 *     (a hotend gaining 0.10 °C/s at full power is not "slightly slow", it
 *     is broken — a healthy one climbs 20–50× faster);
 *   · a buffer that is not full, or a feed that has stopped delivering new
 *     readings, produces silence, never a verdict from stale numbers.
 *
 * The consequence is accepted on purpose: a slow real fault may go unreported
 * here and be caught by `verify_heater` instead. That is the correct trade.
 * ------------------------------------------------------------------------ */

/** One buffered heater reading. `at` is a client clock in milliseconds. */
export interface TempSample {
  at: number;
  temperature: number;
  target: number;
  power: number;
}

export type ThermalSlopeRule =
  | "stalled-heatup"
  | "uncommanded-rise"
  | "losing-heat";

export interface ThermalSlopeIssue {
  rule: ThermalSlopeRule;
  /** Display name, matching the drift detector's labels. */
  heater: "Hotend" | "Bed";
  /** Measured °C per second across the confirmation window. */
  slope: number;
  /** Visible copy — carries the live figure. */
  message: string;
  /** Screen-reader copy — STABLE text, no interpolated telemetry. */
  announcement: string;
}

/**
 * Per-heater slope limits. A bed and a hotend differ by an order of
 * magnitude: a 300W hotend climbs several °C/s, while a large bed at full
 * power manages a tenth of that. One shared threshold would either alarm on
 * every healthy bed or never notice a dead hotend.
 */
export interface HeaterSlopeLimits {
  /** At full power and well below target, a climb slower than this is stalled. */
  stalledBelow: number;
  /** With the heater commanded off, a climb faster than this is uncommanded. */
  riseAbove: number;
  /** At full power and near target, a fall steeper than this is losing heat. */
  fallBelow: number;
}

export const HOTEND_SLOPE_LIMITS: HeaterSlopeLimits = {
  stalledBelow: 0.1,
  riseAbove: 0.15,
  fallBelow: -0.2,
};

export const BED_SLOPE_LIMITS: HeaterSlopeLimits = {
  stalledBelow: 0.01,
  riseAbove: 0.05,
  fallBelow: -0.1,
};

/** Confirmation window for the two commanded-heat rules. */
export const SLOPE_CONFIRM_MS = 45_000;
/**
 * Uncommanded rise gets the longest window of the three: a heater that has
 * just switched off soaks residual block heat into its own thermistor for a
 * few seconds, which looks exactly like an uncommanded climb.
 */
export const UNCOMMANDED_CONFIRM_MS = 60_000;
/** Fewest readings a window may be judged on, whatever its time span. */
export const SLOPE_MIN_SAMPLES = 20;
/** Below this gap a heat-up is close enough to target to be finishing, not stalled. */
export const STALL_MIN_GAP_C = 10;
/** Full-power threshold: below this the heater is regulating, not struggling. */
export const FULL_POWER = 0.95;
/** Commanded-off threshold — PWM noise, not heating. */
export const OFF_POWER = 0.02;

/**
 * Least-squares °C/s across the samples, or null when there is nothing to fit
 * (fewer than two readings, or every reading at the same instant).
 * Regression rather than endpoint difference so thermistor noise on a single
 * sample cannot swing the verdict.
 */
export function temperatureSlope(
  samples: readonly TempSample[],
): number | null {
  if (samples.length < 2) return null;
  const n = samples.length;
  const t0 = samples[0]!.at;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const sample of samples) {
    const x = (sample.at - t0) / 1000;
    const y = sample.temperature;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denominator = n * sumXX - sumX * sumX;
  if (denominator <= 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  return Number.isFinite(slope) ? slope : null;
}

/** The trailing window of at least `spanMs`, or null when the buffer is short. */
function window(
  samples: readonly TempSample[],
  spanMs: number,
): readonly TempSample[] | null {
  if (samples.length < SLOPE_MIN_SAMPLES) return null;
  const newest = samples[samples.length - 1]!;
  const cutoff = newest.at - spanMs;
  const start = samples.findIndex((sample) => sample.at >= cutoff);
  if (start < 0) return null;
  const slice = samples.slice(start);
  if (slice.length < SLOPE_MIN_SAMPLES) return null;
  // The window must actually SPAN the confirmation time. A dense burst of
  // readings over three seconds is not a 45-second confirmation.
  if (newest.at - slice[0]!.at < spanMs) return null;
  return slice;
}

const formatSlope = (slope: number) =>
  `${slope >= 0 ? "+" : "−"}${Math.abs(slope).toFixed(2)} °C/s`;

/**
 * The one slope verdict for a heater, or null for silence. Rules are checked
 * most-specific first; at most one fires, because two toasts about the same
 * heater is noise, not information.
 *
 * `null` is the overwhelmingly common answer and the correct default: a
 * healthy ramp, a heater holding target, a cooling machine, a short buffer
 * and a stalled feed all return it.
 */
export function detectThermalSlope(
  heater: "Hotend" | "Bed",
  samples: readonly TempSample[],
  limits: HeaterSlopeLimits,
): ThermalSlopeIssue | null {
  const all = (
    scope: readonly TempSample[],
    predicate: (sample: TempSample) => boolean,
  ) => scope.every(predicate);

  // 1 · Uncommanded rise — heater commanded off, temperature climbing anyway.
  const offWindow = window(samples, UNCOMMANDED_CONFIRM_MS);
  if (
    offWindow &&
    all(offWindow, (s) => s.target === 0 && s.power <= OFF_POWER)
  ) {
    const slope = temperatureSlope(offWindow);
    if (slope != null && slope > limits.riseAbove) {
      return {
        rule: "uncommanded-rise",
        heater,
        slope,
        message: `${heater} is gaining heat with its heater commanded off (${formatSlope(slope)}) — check the heater output.`,
        announcement: `${heater} is gaining heat with its heater commanded off. Check the heater output.`,
      };
    }
  }

  const hotWindow = window(samples, SLOPE_CONFIRM_MS);
  if (!hotWindow) return null;

  // Both remaining rules describe a heater that is commanded hot and pinned
  // at full power for the WHOLE window. A regulating heater dips below full
  // power constantly, so this alone excludes every normally-behaving machine.
  if (!all(hotWindow, (s) => s.target > 0 && s.power >= FULL_POWER)) return null;

  const slope = temperatureSlope(hotWindow);
  if (slope == null) return null;

  // 2 · Losing heat — near the setpoint, flat out, and still falling. Checked
  // before the stall rule because falling is the more specific story. Bounded
  // above by the drift band so this stays strictly EARLIER than, and never a
  // duplicate of, the shipped ±15°C runaway alert.
  if (
    slope < limits.fallBelow &&
    all(
      hotWindow,
      (s) =>
        s.temperature <= s.target && s.temperature > s.target - RUNAWAY_DRIFT_C,
    )
  ) {
    return {
      rule: "losing-heat",
      heater,
      slope,
      message: `${heater} is at full power and still cooling (${formatSlope(slope)}) — check for a draft or a fan pointed at it.`,
      announcement: `${heater} is at full power and still cooling. Check for a draft or a fan pointed at it.`,
    };
  }

  // 3 · Stalled heat-up — flat out, far from target, and not climbing. The
  // healthy-ramp suppression IS this comparison: any heater gaining heat at
  // or above its limit says nothing at all, no matter how large the gap.
  if (
    slope < limits.stalledBelow &&
    all(hotWindow, (s) => s.target - s.temperature > STALL_MIN_GAP_C)
  ) {
    return {
      rule: "stalled-heatup",
      heater,
      slope,
      message: `${heater} is at full power but not gaining heat (${formatSlope(slope)}) — check the thermistor and heater cartridge.`,
      announcement: `${heater} is at full power but not gaining heat. Check the thermistor and heater cartridge.`,
    };
  }

  return null;
}
