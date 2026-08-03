/**
 * Segment-strip scale math (SD1 spec §2.2), split from SegmentGauge.tsx the
 * same way buttonStyles.ts is split from Button.tsx: the react-refresh lint
 * fence forbids non-component exports from a component module, and these
 * functions are the unit-tested contract.
 *
 * The strip is deliberately discrete: `lit = round(clamp(fraction) * N)` —
 * no fractional segment. The stepped jump is the point (a duty cycle or a
 * factor IS stepped); smoothness would be false precision.
 */

/** 20 segments = 5% resolution across the strip. */
export const SEGMENT_COUNT = 20;

/**
 * Number of lit segments for a value on a [min, max] scale. Unknown values
 * (null / NaN / infinite) and degenerate scales light nothing — an unlit
 * strip plus the HTML `—` placeholder, never a guessed bar.
 */
export function litSegments(
  value: number | null | undefined,
  min: number,
  max: number,
  count = SEGMENT_COUNT,
): number {
  if (value == null || !Number.isFinite(value) || !(max > min)) return 0;
  const fraction = (value - min) / (max - min);
  return Math.round(Math.min(1, Math.max(0, fraction)) * count);
}

/**
 * First segment index of the warn-zone cap: segments whose whole span sits
 * at or above `warnFrom` render the zone tint while unlit. `null` when the
 * instrument has no threshold (or the threshold clears the scale) — no cap
 * is drawn at all.
 */
export function zoneStartIndex(
  warnFrom: number | null | undefined,
  min: number,
  max: number,
  count = SEGMENT_COUNT,
): number | null {
  if (warnFrom == null || !Number.isFinite(warnFrom) || !(max > min)) return null;
  const fraction = (warnFrom - min) / (max - min);
  if (fraction >= 1) return null;
  return Math.max(0, Math.ceil(fraction * count));
}
