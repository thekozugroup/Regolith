import { describe, expect, test } from "bun:test";
import { profileFields } from "../src/profiles";
import { K1_MAX } from "../src/profiles/k1max";
import type { PrinterProfile } from "../src/profiles/types";

// WP-TT-DATA: the tell-tale data layer must subscribe to bed_mesh exactly
// once, and must NEVER subscribe a filament switch the profile does not
// declare — an unlit FILAMENT lamp on a sensorless printer would promise
// monitoring that is not happening.

describe("profileFields — tell-tale data layer", () => {
  test("bed_mesh is subscribed exactly once", () => {
    const fields = profileFields(K1_MAX);
    expect(fields.filter((f) => f === "bed_mesh")).toHaveLength(1);
  });

  test("K1 Max declares no filament sensor, so none is subscribed", () => {
    expect(K1_MAX.filamentSensors).toBeUndefined();
    const fields = profileFields(K1_MAX);
    expect(fields.some((f) => f.startsWith("filament_switch_sensor"))).toBe(false);
  });

  test("a profile that declares runout switches subscribes them", () => {
    const withSensor: PrinterProfile = {
      ...K1_MAX,
      id: "test-with-runout",
      filamentSensors: [
        { klipper: "filament_switch_sensor runout", label: "Runout" },
      ],
    };
    const fields = profileFields(withSensor);
    expect(fields).toContain("filament_switch_sensor runout");
    // Deduped like every other object class.
    expect(new Set(fields).size).toBe(fields.length);
  });

  test("the pre-existing subscription set is intact", () => {
    const fields = profileFields(K1_MAX);
    for (const required of [
      "print_stats",
      "idle_timeout",
      "toolhead",
      "virtual_sdcard",
      "fan",
      "webhooks",
      "gcode_move",
      "extruder",
      "heater_bed",
      "temperature_sensor chamber_temp",
      "temperature_sensor mcu_temp",
      "temperature_fan chamber_fan",
      "temperature_fan soc_fan",
    ]) {
      expect(fields).toContain(required);
    }
  });
});

// WP-PERF: display_status had no reader anywhere in src (progress renders
// from virtual_sdcard) and motion_report streams live position at full
// batch cadence, so it is claimed only while something renders it.
describe("profileFields — WP-PERF subscription hygiene", () => {
  test("display_status is never subscribed", () => {
    expect(profileFields(K1_MAX)).not.toContain("display_status");
    expect(profileFields(K1_MAX, { motion: true })).not.toContain("display_status");
  });

  test("motion_report is subscribed only on an explicit claim", () => {
    expect(profileFields(K1_MAX)).not.toContain("motion_report");
    expect(profileFields(K1_MAX, { motion: true })).toContain("motion_report");
  });
});
