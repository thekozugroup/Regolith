import { describe, expect, test } from "bun:test";
import {
  HOT_SURFACE_C,
  STALE_TELEMETRY_MS,
  heatersHoldHeat,
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
