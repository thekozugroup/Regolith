import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ThermalGaugeProps {
  label: string;
  actual: number | null | undefined;
  target: number | null | undefined;
  power: number | null | undefined;
  maxTemp?: number;
  icon?: ReactNode;
}

/**
 * Retrofuturistic segmented thermal gauge.
 *
 * Inspired by Apollo-era LED bar instruments:
 *   - Discrete trapezoidal segments along a 180° arc
 *   - Lit segments = filled value (with subtle glow)
 *   - Color tiers: cool / warm / hot / over-target
 *   - Target marker = a single bright bar across the arc
 *   - Center: monospace value, "°C" mil-spec label
 *   - Chunky outer bezel ticks at 0/25/50/75/100%
 */
export function ThermalGauge({
  label,
  actual,
  target,
  power,
  maxTemp = 280,
  icon,
}: ThermalGaugeProps) {
  const a = actual ?? 0;
  const t = target ?? 0;
  const active = t > 0;
  const reached = active && Math.abs(a - t) < 2;
  const overTarget = active && a > t + 5;

  // Geometry — semicircle anchored near bottom
  const W = 220;
  const H = 130;
  const cx = W / 2;
  const cy = 110;
  const radius = 84;
  const segmentDepth = 14; // radial thickness of each segment
  const innerRadius = radius - segmentDepth;

  // 28 trapezoidal segments across 180°
  const segCount = 28;
  const arcSpan = 180;
  const startAngle = -90; // left tip
  const segGap = 0.6; // degrees of gap between segments

  const polar = (angle: number, r: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };

  const valToFraction = (v: number) =>
    Math.max(0, Math.min(1, v / maxTemp));
  const filledSegs = Math.round(valToFraction(a) * segCount);
  const targetSeg = active ? Math.round(valToFraction(t) * segCount) : -1;

  // Color tiers (segment-level, ramps from cool → hot)
  const segColor = (i: number): string => {
    if (i >= segCount) return "var(--color-fg-muted)";
    const frac = i / segCount;
    if (overTarget && i >= filledSegs - 1) return "var(--color-warning)";
    if (reached && active) return "var(--color-success)";
    if (!active) return "var(--color-fg-muted)";
    if (frac < 0.4) return "var(--color-info)"; // cool blue
    if (frac < 0.7) return "var(--color-accent)"; // orange
    return "var(--color-warning)"; // amber/red zone
  };

  const segments = Array.from({ length: segCount }, (_, i) => {
    const a1 = startAngle + (arcSpan * i) / segCount + segGap / 2;
    const a2 = startAngle + (arcSpan * (i + 1)) / segCount - segGap / 2;
    const [x1o, y1o] = polar(a1, radius);
    const [x2o, y2o] = polar(a2, radius);
    const [x2i, y2i] = polar(a2, innerRadius);
    const [x1i, y1i] = polar(a1, innerRadius);

    const path = `
      M ${x1o.toFixed(2)} ${y1o.toFixed(2)}
      A ${radius} ${radius} 0 0 1 ${x2o.toFixed(2)} ${y2o.toFixed(2)}
      L ${x2i.toFixed(2)} ${y2i.toFixed(2)}
      A ${innerRadius} ${innerRadius} 0 0 0 ${x1i.toFixed(2)} ${y1i.toFixed(2)}
      Z
    `;
    return { path, i };
  });

  // Major ticks at 5 positions OUTSIDE the bar
  const majorAngles = [0, 25, 50, 75, 100];
  const tickElements = majorAngles.map((pct, idx) => {
    const angle = startAngle + (arcSpan * pct) / 100;
    const [x1, y1] = polar(angle, radius + 4);
    const [x2, y2] = polar(angle, radius + 11);
    return (
      <line
        key={idx}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="var(--color-border-strong)"
        strokeWidth={1.4}
      />
    );
  });

  // Min/max labels
  const [minX, minY] = polar(startAngle, radius + 18);
  const [maxX, maxY] = polar(startAngle + arcSpan, radius + 18);

  // Target marker — short radial line crossing the bar
  const targetMarker = (() => {
    if (targetSeg < 0) return null;
    const angle = startAngle + (arcSpan * targetSeg) / segCount;
    const [x1, y1] = polar(angle, innerRadius - 3);
    const [x2, y2] = polar(angle, radius + 3);
    return (
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="var(--color-fg)"
        strokeWidth={2}
      />
    );
  })();

  return (
    <div className="flex flex-col items-center group select-none">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* Outer ticks */}
        {tickElements}

        {/* Segments */}
        <g>
          {segments.map(({ path, i }) => {
            const lit = i < filledSegs;
            const color = segColor(i);
            return (
              <path
                key={i}
                d={path}
                fill={lit ? color : "var(--color-elevated)"}
                opacity={lit ? 1 : 0.45}
                style={{
                  transition: "fill 240ms ease, opacity 240ms ease",
                  filter: lit && active
                    ? `drop-shadow(0 0 2px ${color})`
                    : undefined,
                }}
              />
            );
          })}
        </g>

        {/* Target marker */}
        {targetMarker}

        {/* Mil-spec brackets at tips */}
        <g stroke="var(--color-border-strong)" strokeWidth={1} fill="none">
          {/* Left bracket */}
          {(() => {
            const [bx, by] = polar(startAngle, radius + 4);
            return (
              <path
                d={`M ${bx + 6} ${by - 4} L ${bx} ${by - 4} L ${bx} ${by + 4} L ${bx + 6} ${by + 4}`}
              />
            );
          })()}
          {(() => {
            const [bx, by] = polar(startAngle + arcSpan, radius + 4);
            return (
              <path
                d={`M ${bx - 6} ${by - 4} L ${bx} ${by - 4} L ${bx} ${by + 4} L ${bx - 6} ${by + 4}`}
              />
            );
          })()}
        </g>

        {/* Min / max numerics */}
        <text
          x={minX}
          y={minY}
          textAnchor="middle"
          className="font-mono fill-[var(--color-fg-muted)]/70"
          style={{ fontSize: 9, fontWeight: 600 }}
        >
          0
        </text>
        <text
          x={maxX}
          y={maxY}
          textAnchor="middle"
          className="font-mono fill-[var(--color-fg-muted)]/70"
          style={{ fontSize: 9, fontWeight: 600 }}
        >
          {maxTemp}
        </text>

        {/* Center value */}
        <text
          x={cx}
          y={cy - 18}
          textAnchor="middle"
          className="font-mono font-semibold fill-[var(--color-fg)]"
          style={{
            fontSize: 30,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
          }}
        >
          {a.toFixed(1)}
        </text>
        <text
          x={cx}
          y={cy + 2}
          textAnchor="middle"
          className="font-mono fill-[var(--color-fg-muted)]"
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.3em",
          }}
        >
          DEG·C
        </text>
      </svg>

      {/* Status block — mil-spec readout */}
      <div className="flex flex-col items-center gap-1 -mt-1 px-3 py-1 rounded-sm bg-[var(--color-elevated)]/40 border border-[var(--color-border)]">
        <div
          className={cn(
            "flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] font-bold",
            active ? "text-[var(--color-accent)]" : "text-[var(--color-fg-muted)]",
          )}
        >
          {icon}
          {label}
        </div>
        <div className="flex items-center gap-2 text-[9px] tabular-nums">
          <Indicator
            label="TGT"
            value={active ? `${t.toFixed(0)}°` : "OFF"}
            active={active}
          />
          <Divider />
          <Indicator
            label="PWR"
            value={power != null && power > 0 ? `${(power * 100).toFixed(0)}%` : "—"}
            active={(power ?? 0) > 0}
          />
          <Divider />
          <Indicator
            label="STA"
            value={
              overTarget
                ? "HOT"
                : reached
                  ? "OK"
                  : active
                    ? "RMP"
                    : "STBY"
            }
            active={active}
            warning={overTarget}
          />
        </div>
      </div>
    </div>
  );
}

function Indicator({
  label,
  value,
  active,
  warning,
}: {
  label: string;
  value: string;
  active?: boolean;
  warning?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[var(--color-fg-muted)]/60 font-bold tracking-[0.15em]">
        {label}
      </span>
      <span
        className={cn(
          "font-bold",
          warning && "text-[var(--color-warning)]",
          active && !warning && "text-[var(--color-accent)]",
          !active && "text-[var(--color-fg)]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <span className="text-[var(--color-fg-muted)]/30">·</span>;
}
