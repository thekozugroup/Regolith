import { describe, expect, test } from "bun:test";
import {
  acknowledgeLamp,
  nextLampPhase,
  homedAxes,
  readLamps,
  type LampReading,
} from "../src/lib/telltales";
import {
  RUNAWAY_CONFIRM_MS,
  detectHeaterDrift,
  isRunawayConfirmed,
} from "../src/lib/health";
import { K1_MAX } from "../src/profiles/k1max";
import type { PrinterState } from "../src/lib/moonraker";
import type { PrinterProfile } from "../src/profiles/types";

const IDLE: PrinterState = {
  webhooks: { state: "ready", state_message: "Printer is ready" },
  print_stats: { state: "standby" },
  extruder: { temperature: 27.4, target: 0, power: 0 },
  heater_bed: { temperature: 25.9, target: 0, power: 0 },
  toolhead: {
    position: [0, 0, 0, 0],
    homed_axes: "",
    print_time: 0,
    estimated_print_time: 0,
  },
  "temperature_sensor mcu_temp": { temperature: 44.2 },
  "temperature_sensor chamber_temp": { temperature: 38.6 },
  "temperature_fan chamber_fan": { temperature: 38.4, target: 0, speed: 0 },
  "temperature_fan soc_fan": { temperature: 46.1, target: 50, speed: 0.6 },
};

function lamps(overrides: Partial<PrinterState> = {}, opts?: {
  profile?: PrinterProfile;
  connected?: boolean;
  runawayConfirmed?: boolean;
}) {
  return readLamps({
    state: { ...IDLE, ...overrides },
    profile: opts?.profile ?? K1_MAX,
    connected: opts?.connected ?? true,
    runawayConfirmed: opts?.runawayConfirmed ?? false,
  });
}

function byId(list: LampReading[], id: string): LampReading {
  const lamp = list.find((entry) => entry.id === id);
  if (!lamp) throw new Error(`missing lamp ${id}`);
  return lamp;
}

describe("latch reducer", () => {
  test("momentary lamps mirror the condition", () => {
    expect(nextLampPhase("off", true, false)).toBe("on");
    expect(nextLampPhase("on", false, false)).toBe("off");
  });

  test("latching lamps hold after the condition clears", () => {
    expect(nextLampPhase("off", true, true)).toBe("on");
    expect(nextLampPhase("on", false, true)).toBe("latched");
    expect(nextLampPhase("latched", false, true)).toBe("latched");
  });

  test("no lamp is ever suppressed while its condition is true", () => {
    expect(nextLampPhase("latched", true, true)).toBe("on");
    expect(nextLampPhase("off", true, true)).toBe("on");
  });

  test("acknowledge clears a cleared condition and re-lights a live one", () => {
    expect(acknowledgeLamp(false)).toBe("off");
    expect(acknowledgeLamp(true)).toBe("on");
  });
});

describe("lamp table — K1 Max v1 set", () => {
  test("exactly the eight table lamps, severity-ordered, no FILAMENT", () => {
    expect(lamps().map((lamp) => lamp.id)).toEqual([
      "thermal-runaway",
      "heater-fault",
      "firmware",
      "link-lost",
      "fan-fault",
      "mcu-hot",
      "mesh-active",
      "homed",
    ]);
  });

  test("idle unhomed fixture lights nothing", () => {
    expect(lamps().every((lamp) => !lamp.condition)).toBe(true);
  });

  test("latch flags follow the final table", () => {
    const set = lamps();
    expect(byId(set, "thermal-runaway").latching).toBe(true);
    expect(byId(set, "heater-fault").latching).toBe(true);
    expect(byId(set, "firmware").latching).toBe(true); // latched after recovery
    expect(byId(set, "link-lost").latching).toBe(false);
    expect(byId(set, "fan-fault").latching).toBe(true);
    expect(byId(set, "mcu-hot").latching).toBe(false);
    expect(byId(set, "mesh-active").latching).toBe(false);
    expect(byId(set, "homed").latching).toBe(false);
  });

  test("FIRMWARE lights on any klippy-not-ready and carries 40 chars of message", () => {
    const long = "M".repeat(80);
    const lamp = byId(
      lamps({ webhooks: { state: "shutdown", state_message: long } }),
      "firmware",
    );
    expect(lamp.condition).toBe(true);
    expect(lamp.detail).toBe("M".repeat(40));
  });

  test("HEATER FAULT keys on klipper's heater wording, not any error", () => {
    const heater = lamps({
      webhooks: {
        state: "shutdown",
        state_message: "Heater extruder not heating at expected rate",
      },
    });
    expect(byId(heater, "heater-fault").condition).toBe(true);
    const other = lamps({
      webhooks: { state: "shutdown", state_message: "MCU 'mcu' shutdown" },
    });
    expect(byId(other, "heater-fault").condition).toBe(false);
    expect(byId(other, "firmware").condition).toBe(true);
  });

  test("LINK LOST mirrors the socket", () => {
    expect(byId(lamps({}, { connected: false }), "link-lost").condition).toBe(true);
  });

  test("FAN FAULT is the honest strain proxy", () => {
    const strained = lamps({
      "temperature_fan chamber_fan": { temperature: 55, target: 40, speed: 1 },
    });
    expect(byId(strained, "fan-fault").condition).toBe(true);
    expect(byId(strained, "fan-fault").detail).toBe("Chamber Fan");
    const headroom = lamps({
      "temperature_fan chamber_fan": { temperature: 55, target: 40, speed: 0.9 },
    });
    expect(byId(headroom, "fan-fault").condition).toBe(false);
  });

  test("MCU HOT escalates warning → error at the critical threshold", () => {
    const warm = byId(lamps({ "temperature_sensor mcu_temp": { temperature: 72 } }), "mcu-hot");
    expect(warm.condition).toBe(true);
    expect(warm.severity).toBe("warning");
    const critical = byId(lamps({ "temperature_sensor mcu_temp": { temperature: 85 } }), "mcu-hot");
    expect(critical.condition).toBe(true);
    expect(critical.severity).toBe("error");
  });

  test("MCU HOT critical carries a text channel, never the color token alone", () => {
    // No color-only state: the amber→red escalation must be readable in
    // text. Warning has no affix; critical appends CRIT + the measurement.
    const warm = byId(lamps({ "temperature_sensor mcu_temp": { temperature: 72 } }), "mcu-hot");
    expect(warm.detail).toBeUndefined();
    const critical = byId(lamps({ "temperature_sensor mcu_temp": { temperature: 85 } }), "mcu-hot");
    expect(critical.detail).toBe("CRIT 85°C");
    expect(critical.detail).toMatch(/CRIT/);
  });

  test("MESH ACTIVE needs a loaded profile name — empty string is no mesh", () => {
    expect(byId(lamps({ bed_mesh: { profile_name: "" } }), "mesh-active").condition).toBe(false);
    expect(byId(lamps({ bed_mesh: { profile_name: "adaptive" } }), "mesh-active").condition).toBe(true);
  });

  test("HOMED lights only when all three axes are homed; text carries partials", () => {
    const homedState: PrinterState = {
      ...IDLE,
      toolhead: { ...IDLE.toolhead!, homed_axes: "xyz" },
    };
    expect(
      byId(readLamps({ state: homedState, profile: K1_MAX, connected: true, runawayConfirmed: false }), "homed").condition,
    ).toBe(true);
    const partial: PrinterState = {
      ...IDLE,
      toolhead: { ...IDLE.toolhead!, homed_axes: "xy" },
    };
    expect(
      byId(readLamps({ state: partial, profile: K1_MAX, connected: true, runawayConfirmed: false }), "homed").condition,
    ).toBe(false);
    expect(homedAxes(partial)).toEqual([
      { axis: "X", homed: true },
      { axis: "Y", homed: true },
      { axis: "Z", homed: false },
    ]);
  });

  test("HOMED keeps unknown telemetry distinct from a known-unhomed claim", () => {
    // No toolhead object at all — before the first push, or a dead feed.
    // Every axis is UNKNOWN (null), never `false`: false renders as the
    // struck-through "not homed" assertion, which would be a lie here.
    const unknown: PrinterState = { ...IDLE };
    delete (unknown as Record<string, unknown>).toolhead;
    expect(homedAxes(unknown)).toEqual([
      { axis: "X", homed: null },
      { axis: "Y", homed: null },
      { axis: "Z", homed: null },
    ]);
    // The lamp itself stays unlit either way — unknown is not homed-green.
    expect(
      byId(readLamps({ state: unknown, profile: K1_MAX, connected: true, runawayConfirmed: false }), "homed").condition,
    ).toBe(false);
    // A present toolhead with an empty string is a REAL unhomed reading.
    const knownUnhomed: PrinterState = {
      ...IDLE,
      toolhead: { ...IDLE.toolhead!, homed_axes: "" },
    };
    expect(homedAxes(knownUnhomed)).toEqual([
      { axis: "X", homed: false },
      { axis: "Y", homed: false },
      { axis: "Z", homed: false },
    ]);
  });

  test("FILAMENT lamp exists only when the profile declares a sensor", () => {
    const withSensor: PrinterProfile = {
      ...K1_MAX,
      id: "test-runout",
      filamentSensors: [{ klipper: "filament_switch_sensor runout", label: "Runout" }],
    };
    const runout = lamps(
      { "filament_switch_sensor runout": { filament_detected: false, enabled: true } },
      { profile: withSensor },
    );
    const lamp = byId(runout, "filament-filament_switch_sensor runout");
    expect(lamp.condition).toBe(true);
    expect(lamp.latching).toBe(true);
    expect(lamp.severity).toBe("error");
    // Present filament: lamp exists, unlit.
    const fed = lamps(
      { "filament_switch_sensor runout": { filament_detected: true, enabled: true } },
      { profile: withSensor },
    );
    expect(byId(fed, "filament-filament_switch_sensor runout").condition).toBe(false);
  });
});

describe("one shared detector — lamp and toast can never disagree", () => {
  // The same fixture is read the way HealthAlerts reads it (detectHeaterDrift
  // + the confirm window) and the way the lamp reads it (readLamps with the
  // caller-tracked confirmation flag). Identical verdicts by construction —
  // this test locks the construction.
  const diverged: PrinterState = {
    ...IDLE,
    extruder: { temperature: 254.2, target: 220, power: 0 },
  };
  const t0 = 1_700_000_000_000;

  test("before the anti-flap window: toast quiet, lamp dark", () => {
    const issue = detectHeaterDrift(diverged.extruder, diverged.heater_bed);
    expect(issue).not.toBeNull();
    const confirmed = isRunawayConfirmed(t0, t0 + RUNAWAY_CONFIRM_MS - 1_000);
    expect(confirmed).toBe(false);
    const lamp = byId(
      readLamps({ state: diverged, profile: K1_MAX, connected: true, runawayConfirmed: confirmed }),
      "thermal-runaway",
    );
    expect(lamp.condition).toBe(false);
  });

  test("past the window: both fire, from the same drift verdict", () => {
    const issue = detectHeaterDrift(diverged.extruder, diverged.heater_bed);
    const confirmed = isRunawayConfirmed(t0, t0 + RUNAWAY_CONFIRM_MS + 1_000);
    expect(issue?.heater).toBe("Hotend");
    expect(confirmed).toBe(true);
    const lamp = byId(
      readLamps({ state: diverged, profile: K1_MAX, connected: true, runawayConfirmed: confirmed }),
      "thermal-runaway",
    );
    expect(lamp.condition).toBe(true);
    expect(lamp.detail).toContain("Hotend");
  });

  test("no drift: both quiet", () => {
    expect(detectHeaterDrift(IDLE.extruder, IDLE.heater_bed)).toBeNull();
    const lamp = byId(
      readLamps({ state: IDLE, profile: K1_MAX, connected: true, runawayConfirmed: true }),
      "thermal-runaway",
    );
    expect(lamp.condition).toBe(false);
  });
});
