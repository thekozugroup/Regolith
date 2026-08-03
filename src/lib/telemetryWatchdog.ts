/**
 * Telemetry freshness watchdog.
 *
 * The thermal-runaway alert used to re-evaluate only when WebSocket data
 * ARRIVED. The exact hazard it exists for — heaters hot, feed dead — is the
 * one case where no data arrives, so the alert could never fire. These pure
 * helpers drive HealthAlerts' timer-based re-evaluation and are unit-tested
 * directly (tests/telemetryWatchdog.test.ts).
 */

/**
 * How long the printer feed may go quiet before a hot machine is considered
 * to be flying blind. Klipper pushes status diffs several times a second
 * while healthy, so 10s of silence is far outside normal jitter while still
 * raising the alarm long before a runaway can develop.
 */
export const STALE_TELEMETRY_MS = 10_000;

/**
 * Above this surface temperature a heater still holds enough energy to
 * matter even with its target already dropped to 0.
 */
export const HOT_SURFACE_C = 50;

/** How often HealthAlerts re-evaluates without waiting for new data. */
export const WATCHDOG_TICK_MS = 1_000;

export interface HeaterReading {
  temperature: number;
  target: number;
}

/**
 * True when the LAST KNOWN heater readings imply stored thermal energy —
 * an active setpoint, or a surface still above the hot threshold.
 */
export function heatersHoldHeat(
  extruder?: HeaterReading | null,
  bed?: HeaterReading | null,
): boolean {
  const hot = (h?: HeaterReading | null) =>
    h != null && (h.target > 0 || h.temperature >= HOT_SURFACE_C);
  return hot(extruder) || hot(bed);
}

/** True once no telemetry has arrived for the stale window. */
export function isTelemetryStale(
  now: number,
  lastTelemetryAt: number,
  staleAfterMs = STALE_TELEMETRY_MS,
): boolean {
  return now - lastTelemetryAt >= staleAfterMs;
}
