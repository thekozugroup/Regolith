import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { PrintDialog, type GcodeMetadata } from "@/components/PrintDialog";
import { PrintHistory } from "@/components/PrintHistory";
import { moonraker, type MoonrakerFile } from "@/lib/moonraker";
import { pickThumbnail, thumbnailUrlFor } from "@/lib/thumbnails";
import { fetchFileMetadata, type FileMetadata } from "@/lib/useJobHistory";
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
    void load();
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

  // Preview URL resolved from what metadata REPORTS (directory-relative to
  // the file), never from a guessed flat path. `undefined` while metadata is
  // unresolved, `null` when the file genuinely embeds no preview.
  const previewUrl =
    selected == null || metadata == null
      ? undefined
      : resolveThumbnail(selected.path, metadata.thumbnails);

  return (
    <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-[var(--grid-gap)] p-[var(--page-gutter)] md:grid-cols-8 lg:grid-cols-12">
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
        <div className="control-group mb-2 flex min-h-11 items-center gap-2 border border-[var(--color-border)] bg-[var(--color-elevated)] px-3">
          <Search className="w-3.5 h-3.5 text-[var(--color-fg-muted)]" />
          <input
            aria-label="Filter print files"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="min-h-11 min-w-0 flex-1 bg-transparent text-[12px] font-mono"
          />
        </div>

        {safety.isBusy && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-warning)] mb-2 px-2 py-1.5 bg-(--color-warning)/6 border border-(--color-warning)/25 rounded-inner">
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
          <div className="py-8 text-center" data-testid="files-empty">
            <FileText
              aria-hidden="true"
              className="w-8 h-8 mx-auto text-[var(--color-fg-subtle)] mb-2"
            />
            <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">
              {filter ? "No matching files" : "No print files yet"}
            </div>
            <div className="text-[11px] text-[var(--color-fg-subtle)] mt-1">
              {filter
                ? "Try a shorter search."
                : "Upload gcode from your slicer to see it here."}
            </div>
          </div>
        )}

        {/* Steady placeholder rows during the initial load — the list keeps
            its shape instead of collapsing to blank glass. No shimmer: calm
            by default, and nothing to silence under reduced motion. */}
        {loading && files.length === 0 && !err && (
          <ul
            aria-hidden="true"
            data-testid="files-skeleton"
            className="divide-y divide-[var(--color-border)] bleed"
          >
            {[0, 1, 2].map((row) => (
              <li
                key={row}
                className="flex items-center gap-3 px-[var(--card-pad)] py-2"
              >
                <span className="h-8 w-8 shrink-0 rounded-inner bg-[var(--color-elevated)]" />
                <span className="min-w-0 flex-1 space-y-1.5">
                  <span className="block h-3 w-3/5 rounded-inner bg-[var(--color-elevated)]" />
                  <span className="block h-2.5 w-2/5 rounded-inner bg-[var(--color-elevated)]" />
                </span>
              </li>
            ))}
          </ul>
        )}

        <ul className="divide-y divide-[var(--color-border)] max-h-[60vh] overflow-y-auto bleed">
          {filtered.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                aria-pressed={selected?.path === f.path}
                className={cn(
                  "w-full min-h-11 border-l-2 border-transparent flex items-center gap-3 py-2 px-[var(--card-pad)] text-left transition-colors",
                  selected?.path === f.path
                    ? "border-l-[var(--color-accent)] bg-(--color-accent)/8"
                    : "hover:bg-[var(--color-elevated)]",
                )}
                onClick={() => setSelected(f)}
              >
                <ListThumb key={f.path} path={f.path} />
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
          <div className="py-8 text-center text-[var(--color-fg-muted)] text-[12px] uppercase tracking-[0.1em]">
            Select a file to preview
          </div>
        ) : (
          <div className="space-y-[var(--stack)]">
            {/* Big thumbnail — or a designed placeholder. Keyed on the path
                so the failure latch resets when another file is selected. */}
            <GcodePreview
              key={selected.path}
              path={selected.path}
              previewUrl={previewUrl}
            />

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
            <div className="grid grid-cols-2 gap-[var(--grid-gap)] text-[11px]">
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

/** Resolve the best embedded preview URL for a file, or null when it has
 *  none. The `relative_path` Moonraker reports is relative to the FILE's own
 *  directory — never a flat `.thumbs/` guess at the gcode root. */
function resolveThumbnail(
  path: string,
  thumbnails: unknown,
  minWidth?: number,
): string | null {
  const relative = pickThumbnail(thumbnails, minWidth);
  return relative ? thumbnailUrlFor(path, relative) : null;
}

/**
 * List-row thumbnail resolved from what metadata REPORTS, never probed.
 * Slicers are not required to embed thumbnails, so "none" is an expected
 * state: it renders the designed icon tile WITHOUT ever issuing the doomed
 * request that used to 404 into the console for every thumbless row. While
 * metadata is still unresolved, a quiet neutral square holds the space —
 * unknown must never render as a "no preview" claim. Keyed on the file path
 * by the caller so the failure latch resets per file.
 */
function ListThumb({ path }: { path: string }) {
  const [meta, setMeta] = useState<FileMetadata | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void fetchFileMetadata(path).then((m) => {
      if (live) setMeta(m);
    });
    return () => {
      live = false;
    };
  }, [path]);

  if (meta === null) {
    // Metadata still unresolved — hold the space, claim nothing.
    return (
      <span
        aria-hidden="true"
        className="h-8 w-8 shrink-0 rounded-inner border border-[var(--color-border)] bg-[var(--color-elevated)]"
      />
    );
  }

  const src = meta.thumbnailSmallUrl ?? meta.thumbnailUrl;
  if (src === null || failed) {
    return (
      <span
        aria-hidden="true"
        data-testid="thumb-fallback"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-inner border border-[var(--color-border)] bg-[var(--color-elevated)]"
      >
        <FileText className="h-3.5 w-3.5 text-[var(--color-fg-subtle)]" />
      </span>
    );
  }
  return (
    <img
      src={src}
      onError={() => setFailed(true)}
      loading="lazy"
      className="w-8 h-8 rounded-inner border border-[var(--color-border)] bg-[var(--color-elevated)] object-cover shrink-0"
      alt=""
    />
  );
}

/**
 * Detail-panel preview. The metadata endpoint already reports whether the
 * file embeds thumbnails — and WHERE, relative to the file's own directory —
 * so a file sliced without one renders its designed placeholder WITHOUT ever
 * issuing the doomed image request (which used to 404 into the console and
 * leave a hollow frame).
 *
 *   previewUrl is a string    → real preview (error-latched, belt+braces)
 *   previewUrl === null       → designed "no preview" tile
 *   previewUrl === undefined  → metadata still unresolved: a quiet neutral
 *     frame. Unknown must never render as a "no preview" claim — the same
 *     rule as the em-dash readouts.
 */
function GcodePreview({
  path,
  previewUrl,
}: {
  path: string;
  previewUrl: string | null | undefined;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = typeof previewUrl === "string" && !failed;
  return (
    <div className="aspect-square w-full max-w-[200px] mx-auto rounded-inner border border-[var(--color-border)] bg-[var(--color-elevated)] overflow-hidden flex items-center justify-center">
      {showImage ? (
        <img
          src={previewUrl}
          alt={`Preview of ${path}`}
          onError={() => setFailed(true)}
          className="w-full h-full object-contain"
        />
      ) : (
        <div
          className="flex flex-col items-center gap-2 p-4 text-center"
          data-testid="preview-fallback"
        >
          <FileText
            aria-hidden="true"
            className="h-8 w-8 text-[var(--color-fg-subtle)]"
          />
          {previewUrl === null || failed ? (
            <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">
              No preview in this file
            </span>
          ) : null}
        </div>
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
      <div className="text-[12px] font-medium tabular-nums mt-0.5">
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
