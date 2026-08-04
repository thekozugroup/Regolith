import type { CSSProperties } from "react";
import { SEGMENT_COUNT, litSegments, zoneStartIndex } from "@/components/segmentScale";

/** Idle strips read as instrumentation, not alerts — the dial state machine's
 *  fg-muted resting color. */
const IDLE_COLOR = "var(--color-fg-muted)";

export interface SegmentGaugeProps {
  label: string;
  /** Formatted readout — the accessible truth. Callers format (and `—`) it;
   *  the strip itself never invents a number. */
  display: string;
  value: number | null | undefined;
  max: number;
  /** Scale start — 0 by default; center-index factor strips span 50–150. */
  min?: number;
  /** Unlit segments at/above this value carry the warm zone tint. */
  warnFrom?: number;
  /** Draw the --color-gauge-target index at the strip midpoint (the 100%
   *  mark of a 50–150% factor scale) — deviation reads as segments past it. */
  centerIndex?: boolean;
  /** Lit-segment color. Same state machine as the dials: active → accent,
   *  warn → warning, critical → error, idle (default) → fg-muted. */
  stateColor?: string;
  /** Optional aria-description mirroring ThermalGauge's scale prose. */
  description?: string;
}

/**
 * Segment-strip instrument (SD1 spec §2) — the third renderer alongside the
 * dial and its bar fallback, for quantities that are inherently stepped
 * (duty cycles, factor offsets, bounded temps with a warn zone). SVG carries
 * GEOMETRY ONLY — zero SVG <text>, same contract as Dial.tsx, so every glyph
 * stays HTML under the 11px gate. No filters, no floor or fallback renderer
 * needed: segments degrade gracefully at any width.
 *
 * The strip is a fixed 24px tall and stretches horizontally with its tile
 * (preserveAspectRatio="none": segments widen like SD1's, they never grow
 * into a tower on a spanning tile). Fill transitions collapse under the
 * global reduced-motion rule; forced colors keeps lit segments legible via
 * currentColor while unlit ones wash out — the HTML number remains the
 * accessible channel, the same trade already accepted for .status-lamp.
 */
export function SegmentGauge({
  label,
  display,
  value,
  max,
  min = 0,
  warnFrom,
  centerIndex,
  stateColor = IDLE_COLOR,
  description,
}: SegmentGaugeProps) {
  const known = value != null && Number.isFinite(value);
  const lit = litSegments(value, min, max);
  const zoneFrom = zoneStartIndex(warnFrom, min, max);

  return (
    <div
      role="img"
      aria-label={`${label} ${known ? display : "unavailable"}`}
      aria-description={description}
      data-lit={lit}
      className="segment-gauge flex min-h-11 min-w-0 flex-col justify-center gap-1.5"
      style={{ color: stateColor } as CSSProperties}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="instrument-label text-[11px]">{label}</span>
        <span
          className="instrument-value text-[13px] font-semibold"
          style={{ color: stateColor === IDLE_COLOR ? "var(--color-fg)" : stateColor }}
        >
          {display}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${SEGMENT_COUNT * 10} 24`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="block h-6 w-full"
      >
        {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
          <rect
            key={index}
            x={index * 10}
            y={2}
            width={7}
            height={20}
            rx={1}
            className="transition-[fill] duration-150 ease-linear"
            fill={
              index < lit
                ? "currentColor"
                : zoneFrom != null && index >= zoneFrom
                  ? "var(--color-segment-zone)"
                  : "var(--color-segment-unlit)"
            }
          />
        ))}
        {centerIndex && (
          <rect x={SEGMENT_COUNT * 5 - 1} y={0} width={2} height={24} fill="var(--color-gauge-target)" />
        )}
      </svg>
    </div>
  );
}
