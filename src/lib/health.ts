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
