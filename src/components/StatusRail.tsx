import { usePrinter } from "@/lib/usePrinter";
import { cn } from "@/lib/utils";

const PRINT_STATE_COLOR: Record<string, string> = {
  printing: "var(--color-accent)",
  paused: "var(--color-warning)",
  complete: "var(--color-success)",
  cancelled: "var(--color-fg-muted)",
  error: "var(--color-error)",
  standby: "var(--color-fg-muted)",
};

/** Segmented mission clock — h:mm:ss. */
function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Z1 STATUS RAIL — one glance answers "is it OK?": print state lamp + word,
 * current file, progress, remaining time, and link health. Sticky under the
 * app bar on compact screens with an opaque background (frost stays confined
 * to `.app-chrome`).
 */
export function StatusRail() {
  const { state, connected } = usePrinter();
  const ps = state.print_stats;
  const printState = ps?.state ?? "standby";
  const isActive = printState === "printing" || printState === "paused";
  const filename = (ps?.filename ?? "").split("/").pop()?.replace(/\.gcode$/i, "") ?? "";

  const progress = state.virtual_sdcard?.progress ?? 0;
  const elapsed = ps?.print_duration ?? 0;
  const klipperEst = state.toolhead?.estimated_print_time ?? 0;
  const linearTotal = progress > 0.01 ? elapsed / progress : 0;
  const totalEst = klipperEst > elapsed && klipperEst < 86400 ? klipperEst : linearTotal;
  const remaining = totalEst > elapsed ? totalEst - elapsed : 0;

  const klipperReady = state.webhooks?.state === "ready";
  const link = !connected
    ? { word: "Connecting", color: "var(--color-fg-muted)" }
    : klipperReady
      ? { word: "Ready", color: "var(--color-success)" }
      : { word: "Error", color: "var(--color-error)" };

  return (
    <section
      aria-label="Printer status"
      className="status-rail instrument-panel flex flex-wrap items-center gap-x-4 gap-y-1 px-[var(--card-pad)] py-2 max-md:sticky max-md:top-[60px] max-md:z-10"
    >
      <span className="flex shrink-0 items-center gap-1.5" style={{ color: PRINT_STATE_COLOR[printState] ?? "var(--color-fg-muted)" }}>
        <span aria-hidden="true" className={cn("status-lamp", isActive && "phosphor-glow")} />
        <span className="instrument-label text-[11px]" style={{ color: "inherit" }}>{printState}</span>
      </span>

      {/*
       * While the link is down, telemetry is unknown — show the neutral `—`
       * placeholder (the "Link Connecting" lamp on this rail already carries
       * the connecting state). PrinterCard owns the "Connecting to printer…"
       * copy; rendering it twice on the Dashboard was a strict-mode trap for
       * the e2e suite and redundant for users.
       */}
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={ps?.filename || undefined}>
        {filename || (connected ? "No active job" : "—")}
      </span>

      <span className="flex shrink-0 items-baseline gap-1.5">
        <span className="instrument-label text-[11px]">Progress</span>
        <span className="instrument-value text-[13px] font-semibold">
          {isActive ? `${(progress * 100).toFixed(1)}%` : "—"}
        </span>
      </span>

      <span className="flex shrink-0 items-baseline gap-1.5">
        <span className="instrument-label text-[11px]">Remaining</span>
        <span className="instrument-value text-[13px] font-semibold">
          {isActive ? formatClock(remaining) : "—"}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-1.5" style={{ color: link.color }}>
        <span aria-hidden="true" className={cn("status-lamp", connected && klipperReady && "phosphor-glow")} />
        <span className="instrument-label text-[11px]" style={{ color: "inherit" }}>Link {link.word}</span>
      </span>
    </section>
  );
}
