/**
 * Honest temperature dial — 240° sweep, labeled scale, tick marks, target
 * index, dominant numeric readout.
 *
 * The SVG carries GEOMETRY ONLY. Every piece of text is HTML absolutely
 * positioned over the SVG so it inherits real font metrics and stays inside
 * the 11px e2e legibility gate (SVG <text> scales with the viewBox and would
 * silently drop below the floor). Rendering below 148px is forbidden; the
 * `.dial-slot` container query in index.css swaps in the rectangular bar
 * renderer instead.
 */

const SWEEP_START = 150; // deg — SVG polar, 0° = +x, clockwise/screen-down
const SWEEP_TOTAL = 240; // deg
const TRACK_R = 74;

const polar = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
};

const arcPath = (r: number, from: number, to: number) => {
  const [x0, y0] = polar(r, from);
  const [x1, y1] = polar(r, to);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};

const angleFor = (value: number, maxTemp: number) =>
  SWEEP_START + SWEEP_TOTAL * Math.max(0, Math.min(1, value / maxTemp));

function tickLine(deg: number, rOuter: number, rInner: number) {
  const [x1, y1] = polar(rOuter, deg);
  const [x2, y2] = polar(rInner, deg);
  return { x1, y1, x2, y2 };
}

/**
 * The scale is fixed geometry — 41 ticks at 6° steps, every fifth one major —
 * so it depends on nothing the dial is handed. Built once at module load
 * rather than rebuilt on every render: two dials refreshing at the telemetry
 * cadence were allocating 41 objects and 41 more line geometries apiece, four
 * times a second, to draw marks that never move.
 */
const TICKS = Array.from({ length: 41 }, (_, i) => {
  const deg = SWEEP_START + 6 * i;
  const major = i % 5 === 0;
  return { deg, major, line: tickLine(deg, 64, major ? 56 : 60) };
});

export interface DialProps {
  actual: number | null | undefined;
  target: number;
  power: number | null | undefined;
  maxTemp: number;
}

export function Dial({ actual, target, power, maxTemp }: DialProps) {
  const hasActual = actual != null && Number.isFinite(actual);
  const value = hasActual ? actual : 0;
  const active = target > 0;
  const heating = active && value < target - 2;
  const cooling = active && value > target + 2;
  const t = Math.max(0, Math.min(1, value / maxTemp));
  const trackD = arcPath(TRACK_R, SWEEP_START, SWEEP_START + SWEEP_TOTAL);
  const valueAngle = angleFor(value, maxTemp);
  const targetAngle = angleFor(target, maxTemp);
  const showDelta = active && hasActual && Math.abs(value - target) >= 2;
  const deltaD = showDelta
    ? arcPath(TRACK_R, Math.min(valueAngle, targetAngle), Math.max(valueAngle, targetAngle))
    : null;
  const targetIndexStyle = {
    transform: `rotate(${targetAngle}deg)`,
    transformOrigin: "100px 100px",
    transition: "transform var(--dur-base) var(--ease-standard)",
  } as const;

  return (
    <div
      className="relative mx-auto w-full"
      style={{ minWidth: "var(--gauge-size-min)", maxWidth: "var(--gauge-size-pref)" }}
    >
      <svg
        aria-hidden="true"
        className="gauge-dial block h-auto w-full"
        viewBox="0 0 200 172"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Track */}
        <path d={trackD} pathLength={1000} fill="none" stroke="var(--color-gauge-track)" strokeWidth={12} strokeLinecap="butt" />
        {/* Delta band — static, no animation */}
        {deltaD && (
          <path d={deltaD} fill="none" stroke="color-mix(in oklab, var(--gauge-stroke) 22%, transparent)" strokeWidth={12} strokeLinecap="butt" />
        )}
        {/* Value arc */}
        <path
          d={trackD}
          pathLength={1000}
          fill="none"
          stroke="currentColor"
          strokeWidth={12}
          strokeLinecap="butt"
          className="phosphor-glow"
          style={{
            color: "var(--gauge-stroke)",
            strokeDasharray: `${t * 1000} 1000`,
            transition: "stroke-dasharray var(--dur-base) linear, stroke var(--dur-base) linear",
          }}
        />
        {/* Ticks — minor hidden on small dials via .dial-ticks-minor */}
        {TICKS.map(({ deg, major, line }) => (
          <line
            key={deg}
            {...line}
            className={major ? undefined : "dial-ticks-minor"}
            stroke={major ? "var(--color-gauge-tick)" : "var(--color-gauge-tick-minor)"}
            strokeWidth={major ? 2 : 1}
          />
        ))}
        {/* Target index */}
        {active && (
          <g style={targetIndexStyle}>
            <line x1={166} y1={100} x2={182} y2={100} stroke="var(--color-surface)" strokeWidth={7} />
            <line x1={166} y1={100} x2={182} y2={100} stroke="var(--color-gauge-target)" strokeWidth={4} />
          </g>
        )}
      </svg>

      {/* Primary readout — always --color-fg; the arc, lamp, and status word carry state */}
      <div className="absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap">
        <span
          className={`readout instrument-value font-semibold ${hasActual ? "" : "text-[var(--color-fg-muted)]"}`}
          style={{ fontSize: "var(--text-readout-lg)" }}
        >
          {hasActual ? value.toFixed(1) : "—"}
          <span className="text-[0.42em] tracking-normal text-[var(--color-fg-muted)]">°C</span>
        </span>
      </div>

      {/* Setpoint + power in the bottom gap — above the scale endpoints so the
          rows never collide at the 148px floor */}
      <div className="absolute left-1/2 top-[63%] -translate-x-1/2 whitespace-nowrap text-center text-[11px] leading-tight">
        <div>
          <span className="instrument-label mr-1 text-[11px]">Set</span>
          <span className="instrument-value text-[var(--color-fg-muted)]">
            {active ? `${target.toFixed(0)}°` : "—"}
          </span>
          {(heating || cooling) && (
            <span aria-hidden="true" className="ml-1 text-[var(--color-fg-muted)]">{heating ? "▲" : "▼"}</span>
          )}
        </div>
        <div>
          <span className="instrument-label mr-1 text-[11px]">Pwr</span>
          <span className="instrument-value text-[var(--color-fg-muted)]">
            {power != null ? `${Math.round(power * 100)}%` : "—"}
          </span>
        </div>
      </div>

      {/* Scale endpoints flanking the bottom gap */}
      <span className="instrument-value absolute bottom-0 left-0 text-[11px] text-[var(--color-fg-muted)]">0°</span>
      <span className="absolute bottom-0 right-0 text-right text-[11px] text-[var(--color-fg-muted)]">
        <span className="instrument-label mr-1 text-[11px]">Max</span>
        <span className="instrument-value">{maxTemp}°</span>
      </span>
    </div>
  );
}
