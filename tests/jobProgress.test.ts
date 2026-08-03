import { describe, expect, it } from "bun:test";
import {
  computeJobTiming,
  MAX_TRUSTED_TOTAL,
  MIN_TRUSTED_ELAPSED,
  MIN_TRUSTED_PROGRESS,
} from "../src/lib/jobProgress";

describe("computeJobTiming", () => {
  it("extrapolates remaining time from the job's own progress", () => {
    // One hour of printing at half the file → one hour to go.
    expect(computeJobTiming(3_600, 0.5).remaining).toBeCloseTo(3_600, 6);
    // 4021s at 47.32% → total 8497.5s, so ~4476s left.
    expect(computeJobTiming(4_021, 0.4732).remaining).toBeCloseTo(4_476.46, 1);
  });

  it("withholds an estimate too early in the job to trust", () => {
    // 96s into a job at 0.6% of the file is all heat-up and purge line.
    // Extrapolating gives ~4.4 hours, which was hours wrong.
    expect(computeJobTiming(96, 0.006).remaining).toBeNull();
    expect(computeJobTiming(30, 0.5).remaining, "no trend after 30s").toBeNull();
    expect(
      computeJobTiming(MIN_TRUSTED_ELAPSED, MIN_TRUSTED_PROGRESS).remaining,
      "the floors themselves are trusted",
    ).not.toBeNull();
  });

  it("withholds an estimate for a job that has nowhere left to go", () => {
    expect(computeJobTiming(5_412, 1).remaining, "a finished file").toBeNull();
    expect(computeJobTiming(0, 0).remaining, "nothing has happened").toBeNull();
  });

  it("never returns a non-finite number or a negative duration", () => {
    for (const [elapsed, progress] of [
      [Number.NaN, 0.5],
      [3_600, Number.NaN],
      [Number.POSITIVE_INFINITY, 0.5],
      [3_600, Number.POSITIVE_INFINITY],
      [-3_600, 0.5],
      [3_600, -0.5],
      [3_600, 0],
      [null, null],
      [undefined, undefined],
    ] as Array<[number | null | undefined, number | null | undefined]>) {
      const timing = computeJobTiming(elapsed, progress);
      expect(Number.isFinite(timing.elapsed)).toBe(true);
      expect(timing.elapsed).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(timing.progress)).toBe(true);
      expect(timing.progress).toBeGreaterThanOrEqual(0);
      expect(timing.progress).toBeLessThanOrEqual(1);
      if (timing.remaining !== null) {
        expect(Number.isFinite(timing.remaining)).toBe(true);
        expect(timing.remaining).toBeGreaterThan(0);
      }
    }
  });

  it("clamps progress reported outside 0..1", () => {
    expect(computeJobTiming(3_600, 1.5).progress).toBe(1);
    expect(computeJobTiming(3_600, -0.2).progress).toBe(0);
  });

  it("rejects an absurd extrapolation instead of reporting it", () => {
    // Just over the trust floor but with a huge elapsed time: the arithmetic
    // is valid and the answer is still nonsense.
    const timing = computeJobTiming(MAX_TRUSTED_TOTAL, MIN_TRUSTED_PROGRESS);
    expect(timing.remaining).toBeNull();
  });

  it("ignores klipper's monotonic clock entirely", () => {
    // The function takes no such input by construction — the same job numbers
    // must yield the same answer no matter what the machine's uptime is.
    const a = computeJobTiming(3_600, 0.5);
    const b = computeJobTiming(3_600, 0.5);
    expect(a.remaining).toBe(b.remaining);
    expect(a.remaining).toBeCloseTo(3_600, 6);
  });
});
