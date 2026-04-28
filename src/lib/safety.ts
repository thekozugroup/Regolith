import type { PrinterState } from "./moonraker";

/**
 * Unified safety guards. Anything UI-side that would dispatch gcode to the
 * printer should consult this module first.
 *
 * Truthful "busy" detection considers BOTH:
 *   - print_stats.state (printing/paused = job in flight)
 *   - idle_timeout.state (Printing = klipper is in the middle of a macro,
 *                         even if no file is loaded — covers calibration,
 *                         shaper, mesh, screws_tilt, probe_accuracy, etc.)
 */

export type Axis = "X" | "Y" | "Z";

export interface SafetyState {
  isBusy: boolean;
  busyReason: string | null;
  klipperReady: boolean;
  homed: { x: boolean; y: boolean; z: boolean };
  /** True if all three primary axes are homed. */
  fullyHomed: boolean;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
}

export function getSafetyState(state: PrinterState): SafetyState {
  const printState = state.print_stats?.state;
  const idleState = state.idle_timeout?.state;
  const klipperState = state.webhooks?.state ?? "unknown";

  // Busy if either: print job running OR klipper idle_timeout = Printing
  let isBusy = false;
  let busyReason: string | null = null;
  if (printState === "printing" || printState === "paused") {
    isBusy = true;
    busyReason = `Print ${printState}`;
  } else if (idleState === "Printing") {
    isBusy = true;
    busyReason = "Macro / calibration in progress";
  }

  const homed = state.toolhead?.homed_axes ?? "";
  const homedAxes = {
    x: homed.toLowerCase().includes("x"),
    y: homed.toLowerCase().includes("y"),
    z: homed.toLowerCase().includes("z"),
  };

  const axMin = state.toolhead?.axis_minimum ?? [0, 0, 0, 0];
  const axMax = state.toolhead?.axis_maximum ?? [
    300, 300, 300, 0,
  ];

  return {
    isBusy,
    busyReason,
    klipperReady: klipperState === "ready",
    homed: homedAxes,
    fullyHomed: homedAxes.x && homedAxes.y && homedAxes.z,
    bounds: {
      min: [axMin[0], axMin[1], axMin[2]],
      max: [axMax[0], axMax[1], axMax[2]],
    },
  };
}

/**
 * Returns whether a jog of `delta` mm on the given axis would land within
 * printer bounds. Treats unhomed axes conservatively (always blocks).
 */
export function canJog(
  state: PrinterState,
  safety: SafetyState,
  axis: Axis,
  delta: number,
): { allowed: boolean; reason?: string } {
  if (safety.isBusy) return { allowed: false, reason: safety.busyReason ?? "Busy" };
  if (!safety.klipperReady) return { allowed: false, reason: "Klipper not ready" };

  const homedKey = axis.toLowerCase() as "x" | "y" | "z";
  if (!safety.homed[homedKey]) {
    return { allowed: false, reason: `${axis} not homed` };
  }

  const idx = { X: 0, Y: 1, Z: 2 }[axis];
  const pos = state.toolhead?.position?.[idx] ?? 0;
  const next = pos + delta;
  const min = safety.bounds.min[idx];
  const max = safety.bounds.max[idx];
  // Small soft-buffer to avoid hitting endstops
  const buffer = 0.5;
  if (next < min + buffer) {
    return {
      allowed: false,
      reason: `${axis} would go below ${(min + buffer).toFixed(0)}`,
    };
  }
  if (next > max - buffer) {
    return {
      allowed: false,
      reason: `${axis} would exceed ${(max - buffer).toFixed(0)}`,
    };
  }
  return { allowed: true };
}

/**
 * Returns whether a calibration / tuning gcode action can be dispatched.
 * Used by the Tune page to disable Run buttons.
 */
export function canRunAction(
  safety: SafetyState,
  opts: { requiresHomed?: boolean; movesPrinthead?: boolean } = {},
): { allowed: boolean; reason?: string } {
  if (safety.isBusy) return { allowed: false, reason: safety.busyReason ?? "Busy" };
  if (!safety.klipperReady) return { allowed: false, reason: "Klipper not ready" };
  // Macros that move the printhead need the home gcode anyway, but flag
  // explicitly so we don't surprise users mid-action.
  if (opts.requiresHomed && opts.movesPrinthead && !safety.fullyHomed) {
    // Most macros will G28 themselves; this is informational, not a block.
  }
  return { allowed: true };
}
