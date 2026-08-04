import { describe, expect, test } from "bun:test";
import {
  HOT_SURFACE_C,
  STALE_LINK_MS,
  STALE_TELEMETRY_MS,
  heatersHoldHeat,
  isLinkStale,
  isTelemetryStale,
} from "../src/lib/telemetryWatchdog";

// Regression for the thermal watchdog blind spot: alerts only re-evaluated
// when WebSocket data arrived, so a dropped feed — the exact scenario a
// thermal alarm exists for — could leave hot heaters unmonitored forever.
// These helpers drive HealthAlerts' timer-based stale-data alert.

describe("heatersHoldHeat", () => {
  test("an active setpoint is hot, regardless of current temperature", () => {
    expect(heatersHoldHeat({ temperature: 24, target: 220 }, undefined)).toBe(true);
    expect(heatersHoldHeat(undefined, { temperature: 30, target: 60 })).toBe(true);
  });

  test("a surface still above the hot threshold is hot even at target 0", () => {
    expect(heatersHoldHeat({ temperature: 168, target: 0 }, undefined)).toBe(true);
    expect(heatersHoldHeat(undefined, { temperature: HOT_SURFACE_C, target: 0 })).toBe(true);
  });

  test("a cold idle machine is not hot", () => {
    expect(
      heatersHoldHeat({ temperature: 27.4, target: 0 }, { temperature: 25.9, target: 0 }),
    ).toBe(false);
  });

  test("no readings at all are not hot", () => {
    expect(heatersHoldHeat(null, null)).toBe(false);
    expect(heatersHoldHeat(undefined, undefined)).toBe(false);
  });
});

describe("isTelemetryStale", () => {
  const t0 = 1_700_000_000_000;

  test("fresh data is never stale", () => {
    expect(isTelemetryStale(t0 + 1_000, t0)).toBe(false);
    expect(isTelemetryStale(t0 + STALE_TELEMETRY_MS - 1, t0)).toBe(false);
  });

  test("silence past the window is stale", () => {
    expect(isTelemetryStale(t0 + STALE_TELEMETRY_MS, t0)).toBe(true);
    expect(isTelemetryStale(t0 + STALE_TELEMETRY_MS * 5, t0)).toBe(true);
  });

  test("the window is conservative — about ten seconds", () => {
    expect(STALE_TELEMETRY_MS).toBeGreaterThanOrEqual(5_000);
    expect(STALE_TELEMETRY_MS).toBeLessThanOrEqual(15_000);
  });
});

describe("isLinkStale — general telemetry age", () => {
  const fresh = {
    connected: true,
    hasServerPush: true,
    ageMs: 0,
    heatersFlyingBlind: false,
  };

  test("fires once the feed has been quiet past the window", () => {
    expect(isLinkStale({ ...fresh, ageMs: STALE_LINK_MS - 1 })).toBe(false);
    expect(isLinkStale({ ...fresh, ageMs: STALE_LINK_MS })).toBe(true);
    expect(isLinkStale({ ...fresh, ageMs: 10 * STALE_LINK_MS })).toBe(true);
  });

  test("stays silent when the link is already known to be down", () => {
    // A dropped socket has its own alert, and its own words. Two toasts
    // saying the same thing is how an owner learns to dismiss both.
    expect(isLinkStale({ ...fresh, ageMs: 60_000, connected: false })).toBe(false);
  });

  test("stays silent until the server has actually pushed something", () => {
    // The false-alarm guard: a server that only answers what it is asked is
    // quiet by design. Silence from it is not evidence of anything.
    expect(isLinkStale({ ...fresh, ageMs: 60_000, hasServerPush: false })).toBe(
      false,
    );
  });

  test("yields to the hot-heater alert rather than doubling it", () => {
    expect(
      isLinkStale({ ...fresh, ageMs: 60_000, heatersFlyingBlind: true }),
    ).toBe(false);
  });

  test("never fires before the first byte has ever arrived", () => {
    // A page still loading has an age of null, not an age of forever.
    expect(isLinkStale({ ...fresh, ageMs: null })).toBe(false);
  });

  test("sits above the hot-heater window so the sharper message wins", () => {
    expect(STALE_LINK_MS).toBeGreaterThan(STALE_TELEMETRY_MS);
  });
});
