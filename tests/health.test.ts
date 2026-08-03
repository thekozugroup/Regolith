import { describe, expect, test } from "bun:test";
import {
  RUNAWAY_CONFIRM_MS,
  RUNAWAY_DRIFT_C,
  detectHeaterDrift,
  fanStrainFault,
  firmwareDown,
  heaterFaultActive,
  isHeaterFaultMessage,
  isRunawayConfirmed,
  linkLost,
  sensorVerdict,
} from "../src/lib/health";

// The shared detector is the single source of fault verdicts for BOTH the
// HealthAlerts toasts and the tell-tale lamp cluster. These tests pin the
// exact semantics HealthAlerts shipped with (b0f625a..ae63d93 watchdog fix)
// so the extraction cannot weaken them.

describe("detectHeaterDrift", () => {
  test("an active setpoint diverging past the band is a drift issue", () => {
    const issue = detectHeaterDrift(
      { temperature: 254.2, target: 220 },
      { temperature: 60, target: 60 },
    );
    expect(issue).toEqual({ heater: "Hotend", drift: 254.2 - 220 });
  });

  test("drift is signed — undershoot reports negative", () => {
    const issue = detectHeaterDrift({ temperature: 200, target: 220 }, null);
    expect(issue?.drift).toBeCloseTo(-20);
  });

  test("divergence at exactly the band is NOT drift (strictly greater)", () => {
    expect(
      detectHeaterDrift({ temperature: 220 + RUNAWAY_DRIFT_C, target: 220 }, null),
    ).toBeNull();
  });

  test("a heater with target 0 never drifts — cooling is not a runaway", () => {
    expect(detectHeaterDrift({ temperature: 180, target: 0 }, null)).toBeNull();
    expect(detectHeaterDrift(null, { temperature: 90, target: 0 })).toBeNull();
  });

  test("bed drift is detected, and the extruder takes precedence", () => {
    expect(
      detectHeaterDrift(null, { temperature: 82, target: 60 }),
    ).toEqual({ heater: "Bed", drift: 22 });
    expect(
      detectHeaterDrift(
        { temperature: 250, target: 220 },
        { temperature: 82, target: 60 },
      )?.heater,
    ).toBe("Hotend");
  });

  test("no readings, no verdict", () => {
    expect(detectHeaterDrift(undefined, undefined)).toBeNull();
    expect(detectHeaterDrift(null, null)).toBeNull();
  });
});

describe("isRunawayConfirmed", () => {
  const t0 = 1_700_000_000_000;

  test("drift inside the anti-flap window is not yet a runaway", () => {
    expect(isRunawayConfirmed(t0, t0 + RUNAWAY_CONFIRM_MS)).toBe(false);
  });

  test("drift outliving the window is confirmed", () => {
    expect(isRunawayConfirmed(t0, t0 + RUNAWAY_CONFIRM_MS + 1)).toBe(true);
  });
});

describe("sensorVerdict", () => {
  const mcu = { warnAbove: 70, criticalAbove: 80 };

  test("below every threshold is quiet", () => {
    expect(sensorVerdict(mcu, 44.2)).toBeNull();
  });

  test("thresholds are inclusive, and critical wins over warn", () => {
    expect(sensorVerdict(mcu, 70)).toBe("warn");
    expect(sensorVerdict(mcu, 79.9)).toBe("warn");
    expect(sensorVerdict(mcu, 80)).toBe("critical");
  });

  test("a sensor with no thresholds never alarms", () => {
    expect(sensorVerdict({}, 300)).toBeNull();
  });

  test("a missing reading never alarms (staleness is the watchdog's job)", () => {
    expect(sensorVerdict(mcu, null)).toBeNull();
    expect(sensorVerdict(mcu, undefined)).toBeNull();
  });
});

describe("heater fault wording", () => {
  test("matches klipper's verify_heater and not-heating phrasings", () => {
    expect(isHeaterFaultMessage("Heater extruder not heating at expected rate")).toBe(true);
    expect(isHeaterFaultMessage("Shutdown due to verify_heater check failure")).toBe(true);
    expect(isHeaterFaultMessage("Printer is ready")).toBe(false);
    expect(isHeaterFaultMessage(undefined)).toBe(false);
  });

  test("fires on klippy-not-ready with a heater message", () => {
    expect(
      heaterFaultActive(
        { state: "shutdown", state_message: "verify_heater extruder: heater failed" },
        { state: "standby" },
      ),
    ).toBe(true);
  });

  test("a ready klippy never reports a heater fault, whatever the message", () => {
    expect(
      heaterFaultActive(
        { state: "ready", state_message: "verify_heater noted in history" },
        { state: "standby" },
      ),
    ).toBe(false);
  });

  test("fires on an errored print with a heater message", () => {
    expect(
      heaterFaultActive(
        { state: "ready", state_message: "Printer is ready" },
        { state: "error", message: "Heater heater_bed not heating at expected rate" },
      ),
    ).toBe(true);
  });

  test("an errored print without heater wording is a firmware story instead", () => {
    expect(
      heaterFaultActive(
        { state: "ready", state_message: "Printer is ready" },
        { state: "error", message: "Move out of range" },
      ),
    ).toBe(false);
  });
});

describe("firmwareDown", () => {
  test("shutdown, error, and startup are all down", () => {
    expect(firmwareDown("shutdown")).toBe(true);
    expect(firmwareDown("error")).toBe(true);
    expect(firmwareDown("startup")).toBe(true);
  });

  test("ready (and unknown) are not down", () => {
    expect(firmwareDown("ready")).toBe(false);
    expect(firmwareDown(undefined)).toBe(false);
  });
});

describe("fanStrainFault", () => {
  test("fan flat out while drifting past driftWarn is strain", () => {
    expect(
      fanStrainFault({ temperature: 55, target: 40, speed: 1 }, 10),
    ).toBe(true);
    expect(
      fanStrainFault({ temperature: 55, target: 40, speed: 0.95 }, 10),
    ).toBe(true);
  });

  test("a fan with headroom left is never strained", () => {
    expect(
      fanStrainFault({ temperature: 55, target: 40, speed: 0.9 }, 10),
    ).toBe(false);
  });

  test("drift at or under the profile threshold is fine", () => {
    expect(
      fanStrainFault({ temperature: 50, target: 40, speed: 1 }, 10),
    ).toBe(false);
  });

  test("no reading or no threshold, no claim", () => {
    expect(fanStrainFault(undefined, 10)).toBe(false);
    expect(fanStrainFault({ temperature: 90, target: 40, speed: 1 }, undefined)).toBe(false);
  });
});

describe("linkLost", () => {
  test("mirrors the WebSocket open state", () => {
    expect(linkLost(false)).toBe(true);
    expect(linkLost(true)).toBe(false);
  });
});
