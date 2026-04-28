/**
 * Printer profile schema.
 *
 * A profile is a portable JSON description of a printer's capabilities and
 * conventions: which Klipper objects exist for sensors and fans, what the
 * bed looks like, which Moonraker features are present, and what UI modes
 * make sense (lidar, AI detection, KAMP).
 *
 * Goal: any Klipper printer can be supported by uploading or editing a
 * profile — no code changes. The active profile drives gauge limits,
 * sensor labels, feature toggles, and macro availability.
 */

export type FanRole = "part" | "hotend" | "auxiliary" | "chamber" | "controller";

/** A temperature sensor exposed by Klipper (`temperature_sensor name`). */
export interface ProfileSensor {
  /** Klipper object id, e.g. `temperature_sensor mcu_temp`. */
  klipper: string;
  /** Display label for UI. */
  label: string;
  /** Optional warning threshold in °C. */
  warnAbove?: number;
  /** Optional critical threshold in °C. */
  criticalAbove?: number;
  /** Optional gauge max for this sensor (defaults to 100). */
  maxTemp?: number;
}

/** A fan-with-thermistor (`temperature_fan name`). */
export interface ProfileTemperatureFan {
  klipper: string;
  label: string;
  role: FanRole;
  /** Optional warning when temperature exceeds target by this much. */
  driftWarn?: number;
}

/** A heater entry (extruder, heater_bed, heater_generic). */
export interface ProfileHeater {
  klipper: string;
  label: string;
  /** Gauge max in °C. */
  maxTemp: number;
  /** Whether this heater accepts a target temp via M104/M140 etc. */
  controllable?: boolean;
}

/** A click-runnable Klipper macro surfaced as a quick-action button. */
export interface ProfileMacro {
  /** Macro name as Klipper sees it. */
  gcode: string;
  /** Display name. */
  label: string;
  /** Section grouping in the UI. */
  section: "preheat" | "filament" | "calibration" | "service" | "shortcut";
  /** Description shown in the confirm modal. */
  description?: string;
  /** Whether the macro physically moves the printhead (triggers warnings). */
  movesPrinthead?: boolean;
  /** Whether SAVE_CONFIG should follow on success. */
  saveAfter?: boolean;
}

/** Optional camera override (default uses moonraker's webcam list). */
export interface ProfileCamera {
  /** Stream URL relative to printer host. */
  streamPath: string;
  /** Snapshot URL relative to printer host. */
  snapshotPath: string;
  /** Direct port to bypass nginx proxies for MJPG (typically 8080). */
  directPort?: number;
}

/** Feature toggles a printer supports. */
export interface ProfileFeatures {
  /** KAMP installed and start-gcode aware. */
  kamp?: boolean;
  /** Timelapse plugin available. */
  timelapse?: boolean;
  /** AI / lidar bridge reachable. */
  lidarBridge?: boolean;
  /** Adaptive bed mesh available regardless of KAMP. */
  adaptiveMesh?: boolean;
}

/** Top-level profile. */
export interface PrinterProfile {
  /** Stable id, e.g. `creality-k1-max`. */
  id: string;
  /** Display name shown in the profile picker. */
  name: string;
  /** Manufacturer, model, year — purely for display. */
  manufacturer?: string;
  model?: string;
  year?: number;
  /** Bed type label (`textured PEI`, `magnetic flex`, etc.). */
  bedSurface?: string;
  /** Soft bounds — the live config also reports these; profile ones are fallback. */
  bounds?: {
    min: [number, number, number];
    max: [number, number, number];
  };
  /** Heaters (extruder + bed + heater_generic). */
  heaters: ProfileHeater[];
  /** Auxiliary read-only sensors. */
  sensors: ProfileSensor[];
  /** Temperature-controlled fans. */
  fans: ProfileTemperatureFan[];
  /** Macros to surface as quick actions. */
  macros: ProfileMacro[];
  /** Feature flags. */
  features: ProfileFeatures;
  /** Optional camera path overrides. */
  camera?: ProfileCamera;
  /** Optional notes shown in profile detail. */
  notes?: string;
  /** Schema version. */
  schema: 1;
}
