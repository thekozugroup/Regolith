/**
 * Heater ring buffers for the thermal slope rules (WP-THERM).
 *
 * Sampling is DECOUPLED from the render path, the way Sparkline already does
 * it: a single 1 Hz interval reads refs, so a burst of Moonraker pushes adds
 * one reading, not five, and the slope stays a rate rather than a function of
 * how chatty the socket happened to be.
 *
 * The one subtlety worth stating: a reading is appended only when Moonraker
 * has actually delivered a NEW one. `mergeState` gives every changed klipper
 * object a fresh identity per push, so comparing identity is exactly the test
 * for "did new data arrive". Without it a dead feed would keep re-appending
 * its last known temperature with fresh timestamps, manufacturing a perfectly
 * flat line — and a flat line at full power is precisely what the stalled
 * heat-up rule looks for. A stalled feed must produce SILENCE here; staleness
 * is telemetryWatchdog's story to tell, not the thermal rules'.
 */

import { useEffect, useRef, useState } from "react";
import type { TempSample } from "./health";

/** One reading per second, matching the rate Klipper reports thermistors at. */
export const TEMP_SAMPLE_INTERVAL_MS = 1_000;
/**
 * 90 readings ≈ 90 s — comfortably longer than the 60 s uncommanded-rise
 * window, and small enough that the whole buffer is a rounding error.
 */
export const TEMP_BUFFER_SIZE = 90;

export interface HeaterReadingLive {
  temperature: number;
  target: number;
  power: number;
}

export interface TempHistory {
  hotend: TempSample[];
  bed: TempSample[];
}

const EMPTY: TempHistory = { hotend: [], bed: [] };

function toSample(
  reading: HeaterReadingLive | undefined,
  at: number,
): TempSample | null {
  if (!reading) return null;
  const { temperature, target, power } = reading;
  if (
    !Number.isFinite(temperature) ||
    !Number.isFinite(target) ||
    !Number.isFinite(power)
  ) {
    return null;
  }
  return { at, temperature, target, power };
}

/**
 * Rolling per-heater history. Returns stable empty arrays until real data
 * arrives, so a caller that mounts before the first push is handed silence
 * rather than a partial buffer.
 */
export function useTempHistory(
  extruder: HeaterReadingLive | undefined,
  bed: HeaterReadingLive | undefined,
): TempHistory {
  const extruderRef = useRef(extruder);
  const bedRef = useRef(bed);
  const lastSampled = useRef<{
    extruder: HeaterReadingLive | undefined;
    bed: HeaterReadingLive | undefined;
  }>({ extruder: undefined, bed: undefined });
  const [history, setHistory] = useState<TempHistory>(EMPTY);

  useEffect(() => {
    extruderRef.current = extruder;
    bedRef.current = bed;
  }, [extruder, bed]);

  useEffect(() => {
    const tick = () => {
      const at = Date.now();
      const nextExtruder = extruderRef.current;
      const nextBed = bedRef.current;
      const extruderIsNew = nextExtruder !== lastSampled.current.extruder;
      const bedIsNew = nextBed !== lastSampled.current.bed;
      if (!extruderIsNew && !bedIsNew) return; // feed quiet — append nothing

      const hotendSample = extruderIsNew ? toSample(nextExtruder, at) : null;
      const bedSample = bedIsNew ? toSample(nextBed, at) : null;
      lastSampled.current = { extruder: nextExtruder, bed: nextBed };
      if (!hotendSample && !bedSample) return;

      setHistory((current) => ({
        hotend: hotendSample
          ? [...current.hotend, hotendSample].slice(-TEMP_BUFFER_SIZE)
          : current.hotend,
        bed: bedSample
          ? [...current.bed, bedSample].slice(-TEMP_BUFFER_SIZE)
          : current.bed,
      }));
    };

    const timer = window.setInterval(tick, TEMP_SAMPLE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return history;
}
