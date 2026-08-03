import { describe, expect, test } from "bun:test";
import {
  factorDeviates,
  formatDuration,
  recentMeaningfulLines,
} from "../src/lib/utils";

describe("formatDuration", () => {
  // Regression: `!seconds` treated a real zero duration as "unknown". `—` is
  // the cockpit's honest "no answer" placeholder; zero IS an answer.
  test("zero is a known duration, not the unknown placeholder", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  test("unknown and invalid inputs keep the placeholder", () => {
    expect(formatDuration(-5)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(null as unknown as number)).toBe("—");
    expect(formatDuration(undefined as unknown as number)).toBe("—");
  });

  test("formats seconds, minutes, and hours as before", () => {
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(150)).toBe("2m 30s");
    expect(formatDuration(3_720)).toBe("1h 2m");
  });
});

describe("factorDeviates", () => {
  // Regression: strict `!== 1` latched a permanent warning off float noise —
  // 0.9999999 renders as "100%" yet warned forever.
  test("float noise around exactly 100% is not a deviation", () => {
    expect(factorDeviates(1)).toBe(false);
    expect(factorDeviates(0.9999999)).toBe(false);
    expect(factorDeviates(1.0000001)).toBe(false);
    expect(factorDeviates(1.004)).toBe(false);
  });

  test("real M220/M221 overrides still warn", () => {
    expect(factorDeviates(0.5)).toBe(true);
    expect(factorDeviates(1.1)).toBe(true);
    expect(factorDeviates(0.99)).toBe(true);
  });

  test("missing or broken telemetry never warns", () => {
    expect(factorDeviates(null)).toBe(false);
    expect(factorDeviates(undefined)).toBe(false);
    expect(factorDeviates(Number.NaN)).toBe(false);
  });
});

describe("recentMeaningfulLines", () => {
  const log = [
    { text: "SHAPER_CALIBRATE" },
    { text: "ok" },
    { text: "// probing point 1" },
    { text: "  " },
    { text: "// probing point 2" },
    { text: "// probing point 3" },
  ];

  // Regression: MissionTimeline's "current operation" headline read the LAST
  // element of the newest-first window — i.e. the OLDEST line — so it lagged
  // three commands behind whatever the machine was actually doing.
  test("index 0 is the NEWEST meaningful line", () => {
    const recent = recentMeaningfulLines(log);
    expect(recent[0]?.text).toBe("// probing point 3");
    expect(recent.map((l) => l.text)).toEqual([
      "// probing point 3",
      "// probing point 2",
      "// probing point 1",
      "SHAPER_CALIBRATE",
    ]);
  });

  test("drops bare ok acknowledgements and blank lines", () => {
    expect(
      recentMeaningfulLines([{ text: "ok" }, { text: " " }, { text: "" }]),
    ).toEqual([]);
  });

  test("caps the window at the requested count", () => {
    expect(recentMeaningfulLines(log, 2).map((l) => l.text)).toEqual([
      "// probing point 3",
      "// probing point 2",
    ]);
  });
});
