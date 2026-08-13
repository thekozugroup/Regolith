/**
 * Host-health telemetry — pure logic for the HOST LOAD guard.
 *
 * Everything here reads what Moonraker GENUINELY exposes and nothing more:
 *
 *   · `notify_proc_stat_update` (~1 Hz, unprompted) carries
 *     `system_cpu_usage.cpu` (aggregate %) and `system_memory`
 *     (MemTotal / MemAvailable, in kB). That notification is ALREADY
 *     arriving on the socket — it is the link-silence heartbeat — and was
 *     being discarded. Consuming it costs ZERO new subscriptions, ZERO new
 *     HTTP traffic, and no polling: the cadence is Moonraker's own ~1 Hz
 *     push, which the 2-core SoC is already paying for. A guard against
 *     host load must not itself add load; this one adds a ring buffer of
 *     ≤ ~130 numbers and a median over ≤ 60 of them, computed in the
 *     browser, not on the printer.
 *
 *   · `toolhead.print_time − toolhead.estimated_print_time` is the motion
 *     buffer — how far ahead the host has fed the MCU. Both fields are in
 *     the already-subscribed `toolhead` object. Healthy is ~2 s; it
 *     collapses toward 0 BEFORE Klipper faults with "Rescheduled timer in
 *     the past", which makes it the leading indicator of host starvation
 *     mid-print.
 *
 * What Moonraker does NOT expose — and this module therefore never claims:
 * swap usage, load average, iowait as its own number, per-process CPU.
 * Because Moonraker derives CPU% from /proc/stat with idle = field 3 only,
 * iowait COUNTS AS USED CPU: a swap-thrashing host reads as a pegged CPU.
 * That is exactly what the 2026-08-12 idle-thrash condition looked like
 * (25% iowait, 0% idle → ~100% by this arithmetic), so "sustained high CPU
 * on an idle printer" is the honest, measurable proxy. Every string built
 * from these numbers says "host busy", never "swap thrash" — we report the
 * symptom we can measure.
 *
 * Honest-unknown discipline throughout (same rule as describeTailscale):
 * absent fields parse to null, null never fires a threshold, and an
 * unknown host NEVER produces a warning.
 *
 * CALIBRATION (provisional): every threshold constant below is derived
 * from the SHAPE of the 2026-08-12 incidents (sustained ~100% CPU with
 * nothing printing; MemAvailable collapsing as the render started), not
 * from a measured healthy-idle baseline of this K1. Re-fit against a
 * 30 min idle + 30 min mid-print `notify_proc_stat_update` capture once
 * the current print finishes. The plumbing is the deliverable; the
 * constants are the best defensible starting point.
 */

/** One consumed `notify_proc_stat_update` sample. Absent fields are null. */
export interface ProcStatSample {
  /** Client clock, ms — when the sample arrived. */
  at: number;
  /** `system_cpu_usage.cpu` — aggregate CPU %, iowait included. */
  cpu: number | null;
  /** `system_memory.available`, kB. */
  memAvailKb: number | null;
  /** `system_memory.total`, kB. */
  memTotalKb: number | null;
}

/**
 * Ring capacity. 130 samples ≈ 130 s at Moonraker's ~1 Hz push — covers
 * the 60 s lamp window and the 120 s fault-context snapshot with slack.
 */
export const HOST_SAMPLE_CAP = 130;

/* --- Pre-print advisory thresholds (PROVISIONAL — see header) ---------- */
/** Median window for the pre-print advisory. */
export const PREPRINT_WINDOW_MS = 30_000;
/** Fewer CPU readings than this in the window → silence, no claim. */
export const PREPRINT_MIN_SAMPLES = 20;
/** Idle printer holding this median for the window → warn. */
export const PREPRINT_CPU_WARN = 60;
/** → warn with strong wording. */
export const PREPRINT_CPU_STRONG = 85;
/** Lower CPU bar that applies only when memory is also low. */
export const PREPRINT_CPU_MEM_AMPLIFIED = 45;
/** MemAvailable/MemTotal below this amplifies the CPU signal. Never fires alone. */
export const PREPRINT_MEM_FRACTION = 0.12;

/* --- HOST LOAD lamp thresholds (PROVISIONAL) --------------------------- */
/**
 * Lamp trigger A: higher bar and a longer window than the pre-print
 * advisory ON PURPOSE — mid-print the host is legitimately busier, and a
 * lamp that flickers during normal printing trains the owner to ignore it.
 */
export const LAMP_WINDOW_MS = 60_000;
export const LAMP_MIN_SAMPLES = 40;
export const LAMP_CPU = 85;

/* --- Motion-buffer starvation (lamp trigger B, PROVISIONAL) ------------ */
/** Forensics recorded ~2.1 s healthy; below this the MCU is being fed late. */
export const BUFFER_STARVED_S = 0.5;
/** The collapse must persist this long — brief dips happen at corners. */
export const BUFFER_SUSTAIN_MS = 10_000;

/** How far back the shutdown explainer's frozen context looks. */
export const FAULT_CONTEXT_WINDOW_MS = 120_000;

/**
 * Rolling host-load summary over one window. `null` everywhere until real
 * data exists — an unknown host never produces a warning.
 */
export interface HostLoad {
  /** Median aggregate CPU % over the window, null if < 1 CPU reading. */
  cpuMedian: number | null;
  /** MemAvailable / MemTotal from the newest sample carrying both, else null. */
  memAvailFraction: number | null;
  memAvailKb: number | null;
  memTotalKb: number | null;
  /** CPU readings inside the window — the count thresholds gate on. */
  sampleCount: number;
  windowMs: number;
}

const finiteOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Total parser for the `notify_proc_stat_update` params. Field-shape drift
 * (older Moonraker, non-RPi SoCs missing `system_memory`) parses to nulls,
 * never to zeros — absent is unknown, and unknown must stay silent.
 */
export function parseProcStatUpdate(
  params: unknown,
  at: number,
): ProcStatSample | null {
  if (!Array.isArray(params) || params.length === 0) return null;
  const payload = params[0];
  if (payload == null || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const cpuUsage = record.system_cpu_usage;
  const cpu =
    cpuUsage != null && typeof cpuUsage === "object"
      ? finiteOrNull((cpuUsage as Record<string, unknown>).cpu)
      : null;
  const memory = record.system_memory;
  let memAvailKb: number | null = null;
  let memTotalKb: number | null = null;
  if (memory != null && typeof memory === "object") {
    memAvailKb = finiteOrNull((memory as Record<string, unknown>).available);
    memTotalKb = finiteOrNull((memory as Record<string, unknown>).total);
  }
  if (cpu == null && memAvailKb == null && memTotalKb == null) return null;
  return { at, cpu, memAvailKb, memTotalKb };
}

/** Append with the ring cap. Returns a new array (reducer discipline). */
export function appendHostSample(
  ring: readonly ProcStatSample[],
  sample: ProcStatSample,
): ProcStatSample[] {
  return [...ring, sample].slice(-HOST_SAMPLE_CAP);
}

/** Median, not mean: a 2–5 s spike (thumbnail decode, the hourly cron)
 *  must not move the verdict — the incident condition was SUSTAINED. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function summarizeHostLoad(
  ring: readonly ProcStatSample[],
  now: number,
  windowMs: number,
): HostLoad {
  const cutoff = now - windowMs;
  const inWindow = ring.filter((sample) => sample.at >= cutoff);
  const cpus = inWindow
    .map((sample) => sample.cpu)
    .filter((cpu): cpu is number => cpu != null);
  // Memory from the NEWEST sample that carries both fields: MemAvailable is
  // a level, not a rate — the latest reading is the truth.
  let memAvailKb: number | null = null;
  let memTotalKb: number | null = null;
  for (let i = inWindow.length - 1; i >= 0; i -= 1) {
    const sample = inWindow[i]!;
    if (sample.memAvailKb != null && sample.memTotalKb != null) {
      memAvailKb = sample.memAvailKb;
      memTotalKb = sample.memTotalKb;
      break;
    }
  }
  return {
    cpuMedian: median(cpus),
    memAvailFraction:
      memAvailKb != null && memTotalKb != null && memTotalKb > 0
        ? memAvailKb / memTotalKb
        : null,
    memAvailKb,
    memTotalKb,
    sampleCount: cpus.length,
    windowMs,
  };
}

/* ------------------------------------------------------------------------ *
 * Pre-print advisory — ADVISORY ONLY, by law.
 *
 * Same law as KAMP and the timelapse write: optional checks never block a
 * print. This verdict is rendered as a dismissible warning inside
 * PrintDialog and is wired to NOTHING else — not the Start button's
 * disabled state, not guardPrinterAction, not safety.ts. There is no
 * "blocked" level and there never may be: a host-health false positive
 * that refuses to print is its own outage.
 * ------------------------------------------------------------------------ */

export interface HostAdvisory {
  level: "warn" | "strong";
  /** Free memory is also low — swap-on-eMMC precondition. Never fires alone. */
  memoryAmplified: boolean;
  cpuMedian: number;
  memAvailKb: number | null;
  memTotalKb: number | null;
}

/**
 * Evaluated only when the printer is NOT printing/paused — the box should
 * be nearly idle, so sustained CPU is background work, not the job.
 * Unknown (few samples, no CPU data) is silence, never a warning.
 */
export function prePrintHostAdvisory(
  load: HostLoad,
  printState: string | undefined,
): HostAdvisory | null {
  if (printState === "printing" || printState === "paused") return null;
  if (load.cpuMedian == null || load.sampleCount < PREPRINT_MIN_SAMPLES) {
    return null;
  }
  const memoryAmplified =
    load.memAvailFraction != null &&
    load.memAvailFraction < PREPRINT_MEM_FRACTION;
  const base = {
    memoryAmplified,
    cpuMedian: load.cpuMedian,
    memAvailKb: load.memAvailKb,
    memTotalKb: load.memTotalKb,
  };
  if (load.cpuMedian >= PREPRINT_CPU_STRONG) return { level: "strong", ...base };
  if (load.cpuMedian >= PREPRINT_CPU_WARN) return { level: "warn", ...base };
  if (load.cpuMedian >= PREPRINT_CPU_MEM_AMPLIFIED && memoryAmplified) {
    return { level: "warn", ...base };
  }
  return null;
}

/* ------------------------------------------------------------------------ *
 * Motion-buffer starvation — lamp trigger B, the leading indicator.
 * ------------------------------------------------------------------------ */

export interface BufferStarvation {
  /** When the buffer first collapsed below BUFFER_STARVED_S, or null. */
  lowSince: number | null;
  /** Collapse has persisted ≥ BUFFER_SUSTAIN_MS with the head moving. */
  starved: boolean;
  /**
   * Last buffer reading taken while the gate was open (printing, head
   * actually moving). Null otherwise — a buffer that legitimately reads ~0
   * while heating, paused, or between objects is NOT a starvation signal,
   * and firing there would false-positive on every print's warm-up.
   */
  bufferS: number | null;
}

export const NO_BUFFER_STARVATION: BufferStarvation = {
  lowSince: null,
  starved: false,
  bufferS: null,
};

export interface BufferStarvationInput {
  printing: boolean;
  /** `motion_report.live_velocity`; null when not subscribed → gate closed. */
  liveVelocity: number | null;
  /** `toolhead.print_time − toolhead.estimated_print_time`, seconds. */
  bufferS: number | null;
  now: number;
}

/** Total reducer — unknown inputs reset to silence, never to a verdict. */
export function reduceBufferStarvation(
  prev: BufferStarvation,
  input: BufferStarvationInput,
): BufferStarvation {
  const gateOpen =
    input.printing &&
    input.liveVelocity != null &&
    input.liveVelocity > 0 &&
    input.bufferS != null &&
    Number.isFinite(input.bufferS);
  if (!gateOpen) return NO_BUFFER_STARVATION;
  const bufferS = input.bufferS!;
  if (bufferS >= BUFFER_STARVED_S) {
    return { lowSince: null, starved: false, bufferS };
  }
  const lowSince = prev.lowSince ?? input.now;
  return {
    lowSince,
    starved: input.now - lowSince >= BUFFER_SUSTAIN_MS,
    bufferS,
  };
}

/* ------------------------------------------------------------------------ *
 * HOST LOAD lamp reading — two independent triggers, OR'd.
 * ------------------------------------------------------------------------ */

export interface HostLampReading {
  condition: boolean;
  /**
   * The non-colour channel that makes the lamp diagnostic: the number that
   * tripped it, as text. Unknown components are OMITTED, never printed as 0.
   */
  detail?: string;
}

export function hostLamp(
  load: HostLoad,
  buffer: BufferStarvation,
): HostLampReading {
  const cpuHot =
    load.cpuMedian != null &&
    load.sampleCount >= LAMP_MIN_SAMPLES &&
    load.cpuMedian >= LAMP_CPU;
  const starved = buffer.starved && buffer.bufferS != null;
  if (!cpuHot && !starved) return { condition: false };
  const cpuText = cpuHot ? `CPU ${Math.round(load.cpuMedian!)}%` : null;
  const bufferValue = starved ? `${buffer.bufferS!.toFixed(1)}s` : null;
  let detail: string | undefined;
  if (cpuText && bufferValue) detail = `${cpuText} · buffer ${bufferValue}`;
  else if (cpuText) detail = `${cpuText} · 60s`;
  else if (bufferValue) detail = `Buffer ${bufferValue}`;
  return { condition: true, detail };
}

/* ------------------------------------------------------------------------ *
 * Shutdown context — frozen at the fault.
 * ------------------------------------------------------------------------ */

/**
 * Host state at the moment `webhooks.state` entered shutdown/error. Frozen,
 * because by the time the explainer renders, the load that caused the fault
 * may have cleared — printing live values would be wrong. Channels with no
 * data are null and get OMITTED from copy, never zero-filled.
 */
export interface HostFaultContext {
  at: number;
  /** Mean CPU % over the last 60 s before the fault (mean, not median — the
   *  question here is "how loaded WAS it", not "filter out spikes"). */
  cpuAvg: number | null;
  memAvailKb: number | null;
  /** Motion buffer at the fault, if the head was being fed at the time. */
  bufferS: number | null;
}

export function snapshotHostFaultContext(
  ring: readonly ProcStatSample[],
  buffer: BufferStarvation,
  now: number,
): HostFaultContext {
  const cutoff = now - 60_000;
  const cpus = ring
    .filter((sample) => sample.at >= cutoff && sample.at <= now)
    .map((sample) => sample.cpu)
    .filter((cpu): cpu is number => cpu != null);
  const cpuAvg =
    cpus.length > 0
      ? cpus.reduce((sum, cpu) => sum + cpu, 0) / cpus.length
      : null;
  let memAvailKb: number | null = null;
  for (let i = ring.length - 1; i >= 0; i -= 1) {
    const sample = ring[i]!;
    if (sample.at < now - FAULT_CONTEXT_WINDOW_MS) break;
    if (sample.memAvailKb != null) {
      memAvailKb = sample.memAvailKb;
      break;
    }
  }
  return { at: now, cpuAvg, memAvailKb, bufferS: buffer.bufferS };
}

/** True when the snapshot has at least one channel worth rendering. */
export function faultContextHasData(
  context: HostFaultContext | null,
): context is HostFaultContext {
  return (
    context != null &&
    (context.cpuAvg != null ||
      context.memAvailKb != null ||
      context.bufferS != null)
  );
}

/** kB → whole megabytes, for copy ("41 MB"). Callers guard null. */
export function formatMb(kb: number): string {
  return `${Math.round(kb / 1024)} MB`;
}
