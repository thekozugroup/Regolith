import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  // `—` is reserved for "unknown". Zero is a real, known duration — a job
  // that just started has honestly elapsed nothing, which is not the same
  // as having no answer. The old `!seconds` guard conflated the two.
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return "—";
  if (seconds === 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * True when a speed/flow factor meaningfully deviates from 100%.
 *
 * Klipper reports factors as floats, and M220/M221 round-trips leave noise
 * like 0.9999999 on a machine set to exactly 100%. A strict `!== 1` check
 * latches a permanent false "off-nominal" warning the owner cannot clear.
 * The epsilon matches the display resolution: anything that still renders
 * as "100%" must not be flagged as a deviation.
 */
export function factorDeviates(
  factor: number | null | undefined,
  epsilon = 0.005,
): boolean {
  return factor != null && Number.isFinite(factor) && Math.abs(factor - 1) > epsilon;
}

/**
 * Newest-first meaningful lines from a chronological (oldest→newest) gcode
 * log — bare "ok" acknowledgements dropped. Index 0 is therefore the LATEST
 * command/response, which is what "what is it doing right now?" must read.
 */
export function recentMeaningfulLines<T extends { text?: string }>(
  log: readonly T[],
  count = 4,
): T[] {
  const out: T[] = [];
  for (let i = log.length - 1; i >= 0 && out.length < count; i -= 1) {
    const text = log[i]?.text?.trim();
    if (text && text !== "ok") out.push(log[i]);
  }
  return out;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatTemp(c: number | null | undefined): string {
  if (c == null) return "—";
  return `${c.toFixed(1)}°C`;
}
