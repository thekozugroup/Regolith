import type { PrinterProfile } from "./types";

/**
 * Creality K1 Max — base profile.
 *
 * Klipper objects derived from a live `printer.objects.list` query against
 * a stock K1 Max running Helper-Script + KAMP. Heaters, sensors, and fans
 * are named exactly as klipper exposes them so the moonraker subscription
 * picks them up directly.
 */
export const K1_MAX: PrinterProfile = {
  schema: 1,
  id: "creality-k1-max",
  name: "K1 Max",
  manufacturer: "Creality",
  model: "K1 Max",
  year: 2023,
  bedSurface: "PEI flex plate",
  bounds: {
    min: [-2, -2, -10],
    max: [306.5, 306, 305],
  },
  heaters: [
    { klipper: "extruder", label: "Hotend", maxTemp: 300, controllable: true },
    { klipper: "heater_bed", label: "Bed", maxTemp: 120, controllable: true },
  ],
  sensors: [
    {
      klipper: "temperature_sensor chamber_temp",
      label: "Chamber",
      maxTemp: 80,
      warnAbove: 60,
    },
    {
      klipper: "temperature_sensor mcu_temp",
      label: "MCU",
      maxTemp: 90,
      warnAbove: 70,
      criticalAbove: 80,
    },
  ],
  fans: [
    {
      klipper: "temperature_fan chamber_fan",
      label: "Chamber Fan",
      role: "chamber",
      driftWarn: 10,
    },
    {
      klipper: "temperature_fan soc_fan",
      label: "SoC Fan",
      role: "controller",
      driftWarn: 10,
    },
  ],
  macros: [
    {
      gcode: "PREHEAT_PLA",
      label: "Preheat PLA",
      section: "preheat",
      description: "Hotend 200°C, bed 60°C",
    },
    {
      gcode: "PREHEAT_PETG",
      label: "Preheat PETG",
      section: "preheat",
      description: "Hotend 240°C, bed 70°C",
    },
    {
      gcode: "PREHEAT_ABS",
      label: "Preheat ABS",
      section: "preheat",
      description: "Hotend 245°C, bed 100°C, chamber 50°C",
    },
    {
      gcode: "COOLDOWN",
      label: "Cooldown",
      section: "preheat",
      description: "Set all heaters to 0",
    },
    {
      gcode: "LOAD_FILAMENT",
      label: "Load Filament",
      section: "filament",
      description: "Heat to 220°C, extrude 100mm",
      movesPrinthead: true,
    },
    {
      gcode: "UNLOAD_FILAMENT",
      label: "Unload Filament",
      section: "filament",
      description: "Heat to 220°C, retract 100mm",
      movesPrinthead: true,
    },
    {
      gcode: "G28\nSCREWS_TILT_CALCULATE",
      label: "Bed Screws Tilt",
      section: "calibration",
      description: "Probe corners, get screw adjustment instructions",
      movesPrinthead: true,
    },
    {
      gcode: "G28\nSHAPER_CALIBRATE",
      label: "Input Shaper Auto",
      section: "calibration",
      description: "Auto-calibrate X+Y resonance via accelerometer",
      movesPrinthead: true,
      saveAfter: true,
    },
    {
      gcode: "G28\nBED_MESH_CALIBRATE PROFILE=default ADAPTIVE=1",
      label: "Adaptive Bed Mesh",
      section: "calibration",
      description: "KAMP-driven mesh of just the print area",
      movesPrinthead: true,
      saveAfter: true,
    },
    {
      gcode: "M84",
      label: "Disable Steppers",
      section: "service",
      description: "Releases all steppers; position will be lost",
    },
    {
      gcode: "FIRMWARE_RESTART",
      label: "Firmware Restart",
      section: "service",
      description: "Restart klipper firmware (no save)",
    },
  ],
  features: {
    kamp: true,
    timelapse: true,
    // Bridge present in stock firmware but disabled when Creality web is
    // removed. Watchdog UI handles the missing-port-9999 case gracefully.
    lidarBridge: false,
    adaptiveMesh: true,
  },
  camera: {
    streamPath: "/webcam/?action=stream",
    snapshotPath: "/webcam/?action=snapshot",
    directPort: 8080,
  },
  notes:
    "K1 Max ships with built-in CR-Touch + ADXL345 + AI lidar. Bed-leveling screws are manual.",
};
