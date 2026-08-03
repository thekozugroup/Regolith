import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { PrintDialog, type GcodeMetadata } from "@/components/PrintDialog";
import { PrintHistory } from "@/components/PrintHistory";
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


export function Files() {
  const { state, connected } = usePrinter();
  const safety = getSafetyState(state);
  const [files, setFiles] = useState<MoonrakerFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<MoonrakerFile | null>(null);
  const [metadata, setMetadata] = useState<GcodeMetadata | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const closePrintDialog = useCallback(() => setDialogOpen(false), []);

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

  const openPrintDialog = () => {
    if (safety.isBusy || !selected) return;
    setDialogOpen(true);
  };

  return (
    <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-3 p-[clamp(0.75rem,2vw,1.5rem)] md:grid-cols-8 lg:grid-cols-12">
      {/* File list */}
      <Card
        title="Files"
        icon={<FileText />}
        className="md:col-span-3 lg:col-span-5"
        action={
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </Button>
        }
      >
        <div aria-busy={loading}>
        <div className="sr-only" role="status" aria-live="polite">
          {loading
            ? "Loading print files."
            : err
              ? "Print files could not be loaded."
              : `${filtered.length} print files available.`}
        </div>

        {/* Search */}
        <div className="mb-2 flex min-h-11 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3">
          <Search className="w-3.5 h-3.5 text-[var(--color-fg-muted)]" />
          <input
            aria-label="Filter print files"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="min-h-11 min-w-0 flex-1 bg-transparent text-[12px] font-mono outline-none"
          />
        </div>

        {safety.isBusy && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-warning)] mb-2 px-2 py-1.5 bg-(--color-warning)/6 border border-(--color-warning)/25 rounded-sm">
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

        <ul className="divide-y divide-[var(--color-border)] max-h-[60vh] overflow-y-auto -mx-[clamp(0.75rem,1.4vw,1.25rem)]">
          {filtered.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                aria-pressed={selected?.path === f.path}
                className={cn(
                  "w-full min-h-11 border-l-2 border-transparent flex items-center gap-3 py-2 px-[clamp(0.75rem,1.4vw,1.25rem)] text-left transition-colors",
                  selected?.path === f.path
                    ? "border-l-[var(--color-accent)] bg-(--color-accent)/8"
                    : "hover:bg-[var(--color-elevated)]",
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
                  <div className="text-[13px] font-medium truncate">
                    {f.path}
                  </div>
                  <div className="text-[11px] text-[var(--color-fg-muted)] tabular-nums">
                    {formatBytes(f.size)} ·{" "}
                    {new Date(f.modified * 1000).toLocaleDateString()}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
        </div>
      </Card>

      {/* Detail panel */}
      <Card title="Details" icon={<HardDrive />} className="md:col-span-5 lg:col-span-7">
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
                alt={`Preview of ${selected.path}`}
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
                disabled={safety.isBusy || !safety.klipperReady || !connected}
                onClick={openPrintDialog}
                className="w-full"
              >
                <Play className="w-4 h-4" />
                {!connected
                  ? "Printer offline"
                  : !safety.klipperReady
                    ? "Klipper not ready"
                    : safety.isBusy
                      ? safety.busyReason
                      : "Start print"}
              </Button>
              <div className="text-[11px] text-[var(--color-fg-muted)] text-center mt-1.5 leading-tight">
                Confirms before sending. Make sure the bed is clear and your
                start gcode handles homing.
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* History card spans both columns */}
      <div className="md:col-span-8 lg:col-span-12">
        <PrintHistory />
      </div>

      {/* Print dialog modal */}
      {selected && (
        <PrintDialog
          file={selected}
          metadata={metadata}
          open={dialogOpen}
          onClose={closePrintDialog}
        />
      )}
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
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
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
