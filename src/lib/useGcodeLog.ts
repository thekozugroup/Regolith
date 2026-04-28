import { useEffect, useState } from "react";
import { moonraker, type GcodeLine } from "./moonraker";

/**
 * Subscribe to the rolling klipper gcode response buffer.
 * Returns the latest N lines (default last 80).
 */
export function useGcodeLog(limit = 80): GcodeLine[] {
  const [lines, setLines] = useState<GcodeLine[]>(moonraker.getGcodeLog());

  useEffect(() => {
    return moonraker.onGcodeLog((all) => {
      setLines(all.slice(-limit));
    });
  }, [limit]);

  return lines;
}
