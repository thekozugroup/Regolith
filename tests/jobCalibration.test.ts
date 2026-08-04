import { describe, expect, it } from "bun:test";
import {
  BLEND_COMPLETE_PROGRESS,
  calibrationFactor,
  computeJobTiming,
  MAX_CALIBRATION_FACTOR,
  MAX_TRUSTED_TOTAL,
  measuredWeight,
  MIN_CALIBRATION_JOBS,
  MIN_TRUSTED_ELAPSED,
  MIN_TRUSTED_PROGRESS,
  type CalibrationSample,
  type JobTimingOptions,
} from "../src/lib/jobProgress";

/** A completed job that ran `actual`s against a slicer guess of `estimate`s. */
const done = (estimate: number, actual: number): CalibrationSample => ({
  status: "completed",
  print_duration: actual,
  metadata: { estimated_time: estimate },
});

describe("calibrationFactor", () => {
  it("takes the median of actual/estimated across completed jobs", () => {
    const jobs = [done(1_000, 1_100), done(1_000, 1_200), done(1_000, 1_300)];
    expect(calibrationFactor(jobs)).toEqual({ factor: 1.2, samples: 3 });
  });

  it("is unmoved by a cancelled job that ran for seconds", () => {
    // The killer outlier: `print_duration` is the fragment that ran, not the
    // job the slicer estimated. Averaging it in would halve the factor.
    const cancelled: CalibrationSample = {
      status: "cancelled",
      print_duration: 12,
      metadata: { estimated_time: 7_200 },
    };
    const jobs = [done(1_000, 1_200), cancelled, done(1_000, 1_200), done(1_000, 1_200)];
    expect(calibrationFactor(jobs)).toEqual({ factor: 1.2, samples: 3 });
  });

  it("drops jobs with no usable estimate rather than guessing one", () => {
    const jobs: CalibrationSample[] = [
      done(1_000, 1_200),
      { status: "completed", print_duration: 900, metadata: {} },
      { status: "completed", print_duration: 900, metadata: null },
      { status: "completed", print_duration: 0, metadata: { estimated_time: 900 } },
      done(1_000, 1_200),
      done(1_000, 1_200),
    ];
    expect(calibrationFactor(jobs)?.samples).toBe(3);
  });

  it("refuses to calibrate below the sample floor", () => {
    expect(calibrationFactor([])).toBeNull();
    expect(calibrationFactor(null)).toBeNull();
    expect(calibrationFactor(undefined)).toBeNull();
    const tooFew = Array.from({ length: MIN_CALIBRATION_JOBS - 1 }, () =>
      done(1_000, 1_200),
    );
    expect(calibrationFactor(tooFew)).toBeNull();
  });

  it("discards implausible ratios instead of letting them skew the median", () => {
    const jobs = [
      done(1_000, 60_000), // 60× — a re-print of a different file, or bad data
      done(10_000, 100), // 0.01× — aborted, logged as completed
      done(1_000, 1_100),
      done(1_000, 1_100),
    ];
    // Only two survivors: below the floor, so no factor at all. A garbage
    // history disables the feature; it never produces a confident wrong k.
    expect(calibrationFactor(jobs)).toBeNull();
  });

  it("survives hostile shapes without throwing", () => {
    const jobs = [
      null,
      undefined,
      {},
      { status: "completed" },
      { status: "completed", print_duration: Number.NaN, metadata: { estimated_time: 10 } },
      { status: "completed", print_duration: 10, metadata: { estimated_time: Number.POSITIVE_INFINITY } },
      { status: "completed", print_duration: -500, metadata: { estimated_time: 500 } },
    ] as unknown as CalibrationSample[];
    expect(calibrationFactor(jobs)).toBeNull();
  });
});

describe("computeJobTiming — uncalibrated equivalence", () => {
  const cases: Array<[number | null | undefined, number | null | undefined]> = [
    [3_600, 0.5],
    [96, 0.006],
    [30, 0.5],
    [5_412, 1],
    [0, 0],
    [Number.NaN, 0.5],
    [null, null],
  ];

  it("is identical with no options, empty options, and null calibration", () => {
    for (const [elapsed, progress] of cases) {
      const bare = computeJobTiming(elapsed, progress);
      for (const options of [
        {},
        { calibration: null },
        { slicerEstimate: null },
        { slicerEstimate: 7_200 },
        { calibration: { factor: 1.2, samples: 9 } },
      ] as JobTimingOptions[]) {
        expect(computeJobTiming(elapsed, progress, options)).toEqual(bare);
      }
      expect(bare.calibrated).toBe(false);
    }
  });

  it("keeps returning null when there is neither a trend nor a calibration", () => {
    const timing = computeJobTiming(20, 0.001, {
      slicerEstimate: null,
      calibration: null,
    });
    expect(timing.remaining).toBeNull();
    expect(timing.calibrated).toBe(false);
  });
});

describe("computeJobTiming — cold start", () => {
  const calibration = { factor: 1.2, samples: 12 };

  it("fills the trust-floor hole the measured signal cannot", () => {
    // 45s into a 2h-estimated job: today this is `null`. Calibrated total is
    // 1.2 × 7200 = 8640s, so 8595s remain.
    const timing = computeJobTiming(45, 0.004, {
      slicerEstimate: 7_200,
      calibration,
    });
    expect(timing.remaining).toBeCloseTo(8_595, 6);
    expect(timing.calibrated).toBe(true);
  });

  it("says nothing at all when the printer has no history yet", () => {
    const timing = computeJobTiming(45, 0.004, {
      slicerEstimate: 7_200,
      calibration: null,
    });
    expect(timing.remaining).toBeNull();
    expect(timing.calibrated).toBe(false);
  });

  it("says nothing when the slicer emitted no estimate", () => {
    for (const slicerEstimate of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const timing = computeJobTiming(45, 0.004, { slicerEstimate, calibration });
      expect(timing.remaining).toBeNull();
      expect(timing.calibrated).toBe(false);
    }
  });

  it("stops counting once the calibrated total is already spent", () => {
    // 3h elapsed against a calibrated total of 1.2 × 7200 = 2.4h. The
    // estimate has run out; a negative or zero countdown is never shown.
    const timing = computeJobTiming(10_800, 0.01, {
      slicerEstimate: 7_200,
      calibration,
    });
    expect(timing.remaining).toBeNull();
  });
});

describe("computeJobTiming — the crossfade", () => {
  const calibration = { factor: 1.2, samples: 12 };
  const options: JobTimingOptions = { slicerEstimate: 7_200, calibration };

  it("weights the measured signal from 0 at the floor to 1 at completion", () => {
    expect(measuredWeight(MIN_TRUSTED_PROGRESS)).toBe(0);
    expect(measuredWeight(BLEND_COMPLETE_PROGRESS)).toBe(1);
    expect(measuredWeight(0)).toBe(0);
    expect(measuredWeight(1)).toBe(1);
    const mid = (MIN_TRUSTED_PROGRESS + BLEND_COMPLETE_PROGRESS) / 2;
    expect(measuredWeight(mid)).toBeCloseTo(0.5, 12);
  });

  it("is continuous across the trust floor — no jump when the trend arrives", () => {
    // Just below the floor: purely calibrated. Just above: the crossfade
    // starts at weight ~0, so the number the owner is watching barely moves.
    const eps = 1e-6;
    const below = computeJobTiming(300, MIN_TRUSTED_PROGRESS - eps, options);
    const above = computeJobTiming(300, MIN_TRUSTED_PROGRESS + eps, options);
    expect(below.remaining).not.toBeNull();
    expect(above.remaining).not.toBeNull();
    expect(Math.abs(above.remaining! - below.remaining!)).toBeLessThan(1);
    expect(above.calibrated).toBe(true);
  });

  it("hands over completely to the measured value by the blend end", () => {
    const measured = computeJobTiming(1_200, BLEND_COMPLETE_PROGRESS);
    const blended = computeJobTiming(1_200, BLEND_COMPLETE_PROGRESS, options);
    expect(blended.remaining).toBe(measured.remaining);
    expect(blended.calibrated).toBe(false);
  });

  it("stays measured for the whole back half of the job", () => {
    for (const progress of [0.2, 0.5, 0.9, 0.99]) {
      const measured = computeJobTiming(3_600, progress);
      const blended = computeJobTiming(3_600, progress, options);
      expect(blended.remaining).toBe(measured.remaining);
      expect(blended.calibrated).toBe(false);
    }
  });

  it("moves monotonically from calibrated toward measured across the fade", () => {
    // Calibrated says much more time than the measured trend does; every
    // step across the fade must move toward the measured answer, never past
    // it and never back.
    const slow: JobTimingOptions = {
      slicerEstimate: 7_200,
      calibration: { factor: 1.0, samples: 8 },
    };
    let previous = Number.POSITIVE_INFINITY;
    for (let p = 0.03; p <= BLEND_COMPLETE_PROGRESS; p += 0.01) {
      const timing = computeJobTiming(180, p, slow);
      expect(timing.remaining).not.toBeNull();
      expect(timing.remaining!).toBeLessThanOrEqual(previous);
      previous = timing.remaining!;
    }
  });
});

describe("computeJobTiming — signals that disagree", () => {
  it("prefers the measured value when the two answers contradict", () => {
    // Measured: 100s at 5% → 1900s left. Calibrated: 4 × 7200 − 100 ≈ 28700s.
    // 15× apart. Blending would publish a number neither signal supports.
    const options: JobTimingOptions = {
      slicerEstimate: 7_200,
      calibration: { factor: MAX_CALIBRATION_FACTOR, samples: 10 },
    };
    const measured = computeJobTiming(100, 0.05);
    const timing = computeJobTiming(100, 0.05, options);
    expect(timing.remaining).toBe(measured.remaining);
    expect(timing.calibrated).toBe(false);
  });

  it("rejects a calibration factor outside the plausible band", () => {
    for (const factor of [0, -1.2, 0.01, 40, Number.NaN, Number.POSITIVE_INFINITY]) {
      const timing = computeJobTiming(45, 0.004, {
        slicerEstimate: 7_200,
        calibration: { factor, samples: 10 },
      });
      expect(timing.remaining).toBeNull();
    }
  });

  it("rejects a calibration built from too few jobs even if handed one", () => {
    const timing = computeJobTiming(45, 0.004, {
      slicerEstimate: 7_200,
      calibration: { factor: 1.2, samples: MIN_CALIBRATION_JOBS - 1 },
    });
    expect(timing.remaining).toBeNull();
  });

  it("rejects an absurd calibrated total the same way it rejects an absurd trend", () => {
    const timing = computeJobTiming(45, 0.004, {
      slicerEstimate: MAX_TRUSTED_TOTAL,
      calibration: { factor: 2, samples: 10 },
    });
    expect(timing.remaining).toBeNull();
  });
});

describe("computeJobTiming — calibration never leaks past the crossfade", () => {
  // Regression: at virtual_sdcard.progress == 1.0 with print_stats still
  // "printing" (end gcode, park, cooldown), measuredRemaining returns null
  // because total <= elapsed — and the old measured==null branch resurrected
  // the raw calibrated value at full confidence. measuredWeight(1) === 1
  // means calibration must contribute NOTHING there; the honest answer is
  // the placeholder, exactly as pre-WP-ETA.
  const options: JobTimingOptions = {
    slicerEstimate: 3_600,
    calibration: { factor: 1.2, samples: 6 },
  };

  it("returns null at progress 1.0, never the spent calibrated total", () => {
    const timing = computeJobTiming(3_600, 1, options);
    expect(timing.remaining).toBeNull();
    expect(timing.calibrated).toBe(false);
  });

  it("does not jump at the very end: measured just below 1.0, null at 1.0", () => {
    const before = computeJobTiming(3_600, 0.999, options);
    expect(before.remaining).not.toBeNull();
    expect(before.calibrated).toBe(false);
    expect(before.remaining!).toBeLessThan(10); // seconds, not the ~12m leak
    const at = computeJobTiming(3_600, 1, options);
    expect(at.remaining).toBeNull();
  });

  it("stays null past 1.0 regardless of elapsed", () => {
    for (const elapsed of [1_000, 3_600, 4_000, 100_000]) {
      const timing = computeJobTiming(elapsed, 1, options);
      expect(timing.remaining).toBeNull();
      expect(timing.calibrated).toBe(false);
    }
    // Inputs above 1 clamp to 1 and behave identically.
    expect(computeJobTiming(3_600, 1.5, options).remaining).toBeNull();
  });

  it("refuses the calibrated answer whenever the crossfade is complete, even below the elapsed floor", () => {
    // progress past BLEND_COMPLETE_PROGRESS but elapsed under the 60s floor:
    // measured is null, weight is already 1 — calibration is spent here too.
    const timing = computeJobTiming(30, BLEND_COMPLETE_PROGRESS, options);
    expect(timing.remaining).toBeNull();
    expect(timing.calibrated).toBe(false);
  });

  it("still fills the early gap below the crossfade exactly as before", () => {
    const timing = computeJobTiming(45, 0.004, options);
    // 1.2 × 3600 − 45 = 4275s, the calibrated early-window estimate.
    expect(timing.remaining).toBeCloseTo(1.2 * 3_600 - 45, 6);
    expect(timing.calibrated).toBe(true);
  });
});

describe("computeJobTiming — pathological inputs stay safe", () => {
  it("never emits a non-finite or non-positive remaining, calibrated or not", () => {
    const elapsedValues = [Number.NaN, -3_600, 0, 60, 3_600, MAX_TRUSTED_TOTAL, null, undefined];
    const progressValues = [Number.NaN, -0.5, 0, MIN_TRUSTED_PROGRESS, 0.5, 1, 1.5, null, undefined];
    const optionSets: JobTimingOptions[] = [
      {},
      { slicerEstimate: Number.NaN, calibration: { factor: Number.NaN, samples: Number.NaN } },
      { slicerEstimate: 7_200, calibration: { factor: 1.2, samples: 12 } },
      { slicerEstimate: 1, calibration: { factor: 0.25, samples: 3 } },
      { slicerEstimate: MAX_TRUSTED_TOTAL * 10, calibration: { factor: 4, samples: 99 } },
    ];

    for (const elapsed of elapsedValues) {
      for (const progress of progressValues) {
        for (const options of optionSets) {
          const timing = computeJobTiming(
            elapsed as number,
            progress as number,
            options,
          );
          expect(Number.isFinite(timing.elapsed)).toBe(true);
          expect(timing.elapsed).toBeGreaterThanOrEqual(0);
          expect(timing.progress).toBeGreaterThanOrEqual(0);
          expect(timing.progress).toBeLessThanOrEqual(1);
          expect(typeof timing.calibrated).toBe("boolean");
          if (timing.remaining !== null) {
            expect(Number.isFinite(timing.remaining)).toBe(true);
            expect(timing.remaining).toBeGreaterThan(0);
          } else {
            expect(timing.calibrated).toBe(false);
          }
        }
      }
    }
  });

  it("never marks a purely measured answer as calibrated", () => {
    const timing = computeJobTiming(MIN_TRUSTED_ELAPSED, 0.5, {
      slicerEstimate: 7_200,
      calibration: { factor: 1.2, samples: 12 },
    });
    expect(timing.calibrated).toBe(false);
  });
});
