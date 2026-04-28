import { useEffect, useState } from "react";
import { moonraker, type PrinterState } from "./moonraker";
import { profileFields } from "@/profiles";
import { useProfile } from "./useProfile";

export function usePrinter() {
  const profile = useProfile();
  const [state, setState] = useState<PrinterState>(moonraker.getState());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    moonraker.connect();
    const unsubState = moonraker.subscribe(profileFields(profile), setState);
    const unsubConn = moonraker.onConnect(setConnected);
    return () => {
      unsubState();
      unsubConn();
    };
  }, [profile]);

  return { state, connected, mr: moonraker, profile };
}
