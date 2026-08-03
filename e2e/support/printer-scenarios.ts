/**
 * Live-printer state fixtures for the active-state e2e suite.
 *
 * Every field is shaped exactly as Moonraker reports it via
 * `printer.objects.subscribe`, so the app's own parsing runs unchanged.
 * Aux sensors / fans use the K1 Max profile's klipper object names so the
 * expert-mode aux grid populates.
 *
 * Sensor readings are deliberately kept under the profile's warn thresholds
 * (chamber 60°C, MCU 70°C) so HealthAlerts stays quiet and each scenario
 * isolates the layout under test.
 */

import type { MockPrinterState } from "./active-state-harness";

const BASE: MockPrinterState = {
  webhooks: { state: "ready", state_message: "Printer is ready" },
  idle_timeout: { state: "Ready" },
  print_stats: {
    state: "standby",
    filename: "",
    total_duration: 0,
    print_duration: 0,
    filament_used: 0,
    message: "",
  },
  virtual_sdcard: { progress: 0, is_active: false, file_position: 0, file_size: 0 },
  extruder: { temperature: 27.4, target: 0, power: 0, pressure_advance: 0.042 },
  heater_bed: { temperature: 25.9, target: 0, power: 0 },
  toolhead: {
    position: [128.4, 141.9, 12.6, 0],
    homed_axes: "xyz",
    print_time: 0,
    estimated_print_time: 0,
    max_velocity: 600,
    max_accel: 20_000,
    axis_minimum: [-2, -2, -10, 0],
    axis_maximum: [306.5, 306, 305, 0],
  },
  display_status: { progress: 0, message: "" },
  fan: { speed: 0 },
  gcode_move: {
    position: [128.4, 141.9, 12.6, 0],
    gcode_position: [128.4, 141.9, 12.6, 0],
    speed: 3_000,
    speed_factor: 1,
    extrude_factor: 1,
    homing_origin: [0, 0, -0.045, 0],
  },
  motion_report: {
    live_position: [128.4, 141.9, 12.6, 0],
    live_velocity: 0,
    live_extruder_velocity: 0,
  },
  "temperature_sensor chamber_temp": { temperature: 38.6 },
  "temperature_sensor mcu_temp": { temperature: 44.2 },
  "temperature_fan chamber_fan": { temperature: 38.4, target: 0, speed: 0 },
  "temperature_fan soc_fan": { temperature: 46.1, target: 50, speed: 0.6 },
};

function withState(overrides: MockPrinterState): MockPrinterState {
  return { ...BASE, ...overrides };
}

export interface PrinterScenario {
  id: string;
  /** What the owner is looking at, in their words. */
  title: string;
  state: MockPrinterState;
  camera?: "ok" | "absent";
  thumbnail?: boolean;
  experience?: "basic" | "expert";
  /** State words that must match the state, exactly as rendered. */
  words: {
    /** print_stats.state, shown on the status rail lamp and the job badge. */
    print: string;
    /** ThermalGauge status word for the hotend. */
    hotend: string;
    /** ThermalGauge status word for the bed. */
    bed: string;
  };
  /** Status-rail readouts. `—` is the honest "not applicable" placeholder. */
  rail: { progress: string; remaining: string; job: string };
}

export const SCENARIOS: PrinterScenario[] = [
  {
    id: "printing-midjob",
    title: "actively printing, mid-job, at temperature",
    thumbnail: true,
    state: withState({
      idle_timeout: { state: "Printing" },
      print_stats: {
        state: "printing",
        filename: "calibration/benchy_0.2mm_PLA_K1Max.gcode",
        total_duration: 4_120,
        print_duration: 4_021,
        filament_used: 8_432.5,
        message: "",
        info: { total_layer: 250, current_layer: 118 },
      },
      virtual_sdcard: {
        progress: 0.4732,
        is_active: true,
        file_position: 4_732_000,
        file_size: 10_000_000,
      },
      extruder: { temperature: 219.8, target: 220, power: 0.42, pressure_advance: 0.042 },
      heater_bed: { temperature: 60.1, target: 60, power: 0.28 },
      toolhead: {
        position: [96.2, 187.4, 23.6, 0],
        homed_axes: "xyz",
        print_time: 4_021,
        estimated_print_time: 8_040,
        max_velocity: 600,
        max_accel: 20_000,
        axis_minimum: [-2, -2, -10, 0],
        axis_maximum: [306.5, 306, 305, 0],
      },
      display_status: { progress: 0.4732, message: "Printing" },
      fan: { speed: 1 },
      motion_report: {
        live_position: [96.2, 187.4, 23.6, 0],
        live_velocity: 148.3,
        live_extruder_velocity: 3.1,
      },
    }),
    words: { print: "printing", hotend: "Stable", bed: "Stable" },
    rail: { progress: "47.3%", remaining: "1:06:59", job: "benchy_0.2mm_PLA_K1Max" },
  },
  {
    id: "heating",
    title: "heating up — nozzle far below a live target",
    state: withState({
      idle_timeout: { state: "Printing" },
      print_stats: {
        state: "printing",
        filename: "spool/first_layer_test.gcode",
        total_duration: 112,
        print_duration: 96,
        filament_used: 24.5,
        message: "",
        info: { total_layer: 180, current_layer: 1 },
      },
      virtual_sdcard: {
        progress: 0.006,
        is_active: true,
        file_position: 60_000,
        file_size: 10_000_000,
      },
      extruder: { temperature: 48.3, target: 220, power: 1, pressure_advance: 0.042 },
      heater_bed: { temperature: 42, target: 60, power: 1 },
      toolhead: {
        position: [150, 150, 0.2, 0],
        homed_axes: "xyz",
        print_time: 96,
        estimated_print_time: 7_200,
        max_velocity: 600,
        max_accel: 20_000,
        axis_minimum: [-2, -2, -10, 0],
        axis_maximum: [306.5, 306, 305, 0],
      },
      display_status: { progress: 0.006, message: "Heating" },
      fan: { speed: 0 },
    }),
    words: { print: "printing", hotend: "Heating", bed: "Heating" },
    rail: { progress: "0.6%", remaining: "1:58:24", job: "first_layer_test" },
  },
  {
    id: "cooling-after-job",
    title: "job complete, nozzle cooling above a lowered setpoint",
    thumbnail: true,
    state: withState({
      idle_timeout: { state: "Ready" },
      print_stats: {
        state: "complete",
        filename: "finished/lunar_lander_v4.gcode",
        total_duration: 5_480,
        print_duration: 5_412,
        filament_used: 12_004,
        message: "",
        info: { total_layer: 310, current_layer: 310 },
      },
      virtual_sdcard: {
        progress: 1,
        is_active: false,
        file_position: 10_000_000,
        file_size: 10_000_000,
      },
      // Setpoint dropped to a filament-change hold; the nozzle is still
      // coasting down through it, so the dial must show a falling delta.
      // Divergence is kept under HealthAlerts' 15°C runaway threshold so the
      // scenario isolates the cooling layout.
      extruder: { temperature: 205, target: 195, power: 0, pressure_advance: 0.042 },
      heater_bed: { temperature: 58, target: 0, power: 0 },
      display_status: { progress: 1, message: "Complete" },
    }),
    words: { print: "complete", hotend: "Above target", bed: "Standby" },
    rail: { progress: "—", remaining: "—", job: "lunar_lander_v4" },
  },
  {
    id: "at-temperature",
    title: "preheated and stable, waiting for a job",
    state: withState({
      extruder: { temperature: 220.1, target: 220, power: 0.31, pressure_advance: 0.042 },
      heater_bed: { temperature: 60, target: 60, power: 0.21 },
    }),
    words: { print: "standby", hotend: "Stable", bed: "Stable" },
    rail: { progress: "—", remaining: "—", job: "No active job" },
  },
  {
    id: "paused",
    title: "paused mid-job with heaters held",
    state: withState({
      idle_timeout: { state: "Printing" },
      print_stats: {
        state: "paused",
        filename: "prototypes/bracket_v3_hi_infill.gcode",
        total_duration: 1_860,
        print_duration: 1_800,
        filament_used: 3_120,
        message: "",
        info: { total_layer: 90, current_layer: 33 },
      },
      virtual_sdcard: {
        progress: 0.3667,
        is_active: true,
        file_position: 3_667_000,
        file_size: 10_000_000,
      },
      extruder: { temperature: 215, target: 215, power: 0.36, pressure_advance: 0.042 },
      heater_bed: { temperature: 60, target: 60, power: 0.22 },
      toolhead: {
        position: [10, 10, 26.4, 0],
        homed_axes: "xyz",
        print_time: 1_800,
        estimated_print_time: 4_900,
        max_velocity: 600,
        max_accel: 20_000,
        axis_minimum: [-2, -2, -10, 0],
        axis_maximum: [306.5, 306, 305, 0],
      },
      display_status: { progress: 0.3667, message: "Paused" },
    }),
    words: { print: "paused", hotend: "Stable", bed: "Stable" },
    rail: { progress: "36.7%", remaining: "0:51:40", job: "bracket_v3_hi_infill" },
  },
  {
    id: "cancelled",
    title: "job cancelled, heaters released",
    state: withState({
      print_stats: {
        state: "cancelled",
        filename: "aborts/warped_bracket.gcode",
        total_duration: 702,
        print_duration: 640,
        filament_used: 812,
        message: "Print cancelled by user",
        info: { total_layer: 120, current_layer: 9 },
      },
      virtual_sdcard: {
        progress: 0.072,
        is_active: false,
        file_position: 720_000,
        file_size: 10_000_000,
      },
      extruder: { temperature: 168, target: 0, power: 0, pressure_advance: 0.042 },
      heater_bed: { temperature: 55, target: 0, power: 0 },
      display_status: { progress: 0.072, message: "Cancelled" },
    }),
    words: { print: "cancelled", hotend: "Standby", bed: "Standby" },
    rail: { progress: "—", remaining: "—", job: "warped_bracket" },
  },
  {
    id: "null-layer-info",
    title: "printing a job whose slicer omitted layer info (nulls)",
    state: withState({
      idle_timeout: { state: "Printing" },
      print_stats: {
        state: "printing",
        filename: "legacy/slicer_without_layers.gcode",
        total_duration: 2_480,
        print_duration: 2_410,
        filament_used: 5_000,
        message: "",
        info: { total_layer: null, current_layer: null },
      },
      virtual_sdcard: {
        progress: 0.55,
        is_active: true,
        file_position: 5_500_000,
        file_size: 10_000_000,
      },
      extruder: { temperature: 240, target: 240, power: 0.5, pressure_advance: 0.042 },
      heater_bed: { temperature: 70, target: 70, power: 0.3 },
      toolhead: {
        position: [180, 90, 41.2, 0],
        homed_axes: "xyz",
        print_time: 2_410,
        estimated_print_time: 4_400,
        max_velocity: 600,
        max_accel: 20_000,
        axis_minimum: [-2, -2, -10, 0],
        axis_maximum: [306.5, 306, 305, 0],
      },
      display_status: { progress: 0.55, message: "Printing" },
      fan: { speed: 0.8 },
    }),
    words: { print: "printing", hotend: "Stable", bed: "Stable" },
    rail: { progress: "55.0%", remaining: "0:33:10", job: "slicer_without_layers" },
  },
  {
    id: "absent-layer-info",
    title: "printing a job with no print_stats.info object at all",
    state: withState({
      idle_timeout: { state: "Printing" },
      print_stats: {
        state: "printing",
        filename: "legacy/no_info_object.gcode",
        total_duration: 900,
        print_duration: 880,
        filament_used: 1_500,
        message: "",
      },
      virtual_sdcard: {
        progress: 0.2,
        is_active: true,
        file_position: 2_000_000,
        file_size: 10_000_000,
      },
      extruder: { temperature: 235, target: 235, power: 0.44, pressure_advance: 0.042 },
      heater_bed: { temperature: 65, target: 65, power: 0.26 },
      toolhead: {
        position: [40, 220, 8.4, 0],
        homed_axes: "xyz",
        print_time: 880,
        estimated_print_time: 4_400,
        max_velocity: 600,
        max_accel: 20_000,
        axis_minimum: [-2, -2, -10, 0],
        axis_maximum: [306.5, 306, 305, 0],
      },
      display_status: { progress: 0.2, message: "Printing" },
      fan: { speed: 0.6 },
    }),
    words: { print: "printing", hotend: "Stable", bed: "Stable" },
    rail: { progress: "20.0%", remaining: "0:58:40", job: "no_info_object" },
  },
  {
    id: "no-camera-no-chamber",
    title: "printing with the camera unplugged and no chamber sensor",
    experience: "expert",
    camera: "absent",
    state: (() => {
      const state = withState({
        idle_timeout: { state: "Printing" },
        print_stats: {
          state: "printing",
          filename: "night/gantry_spacer.gcode",
          total_duration: 3_100,
          print_duration: 3_000,
          filament_used: 6_400,
          message: "",
          info: { total_layer: 140, current_layer: 77 },
        },
        virtual_sdcard: {
          progress: 0.55,
          is_active: true,
          file_position: 5_500_000,
          file_size: 10_000_000,
        },
        extruder: { temperature: 244.6, target: 245, power: 0.48, pressure_advance: 0.042 },
        heater_bed: { temperature: 99.8, target: 100, power: 0.55 },
        toolhead: {
          position: [201.5, 64.2, 15.4, 0],
          homed_axes: "xyz",
          print_time: 3_000,
          estimated_print_time: 5_600,
          max_velocity: 600,
          max_accel: 20_000,
          axis_minimum: [-2, -2, -10, 0],
          axis_maximum: [306.5, 306, 305, 0],
        },
        display_status: { progress: 0.55, message: "Printing" },
        fan: { speed: 0.35 },
      });
      // The chamber thermistor is simply not reported by this machine.
      delete state["temperature_sensor chamber_temp"];
      delete state["temperature_fan chamber_fan"];
      return state;
    })(),
    words: { print: "printing", hotend: "Stable", bed: "Stable" },
    rail: { progress: "55.0%", remaining: "0:43:20", job: "gantry_spacer" },
  },
  {
    id: "tuning-macro",
    title: "a calibration macro is running with no print file",
    state: withState({
      idle_timeout: { state: "Printing" },
      print_stats: {
        state: "standby",
        filename: "",
        total_duration: 0,
        print_duration: 0,
        filament_used: 0,
        message: "",
      },
      extruder: { temperature: 152.4, target: 150, power: 0.18, pressure_advance: 0.042 },
      heater_bed: { temperature: 89.6, target: 90, power: 0.4 },
      toolhead: {
        position: [153.2, 148.7, 5, 0],
        homed_axes: "xyz",
        print_time: 0,
        estimated_print_time: 0,
        max_velocity: 600,
        max_accel: 20_000,
        axis_minimum: [-2, -2, -10, 0],
        axis_maximum: [306.5, 306, 305, 0],
      },
      motion_report: {
        live_position: [153.2, 148.7, 5, 0],
        live_velocity: 62.5,
        live_extruder_velocity: 0,
      },
    }),
    // 152.4 vs 150 is outside the ±2°C stable band but not above target:
    // the fourth ThermalGauge branch, "Regulating".
    words: { print: "standby", hotend: "Regulating", bed: "Stable" },
    rail: { progress: "—", remaining: "—", job: "No active job" },
  },
];

export const SCENARIOS_BY_ID = new Map(SCENARIOS.map((scenario) => [scenario.id, scenario]));

export function scenario(id: string): PrinterScenario {
  const found = SCENARIOS_BY_ID.get(id);
  if (!found) throw new Error(`Unknown printer scenario: ${id}`);
  return found;
}
