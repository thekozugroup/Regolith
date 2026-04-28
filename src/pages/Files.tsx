import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { moonraker, type MoonrakerFile } from "@/lib/moonraker";
import { usePrinter } from "@/lib/usePrinter";
import { getSafetyState } from "@/lib/safety";
import { formatBytes, cn } from "@/lib/utils";
import {
  FileText,
  Play,
  RefreshCw,
  Search,
  AlertTriangle,
  HardDrive,
  Clock,
  Layers,
} from "lucide-react";

interface GcodeMetadata {
  filename: string;
  size: number;
  modified: number;
  estimated_time?: number;
  filament_total?: number;
  filament_weight_total?: number;
  layer_height?: number;
  first_layer_height?: number;
  layer_count?: number;
  object_height?: number;
  slicer?: string;
  slicer_version?: string;
  thumbnails?: { width: number; height: number; size: number; relative_path: string }[];
}

export function Files() {
  const { state } = usePrinter();
  const safety = getSafetyState(state);
  const [files, setFiles] = useState<MoonrakerFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<MoonrakerFile | null>(null);
  const [metadata, setMetadata] = useState<GcodeMetadata | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const f = await moonraker.listFiles();
      setFiles(f.sort((a, b) => b.modified - a.modified));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Fetch detailed metadata when a file is selected
  useEffect(() => {
    if (!selected) {
      setMetadata(null);
      return;
    }
    fetch(
      `/server/files/metadata?filename=${encodeURIComponent(selected.path)}`,
    )
      .then((r) => r.json())
      .then((d) => setMetadata(d.result))
      .catch(() => setMetadata(null));
  }, [selected]);

  const filtered = filter
    ? files.filter((f) =>
        f.path.toLowerCase().includes(filter.toLowerCase()),
      )
    : files;

  const printFile = async (path: string) => {
    if (safety.isBusy) return;
    if (
      !confirm(
        `Start print: ${path}?\n\nMake sure the bed is clear and any nozzle priming is complete.`,
      )
    )
      return;
    try {
      await moonraker.startPrint(path);
    } catch (e) {
      alert(`Failed to start: ${(e as Error).message}`);
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
      {/* File list */}
      <Card
        title="Files"
        icon={<FileText />}
        action={
          <Button size="sm" variant="ghost" onClick={load}>
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </Button>
        }
      >
        {/* Search */}
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-sm">
          <Search className="w-3.5 h-3.5 text-[var(--color-fg-muted)]" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="flex-1 bg-transparent outline-none text-[12px] font-mono"
          />
        </div>

        {safety.isBusy && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-warning)] mb-2 px-2 py-1.5 bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.25)] rounded-sm">
            <AlertTriangle className="w-3 h-3" />
            <span>{safety.busyReason} — start blocked.</span>
          </div>
        )}

        {err && (
          <div className="text-[12px] text-[var(--color-error)] py-3 text-center">
            {err}
          </div>
        )}
        {!err && filtered.length === 0 && !loading && (
          <div className="text-[12px] text-[var(--color-fg-muted)] py-6 text-center uppercase tracking-[0.1em]">
            {filter ? "No matches" : "No files"}
          </div>
        )}

        <ul className="divide-y divide-[rgba(63,63,70,0.4)] max-h-[60vh] overflow-y-auto -mx-3.5">
          {filtered.map((f) => (
            <li
              key={f.path}
              className={cn(
                "flex items-center gap-3 py-2 px-3.5 cursor-pointer transition-colors",
                selected?.path === f.path
                  ? "bg-[rgba(249,115,22,0.10)]"
                  : "hover:bg-[rgba(249,115,22,0.04)]",
              )}
              onClick={() => setSelected(f)}
            >
              <img
                src={moonraker.thumbnailUrl(f.path, 32)}
                onError={(e) =>
                  ((e.target as HTMLImageElement).style.opacity = "0")
                }
                className="w-8 h-8 rounded border border-[var(--color-border)] bg-[var(--color-elevated)] object-cover shrink-0"
                alt=""
              />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium truncate">
                  {f.path}
                </div>
                <div className="text-[10px] text-[var(--color-fg-muted)] tabular-nums">
                  {formatBytes(f.size)} ·{" "}
                  {new Date(f.modified * 1000).toLocaleDateString()}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Detail panel */}
      <Card title="Details" icon={<HardDrive />}>
        {!selected ? (
          <div className="py-12 text-center text-[var(--color-fg-muted)] text-[12px] uppercase tracking-[0.1em]">
            Select a file to preview
          </div>
        ) : (
          <div className="space-y-3">
            {/* Big thumbnail */}
            <div className="aspect-square w-full max-w-[200px] mx-auto rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] overflow-hidden flex items-center justify-center">
              <img
                src={moonraker.thumbnailUrl(selected.path, 300)}
                alt=""
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  img.style.display = "none";
                }}
                className="w-full h-full object-contain"
              />
            </div>

            {/* Filename */}
            <div className="text-center">
              <div
                className="text-[12px] font-medium font-mono break-all"
                title={selected.path}
              >
                {selected.path}
              </div>
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <Stat
                icon={<HardDrive className="w-3 h-3" />}
                label="Size"
                value={formatBytes(selected.size)}
              />
              <Stat
                icon={<Clock className="w-3 h-3" />}
                label="Print time"
                value={
                  metadata?.estimated_time
                    ? formatTimeShort(metadata.estimated_time)
                    : "—"
                }
              />
              <Stat
                icon={<Layers className="w-3 h-3" />}
                label="Layers"
                value={metadata?.layer_count?.toString() ?? "—"}
              />
              <Stat
                label="Layer Height"
                value={
                  metadata?.layer_height != null
                    ? `${metadata.layer_height.toFixed(2)} mm`
                    : "—"
                }
              />
              <Stat
                label="Filament"
                value={
                  metadata?.filament_total
                    ? `${(metadata.filament_total / 1000).toFixed(2)} m`
                    : "—"
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
                label="Height"
                value={
                  metadata?.object_height
                    ? `${metadata.object_height.toFixed(1)} mm`
                    : "—"
                }
              />
              <Stat
                label="Slicer"
                value={metadata?.slicer ?? "—"}
              />
            </div>

            {/* Big print button */}
            <div className="pt-2 border-t border-[var(--color-border)]">
              <Button
                variant="primary"
                size="lg"
                disabled={safety.isBusy}
                onClick={() => printFile(selected.path)}
                className="w-full"
              >
                <Play className="w-4 h-4" />
                {safety.isBusy ? safety.busyReason : "Start Print"}
              </Button>
              <div className="text-[10px] text-[var(--color-fg-muted)] text-center mt-1.5 leading-tight">
                Confirms before sending. Make sure the bed is clear and your
                start gcode handles homing.
              </div>
            </div>
          </div>
        )}
      </Card>
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
        {icon && (
          <span className="text-[var(--color-fg-muted)]">{icon}</span>
        )}
        {label}
      </div>
      <div className="text-[12px] font-mono font-medium tabular-nums mt-0.5">
        {value}
      </div>
    </div>
  );
}

function formatTimeShort(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
