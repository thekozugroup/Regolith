import { useEffect, useState } from "react";
import { Pause, Play, Square, FileText } from "lucide-react";
import { Button } from "./Button";
import { Card } from "./Card";
import { usePrinter } from "@/lib/usePrinter";
import { moonraker } from "@/lib/moonraker";
import { formatDuration, cn } from "@/lib/utils";

/**
 * Mission Status laid out as SpaceX-style timeline.
 * Shows: thumbnail · timeline progress dot · key stats · controls.
 */
export function MissionTimeline() {
  const { state, mr } = usePrinter();
  const ps = state.print_stats;
  const sd = state.virtual_sdcard;
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  const printState = ps?.state ?? "standby";
  const isPrinting = printState === "printing" || printState === "paused";
  const isComplete = printState === "complete";
  const filename = ps?.filename ?? "";
  const progress = sd?.progress ?? 0;
  const elapsed = ps?.print_duration ?? 0;
  const totalEst = state.toolhead?.estimated_print_time ?? 0;
  const remaining = totalEst > elapsed ? totalEst - elapsed : 0;
  const filamentMm = ps?.filament_used ?? 0;

  // Resolve thumbnail (Fluidd convention)
  useEffect(() => {
    if (!filename) {
      setThumbUrl(null);
      return;
    }
    const url = moonraker.thumbnailUrl(filename, 300);
    // Probe existence
    const img = new Image();
    img.onload = () => setThumbUrl(url);
    img.onerror = () => setThumbUrl(null);
    img.src = url;
  }, [filename]);

  // Timeline checkpoints — derived from progress
  const checkpoints = [
    { label: "Start", at: 0 },
    { label: "25%", at: 0.25 },
    { label: "50%", at: 0.5 },
    { label: "75%", at: 0.75 },
    { label: "Done", at: 1 },
  ];

  return (
    <Card
      title="Mission Status"
      icon={<FileText />}
      action={
        isPrinting && (
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
        )
      }
    >
      {!filename && !isComplete ? (
        <div className="flex items-center justify-between py-1">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
              {printState}
            </div>
            <div className="text-[14px] font-medium mt-1">Ready to print</div>
          </div>
        </div>
      ) : (
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

          {/* Timeline + stats */}
          <div className="flex flex-col justify-between gap-3">
            {/* Filename + state badge */}
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
              {/* Track */}
              <div className="absolute left-0 right-0 top-[18px] h-0.5 bg-[var(--color-elevated)] rounded-full" />
              {/* Filled */}
              <div
                className="absolute left-0 top-[18px] h-0.5 bg-gradient-to-r from-[var(--color-accent)] to-[#fb923c] rounded-full transition-[width] duration-700"
                style={{ width: `${progress * 100}%` }}
              />
              {/* Checkpoint dots */}
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

            {/* Stats grid */}
            <div className="grid grid-cols-4 gap-3 pt-1">
              <Stat
                label="Progress"
                value={`${(progress * 100).toFixed(1)}%`}
                accent
              />
              <Stat label="Elapsed" value={formatDuration(elapsed)} />
              <Stat
                label="ETA"
                value={isPrinting ? formatDuration(remaining) : "—"}
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
      )}
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
