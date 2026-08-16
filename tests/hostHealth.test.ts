import { describe, expect, test } from "bun:test";
import {
  BOOT_GRACE_UPTIME_S,
  BUFFER_STARVED_S,
  BUFFER_SUSTAIN_MS,
  FAULT_BUFFER_MAX_AGE_MS,
  HOST_SAMPLE_CAP,
  LAMP_CPU,
  LAMP_MIN_SAMPLES,
  LAMP_WINDOW_MS,
  MEM_AVAIL_STRONG_KB,
  MEM_AVAIL_WARN_KB,
  NO_BUFFER_STARVATION,
  PREPRINT_CPU_STRONG,
  PREPRINT_CPU_WARN,
  PREPRINT_MIN_SAMPLES,
  PREPRINT_WINDOW_MS,
  appendHostSample,
  faultContextHasData,
  formatMb,
  hostLamp,
  parseProcStatUpdate,
  prePrintHostAdvisory,
  reduceBufferStarvation,
  snapshotHostFaultContext,
  summarizeHostLoad,
  type BufferStarvation,
  type HostLoad,
  type ProcStatSample,
} from "../src/lib/hostHealth";

// The host-health guard exists because two prints died to host starvation
// that surfaced as timer/probe errors. These tests pin the honest-unknown
// discipline (absent data never warns) and the exact threshold semantics.
// Thresholds were CALIBRATED 2026-08-16 against measured baselines of this
// K1 Max (host-baseline-idle.md / host-baseline-loaded.md): full-print
// memavail floor 106,852 kB, fault signature < 82 MB, idle CPU median
// 17.99 with a single 77.11% spike on a sparse window, boot storm clear by
// t+120 s. The numbers asserted below cite those measurements.

/** The payload shape Moonraker's proc_stats component pushes. */
function procStatParams(overrides: Record<string, unknown> = {}): unknown {
  return [
    {
      moonraker_stats: { time: 1626612666.85, cpu_usage: 2.66, memory: 24732, mem_units: "kB" },
      cpu_temp: null,
      network: {},
      system_cpu_usage: { cpu: 22.79, cpu0: 26.06, cpu1: 22.44 },
      system_memory: { total: 253952, available: 133120, used: 120832 },
      system_uptime: 8640.25,
      websocket_connections: 2,
      ...overrides,
    },
  ];
}

function samplesAt(
  cpus: number[],
  start: number,
  stepMs = 1000,
  mem: { availKb: number | null; totalKb: number | null } = {
    availKb: 133120,
    totalKb: 253952,
  },
  uptimeS: number | null = null,
): ProcStatSample[] {
  return cpus.map((cpu, index) => ({
    at: start + index * stepMs,
    cpu,
    memAvailKb: mem.availKb,
    memTotalKb: mem.totalKb,
    uptimeS,
  }));
}

describe("parseProcStatUpdate", () => {
  test("a full payload parses cpu, memory, and uptime", () => {
    const sample = parseProcStatUpdate(procStatParams(), 1000);
    expect(sample).toEqual({
      at: 1000,
      cpu: 22.79,
      memAvailKb: 133120,
      memTotalKb: 253952,
      uptimeS: 8640.25,
    });
  });

  test("missing system_memory parses to nulls, never zeros", () => {
    const sample = parseProcStatUpdate(
      procStatParams({ system_memory: undefined }),
      1000,
    );
    expect(sample?.cpu).toBe(22.79);
    expect(sample?.memAvailKb).toBeNull();
    expect(sample?.memTotalKb).toBeNull();
  });

  test("missing system_uptime parses to null — no grace granted, none faked", () => {
    const sample = parseProcStatUpdate(
      procStatParams({ system_uptime: undefined }),
      1000,
    );
    expect(sample?.cpu).toBe(22.79);
    expect(sample?.uptimeS).toBeNull();
  });

  test("missing system_cpu_usage parses to null cpu", () => {
    const sample = parseProcStatUpdate(
      procStatParams({ system_cpu_usage: undefined }),
      1000,
    );
    expect(sample?.cpu).toBeNull();
    expect(sample?.memAvailKb).toBe(133120);
  });

  test("non-finite / non-numeric fields are null, not NaN", () => {
    const sample = parseProcStatUpdate(
      procStatParams({
        system_cpu_usage: { cpu: "hot" },
        system_memory: { total: NaN, available: null },
        system_uptime: "yesterday",
      }),
      1000,
    );
    expect(sample).toBeNull(); // nothing useful → no sample at all
  });

  test("garbage payloads produce no sample", () => {
    expect(parseProcStatUpdate(undefined, 0)).toBeNull();
    expect(parseProcStatUpdate([], 0)).toBeNull();
    expect(parseProcStatUpdate([null], 0)).toBeNull();
    expect(parseProcStatUpdate(["x"], 0)).toBeNull();
  });
});

describe("appendHostSample", () => {
  test("caps the ring", () => {
    let ring: ProcStatSample[] = [];
    for (let i = 0; i < HOST_SAMPLE_CAP + 25; i += 1) {
      ring = appendHostSample(ring, {
        at: i * 1000,
        cpu: 10,
        memAvailKb: null,
        memTotalKb: null,
        uptimeS: null,
      });
    }
    expect(ring.length).toBe(HOST_SAMPLE_CAP);
    expect(ring[0]!.at).toBe(25_000);
  });
});

describe("summarizeHostLoad", () => {
  test("empty ring is honest-unknown: nulls and zero samples", () => {
    const load = summarizeHostLoad([], 100_000, PREPRINT_WINDOW_MS);
    expect(load.cpuMedian).toBeNull();
    expect(load.memAvailFraction).toBeNull();
    expect(load.memAvailKb).toBeNull();
    expect(load.sampleCount).toBe(0);
  });

  test("median over the window ignores short spikes", () => {
    // 28 quiet seconds with a 3-sample spike to 100% — the hourly cron /
    // thumbnail decode shape. Median must stay at the quiet level.
    const cpus = [...Array(28).fill(20), 100, 100, 100];
    const ring = samplesAt(cpus, 0);
    const load = summarizeHostLoad(ring, 30_000, PREPRINT_WINDOW_MS);
    expect(load.cpuMedian).toBe(20);
  });

  test("samples outside the window are excluded", () => {
    const old = samplesAt(Array(30).fill(95), 0);
    const fresh = samplesAt(Array(5).fill(10), 60_000);
    const load = summarizeHostLoad(
      [...old, ...fresh],
      64_000,
      PREPRINT_WINDOW_MS,
    );
    expect(load.cpuMedian).toBe(10);
    expect(load.sampleCount).toBe(5);
  });

  test("memory comes from the newest sample carrying it", () => {
    const ring: ProcStatSample[] = [
      { at: 1000, cpu: 50, memAvailKb: 100_000, memTotalKb: 253952, uptimeS: null },
      { at: 2000, cpu: 50, memAvailKb: 20_000, memTotalKb: 253952, uptimeS: null },
      { at: 3000, cpu: 50, memAvailKb: null, memTotalKb: null, uptimeS: null },
    ];
    const load = summarizeHostLoad(ring, 3000, PREPRINT_WINDOW_MS);
    expect(load.memAvailKb).toBe(20_000);
    expect(load.memAvailFraction).toBeCloseTo(20_000 / 253952, 5);
  });

  test("uptime is a level: newest in-window reading, null when absent", () => {
    const ring: ProcStatSample[] = [
      { at: 1000, cpu: 50, memAvailKb: null, memTotalKb: null, uptimeS: 90 },
      { at: 2000, cpu: 50, memAvailKb: null, memTotalKb: null, uptimeS: 91 },
      { at: 3000, cpu: 50, memAvailKb: null, memTotalKb: null, uptimeS: null },
    ];
    expect(summarizeHostLoad(ring, 3000, PREPRINT_WINDOW_MS).uptimeS).toBe(91);
    expect(summarizeHostLoad([], 3000, PREPRINT_WINDOW_MS).uptimeS).toBeNull();
  });
});

describe("prePrintHostAdvisory", () => {
  const loadOf = (over: Partial<HostLoad>): HostLoad => ({
    cpuMedian: null,
    memAvailFraction: null,
    memAvailKb: null,
    memTotalKb: null,
    uptimeS: null,
    sampleCount: 0,
    windowMs: PREPRINT_WINDOW_MS,
    ...over,
  });

  test("an unknown host NEVER warns", () => {
    expect(prePrintHostAdvisory(loadOf({}), "standby")).toBeNull();
  });

  test("a sparse window is UNKNOWN, never a warning — the 77.11% idle spike", () => {
    // Measured (host-baseline-idle.md spot-run): a single 77.11% sample on
    // an otherwise idle box. At 1–2 samples that spike IS the "median" and
    // beat the 60% warn bar. Below the sample floor there is no verdict at
    // all — not healthy, not warning.
    const spike = loadOf({ cpuMedian: 77.11, sampleCount: 2 });
    expect(prePrintHostAdvisory(spike, "standby")).toBeNull();
    const justUnder = loadOf({
      cpuMedian: 99,
      sampleCount: PREPRINT_MIN_SAMPLES - 1,
    });
    expect(prePrintHostAdvisory(justUnder, "standby")).toBeNull();
  });

  test("boot grace: uptime under 180 s is SETTLING, not a warning, whatever the signals", () => {
    // Measured boot storm (post-fix): everything clears by t+120 s. Even a
    // pegged CPU and floor-crossing memory inside the grace window renders
    // as the honest "settling" state — visible, informational, no warning.
    const booting = loadOf({
      cpuMedian: 100,
      memAvailKb: 30_720,
      memTotalKb: 219_136,
      uptimeS: BOOT_GRACE_UPTIME_S - 1,
      sampleCount: 30,
    });
    const advisory = prePrintHostAdvisory(booting, "standby");
    expect(advisory?.level).toBe("settling");
    expect(advisory?.cpuHot).toBe(false);
    expect(advisory?.memLow).toBe(false);
  });

  test("at 180 s the grace ends and normal evaluation resumes", () => {
    const settled = loadOf({
      cpuMedian: PREPRINT_CPU_WARN,
      uptimeS: BOOT_GRACE_UPTIME_S,
      sampleCount: 30,
    });
    expect(prePrintHostAdvisory(settled, "standby")?.level).toBe("warn");
  });

  test("unknown uptime grants no grace — evaluation proceeds normally", () => {
    const load = loadOf({
      cpuMedian: PREPRINT_CPU_WARN,
      uptimeS: null,
      sampleCount: 30,
    });
    expect(prePrintHostAdvisory(load, "standby")?.level).toBe("warn");
  });

  test("sustained 60% on an idle printer warns", () => {
    const load = loadOf({ cpuMedian: PREPRINT_CPU_WARN, sampleCount: 30 });
    const advisory = prePrintHostAdvisory(load, "standby");
    expect(advisory?.level).toBe("warn");
    expect(advisory?.cpuHot).toBe(true);
    expect(advisory?.memLow).toBe(false);
  });

  test("just below every bar is silence", () => {
    const load = loadOf({
      cpuMedian: PREPRINT_CPU_WARN - 0.1,
      memAvailKb: MEM_AVAIL_WARN_KB,
      memTotalKb: 219_136,
      sampleCount: 30,
    });
    expect(prePrintHostAdvisory(load, "standby")).toBeNull();
  });

  test("85% escalates to strong wording", () => {
    const load = loadOf({ cpuMedian: PREPRINT_CPU_STRONG, sampleCount: 30 });
    expect(prePrintHostAdvisory(load, "standby")?.level).toBe("strong");
  });

  test("memory floors fire ALONE — the primary signal since 2026-08-16", () => {
    // The real-print floor was 106,852 kB (never warned) and the fault
    // signature was < 82 MB. 55 MB is under the 60 MB warn floor; 30 MB is
    // under the 35 MB strong floor. No CPU reading is needed: memory is a
    // level, not a median.
    const printFloor = loadOf({ memAvailKb: 106_852, memTotalKb: 219_136 });
    expect(prePrintHostAdvisory(printFloor, "standby")).toBeNull();

    const warnMem = loadOf({ memAvailKb: 55 * 1024, memTotalKb: 219_136 });
    const warn = prePrintHostAdvisory(warnMem, "standby");
    expect(warn?.level).toBe("warn");
    expect(warn?.memLow).toBe(true);
    expect(warn?.cpuHot).toBe(false);

    const strongMem = loadOf({ memAvailKb: 30 * 1024, memTotalKb: 219_136 });
    expect(prePrintHostAdvisory(strongMem, "standby")?.level).toBe("strong");
    expect(30 * 1024).toBeLessThan(MEM_AVAIL_STRONG_KB);
  });

  test("both signals firing take the strongest level and name both", () => {
    const load = loadOf({
      cpuMedian: PREPRINT_CPU_STRONG,
      memAvailKb: 55 * 1024,
      memTotalKb: 219_136,
      sampleCount: 30,
    });
    const advisory = prePrintHostAdvisory(load, "standby");
    expect(advisory?.level).toBe("strong");
    expect(advisory?.cpuHot).toBe(true);
    expect(advisory?.memLow).toBe(true);
  });

  test("never evaluated while printing or paused — the box is legitimately busy", () => {
    const load = loadOf({ cpuMedian: 100, sampleCount: 60 });
    expect(prePrintHostAdvisory(load, "printing")).toBeNull();
    expect(prePrintHostAdvisory(load, "paused")).toBeNull();
    expect(prePrintHostAdvisory(load, "complete")).not.toBeNull();
    expect(prePrintHostAdvisory(load, undefined)).not.toBeNull();
  });

  test("there is no level that blocks — settling/warn/strong is the whole type", () => {
    const load = loadOf({
      cpuMedian: 100,
      memAvailKb: 2_048,
      memTotalKb: 219_136,
      sampleCount: 60,
    });
    const advisory = prePrintHostAdvisory(load, "standby");
    expect(["settling", "warn", "strong"]).toContain(advisory!.level);
    expect(advisory!.level).toBe("strong");
  });
});

describe("reduceBufferStarvation", () => {
  const base = {
    printing: true,
    liveVelocity: 80,
    bufferS: 0.2,
    now: 100_000,
  };

  test("the gate: not printing, no velocity, or unknown buffer all reset to silence", () => {
    const primed: BufferStarvation = {
      lowSince: 90_000,
      starved: false,
      bufferS: 0.2,
      bufferAt: 90_000,
    };
    expect(reduceBufferStarvation(primed, { ...base, printing: false })).toEqual(
      NO_BUFFER_STARVATION,
    );
    expect(
      reduceBufferStarvation(primed, { ...base, liveVelocity: 0 }),
    ).toEqual(NO_BUFFER_STARVATION);
    expect(
      reduceBufferStarvation(primed, { ...base, liveVelocity: null }),
    ).toEqual(NO_BUFFER_STARVATION);
    expect(reduceBufferStarvation(primed, { ...base, bufferS: null })).toEqual(
      NO_BUFFER_STARVATION,
    );
  });

  test("an implausible cross-clock figure is unknown, never a reading or a verdict", () => {
    // The two toolhead clocks only track each other while moves are being
    // fed; a "-4019 s buffer" is arithmetic between unrelated clocks. It
    // must not trip the starvation trigger and must not be recorded for
    // the fault snapshot to render.
    expect(
      reduceBufferStarvation(NO_BUFFER_STARVATION, {
        ...base,
        bufferS: -4019,
      }),
    ).toEqual(NO_BUFFER_STARVATION);
    expect(
      reduceBufferStarvation(NO_BUFFER_STARVATION, { ...base, bufferS: 7200 }),
    ).toEqual(NO_BUFFER_STARVATION);
  });

  test("a healthy buffer while moving records the reading and stays calm", () => {
    const next = reduceBufferStarvation(NO_BUFFER_STARVATION, {
      ...base,
      bufferS: 2.1,
    });
    expect(next).toEqual({
      lowSince: null,
      starved: false,
      bufferS: 2.1,
      bufferAt: base.now,
    });
  });

  test("a collapse must SUSTAIN before it is starvation", () => {
    let s = reduceBufferStarvation(NO_BUFFER_STARVATION, base);
    expect(s.lowSince).toBe(100_000);
    expect(s.starved).toBe(false);
    // 9.9s later: still not confirmed.
    s = reduceBufferStarvation(s, { ...base, now: 100_000 + BUFFER_SUSTAIN_MS - 100 });
    expect(s.starved).toBe(false);
    // Past the sustain window: starved.
    s = reduceBufferStarvation(s, { ...base, now: 100_000 + BUFFER_SUSTAIN_MS });
    expect(s.starved).toBe(true);
    expect(s.bufferS).toBe(0.2);
  });

  test("recovery above the threshold resets the clock", () => {
    let s = reduceBufferStarvation(NO_BUFFER_STARVATION, base);
    s = reduceBufferStarvation(s, {
      ...base,
      bufferS: BUFFER_STARVED_S + 0.1,
      now: 104_000,
    });
    expect(s.lowSince).toBeNull();
    s = reduceBufferStarvation(s, { ...base, now: 105_000 });
    expect(s.lowSince).toBe(105_000);
    expect(s.starved).toBe(false);
  });
});

describe("hostLamp", () => {
  const loadOf = (over: Partial<HostLoad>): HostLoad => ({
    cpuMedian: null,
    memAvailFraction: null,
    memAvailKb: null,
    memTotalKb: null,
    uptimeS: null,
    sampleCount: 0,
    windowMs: LAMP_WINDOW_MS,
    ...over,
  });

  test("unknown host: dark", () => {
    expect(hostLamp(loadOf({}))).toEqual({ condition: false });
  });

  test("boot grace: settling is visible, dark, and cannot latch a warning", () => {
    const lamp = hostLamp(
      loadOf({
        cpuMedian: 100,
        memAvailKb: 20_000,
        memTotalKb: 219_136,
        uptimeS: BOOT_GRACE_UPTIME_S - 60,
        sampleCount: 60,
      }),
    );
    expect(lamp.condition).toBe(false);
    expect(lamp.settling).toBe(true);
    // At 180 s the grace ends: the same signals now evaluate normally.
    const after = hostLamp(
      loadOf({
        cpuMedian: 100,
        memAvailKb: 20_000,
        memTotalKb: 219_136,
        uptimeS: BOOT_GRACE_UPTIME_S,
        sampleCount: 60,
      }),
    );
    expect(after.condition).toBe(true);
    expect(after.settling).toBeUndefined();
  });

  test("the strong memory floor lights the lamp alone, with the number", () => {
    // Fault signature: memavail < 82 MB with the klippy heap paged out.
    // 30 MB is under the 35 MB strong floor; the real-print floor of
    // 106,852 kB must stay dark.
    const low = hostLamp(loadOf({ memAvailKb: 30 * 1024, memTotalKb: 219_136 }));
    expect(low.condition).toBe(true);
    expect(low.detail).toBe("Mem 30 MB free");
    const printFloor = hostLamp(
      loadOf({ memAvailKb: 106_852, memTotalKb: 219_136 }),
    );
    expect(printFloor.condition).toBe(false);
  });

  test("THE LAW — an unsampled host never warns, whatever else is true", () => {
    // The lamp's second trigger used to reach this state: `sampleCount: 0,
    // cpuMedian: null` and a lit warning, because a stale live_velocity kept
    // a motion-buffer gate open. A warning about a host we have never
    // measured is worse than no warning, so the guard is now explicit rather
    // than an emergent property of the thresholds.
    expect(hostLamp(loadOf({ sampleCount: 0, cpuMedian: null }))).toEqual({
      condition: false,
    });
    expect(hostLamp(loadOf({ sampleCount: 0, cpuMedian: 100 }))).toEqual({
      condition: false,
    });
  });

  test("sustained CPU with enough samples, and the detail says MEDIAN", () => {
    const lamp = hostLamp(
      loadOf({ cpuMedian: 91.2, sampleCount: LAMP_MIN_SAMPLES }),
    );
    expect(lamp.condition).toBe(true);
    // Not "CPU 91% · 60s": the figure is a median over the readings inside
    // the window, not a level held for the whole minute.
    expect(lamp.detail).toBe("CPU 91% median · 60s");
  });

  test("the trigger needs the full sample budget — a burst cannot fake 60s", () => {
    const lamp = hostLamp(
      loadOf({ cpuMedian: 99, sampleCount: LAMP_MIN_SAMPLES - 1 }),
    );
    expect(lamp.condition).toBe(false);
  });

  test("the bar sits at 85 — a busy-but-plausible 80 stays dark", () => {
    const lamp = hostLamp(loadOf({ cpuMedian: LAMP_CPU - 1, sampleCount: 60 }));
    expect(lamp.condition).toBe(false);
  });
});

describe("snapshotHostFaultContext", () => {
  test("freezes mean CPU over the last minute plus newest memory", () => {
    const ring = samplesAt(Array(60).fill(98), 0, 1000, {
      availKb: 41_984,
      totalKb: 253_952,
    });
    const context = snapshotHostFaultContext(
      ring,
      { lowSince: 50_000, starved: true, bufferS: 0.1, bufferAt: 58_500 },
      59_000,
    );
    expect(context.cpuAvg).toBe(98);
    expect(context.memAvailKb).toBe(41_984);
    expect(context.bufferS).toBe(0.1);
    expect(faultContextHasData(context)).toBe(true);
  });

  test("a buffer figure older than the freshness bar is omitted, not rendered", () => {
    // The snapshot deliberately reads the PRE-fault buffer state, so it must
    // police the age itself: a reading from earlier in the print is not a
    // reading "at the moment of the fault".
    const stale = snapshotHostFaultContext(
      [],
      {
        lowSince: 0,
        starved: true,
        bufferS: 0.1,
        bufferAt: 59_000 - FAULT_BUFFER_MAX_AGE_MS - 1,
      },
      59_000,
    );
    expect(stale.bufferS).toBeNull();
    const fresh = snapshotHostFaultContext(
      [],
      {
        lowSince: 0,
        starved: true,
        bufferS: 0.1,
        bufferAt: 59_000 - FAULT_BUFFER_MAX_AGE_MS,
      },
      59_000,
    );
    expect(fresh.bufferS).toBe(0.1);
  });

  test("a reading with no timestamp is not a reading at the fault", () => {
    const context = snapshotHostFaultContext(
      [],
      { lowSince: 0, starved: true, bufferS: 0.1, bufferAt: null },
      59_000,
    );
    expect(context.bufferS).toBeNull();
  });

  test("no samples → every channel null, and the has-data guard says so", () => {
    const context = snapshotHostFaultContext([], NO_BUFFER_STARVATION, 10_000);
    expect(context.cpuAvg).toBeNull();
    expect(context.memAvailKb).toBeNull();
    expect(context.bufferS).toBeNull();
    expect(faultContextHasData(context)).toBe(false);
    expect(faultContextHasData(null)).toBe(false);
  });
});

describe("formatMb", () => {
  test("kB → whole MB", () => {
    expect(formatMb(41_984)).toBe("41 MB");
    expect(formatMb(253_952)).toBe("248 MB");
  });
});
