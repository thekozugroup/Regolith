import { describe, expect, test } from "bun:test";
import {
  SEGMENT_COUNT,
  litSegments,
  zoneStartIndex,
} from "../src/components/segmentScale";

describe("litSegments", () => {
  test("discrete mapping: round(clamp(fraction) * N), never fractional", () => {
    expect(litSegments(0, 0, 100)).toBe(0);
    expect(litSegments(100, 0, 100)).toBe(SEGMENT_COUNT);
    expect(litSegments(50, 0, 100)).toBe(10);
    // 83% of a 20-segment strip is 16.6 — rounds to 17, no partial segment.
    expect(litSegments(83, 0, 100)).toBe(17);
    expect(Number.isInteger(litSegments(83, 0, 100))).toBe(true);
  });

  test("clamps beyond both scale ends", () => {
    expect(litSegments(140, 0, 100)).toBe(SEGMENT_COUNT);
    expect(litSegments(-20, 0, 100)).toBe(0);
  });

  test("center-index factor scale spans 50-150 with nominal at half", () => {
    // The 100% mark is the strip midpoint — deviation reads as segments
    // beyond (or short of) the center index.
    expect(litSegments(100, 50, 150)).toBe(SEGMENT_COUNT / 2);
    expect(litSegments(120, 50, 150)).toBe(14);
    expect(litSegments(95, 50, 150)).toBe(9);
    expect(litSegments(150, 50, 150)).toBe(SEGMENT_COUNT);
    // Out-of-range factors clamp; the tile's warn text carries the overflow.
    expect(litSegments(175, 50, 150)).toBe(SEGMENT_COUNT);
    expect(litSegments(25, 50, 150)).toBe(0);
  });

  test("the segmented dial rides the same quantizer at count 24", () => {
    // One law, one code path: the dial calls litSegments(v, 0, maxTemp, 24)
    // so the strip and the dial quantize identically. Fixture arithmetic the
    // e2e suite pins against the rendered DOM:
    expect(litSegments(219.8, 0, 300, 24)).toBe(18); // printing-midjob hotend
    expect(litSegments(60.1, 0, 120, 24)).toBe(12); // printing-midjob bed
    expect(litSegments(48.3, 0, 300, 24)).toBe(4); // heating hotend value
    expect(litSegments(220, 0, 300, 24)).toBe(18); // heating hotend target
    expect(litSegments(null, 0, 300, 24)).toBe(0); // unknown lights nothing
  });

  test("unknown values and degenerate scales light nothing", () => {
    expect(litSegments(null, 0, 100)).toBe(0);
    expect(litSegments(undefined, 0, 100)).toBe(0);
    expect(litSegments(Number.NaN, 0, 100)).toBe(0);
    expect(litSegments(Number.POSITIVE_INFINITY, 0, 100)).toBe(0);
    expect(litSegments(50, 100, 100)).toBe(0);
    expect(litSegments(50, 100, 0)).toBe(0);
  });
});

describe("zoneStartIndex", () => {
  test("chamber case: warn 60 on a 0-80 scale caps the last quarter", () => {
    expect(zoneStartIndex(60, 0, 80)).toBe(15);
  });

  test("only whole segments at/above the threshold join the cap", () => {
    // 57.6/80 = 0.72 → segment 14 straddles the threshold; the cap starts
    // at the first segment fully inside the zone.
    expect(zoneStartIndex(57.6, 0, 80)).toBe(15);
  });

  test("no threshold, or a threshold clearing the scale, draws no cap", () => {
    expect(zoneStartIndex(undefined, 0, 80)).toBeNull();
    expect(zoneStartIndex(null, 0, 80)).toBeNull();
    expect(zoneStartIndex(Number.NaN, 0, 80)).toBeNull();
    expect(zoneStartIndex(80, 0, 80)).toBeNull();
    expect(zoneStartIndex(90, 0, 80)).toBeNull();
    expect(zoneStartIndex(60, 80, 0)).toBeNull();
  });

  test("a threshold below the scale floors at the first segment", () => {
    expect(zoneStartIndex(-10, 0, 80)).toBe(0);
  });
});
