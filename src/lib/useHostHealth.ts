import { useEffect, useState } from "react";
import { moonraker } from "./moonraker";
import {
  LAMP_WINDOW_MS,
  PREPRINT_WINDOW_MS,
  type BufferStarvation,
  type HostFaultContext,
  type HostLoad,
} from "./hostHealth";

export interface HostHealthReading {
  /** 30 s window — the pre-print advisory's signal. */
  prePrintLoad: HostLoad;
  /** 60 s window — the HOST LOAD lamp's trigger A. */
  lampLoad: HostLoad;
  /** Motion-buffer starvation — the lamp's trigger B. */
  buffer: BufferStarvation;
  /** Frozen at the last shutdown/error transition, or null. */
  fault: HostFaultContext | null;
}

function read(): HostHealthReading {
  const now = Date.now();
  return {
    prePrintLoad: moonraker.getHostLoad(PREPRINT_WINDOW_MS, now),
    lampLoad: moonraker.getHostLoad(LAMP_WINDOW_MS, now),
    buffer: moonraker.getBufferStarvation(),
    fault: moonraker.getHostFaultContext(),
  };
}

/**
 * Live host-health snapshot, re-read whenever a proc-stat sample lands.
 *
 * The cadence is Moonraker's own ~1 Hz `notify_proc_stat_update` push —
 * traffic the socket is already carrying as its heartbeat. No polling, no
 * extra subscription, nothing added to the printer's load: the whole point
 * of this guard is host pressure, so it must never be part of it.
 */
export function useHostHealth(): HostHealthReading {
  const [reading, setReading] = useState<HostHealthReading>(read);

  useEffect(() => {
    return moonraker.onHostStats(() => setReading(read()));
  }, []);

  return reading;
}
