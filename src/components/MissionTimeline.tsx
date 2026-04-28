import { useEffect, useState } from "react";
import { Pause, Play, Square, FileText, Activity, X, RotateCcw } from "lucide-react";
import { Button } from "./Button";
import { Card } from "./Card";
import { usePrinter } from "@/lib/usePrinter";
import { useGcodeLog } from "@/lib/useGcodeLog";
import { moonraker } from "@/lib/moonraker";
import { formatDuration, cn } from "@/lib/utils";

/**
 * Mission Status — SpaceX-style mission control.
 *
 * Shows three modes:
 *   1. Print active: thumbnail + timeline + ETA + controls
 *   2. Tuning / macro active: spinner + recent gcode lines + elapsed
 *   3. Idle: ready state
 *
 * Auto-detects non-print activity by watching idle_timeout.state === "Printing"
 * while print_stats.filename is empty (typical for SHAPER_CALIBRATE,
 * SCREWS_TILT_CALCULATE, BED_MESH_CALIBRATE, PROBE_ACCURACY etc).
 */
export function MissionTimeline() {
  const { state, mr } = usePrinter();
  const log = useGcodeLog(20);
  const ps = state.print_stats;
  const sd = state.virtual_sdcard;
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [activityStart, setActivityStart] = useState<number | null>(null);

  const printState = ps?.state ?? "standby";
  const isPrintingFile = printState === "printing" || printState === "paused";
  const isComplete = printState === "complete";
  const filename = ps?.filename ?? "";
  const klipperBusy = state.idle_timeout?.state === "Printing";
  // Non-print activity: klipper busy but no print file
  const isTuning = klipperBusy && !filename;

  const progress = sd?.progress ?? 0;
  const elapsed = ps?.print_duration ?? 0;
  const klipperEst = state.toolhead?.estimated_print_time ?? 0;
  // Compute ETA two ways and use the better one:
  //   1. Klipper's estimate (if populated by slicer M73)
  //   2. Linear extrapolation from elapsed / progress (works after any time)
  const linearTotal = progress > 0.01 ? elapsed / progress : 0;
  const totalEst =
    klipperEst > elapsed && klipperEst < 86400 ? klipperEst : linearTotal;
  const remaining = totalEst > elapsed ? totalEst - elapsed : 0;
  const filamentMm = ps?.filament_used ?? 0;

  // Track activity start for non-print ops
  useEffect(() => {
    if (isTuning && activityStart === null) {
      setActivityStart(Date.now());
    } else if (!isTuning && activityStart !== null) {
      setActivityStart(null);
    }
  }, [isTuning, activityStart]);

  // Resolve thumbnail (prints only)
  useEffect(() => {
    if (!filename) {
      setThumbUrl(null);
      return;
    }
    const url = moonraker.thumbnailUrl(filename, 300);
    const img = new Image();
    img.onload = () => setThumbUrl(url);
    img.onerror = () => setThumbUrl(null);
    img.src = url;
  }, [filename]);

  const checkpoints = [
    { label: "Start", at: 0 },
    { label: "25%", at: 0.25 },
    { label: "50%", at: 0.5 },
    { label: "75%", at: 0.75 },
    { label: "Done", at: 1 },
  ];

  // ---------- TUNING / MACRO MODE ----------
  if (isTuning) {
    const elapsedSec = activityStart
      ? Math.floor((Date.now() - activityStart) / 1000)
      : 0;
    // Last meaningful command (not just "ok")
    const recentLines = log
      .slice()
      .reverse()
      .filter((l) => l.text && l.text.trim() !== "ok")
      .slice(0, 4);
    const guessedOp = recentLines[recentLines.length - 1]?.text || "—";

    return (
      <Card
        title="Mission Status"
        icon={<Activity />}
        action={
          <Button size="sm" variant="danger" onClick={() => mr.runGcode("CANCEL_PRINT")}>
            <X className="w-3 h-3" /> Abort
          </Button>
        }
      >
        <div className="grid grid-cols-[120px_1fr] gap-4">
          <div className="aspect-square rounded-md border border-[var(--color-accent)] bg-[rgba(249,115,22,0.05)] overflow-hidden flex items-center justify-center">
            <Activity
              className="w-12 h-12 text-[var(--color-accent)] animate-pulse"
              strokeWidth={1.25}
            />
          </div>

          <div className="flex flex-col gap-2 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)] font-semibold">
                Calibration · Tuning
              </span>
              <span className="shrink-0 px-1.5 py-0.5 rounded-sm border text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--color-accent)] bg-[rgba(249,115,22,0.10)] border-[rgba(249,115,22,0.3)]">
                ACTIVE
              </span>
            </div>
            <div
              className="text-[13px] font-mono font-medium truncate"
              title={guessedOp}
            >
              {guessedOp}
            </div>

            {/* Recent gcode log preview */}
            <div className="bg-black border border-[var(--color-border)] rounded-sm p-2 max-h-[88px] overflow-y-auto font-mono text-[10.5px] leading-relaxed">
              {recentLines.length === 0 ? (
                <div className="text-[var(--color-fg-muted)] italic">
                  Waiting for klipper output…
                </div>
              ) : (
                recentLines
                  .slice()
                  .reverse()
                  .map((l, i) => (
                    <div key={i} className="text-[var(--color-fg-muted)]">
                      {l.text}
                    </div>
                  ))
              )}
            </div>

            <div className="flex gap-3 text-[10px] tabular-nums">
              <Stat
                label="Elapsed"
                value={formatDuration(elapsedSec)}
                accent
              />
              <Stat
                label="Position"
                value={
                  state.toolhead?.position
                    ? `${state.toolhead.position[0]?.toFixed(0)},${state.toolhead.position[1]?.toFixed(0)},${state.toolhead.position[2]?.toFixed(1)}`
                    : "—"
                }
              />
              <Stat
                label="State"
                value={state.idle_timeout?.state ?? "—"}
              />
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // ---------- IDLE / NO ACTIVITY ----------
  if (!filename && !isPrintingFile && printState !== "complete") {
    return (
      <Card title="Mission Status" icon={<FileText />}>
        <div className="flex items-center justify-between py-1">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
              {printState}
            </div>
            <div className="text-[14px] font-medium mt-1">Ready to print</div>
          </div>
        </div>
      </Card>
    );
  }

  // ---------- PRINT ACTIVE ----------
  return (
    <Card
      title="Mission Status"
      icon={<FileText />}
      action={
        isPrintingFile ? (
          <div className="flex gap-1">
            {printState === "printing" ? (
              <Button size="sm" variant="ghost" onClick={() => mr.pause()}>
                <Pause className="w-3 h-3" /> Pause
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => mr.resume()}>
                <Play className="w-3 h-3" /> Resume
              </Button>
            )}
            <Button size="sm" variant="danger" onClick={() => mr.cancel()}>
              <Square className="w-3 h-3" /> Cancel
            </Button>
          </div>
        ) : isComplete && filename ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              if (confirm(`Print again: ${filename}?`)) {
                mr.startPrint(filename).catch(() => {});
              }
            }}
          >
            <RotateCcw className="w-3 h-3" /> Print again
          </Button>
        ) : null
      }
    >
      <div className="grid grid-cols-[120px_1fr] gap-4">
        {/* Thumbnail */}
        <div className="aspect-square rounded-md border border-[var(--color-border)] bg-black overflow-hidden flex items-center justify-center">
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={filename}
              className="w-full h-full object-contain"
            />
          ) : (
            <FileText className="w-10 h-10 text-[var(--color-fg-muted)]/40" />
          )}
        </div>

        <div className="flex flex-col justify-between gap-3">
          <div className="flex items-baseline gap-2 min-w-0">
            <span
              className="text-[13px] font-medium truncate"
              title={filename}
            >
              {filename || "—"}
            </span>
            <StateBadge state={printState} />
          </div>

          {/* Timeline */}
          <div className="relative pt-3 pb-2">
            <div className="absolute left-0 right-0 top-[18px] h-0.5 bg-[var(--color-elevated)] rounded-full" />
            <div
              className="absolute left-0 top-[18px] h-0.5 bg-gradient-to-r from-[var(--color-accent)] to-[#fb923c] rounded-full transition-[width] duration-700"
              style={{ width: `${progress * 100}%` }}
            />
            <div className="relative flex justify-between">
              {checkpoints.map((cp) => {
                const reached = progress >= cp.at;
                const current =
                  progress >= cp.at && progress < cp.at + 0.05;
                return (
                  <div
                    key={cp.label}
                    className="flex flex-col items-center gap-1"
                  >
                    <span
                      className={cn(
                        "block w-3 h-3 rounded-full border-2 transition-all",
                        current &&
                          "bg-[var(--color-accent)] border-[var(--color-accent)] shadow-[0_0_8px_rgba(249,115,22,0.6)] scale-125",
                        reached &&
                          !current &&
                          "bg-[var(--color-accent)] border-[var(--color-accent)]",
                        !reached &&
                          "bg-[var(--color-bg)] border-[var(--color-border-strong)]",
                      )}
                    />
                    <span
                      className={cn(
                        "text-[9px] uppercase tracking-[0.1em] font-semibold mt-1",
                        reached
                          ? "text-[var(--color-fg)]"
                          : "text-[var(--color-fg-muted)]/60",
                      )}
                    >
                      {cp.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 pt-1">
            <Stat
              label="Progress"
              value={`${(progress * 100).toFixed(1)}%`}
              accent
            />
            <Stat label="Elapsed" value={formatDuration(elapsed)} />
            <Stat
              label="ETA"
              value={isPrintingFile ? formatDuration(remaining) : "—"}
            />
            <Stat
              label="Filament"
              value={
                filamentMm > 0 ? `${(filamentMm / 1000).toFixed(2)} m` : "—"
              }
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
        {label}
      </div>
      <div
        className={cn(
          "text-[15px] font-semibold tabular-nums mt-0.5",
          accent && "text-[var(--color-accent)]",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const variants: Record<string, string> = {
    printing:
      "text-[var(--color-accent)] bg-[rgba(249,115,22,0.10)] border-[rgba(249,115,22,0.3)]",
    paused:
      "text-[var(--color-warning)] bg-[rgba(245,158,11,0.10)] border-[rgba(245,158,11,0.3)]",
    complete:
      "text-[var(--color-success)] bg-[rgba(16,185,129,0.10)] border-[rgba(16,185,129,0.3)]",
    cancelled:
      "text-[var(--color-fg-muted)] bg-[var(--color-elevated)] border-[var(--color-border)]",
    error:
      "text-[var(--color-error)] bg-[rgba(239,68,68,0.10)] border-[rgba(239,68,68,0.3)]",
    standby:
      "text-[var(--color-fg-muted)] bg-[var(--color-elevated)] border-[var(--color-border)]",
  };
  return (
    <span
      className={cn(
        "shrink-0 px-1.5 py-0.5 rounded-sm border text-[9px] font-semibold uppercase tracking-[0.1em]",
        variants[state] ?? variants.standby,
      )}
    >
      {state}
    </span>
  );
}
