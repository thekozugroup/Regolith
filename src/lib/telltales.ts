/**
 * Tell-tale lamp derivation + latch reducer (S2 §3).
 *
 * Pure functions only, so the lamp truth table is unit-testable without a
 * DOM. Every fault verdict comes from the SHARED detectors in
 * src/lib/health.ts — the same functions HealthAlerts reads — so the lamp
 * panel and the toast channel can never disagree.
 *
 * Latch semantics ("latched" = stays lit after the condition clears until
 * acknowledged): a condition that is TRUE always shows — no lamp is ever
 * suppressed while its condition holds. Only the transition out of "on"
 * consults the latching flag.
 */

import type { PrinterState } from "./moonraker";
import type { PrinterProfile } from "@/profiles";
import {
  detectHeaterDrift,
  fanStrainFault,
  firmwareDown,
  heaterFaultActive,
  linkLost,
  sensorVerdict,
} from "./health";

export type LampPhase = "off" | "on" | "latched";
export type LampSeverity = "error" | "warning" | "info" | "success";

export interface LampReading {
  id: string;
  /** Always-visible 11px label, uppercase like every instrument label. */
  label: string;
  severity: LampSeverity;
  /** Whether the lamp holds after its condition clears (until acknowledged). */
  latching: boolean;
  /** Live condition this evaluation tick. */
  condition: boolean;
  /** Optional sub-text captured while the condition is true (e.g. klippy's state_message). */
  detail?: string;
}

/**
 * Per-lamp phase transition. Momentary lamps mirror the condition; latching
 * lamps hold "latched" after a true→false transition until acknowledged.
 */
export function nextLampPhase(
  prev: LampPhase,
  condition: boolean,
  latching: boolean,
): LampPhase {
  if (condition) return "on";
  if (prev === "on") return latching ? "latched" : "off";
  return prev; // off stays off; latched stays latched until acknowledged
}

/** Acknowledge (press): a still-true condition re-lights; otherwise clear. */
export function acknowledgeLamp(condition: boolean): LampPhase {
  return condition ? "on" : "off";
}

export interface LampInputs {
  state: PrinterState;
  profile: PrinterProfile;
  connected: boolean;
  /**
   * Whether the shared drift detector's issue has outlived the anti-flap
   * window. Time-tracking lives with the caller (the component's watchdog
   * clock), exactly as HealthAlerts tracks it — same detector, same window.
   */
  runawayConfirmed: boolean;
}

/**
 * The v1 lamp set, severity-ordered (errors → warnings → info/status), per
 * the SD1 final table. Lamps for absent hardware are OMITTED, not rendered
 * unlit: the FILAMENT entry exists only when the profile declares a sensor
 * (the K1 Max base profile declares none), and MAINTENANCE is deferred (P2)
 * because no honest data source exists in push state.
 */
export function readLamps({
  state,
  profile,
  connected,
  runawayConfirmed,
}: LampInputs): LampReading[] {
  const lamps: LampReading[] = [];
  const webhooks = state.webhooks;

  // 1 · THERMAL RUNAWAY — shared detector + shared anti-flap window.
  const drift = detectHeaterDrift(state.extruder, state.heater_bed);
  lamps.push({
    id: "thermal-runaway",
    label: "Thermal Runaway",
    severity: "error",
    latching: true,
    condition: drift != null && runawayConfirmed,
    detail: drift ? `${drift.heater} ${drift.drift > 0 ? "+" : ""}${drift.drift.toFixed(1)}°C` : undefined,
  });

  // 2 · HEATER FAULT — klipper's own verify_heater wording.
  lamps.push({
    id: "heater-fault",
    label: "Heater Fault",
    severity: "error",
    latching: true,
    condition: heaterFaultActive(webhooks, state.print_stats),
  });

  // 3 · FIRMWARE — any klippy-not-ready. Momentary while down, latched after
  // recovery (the reducer gives exactly that: condition true keeps it "on",
  // the ready transition parks it "latched" so a mid-print restart is seen).
  const fwDown = firmwareDown(webhooks?.state);
  lamps.push({
    id: "firmware",
    label: "Firmware",
    severity: "error",
    latching: true,
    condition: fwDown,
    detail: fwDown ? webhooks?.state_message?.slice(0, 40) : undefined,
  });

  // 4 · LINK LOST — the WS open state, momentary (MissionBar words it).
  lamps.push({
    id: "link-lost",
    label: "Link Lost",
    severity: "error",
    latching: false,
    condition: linkLost(connected),
  });

  // FILAMENT — code path ships for every printer, the lamp exists only where
  // the profile declares a physical switch. Runout mid-print pauses, so the
  // cause must persist on the panel: latched.
  for (const sensor of profile.filamentSensors ?? []) {
    const live = state[sensor.klipper as `filament_switch_sensor ${string}`];
    lamps.push({
      id: `filament-${sensor.klipper}`,
      label: "Filament",
      severity: "error",
      latching: true,
      condition: live?.filament_detected === false,
      detail: sensor.label,
    });
  }

  // 5 · FAN FAULT — honest strain proxy, never a literal tach claim.
  const strained = profile.fans.find((fan) =>
    fanStrainFault(
      state[fan.klipper as `temperature_fan ${string}`],
      fan.driftWarn,
    ),
  );
  lamps.push({
    id: "fan-fault",
    label: "Fan Fault",
    severity: "warning",
    latching: true,
    condition: strained != null,
    detail: strained?.label,
  });

  // 6 · MCU HOT — profile thresholds through the shared verdict; the lamp
  // escalates warning → error at critical. Momentary (cools visibly).
  // The escalation must never ride on the amber→red token alone (no
  // color-only state): critical adds a text channel — the CRIT affix plus
  // the measured temperature — the same technique as the ACK affix.
  const mcuSensor = profile.sensors.find((sensor) => /mcu/i.test(sensor.klipper));
  const mcuTemp = mcuSensor
    ? state[mcuSensor.klipper as `temperature_sensor ${string}`]?.temperature
    : undefined;
  const mcuVerdict = mcuSensor ? sensorVerdict(mcuSensor, mcuTemp) : null;
  if (mcuSensor) {
    lamps.push({
      id: "mcu-hot",
      label: "MCU Hot",
      severity: mcuVerdict === "critical" ? "error" : "warning",
      latching: false,
      condition: mcuVerdict != null,
      detail:
        mcuVerdict === "critical"
          ? typeof mcuTemp === "number" && Number.isFinite(mcuTemp)
            ? `CRIT ${Math.round(mcuTemp)}°C`
            : "CRIT"
          : undefined,
    });
  }

  // 7 · MESH ACTIVE — a loaded mesh profile is the only proof.
  lamps.push({
    id: "mesh-active",
    label: "Mesh Active",
    severity: "info",
    latching: false,
    condition: !!state.bed_mesh?.profile_name,
  });

  // 8 · HOMED XYZ — lit green only when all three axes are homed; the label
  // renders the axes literally so text carries partial homing. Absent
  // toolhead telemetry stays UNKNOWN (dashes via homedAxes), never a
  // positive "not homed" claim.
  const homed = state.toolhead?.homed_axes ?? "";
  lamps.push({
    id: "homed",
    label: "Homed",
    severity: "success",
    latching: false,
    condition: ["x", "y", "z"].every((axis) => homed.includes(axis)),
  });

  return lamps;
}

/**
 * The axes channel for the HOMED label — text, never color alone.
 *
 * `homed` is three-valued: `true` (telemetry says homed), `false` (telemetry
 * says NOT homed), `null` (no toolhead telemetry at all — before the first
 * push, or a dead feed). Unknown must never collapse into the struck-through
 * "not homed" assertion: the same rule that renders unavailable temperatures
 * as an em dash instead of 0.0°C.
 */
export function homedAxes(
  state: PrinterState,
): { axis: string; homed: boolean | null }[] {
  const toolhead = state.toolhead;
  const homed = toolhead?.homed_axes ?? "";
  return ["x", "y", "z"].map((axis) => ({
    axis: axis.toUpperCase(),
    homed: toolhead === undefined ? null : homed.includes(axis),
  }));
}
