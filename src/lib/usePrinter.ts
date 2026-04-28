import { useEffect, useState } from "react";
import { moonraker, type PrinterState } from "./moonraker";

const ALL_FIELDS = [
  "print_stats",
  "idle_timeout",
  "extruder",
  "heater_bed",
  "toolhead",
  "display_status",
  "virtual_sdcard",
  "fan",
  "webhooks",
  "temperature_fan chamber_fan",
  "temperature_fan soc_fan",
  "temperature_sensor mcu_temp",
  "temperature_sensor chamber_temp",
  "heater_fan hotend_fan",
];

export function usePrinter() {
  const [state, setState] = useState<PrinterState>(moonraker.getState());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    moonraker.connect();
    const unsubState = moonraker.subscribe(ALL_FIELDS, setState);
    const unsubConn = moonraker.onConnect(setConnected);
    return () => {
      unsubState();
      unsubConn();
    };
  }, []);

  return { state, connected, mr: moonraker };
}
