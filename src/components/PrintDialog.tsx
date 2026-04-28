import { useState } from "react";
import { Button } from "./Button";
import { moonraker, type MoonrakerFile } from "@/lib/moonraker";
import {
  X,
  Play,
  Clock,
  Layers,
  HardDrive,
  Film,
  Layers3,
  AlertTriangle,
} from "lucide-react";
import { formatBytes, cn } from "@/lib/utils";

interface PrintDialogProps {
  file: MoonrakerFile;
  metadata: GcodeMetadata | null;
  open: boolean;
  onClose: () => void;
}

export interface GcodeMetadata {
  estimated_time?: number;
  filament_total?: number;
  filament_weight_total?: number;
  layer_height?: number;
  first_layer_height?: number;
  layer_count?: number;
  object_height?: number;
  slicer?: string;
  filament_name?: string;
  filament_type?: string;
  first_layer_extr_temp?: number;
  first_layer_bed_temp?: number;
}

const KAMP_KEY = "forge.print.kamp";
const TIMELAPSE_KEY = "forge.print.timelapse";

export function PrintDialog({ file, metadata, open, onClose }: PrintDialogProps) {
  const [kamp, setKamp] = useState(
    () => localStorage.getItem(KAMP_KEY) !== "0",
  );
  const [timelapse, setTimelapse] = useState(
    () => localStorage.getItem(TIMELAPSE_KEY) === "1",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const start = async () => {
    setBusy(true);
    setError(null);
    // Persist toggles for next print
    localStorage.setItem(KAMP_KEY, kamp ? "1" : "0");
    localStorage.setItem(TIMELAPSE_KEY, timelapse ? "1" : "0");

    try {
      // Send pre-print configuration via gcode variables that PRINT_START can read
      const setup: string[] = [];
      if (kamp) {
        setup.push("SET_GCODE_VARIABLE MACRO=PRINT_START VARIABLE=use_kamp VALUE=1");
      } else {
        setup.push("SET_GCODE_VARIABLE MACRO=PRINT_START VARIABLE=use_kamp VALUE=0");
      }
      if (timelapse) {
        setup.push("TIMELAPSE_RENDER  ; pre-arm: timelapse plugin will record");
      }
      // Catch failures of the variable set quietly — fallback silently if PRINT_START doesn't expose them
      for (const cmd of setup) {
        try {
          await moonraker.runGcode(cmd);
        } catch {
          /* ignore */
        }
      }
      await moonraker.startPrint(file.path);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const time = metadata?.estimated_time;
  const filamentMeters = metadata?.filament_total
    ? metadata.filament_total / 1000
    : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-md max-w-md w-full overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-[12px] font-semibold tracking-[0.06em] uppercase">
            Confirm print
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-4 space-y-4">
          {/* Preview */}
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <div className="aspect-square rounded-md border border-[var(--color-border)] bg-black overflow-hidden flex items-center justify-center">
              <img
                src={moonraker.thumbnailUrl(file.path, 300)}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="min-w-0 flex flex-col justify-between">
              <div>
                <div className="text-[12px] font-mono font-medium break-words">
                  {file.path}
                </div>
                <div className="text-[10px] text-[var(--color-fg-muted)] mt-1 tabular-nums">
                  {formatBytes(file.size)} ·{" "}
                  {new Date(file.modified * 1000).toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2 border-t border-[var(--color-border)]">
            <Stat
              icon={<Clock className="w-3 h-3" />}
              label="Time"
              value={
                time
                  ? `${Math.floor(time / 3600)}h ${Math.floor((time % 3600) / 60)}m`
                  : "—"
              }
            />
            <Stat
              icon={<HardDrive className="w-3 h-3" />}
              label="Filament"
              value={
                filamentMeters
                  ? `${filamentMeters.toFixed(2)} m`
                  : "—"
              }
            />
            <Stat
              icon={<Layers className="w-3 h-3" />}
              label="Layers"
              value={metadata?.layer_count?.toString() ?? "—"}
            />
            <Stat
              label="Material"
              value={
                metadata?.filament_type ??
                metadata?.filament_name ??
                "—"
              }
            />
            <Stat
              label="Weight"
              value={
                metadata?.filament_weight_total
                  ? `${metadata.filament_weight_total.toFixed(1)} g`
                  : "—"
              }
            />
            <Stat
              label="Hotend / Bed"
              value={
                metadata?.first_layer_extr_temp ||
                metadata?.first_layer_bed_temp
                  ? `${metadata.first_layer_extr_temp ?? "—"}° / ${metadata.first_layer_bed_temp ?? "—"}°`
                  : "—"
              }
            />
          </div>

          {/* Pre-print options */}
          <div className="space-y-1.5 pt-3 border-t border-[var(--color-border)]">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold mb-1">
              Pre-print options
            </div>
            <Toggle
              icon={<Layers3 className="w-3.5 h-3.5" />}
              label="Adaptive bed mesh (KAMP)"
              description="Probe only the print area for faster, more accurate first layer"
              checked={kamp}
              onChange={setKamp}
            />
            <Toggle
              icon={<Film className="w-3.5 h-3.5" />}
              label="Record timelapse"
              description="Capture a frame per layer; saved to /timelapses"
              checked={timelapse}
              onChange={setTimelapse}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-2 bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.3)] rounded-sm">
              <AlertTriangle className="w-3.5 h-3.5 text-[var(--color-error)] shrink-0 mt-0.5" />
              <span className="text-[11px] text-[var(--color-error)]">
                {error}
              </span>
            </div>
          )}
        </div>

        <footer className="flex justify-between items-center px-4 py-3 border-t border-[var(--color-border)] bg-[rgba(255,255,255,0.01)]">
          <span className="text-[10px] text-[var(--color-fg-muted)]">
            Bed clear · Filament loaded · Hotend cold
          </span>
          <div className="flex gap-2">
            <Button size="md" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="md"
              variant="primary"
              onClick={start}
              disabled={busy}
            >
              <Play className="w-3.5 h-3.5" />
              {busy ? "Starting…" : "Start print"}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
        {icon && <span className="text-[var(--color-fg-muted)]">{icon}</span>}
        {label}
      </div>
      <div className="text-[12px] font-mono font-medium tabular-nums mt-0.5">
        {value}
      </div>
    </div>
  );
}

function Toggle({
  icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        "w-full flex items-center gap-3 p-2 rounded-sm border text-left transition-all",
        checked
          ? "border-[rgba(249,115,22,0.4)] bg-[rgba(249,115,22,0.06)]"
          : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]",
      )}
    >
      <span
        className={
          checked ? "text-[var(--color-accent)]" : "text-[var(--color-fg-muted)]"
        }
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12px] font-medium leading-tight">
          {label}
        </span>
        <span className="block text-[10.5px] text-[var(--color-fg-muted)] leading-tight mt-0.5">
          {description}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 w-7 h-4 rounded-full border transition-colors relative",
          checked
            ? "bg-[var(--color-accent)] border-[var(--color-accent)]"
            : "bg-[var(--color-elevated)] border-[var(--color-border-strong)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
            checked ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
