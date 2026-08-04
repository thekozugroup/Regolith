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

/**
 * How long the feed may go quiet before the owner is told the screen has
 * stopped describing the machine — whether or not anything is hot.
 *
 * The heater rule above is deliberately tighter, because a hot machine flying
 * blind is an emergency. This one covers the merely DISHONEST case: a frozen
 * progress bar and a frozen temperature look exactly like a printer running
 * steadily, and the owner has no way to tell the difference by looking. It
 * sits above the 10s heater window so a hot machine always gets the sharper
 * message rather than both.
 */
export const STALE_LINK_MS = 20_000;

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

export interface LinkStalenessInputs {
  /** The socket still claims to be up. A dropped link has its own alert. */
  connected: boolean;
  /**
   * Whether this server has ever pushed unprompted. Without it, silence
   * proves nothing — a server that only answers requests is quiet by design.
   */
  hasServerPush: boolean;
  /** ms since anything last arrived, or null before the first byte ever. */
  ageMs: number | null;
  /** The hot-heater alert is already saying it, and says it better. */
  heatersFlyingBlind: boolean;
  staleAfterMs?: number;
}

/**
 * Whether the owner should be told the screen has stopped describing the
 * machine. Pure so the four conditions can be pinned individually — this is
 * the alert most likely to become a false alarm, and a false alarm here
 * teaches the owner to ignore the one that matters.
 */
export function isLinkStale({
  connected,
  hasServerPush,
  ageMs,
  heatersFlyingBlind,
  staleAfterMs = STALE_LINK_MS,
}: LinkStalenessInputs): boolean {
  if (!connected || !hasServerPush || heatersFlyingBlind) return false;
  return ageMs != null && ageMs >= staleAfterMs;
}
