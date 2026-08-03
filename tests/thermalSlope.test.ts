import { describe, expect, it } from "bun:test";
import {
  BED_SLOPE_LIMITS,
  detectThermalSlope,
  HOTEND_SLOPE_LIMITS,
  SLOPE_MIN_SAMPLES,
  temperatureSlope,
  type TempSample,
} from "../src/lib/health";

/**
 * Recorded-style curves. Every series is built at the real 1 Hz sample rate
 * with a little deterministic thermistor noise on top, because a rule that
 * only survives perfectly clean data is a rule that fires on a real printer.
 */
function curve({
  samples,
  start,
  slope,
  target,
  power,
  noise = 0.05,
  startAt = 1_700_000_000_000,
}: {
  samples: number;
  start: number;
  slope: number;
  target: number;
  power: number | ((i: number) => number);
  noise?: number;
  startAt?: number;
}): TempSample[] {
  return Array.from({ length: samples }, (_, i) => ({
    at: startAt + i * 1_000,
    // sin/cos wobble: deterministic, zero-mean, and not a straight line.
    temperature: start + slope * i + noise * Math.sin(i * 1.7),
    target,
    power: typeof power === "function" ? power(i) : power,
  }));
}

/** 45 s of readings — exactly the commanded-heat confirmation window. */
const CONFIRM_SAMPLES = 46;
/** 60 s of readings — the longer uncommanded-rise window. */
const UNCOMMANDED_SAMPLES = 61;

const hotend = (samples: TempSample[]) =>
  detectThermalSlope("Hotend", samples, HOTEND_SLOPE_LIMITS);
const bed = (samples: TempSample[]) =>
  detectThermalSlope("Bed", samples, BED_SLOPE_LIMITS);

describe("temperatureSlope", () => {
  it("recovers the rate a curve was generated at", () => {
    const climbing = curve({
      samples: 60,
      start: 25,
      slope: 2.5,
      target: 220,
      power: 1,
    });
    expect(temperatureSlope(climbing)!).toBeCloseTo(2.5, 2);
    const falling = curve({
      samples: 60,
      start: 220,
      slope: -0.4,
      target: 220,
      power: 1,
    });
    expect(temperatureSlope(falling)!).toBeCloseTo(-0.4, 2);
  });

  it("has no opinion without at least two readings at two instants", () => {
    expect(temperatureSlope([])).toBeNull();
    expect(
      temperatureSlope([{ at: 1, temperature: 200, target: 200, power: 0 }]),
    ).toBeNull();
    expect(
      temperatureSlope([
        { at: 5, temperature: 200, target: 200, power: 0 },
        { at: 5, temperature: 260, target: 200, power: 0 },
      ]),
    ).toBeNull();
  });

  it("is not swung by a single bad reading", () => {
    const flat = curve({
      samples: 60,
      start: 200,
      slope: 0,
      target: 200,
      power: 1,
      noise: 0,
    });
    flat[30] = { ...flat[30]!, temperature: 2_000 }; // one nonsense sample
    expect(Math.abs(temperatureSlope(flat)!)).toBeLessThan(1);
  });
});

describe("thermal slope — a healthy machine says nothing", () => {
  it("stays silent through a normal hotend heat-up", () => {
    // 25 → 160°C at 3 °C/s with the heater flat out. The gap from target is
    // enormous the whole way; only the SLOPE keeps this quiet, which is the
    // whole point of the rule.
    expect(
      hotend(
        curve({
          samples: CONFIRM_SAMPLES,
          start: 25,
          slope: 3,
          target: 220,
          power: 1,
        }),
      ),
    ).toBeNull();
  });

  it("stays silent through a normal — and much slower — bed heat-up", () => {
    // A big bed climbs at ~0.05 °C/s. Judged against the hotend's threshold
    // this would read as a stall on every single print.
    const slowBed = curve({
      samples: CONFIRM_SAMPLES,
      start: 24,
      slope: 0.05,
      target: 60,
      power: 1,
      noise: 0.02,
    });
    expect(bed(slowBed)).toBeNull();
    expect(hotend(slowBed), "the shared threshold that would misfire").not.toBeNull();
  });

  it("stays silent while a heater holds its setpoint", () => {
    expect(
      hotend(
        curve({
          samples: CONFIRM_SAMPLES,
          start: 220,
          slope: 0,
          target: 220,
          power: (i) => 0.25 + 0.1 * Math.sin(i / 3),
          noise: 0.3,
        }),
      ),
    ).toBeNull();
  });

  it("stays silent while a commanded-off machine cools down", () => {
    expect(
      hotend(
        curve({
          samples: UNCOMMANDED_SAMPLES,
          start: 210,
          slope: -1.2,
          target: 0,
          power: 0,
        }),
      ),
    ).toBeNull();
  });

  it("stays silent when the heater is only briefly at full power", () => {
    // One regulating dip anywhere in the window disqualifies it. Preconditions
    // must hold for EVERY sample, so a transient can never trip a rule.
    const flatline = curve({
      samples: CONFIRM_SAMPLES,
      start: 24.9,
      slope: 0,
      target: 220,
      power: 1,
    });
    expect(hotend(flatline), "control: the same curve does alarm").not.toBeNull();
    flatline[20] = { ...flatline[20]!, power: 0.6 };
    expect(hotend(flatline)).toBeNull();
  });
});

describe("thermal slope — detached thermistor flatline", () => {
  it("reports a stalled heat-up once the window is full", () => {
    const issue = hotend(
      curve({
        samples: CONFIRM_SAMPLES,
        start: 24.9,
        slope: 0,
        target: 220,
        power: 1,
      }),
    );
    expect(issue?.rule).toBe("stalled-heatup");
    expect(issue?.heater).toBe("Hotend");
    expect(Math.abs(issue!.slope)).toBeLessThan(0.1);
    expect(issue?.message).toContain("not gaining heat");
    // Never a claim of protection, and never the word AI.
    expect(issue?.message).not.toMatch(/protect|AI\b/i);
  });

  it("catches the bed equivalent at its own much lower threshold", () => {
    const issue = bed(
      curve({
        samples: CONFIRM_SAMPLES,
        start: 23.5,
        slope: 0.002,
        target: 60,
        power: 1,
        noise: 0.01,
      }),
    );
    expect(issue?.rule).toBe("stalled-heatup");
  });

  it("says nothing while the heat-up is merely finishing", () => {
    // 213 → 219 against a 220 target: flat-ish, at power, but only 7°C out.
    // That is a heater settling, not a heater that cannot heat.
    expect(
      hotend(
        curve({
          samples: CONFIRM_SAMPLES,
          start: 213,
          slope: 0.001,
          target: 220,
          power: 1,
        }),
      ),
    ).toBeNull();
  });

  it("says nothing until the confirmation window is genuinely spanned", () => {
    const flatline = curve({
      samples: CONFIRM_SAMPLES,
      start: 24.9,
      slope: 0,
      target: 220,
      power: 1,
    });
    expect(hotend(flatline.slice(0, SLOPE_MIN_SAMPLES - 1))).toBeNull();
    expect(hotend(flatline.slice(0, 30)), "30 s is not 45 s").toBeNull();

    // A dense burst: plenty of readings, no elapsed time. Sample COUNT alone
    // must never be mistaken for a confirmation window.
    const burst = flatline.map((sample, i) => ({
      ...sample,
      at: flatline[0]!.at + i * 50,
    }));
    expect(hotend(burst)).toBeNull();
  });
});

describe("thermal slope — slow-creep uncommanded rise", () => {
  it("reports a heater gaining heat with its output commanded off", () => {
    const issue = hotend(
      curve({
        samples: UNCOMMANDED_SAMPLES,
        start: 42,
        slope: 0.3,
        target: 0,
        power: 0,
      }),
    );
    expect(issue?.rule).toBe("uncommanded-rise");
    expect(issue!.slope).toBeGreaterThan(0.15);
    expect(issue?.message).toContain("commanded off");
  });

  it("ignores the brief post-shutoff soak into the thermistor", () => {
    // 15 s of rise after the heater cut out, then the real cooldown. The
    // 60 s window is longer than the soak on purpose.
    const soak = [
      ...curve({ samples: 16, start: 208, slope: 0.4, target: 0, power: 0 }),
      ...curve({
        samples: 45,
        start: 214,
        slope: -0.9,
        target: 0,
        power: 0,
        startAt: 1_700_000_000_000 + 16_000,
      }),
    ];
    expect(hotend(soak)).toBeNull();
  });

  it("ignores a creep too slow to distinguish from ambient drift", () => {
    expect(
      hotend(
        curve({
          samples: UNCOMMANDED_SAMPLES,
          start: 30,
          slope: 0.05,
          target: 0,
          power: 0,
        }),
      ),
    ).toBeNull();
  });

  it("ignores a rise while the heater is legitimately commanded on", () => {
    expect(
      hotend(
        curve({
          samples: UNCOMMANDED_SAMPLES,
          start: 60,
          slope: 0.3,
          target: 220,
          power: 1,
        }),
      ),
    ).toBeNull();
  });
});

describe("thermal slope — losing heat while commanded hot", () => {
  it("reports a heater at full power that is still falling", () => {
    const issue = hotend(
      curve({
        samples: CONFIRM_SAMPLES,
        start: 218.5,
        slope: -0.25,
        target: 220,
        power: 1,
      }),
    );
    expect(issue?.rule).toBe("losing-heat");
    expect(issue!.slope).toBeLessThan(-0.2);
    expect(issue?.message).toContain("still cooling");
  });

  it("hands over to the ±15°C runaway rule once the gap opens up", () => {
    // Below target − 15 this is the shipped runaway alert's story. Two toasts
    // for one fault is noise, so the early explainer stops talking.
    const issue = hotend(
      curve({
        samples: CONFIRM_SAMPLES,
        start: 200,
        slope: -0.25,
        target: 220,
        power: 1,
      }),
    );
    expect(issue?.rule).not.toBe("losing-heat");
  });

  it("says nothing when a fall is just the setpoint coming down", () => {
    expect(
      hotend(
        curve({
          samples: CONFIRM_SAMPLES,
          start: 218,
          slope: -0.5,
          target: 0,
          power: 0,
        }),
      ),
    ).toBeNull();
  });
});

describe("thermal slope — degenerate inputs stay silent", () => {
  it("never throws and never invents a verdict", () => {
    const shapes: TempSample[][] = [
      [],
      curve({ samples: 5, start: 20, slope: 0, target: 220, power: 1 }),
      curve({
        samples: CONFIRM_SAMPLES,
        start: Number.NaN,
        slope: 0,
        target: 220,
        power: 1,
      }),
      curve({
        samples: CONFIRM_SAMPLES,
        start: 20,
        slope: 0,
        target: Number.NaN,
        power: 1,
      }),
      curve({ samples: CONFIRM_SAMPLES, start: 20, slope: 0, target: 0, power: 0 }),
    ];
    for (const samples of shapes) {
      expect(hotend(samples)).toBeNull();
      expect(bed(samples)).toBeNull();
    }
  });

  it("emits at most one verdict per heater", () => {
    // Flat, at power, far below target AND inside the falling band would
    // match two rules if they were allowed to stack.
    const issue = hotend(
      curve({
        samples: CONFIRM_SAMPLES,
        start: 24.9,
        slope: 0,
        target: 220,
        power: 1,
      }),
    );
    expect(issue).not.toBeNull();
    expect(typeof issue!.rule).toBe("string");
  });
});
