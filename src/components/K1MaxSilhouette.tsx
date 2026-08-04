/**
 * K1 Max silhouette — original line art in the cluster's design language:
 * geometric, honest, neutral strokes. Zero skeuomorphism, zero fills, zero
 * gradients, no photo, and NO SVG <text> (the gauge law: all text is HTML).
 *
 * Drawn on a 4px construction grid inside a 96x96 viewBox, ≤12 primitives.
 * Every stroke carries `vector-effect: non-scaling-stroke` so line weight is
 * constant at every module size — drawn weight, not scaled weight.
 *
 * The drawing is DECORATIVE (`aria-hidden` on the whole svg); adjacent HTML
 * text is the accessible truth. Accent is a live-state cue only:
 *   - carriage + nozzle go accent while printing/paused (paused at 60% —
 *     never the sole channel; the status word says paused),
 *   - the three chamber-light rays render ONLY when the LED reads ON
 *     (unknown draws nothing — never a false claim),
 *   - no error/red ever appears on the drawing; the lamp + word carry fault.
 */
export function K1MaxSilhouette({
  printing = false,
  paused = false,
  lightOn = false,
  className,
}: {
  printing?: boolean;
  paused?: boolean;
  lightOn?: boolean;
  className?: string;
}) {
  const active = printing || paused;
  return (
    <svg
      viewBox="0 0 96 96"
      aria-hidden="true"
      className={className ? `k1-silhouette ${className}` : "k1-silhouette"}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Body — the enclosed CoreXY cube. Corner radius 2 echoes
          --radius-control optically (authored in the path, not derived:
          silhouette corners are drawn, per the spec). */}
      <rect x="10" y="8" width="76" height="76" rx="2" vectorEffect="non-scaling-stroke" />
      {/* Feet */}
      <rect x="14" y="84" width="8" height="3" vectorEffect="non-scaling-stroke" />
      <rect x="74" y="84" width="8" height="3" vectorEffect="non-scaling-stroke" />
      {/* Top gantry rule across the interior */}
      <path d="M10 20H86" vectorEffect="non-scaling-stroke" />
      {/* Carriage + nozzle — the toolhead; accent while a job runs */}
      <g data-accent={active || undefined} data-paused={paused || undefined}>
        <rect x="44" y="17.5" width="8" height="5" vectorEffect="non-scaling-stroke" />
        <path d="M48 22.5v4" vectorEffect="non-scaling-stroke" />
      </g>
      {/* Front door + handle */}
      <rect x="18" y="28" width="48" height="52" rx="2" vectorEffect="non-scaling-stroke" />
      <rect x="62.5" y="50" width="1.5" height="8" vectorEffect="non-scaling-stroke" />
      {/* Screen — the small display, bottom-right, as on the machine */}
      <rect x="70" y="62" width="12" height="16" rx="2" vectorEffect="non-scaling-stroke" />
      {/* Chamber-light glyph: three short 45° rays under the top interior
          edge, left of the gantry — rendered ONLY when the LED reads ON. */}
      {lightOn && (
        <g data-accent="true">
          <path d="M18 23l4 4" vectorEffect="non-scaling-stroke" />
          <path d="M26 23l4 4" vectorEffect="non-scaling-stroke" />
          <path d="M34 23l4 4" vectorEffect="non-scaling-stroke" />
        </g>
      )}
    </svg>
  );
}
