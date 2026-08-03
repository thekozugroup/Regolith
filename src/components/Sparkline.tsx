import { useEffect, useMemo, useRef, useState } from "react";
import { buildSparklineGeometry } from "@/lib/sparkline";

/** Lightweight one-second rolling trend with no chart runtime. */
export function Sparkline({
  value,
  bufferSize = 60,
  color = "var(--color-accent)",
  height = 28,
}: {
  value: number | null | undefined;
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
        aria-label="Temperature trend collecting data"
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
      aria-label={`Temperature trend from ${geometry.min.toFixed(1)} to ${geometry.max.toFixed(1)} degrees Celsius`}
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
