import { describe, expect, test } from "bun:test";
import {
  BUFFER_STARVED_S,
  BUFFER_SUSTAIN_MS,
  FAULT_BUFFER_MAX_AGE_MS,
  HOST_SAMPLE_CAP,
  LAMP_CPU,
  LAMP_MIN_SAMPLES,
  LAMP_WINDOW_MS,
  NO_BUFFER_STARVATION,
  PREPRINT_CPU_MEM_AMPLIFIED,
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
// discipline (absent data never warns) and the exact threshold semantics —
// the thresholds themselves are PROVISIONAL pending an idle baseline
// capture, but the plumbing around them is not.

/** The payload shape Moonraker's proc_stats component pushes. */
function procStatParams(overrides: Record<string, unknown> = {}): unknown {
  return [
    {
      moonraker_stats: { time: 1626612666.85, cpu_usage: 2.66, memory: 24732, mem_units: "kB" },
      cpu_temp: null,
      network: {},
      system_cpu_usage: { cpu: 22.79, cpu0: 26.06, cpu1: 22.44 },
      system_memory: { total: 253952, available: 133120, used: 120832 },
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
): ProcStatSample[] {
  return cpus.map((cpu, index) => ({
    at: start + index * stepMs,
    cpu,
    memAvailKb: mem.availKb,
    memTotalKb: mem.totalKb,
  }));
}

describe("parseProcStatUpdate", () => {
  test("a full payload parses cpu and memory", () => {
    const sample = parseProcStatUpdate(procStatParams(), 1000);
    expect(sample).toEqual({
      at: 1000,
      cpu: 22.79,
      memAvailKb: 133120,
      memTotalKb: 253952,
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
      { at: 1000, cpu: 50, memAvailKb: 100_000, memTotalKb: 253952 },
      { at: 2000, cpu: 50, memAvailKb: 20_000, memTotalKb: 253952 },
      { at: 3000, cpu: 50, memAvailKb: null, memTotalKb: null },
    ];
    const load = summarizeHostLoad(ring, 3000, PREPRINT_WINDOW_MS);
    expect(load.memAvailKb).toBe(20_000);
    expect(load.memAvailFraction).toBeCloseTo(20_000 / 253952, 5);
  });
});

describe("prePrintHostAdvisory", () => {
  const loadOf = (over: Partial<HostLoad>): HostLoad => ({
    cpuMedian: null,
    memAvailFraction: null,
    memAvailKb: null,
    memTotalKb: null,
    sampleCount: 0,
    windowMs: PREPRINT_WINDOW_MS,
    ...over,
  });

  test("an unknown host NEVER warns", () => {
    expect(prePrintHostAdvisory(loadOf({}), "standby")).toBeNull();
  });

  test("fewer than the minimum samples is silence, whatever the median", () => {
    const load = loadOf({ cpuMedian: 99, sampleCount: PREPRINT_MIN_SAMPLES - 1 });
    expect(prePrintHostAdvisory(load, "standby")).toBeNull();
  });

  test("sustained 60% on an idle printer warns", () => {
    const load = loadOf({ cpuMedian: PREPRINT_CPU_WARN, sampleCount: 30 });
    const advisory = prePrintHostAdvisory(load, "standby");
    expect(advisory?.level).toBe("warn");
    expect(advisory?.memoryAmplified).toBe(false);
  });

  test("just below every bar is silence", () => {
    const load = loadOf({
      cpuMedian: PREPRINT_CPU_WARN - 0.1,
      memAvailFraction: 0.5,
      sampleCount: 30,
    });
    expect(prePrintHostAdvisory(load, "standby")).toBeNull();
  });

  test("85% escalates to strong wording", () => {
    const load = loadOf({ cpuMedian: PREPRINT_CPU_STRONG, sampleCount: 30 });
    expect(prePrintHostAdvisory(load, "standby")?.level).toBe("strong");
  });

  test("low memory LOWERS the CPU bar but never fires alone", () => {
    const amplified = loadOf({
      cpuMedian: PREPRINT_CPU_MEM_AMPLIFIED,
      memAvailFraction: 0.1,
      memAvailKb: 25_395,
      memTotalKb: 253_952,
      sampleCount: 30,
    });
    const advisory = prePrintHostAdvisory(amplified, "standby");
    expect(advisory?.level).toBe("warn");
    expect(advisory?.memoryAmplified).toBe(true);

    // Same low memory with a quiet CPU: silence. MemAvailable alone is not
    // alarming — it is the precondition, not the fault.
    const memOnly = loadOf({
      cpuMedian: 10,
      memAvailFraction: 0.05,
      sampleCount: 30,
    });
    expect(prePrintHostAdvisory(memOnly, "standby")).toBeNull();
  });

  test("never evaluated while printing or paused — the box is legitimately busy", () => {
    const load = loadOf({ cpuMedian: 100, sampleCount: 60 });
    expect(prePrintHostAdvisory(load, "printing")).toBeNull();
    expect(prePrintHostAdvisory(load, "paused")).toBeNull();
    expect(prePrintHostAdvisory(load, "complete")).not.toBeNull();
    expect(prePrintHostAdvisory(load, undefined)).not.toBeNull();
  });

  test("there is no level that blocks — the type admits only warn/strong", () => {
    const load = loadOf({ cpuMedian: 100, memAvailFraction: 0.01, sampleCount: 60 });
    const advisory = prePrintHostAdvisory(load, "standby");
    expect(["warn", "strong"]).toContain(advisory!.level);
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
    sampleCount: 0,
    windowMs: LAMP_WINDOW_MS,
    ...over,
  });

  test("unknown host: dark", () => {
    expect(hostLamp(loadOf({}))).toEqual({ condition: false });
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
