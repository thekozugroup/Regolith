import { describe, expect, test } from "bun:test";
import {
  cameraRetryDelay,
  exponentialBackoff,
  isActiveWebSocketState,
  moonrakerReconnectDelay,
} from "../src/lib/retry";
import { normalizeExperienceMode } from "../src/lib/useExperienceMode";

describe("bounded recovery delays", () => {
  test("grows exponentially from a safe non-negative attempt", () => {
    expect(exponentialBackoff(-4, 1000, 30_000)).toBe(1000);
    expect(exponentialBackoff(0, 1000, 30_000)).toBe(1000);
    expect(exponentialBackoff(3, 1000, 30_000)).toBe(8000);
  });

  test("caps camera retry at 30 seconds", () => {
    expect([0, 1, 2, 3, 4, 5].map(cameraRetryDelay)).toEqual([
      1500,
      3000,
      6000,
      12_000,
      24_000,
      30_000,
    ]);
  });

  test("caps Moonraker reconnect at 30 seconds", () => {
    expect([0, 1, 2, 3, 4, 5].map(moonrakerReconnectDelay)).toEqual([
      2000,
      4000,
      8000,
      16_000,
      30_000,
      30_000,
    ]);
  });

  test("treats connecting and open sockets as active", () => {
    expect(isActiveWebSocketState(0)).toBe(true);
    expect(isActiveWebSocketState(1)).toBe(true);
    expect(isActiveWebSocketState(2)).toBe(false);
    expect(isActiveWebSocketState(3)).toBe(false);
    expect(isActiveWebSocketState(undefined)).toBe(false);
  });
});

describe("experience mode", () => {
  test("defaults missing and unknown values to Basic", () => {
    expect(normalizeExperienceMode(null)).toBe("basic");
    expect(normalizeExperienceMode("advanced")).toBe("basic");
  });

  test("preserves the explicit Expert choice", () => {
    expect(normalizeExperienceMode("expert")).toBe("expert");
  });
});
