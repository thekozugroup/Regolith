import { usePrinter } from "@/lib/usePrinter";
import { computeJobTiming } from "@/lib/jobProgress";
import { cn } from "@/lib/utils";

const PRINT_STATE_COLOR: Record<string, string> = {
  printing: "var(--color-accent)",
  paused: "var(--color-warning)",
  complete: "var(--color-success)",
  cancelled: "var(--color-fg-muted)",
  error: "var(--color-error)",
  standby: "var(--color-fg-muted)",
};

/**
 * Segmented mission clock — h:mm:ss. `null` means "we do not have a
 * trustworthy estimate", and renders as the same neutral placeholder the rest
 * of the cockpit uses. A wrong h:mm:ss reads as certainty the data cannot back.
 */
function formatClock(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * MISSION BAR — the cockpit's bottom status strip. One glance answers
 * "is it OK?": print state lamp + word, current file, progress, remaining
 * time, and link health, plus the full-width progress strip along its top
 * edge (the owner's peripheral-vision readout, formerly a sliver under the
 * app bar). Pinned to the bottom of the viewport on every route; on compact
 * chrome it stacks directly above the bottom nav (see .mission-bar in
 * index.css — the same tokens drive the app shell's content clearance).
 */
export function MissionBar() {
  const { state, connected } = usePrinter();
  const ps = state.print_stats;
  const printState = ps?.state ?? "standby";
  const isActive = printState === "printing" || printState === "paused";
  // A finished/stopped job keeps its identity but must not read as live.
  const isEnded =
    printState === "complete" || printState === "cancelled" || printState === "error";
  const filename = (ps?.filename ?? "").split("/").pop()?.replace(/\.gcode$/i, "") ?? "";
  // Klipper leaves `print_stats.filename` populated long after a job ends —
  // including once the state falls back to plain standby. Seen live on the
  // K1 Max: the bar read "standby · <old file>", which looks like a queued
  // job. Show the raw name only while the job is ACTIVE; contextualize it as
  // "Last:" while the ended state still explains it; clear it everywhere else.
  const jobLabel = isActive ? filename : isEnded && filename ? `Last: ${filename}` : "";

  // Derived from the JOB's own progress and elapsed print time, and null when
  // no estimate can be trusted — see lib/jobProgress.ts. It must never come
  // from `toolhead.estimated_print_time`: that is Klipper's monotonic clock
  // (roughly the machine's uptime), not the duration of this job, so it could
  // sit here reading confidently wrong for an entire multi-hour print.
  const { progress, remaining } = computeJobTiming(
    ps?.print_duration,
    state.virtual_sdcard?.progress,
  );

  const klipperReady = state.webhooks?.state === "ready";
  const link = !connected
    ? { word: "Connecting", color: "var(--color-fg-muted)" }
    : klipperReady
      ? { word: "Ready", color: "var(--color-success)" }
      : { word: "Error", color: "var(--color-error)" };

  return (
    <section aria-label="Printer status" className="mission-bar">
      {/* Full-width progress strip along the bar's top edge. Only exists
          while a job is running — a cancelled or idle machine must not leave
          a stale strip behind. The adjacent state WORD carries the
          printing/paused distinction; color is reinforcement, not encoding. */}
      {isActive && (
        <div
          data-mission-progress
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[3px] overflow-hidden bg-[var(--color-elevated)]"
        >
          <div
            className="h-full transition-[width,background-color] duration-150 ease-out"
            style={{
              width: `${progress * 100}%`,
              backgroundColor:
                printState === "paused" ? "var(--color-warning)" : "var(--color-accent)",
            }}
          />
        </div>
      )}

      <div className="flex h-full flex-col justify-center gap-y-1 px-[var(--page-gutter)] pt-[3px] leading-tight sm:flex-row sm:items-center sm:gap-x-4">
        {/* Row A — state, job, link. On sm+ this is the left half of one row. */}
        <div className="flex min-w-0 items-center gap-x-3 sm:flex-1">
          <span
            className="flex shrink-0 items-center gap-1.5"
            style={{ color: PRINT_STATE_COLOR[printState] ?? "var(--color-fg-muted)" }}
          >
            <span aria-hidden="true" className={cn("status-lamp", isActive && "phosphor-glow")} />
            <span className="instrument-label text-[11px]" style={{ color: "inherit" }}>{printState}</span>
          </span>

          {/*
           * While the link is down, telemetry is unknown — show the neutral
           * `—` placeholder (the "Link Connecting" lamp on this bar already
           * carries the connecting state). PrinterCard owns the "Connecting
           * to printer…" copy.
           */}
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-medium"
            title={jobLabel ? ps?.filename || undefined : undefined}
          >
            {jobLabel || (connected ? "No active job" : "—")}
          </span>

          <span className="flex shrink-0 items-center gap-1.5" style={{ color: link.color }}>
            <span aria-hidden="true" className={cn("status-lamp", connected && klipperReady && "phosphor-glow")} />
            <span className="instrument-label text-[11px]" style={{ color: "inherit" }}>Link {link.word}</span>
          </span>
        </div>

        {/* Row B — the mission numbers. On sm+ this is the right half. */}
        <div className="flex shrink-0 items-baseline gap-x-4">
          <span className="flex items-baseline gap-1.5">
            <span className="instrument-label text-[11px]">Progress</span>
            <span className="instrument-value text-[13px] font-semibold">
              {isActive ? `${(progress * 100).toFixed(1)}%` : "—"}
            </span>
          </span>

          <span className="flex items-baseline gap-1.5">
            <span className="instrument-label text-[11px]">Remaining</span>
            <span className="instrument-value text-[13px] font-semibold">
              {isActive ? formatClock(remaining) : "—"}
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}
