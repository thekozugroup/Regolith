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
 * CALIBRATION (2026-08-16, measured — no longer provisional): thresholds
 * below are fitted against two captured baselines of THIS K1 Max:
 *
 *   · host-baseline-idle.md — 60 proc-stat samples over 11 min idle:
 *     CPU min 12.43 / median 17.99 / p90 32.98 / max 36.98; a live idle
 *     spot-run also caught a single 77.11% spike on a sparse window,
 *     which is why the min-sample gates below are load-bearing.
 *   · host-baseline-loaded.md — 2,164 klippy.log samples across a full
 *     1h49m print: sysload med 2.17 / max 6.01; memavail floor
 *     106,852 kB; klippy CPU med 24.5 / max 48.1; print_stall 0;
 *     buffer_time never < 1.109 s. Estimated 30 s-median SYSTEM CPU
 *     while printing ≈ 37–40%.
 *   · Boot storm (post-fix, measured live): load peak 4.10 at t+45 s,
 *     memavail floor 104 MB, all signals clear by t+120 s.
 *   · Fault signature (both real incidents): load > 15, memavail
 *     < 82 MB, klippy heap paged out.
 *
 * The loaded-baseline analysis recommended LOAD AVERAGE as the primary
 * signal (sysload separates idle/print/fault cleanly). That is impossible
 * here: Moonraker's `notify_proc_stat_update` does NOT carry load average,
 * and this module never fakes or derives one. Where the analysis wanted
 * load-based verdicts, this module substitutes the memory floors, the
 * boot-grace window, and min-sample-gated CPU medians instead.
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
  /** `system_uptime` — host uptime in seconds. Powers the boot grace. */
  uptimeS: number | null;
}

/**
 * Ring capacity. 130 samples ≈ 130 s at Moonraker's ~1 Hz push — covers
 * the 60 s lamp window and the 120 s fault-context snapshot with slack.
 */
export const HOST_SAMPLE_CAP = 130;

/* --- Boot grace (calibrated 2026-08-16) -------------------------------- */
/**
 * Everything spikes for the first ~2 min after boot. Measured post-fix
 * boot storm: load peak 4.10 at t+45 s, memavail floor 104 MB, every
 * signal clear by t+120 s — 180 s keeps a full minute of margin. (The
 * PRE-fix storm hit load 19 / 19 MB; that world is gone, but a firmware
 * update could resurrect it, so the grace must survive it too.) While
 * `system_uptime` reads below this, advisory and lamp are SUPPRESSED —
 * rendered as an honest "settling after boot" state, never as silence
 * and never as a warning. Unknown uptime (older Moonraker) grants no
 * grace: evaluation proceeds normally.
 */
export const BOOT_GRACE_UPTIME_S = 180;

/* --- Memory floors (calibrated 2026-08-16) ----------------------------- */
/**
 * MemAvailable floors, absolute kB — fitted from host-baseline-loaded.md:
 * the full-print floor was 106,852 kB and the fault signature in both real
 * incidents was < 82 MB with the klippy heap paged out. 60 MB warn never
 * fires during a real print (46 MB of margin under the measured floor) and
 * sits comfortably above the fault signature; 35 MB strong is deep in
 * confirmed-starvation territory. Memory is a LEVEL, not a rate, so the
 * floors read the newest sample — no median, no sample-count gate.
 */
export const MEM_AVAIL_WARN_KB = 60 * 1024;
export const MEM_AVAIL_STRONG_KB = 35 * 1024;

/* --- Pre-print advisory CPU thresholds (calibrated 2026-08-16) --------- */
/** Median window for the pre-print advisory. */
export const PREPRINT_WINDOW_MS = 30_000;
/**
 * Fewer CPU readings than this in the window → no verdict, rendered as
 * UNKNOWN, never as healthy or warning. Load-bearing: at ~1 Hz proc-stat
 * cadence a sparse window degrades to a 1–2 sample "median", and a single
 * measured 77.11% idle spike (host-baseline-idle.md spot-run) would beat
 * the 60% warn bar on an idle box.
 */
export const PREPRINT_MIN_SAMPLES = 20;
/**
 * CPU stays SECONDARY to the memory floors (idle median 17.99 but idle
 * tail spikes to 77 — CPU% separates the states poorly on this box).
 * The bars are kept, not lowered: estimated real print load is a 37–40%
 * 30 s median, so 60/85 cannot false-trigger on a legitimate print.
 */
export const PREPRINT_CPU_WARN = 60;
/** → warn with strong wording. */
export const PREPRINT_CPU_STRONG = 85;

/* --- HOST LOAD lamp thresholds (calibrated 2026-08-16) ----------------- */
/**
 * Lamp trigger A: higher bar and a longer window than the pre-print
 * advisory ON PURPOSE — mid-print the host is legitimately busier, and a
 * lamp that flickers during normal printing trains the owner to ignore it.
 */
export const LAMP_WINDOW_MS = 60_000;
export const LAMP_MIN_SAMPLES = 40;
export const LAMP_CPU = 85;

/* --- Motion-buffer starvation (lamp trigger B) ------------------------- */
/** Forensics recorded ~2.1 s healthy; below this the MCU is being fed late.
 *  Corroborated 2026-08-16: across a full 1h49m print, `buffer_time` never
 *  fell below 1.109 s (host-baseline-loaded.md) — 0.5 is clear of anything
 *  a healthy print produces. */
export const BUFFER_STARVED_S = 0.5;
/** The collapse must persist this long — brief dips happen at corners. */
export const BUFFER_SUSTAIN_MS = 10_000;
/**
 * Plausibility band for `print_time − estimated_print_time` to count as a
 * motion-buffer READING at all. The two toolhead clocks only track each
 * other while the host is actually feeding moves; in other states the
 * difference is cross-clock arithmetic, not a buffer — a figure like
 * "-4019 s" is garbage, and rendering it (or triggering on it) would be a
 * lie. Real collapse sits near 0 (healthy ≈ 2 s, starved ≈ 0.2 s, briefly
 * slightly negative); anything outside this band is UNKNOWN, not a verdict.
 */
export const BUFFER_PLAUSIBLE_MIN_S = -10;
export const BUFFER_PLAUSIBLE_MAX_S = 600;

/** How far back the shutdown explainer's frozen context looks. */
export const FAULT_CONTEXT_WINDOW_MS = 120_000;
/**
 * A buffer reading older than this is not a reading "at the fault". The
 * snapshot deliberately takes the PRE-fault figure (the shutdown push closes
 * the reducer's gate in the same message), so it needs its own recency bar
 * to keep a figure from an earlier, unrelated stretch of the print out of
 * the explainer.
 */
export const FAULT_BUFFER_MAX_AGE_MS = 15_000;

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
  /** Host uptime (s) from the newest in-window sample carrying it, else null. */
  uptimeS: number | null;
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
  const uptimeS = finiteOrNull(record.system_uptime);
  if (
    cpu == null &&
    memAvailKb == null &&
    memTotalKb == null &&
    uptimeS == null
  ) {
    return null;
  }
  return { at, cpu, memAvailKb, memTotalKb, uptimeS };
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
  // Uptime is a level too — newest in-window reading, same rule as memory.
  let uptimeS: number | null = null;
  for (let i = inWindow.length - 1; i >= 0; i -= 1) {
    const sample = inWindow[i]!;
    if (sample.uptimeS != null) {
      uptimeS = sample.uptimeS;
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
    uptimeS,
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
  /**
   * "settling" is the boot-grace state — informational, not a warning:
   * the host just booted and every signal is legitimately noisy. There is
   * still no level that blocks, and there never may be.
   */
  level: "settling" | "warn" | "strong";
  /** The CPU median crossed a bar (never true during settling). */
  cpuHot: boolean;
  /** MemAvailable is under a floor (never true during settling). */
  memLow: boolean;
  cpuMedian: number | null;
  memAvailKb: number | null;
  memTotalKb: number | null;
  uptimeS: number | null;
}

/**
 * Evaluated only when the printer is NOT printing/paused — the box should
 * be nearly idle, so sustained CPU is background work, not the job.
 *
 * Verdict order (calibrated 2026-08-16, see header):
 *   1. Boot grace: uptime < 180 s → "settling", suppressing both signals.
 *   2. Memory floors — PRIMARY. Fire alone: warn < 60 MB, strong < 35 MB.
 *   3. CPU median — SECONDARY, gated on ≥ 20 in-window samples: a sparse
 *      window is UNKNOWN (null), never healthy and never a warning.
 * Unknown anything (no samples, no CPU data, no memory reading) never
 * fires a threshold — absent is silence.
 */
export function prePrintHostAdvisory(
  load: HostLoad,
  printState: string | undefined,
): HostAdvisory | null {
  if (printState === "printing" || printState === "paused") return null;
  const base = {
    cpuMedian: load.cpuMedian,
    memAvailKb: load.memAvailKb,
    memTotalKb: load.memTotalKb,
    uptimeS: load.uptimeS,
  };
  if (load.uptimeS != null && load.uptimeS < BOOT_GRACE_UPTIME_S) {
    return { level: "settling", cpuHot: false, memLow: false, ...base };
  }
  const memLevel: "warn" | "strong" | null =
    load.memAvailKb == null
      ? null
      : load.memAvailKb < MEM_AVAIL_STRONG_KB
        ? "strong"
        : load.memAvailKb < MEM_AVAIL_WARN_KB
          ? "warn"
          : null;
  const cpuKnown =
    load.cpuMedian != null && load.sampleCount >= PREPRINT_MIN_SAMPLES;
  const cpuLevel: "warn" | "strong" | null = !cpuKnown
    ? null
    : load.cpuMedian! >= PREPRINT_CPU_STRONG
      ? "strong"
      : load.cpuMedian! >= PREPRINT_CPU_WARN
        ? "warn"
        : null;
  if (memLevel == null && cpuLevel == null) return null;
  return {
    level: memLevel === "strong" || cpuLevel === "strong" ? "strong" : "warn",
    cpuHot: cpuLevel != null,
    memLow: memLevel != null,
    ...base,
  };
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
  /**
   * Client clock at which `bufferS` was read, null when there is no reading.
   * Without it a figure has no age, and a figure with no age cannot be
   * honestly attributed to "the moment of the fault".
   */
  bufferAt: number | null;
}

export const NO_BUFFER_STARVATION: BufferStarvation = {
  lowSince: null,
  starved: false,
  bufferS: null,
  bufferAt: null,
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
    Number.isFinite(input.bufferS) &&
    // Outside the plausibility band the number is not a buffer reading —
    // unknown, never a verdict and never a rendered figure.
    input.bufferS > BUFFER_PLAUSIBLE_MIN_S &&
    input.bufferS < BUFFER_PLAUSIBLE_MAX_S;
  if (!gateOpen) return NO_BUFFER_STARVATION;
  const bufferS = input.bufferS!;
  if (bufferS >= BUFFER_STARVED_S) {
    return { lowSince: null, starved: false, bufferS, bufferAt: input.now };
  }
  const lowSince = prev.lowSince ?? input.now;
  return {
    lowSince,
    starved: input.now - lowSince >= BUFFER_SUSTAIN_MS,
    bufferS,
    bufferAt: input.now,
  };
}

/* ------------------------------------------------------------------------ *
 * HOST LOAD lamp reading — ONE trigger: the proc-stat median.
 *
 * The motion-buffer collapse used to be a second, OR'd trigger. It was
 * REMOVED from the lamp on 2026-08-12, and the reason is worth keeping:
 *
 *   · its gate read `motion_report.live_velocity`, but `motion_report` is
 *     CONDITIONALLY subscribed (profileFields({motion})) — claimed only by
 *     /control and the Dashboard's EXPERT Live-Vel tile. In Basic mode on a
 *     session that never opened /control, the field is undefined, the gate
 *     is permanently shut, and the "leading indicator" could never fire for
 *     the app's stated target user;
 *   · after one visit to /control it was WORSE than useless: `mergeState`
 *     only ever spreads, never deletes, so the stale velocity persisted
 *     forever and a normal print warm-up latched a HOST LOAD warning in
 *     10 s with `cpuMedian: null, sampleCount: 0` — a warning about a host
 *     that had never been sampled, which breaks this module's own law.
 *
 * The fix was not to widen the subscription. `motion_report` streams live
 * position at Moonraker's full batch cadence; subscribing it unconditionally
 * to power a host-LOAD guard would make the guard a source of the very load
 * it watches for. So the lamp keeps the trigger that costs nothing and is
 * always available, and the buffer figure survives where it is honest and
 * free: as an OMITTABLE line in the frozen shutdown context, rendered only
 * when motion_report happened to be subscribed and fresh.
 * ------------------------------------------------------------------------ */

export interface HostLampReading {
  condition: boolean;
  /**
   * The non-colour channel that makes the lamp diagnostic: the number that
   * tripped it, as text. Unknown components are OMITTED, never printed as 0.
   */
  detail?: string;
  /**
   * Boot grace (uptime < BOOT_GRACE_UPTIME_S): the lamp is suppressed but
   * the suppression is VISIBLE — consumers render "settling after boot",
   * an honest state, never silence and never a lit warning.
   */
  settling?: boolean;
}

export function hostLamp(load: HostLoad): HostLampReading {
  // Boot grace first: for ~2 min after boot everything spikes (measured
  // post-fix storm clears by t+120 s; 180 s adds margin). Suppressed, and
  // said so — the condition stays false so nothing can latch a warning
  // out of a normal boot.
  if (load.uptimeS != null && load.uptimeS < BOOT_GRACE_UPTIME_S) {
    return { condition: false, settling: true };
  }
  // THE LAW, stated explicitly rather than left to follow from the
  // thresholds: a host we have never sampled never produces a warning.
  // (Null CPU / null memory below never compare true — unknown is dark.)
  const memStrong =
    load.memAvailKb != null && load.memAvailKb < MEM_AVAIL_STRONG_KB;
  const cpuHot =
    load.cpuMedian != null &&
    load.sampleCount >= LAMP_MIN_SAMPLES &&
    load.cpuMedian >= LAMP_CPU;
  if (!memStrong && !cpuHot) return { condition: false };
  // Detail: memory first when both fire — the paged-out klippy heap is the
  // fault signature (< 82 MB at death in both real incidents), so the
  // graver number leads. "median" is the honest word for the CPU figure:
  // a median over the readings inside the 60 s window, not a level held
  // for 60 s.
  const parts: string[] = [];
  if (memStrong) parts.push(`Mem ${formatMb(load.memAvailKb!)} free`);
  if (cpuHot) parts.push(`CPU ${Math.round(load.cpuMedian!)}% median · 60s`);
  return { condition: true, detail: parts.join(" · ") };
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
  // Callers hand in the PRE-fault buffer state (the shutdown push closes the
  // reducer's gate in the same message), so the age check belongs here: a
  // reading from earlier in the print is not a reading at the fault, and an
  // unknown buffer is omitted from the copy rather than guessed at.
  const bufferFresh =
    buffer.bufferS != null &&
    buffer.bufferAt != null &&
    now - buffer.bufferAt <= FAULT_BUFFER_MAX_AGE_MS;
  return {
    at: now,
    cpuAvg,
    memAvailKb,
    bufferS: bufferFresh ? buffer.bufferS : null,
  };
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
