import { useEffect, useState } from "react";
import { moonraker } from "./moonraker";
import {
  isRecordingNow,
  type TimelapseActivity,
} from "./timelapse";

/**
 * How often the RECORDING lamp re-checks the age of the last frame.
 *
 * Frames arrive minutes apart, so this is not a render loop — it exists so
 * the lamp can go DARK on its own when frames stop, without waiting for some
 * other event to repaint the cockpit. It only runs once a frame has been
 * seen, so an idle printer schedules nothing at all.
 */
const FRESHNESS_TICK_MS = 5_000;

/**
 * Live timelapse capture state for the UI.
 *
 * `recording` is an OBSERVATION, not a setting: see `isRecordingNow`. A
 * printer whose global `enabled` flag is true but whose capture mode never
 * fires reads as not recording here, which is the truth.
 */
export function useTimelapse(): {
  activity: TimelapseActivity;
  recording: boolean;
} {
  const [activity, setActivity] = useState<TimelapseActivity>(() =>
    moonraker.getTimelapseActivity(),
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => moonraker.onTimelapseActivity(setActivity), []);

  useEffect(() => {
    if (activity.lastFrameAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), FRESHNESS_TICK_MS);
    return () => clearInterval(id);
  }, [activity.lastFrameAt]);

  return { activity, recording: isRecordingNow(activity, now) };
}
