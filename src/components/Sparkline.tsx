import { useEffect, useMemo, useRef, useState } from "react";
import { buildSparklineGeometry } from "@/lib/sparkline";

/** Lightweight one-second rolling trend with no chart runtime.
 *
 *  HONESTY: the geometry AUTO-SCALES to the buffer's own min/max — there is
 *  no axis, no endpoint and no track, so nothing here asserts a maximum the
 *  app cannot know (the pressure-advance incident class). The only rule
 *  drawn is a baseline at the bottom edge, which reads as a floor, never a
 *  ceiling. The `data-autoscale` marker is the machine-readable statement of
 *  that: a telemetry law asserts against it, so a future proportional track
 *  cannot smuggle itself in as "just another svg".
 *
 *  The quantity and unit MUST be passed: the aria-label used to be hardcoded
 *  to "Temperature … degrees Celsius", which would have announced a Z-offset
 *  in mm as a temperature. */
export function Sparkline({
  value,
  quantity,
  unit,
  bufferSize = 60,
  color = "var(--color-accent)",
  height = 28,
}: {
  value: number | null | undefined;
  /** What is being trended, e.g. "Nozzle" or "Z-Offset". */
  quantity: string;
  /** The unit, spelled out for a screen reader, e.g. "degrees Celsius". */
  unit: string;
  bufferSize?: number;
  color?: string;
  height?: number;
}) {
  const valueRef = useRef(value);
  const [values, setValues] = useState<number[]>(() =>
    typeof value === "number" && Number.isFinite(value) ? [value] : [],
  );

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    const sample = () => {
      const nextValue = valueRef.current;
      if (typeof nextValue !== "number" || !Number.isFinite(nextValue)) return;
      setValues((current) => [...current, nextValue].slice(-bufferSize));
    };
    const timer = window.setInterval(sample, 1000);
    return () => clearInterval(timer);
  }, [bufferSize]);

  const geometry = useMemo(
    () => buildSparklineGeometry(values, 100, height),
    [height, values],
  );

  if (!geometry) {
    return (
      <div
        style={{ height }}
        role="img"
        data-autoscale="true"
        aria-label={`${quantity} trend collecting data`}
        className="flex items-center justify-center text-[11px] text-[var(--color-fg-muted)]"
      >
        ──
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      role="img"
      data-autoscale="true"
      aria-label={`${quantity} trend from ${geometry.min.toFixed(1)} to ${geometry.max.toFixed(1)} ${unit}. Scaled to the samples themselves, not to any limit.`}
      className="block w-full"
      style={{ height }}
    >
      <line
        x1="2"
        y1={height - 2}
        x2="98"
        y2={height - 2}
        stroke="var(--color-border)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={geometry.points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
