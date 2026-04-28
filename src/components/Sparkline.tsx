import { useEffect, useRef, useState } from "react";
import { LineChart, Line, YAxis, ResponsiveContainer } from "recharts";

/**
 * Tiny rolling sparkline. Pushes new value into a fixed-length buffer.
 */
export function Sparkline({
  value,
  bufferSize = 60,
  color = "var(--color-accent)",
  height = 28,
}: {
  value: number;
  bufferSize?: number;
  color?: string;
  height?: number;
}) {
  const [data, setData] = useState<{ v: number }[]>([]);
  const lastUpdate = useRef(0);

  useEffect(() => {
    // Throttle to one push per second
    const now = Date.now();
    if (now - lastUpdate.current < 950) return;
    lastUpdate.current = now;
    setData((prev) => {
      const next = [...prev, { v: value }];
      if (next.length > bufferSize) next.shift();
      return next;
    });
  }, [value, bufferSize]);

  if (data.length < 2) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-[10px] text-[var(--color-fg-muted)]/60"
      >
        ──
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <YAxis
          domain={["dataMin - 1", "dataMax + 1"]}
          hide
        />
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
