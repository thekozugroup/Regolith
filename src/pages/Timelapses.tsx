import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { buttonClassName } from "@/components/buttonStyles";
import { ActionConfirmDialog } from "@/components/ActionConfirmDialog";
import { Film, Download, Trash2, Play, RefreshCw } from "lucide-react";
import { formatBytes, cn } from "@/lib/utils";
import { useTimelapse } from "@/lib/useTimelapse";

interface TimelapseFile {
  path: string;
  size: number;
  modified: number;
}

/** The plugin's terminal render states, in the owner's words. */
const RENDER_WORD: Record<string, string> = {
  running: "Rendering video",
  success: "Video ready",
  skipped: "Render skipped",
  error: "Render failed",
};

export function Timelapses() {
  const [files, setFiles] = useState<TimelapseFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<TimelapseFile | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TimelapseFile | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { activity, recording } = useTimelapse();
  const render = activity.render;

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/server/files/list?root=timelapse");
      if (!res.ok) throw new Error(`Could not load timelapses (${res.status}).`);
      const data = await res.json();
      const list = (data.result ?? []) as TimelapseFile[];
      // Show only video files (mp4/avi/mov), sorted newest first
      const videos = list
        .filter((f) => /\.(mp4|avi|mov|webm)$/i.test(f.path))
        .sort((a, b) => b.modified - a.modified);
      setFiles(videos);
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

  // A finished render means a NEW file exists on the printer. Refreshing on
  // that edge is what turns this page from a snapshot into a live library —
  // without it the owner watches a render reach 100% and then stares at a
  // list that still says the video is not there.
  useEffect(() => {
    if (render?.status !== "success") return;
    void load();
  }, [render?.status, render?.filename]);

  // In-app confirmation, never `window.confirm`: the native dialog blocks
  // the main thread, so the HealthAlerts watchdog (and every live readout)
  // would freeze for as long as it sat open — the same rule every guarded
  // printer action already follows via ActionConfirmDialog.
  const remove = async (file: TimelapseFile) => {
    setPendingDelete(null);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/server/files/timelapse/${encodeURIComponent(file.path)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`the printer answered HTTP ${res.status}`);
      setSelected(null);
      await load();
    } catch (e) {
      setDeleteError(
        `The timelapse wasn't deleted — ${(e as Error).message}.`,
      );
    }
  };

  const downloadUrl = (file: TimelapseFile) =>
    `/server/files/timelapse/${encodeURIComponent(file.path)}`;

  return (
    <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-[var(--grid-gap)] p-[var(--page-gutter)] md:grid-cols-8 lg:grid-cols-12">
      <Card
        title="Timelapses"
        icon={<Film />}
        className="md:col-span-3 lg:col-span-5"
        action={
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            Refresh
          </Button>
        }
      >
        <div className="sr-only" role="status" aria-live="polite">
          {loading
            ? "Loading timelapses."
            : err
              ? "Timelapses could not be loaded."
              : `${files.length} timelapses available.`}
        </div>
        {/* Live capture / render state. Rendered ONLY when something is
            actually happening — an idle machine gets no dead complication,
            the same law the mission bar follows. */}
        {(render || recording) && (
          <div
            data-testid="timelapse-activity"
            role="status"
            aria-live="polite"
            className="mb-[var(--stack)] rounded-inner border border-[var(--color-border)] p-3"
          >
            {render ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="instrument-label text-[11px]">
                    {RENDER_WORD[render.status]}
                  </span>
                  {render.progress !== null && (
                    <span className="instrument-value text-[12px] font-semibold tabular-nums">
                      {`${Math.round(render.progress)}%`}
                    </span>
                  )}
                </div>
                {render.status === "running" && (
                  <div
                    aria-hidden="true"
                    className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--color-elevated)]"
                  >
                    <div
                      data-testid="timelapse-render-bar"
                      className="h-full bg-[var(--color-accent)] transition-[width] duration-300"
                      style={{ width: `${render.progress ?? 0}%` }}
                    />
                  </div>
                )}
                {(render.filename || render.message) && (
                  <div className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-fg-muted)] break-all">
                    {render.filename ?? render.message}
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-baseline justify-between gap-3">
                {/* Lit by FRAMES ARRIVING, never by the plugin's global
                    `enabled` flag — that flag is true on printers that have
                    never captured anything. */}
                <span className="instrument-label text-[11px] text-[var(--color-accent)]">
                  Recording
                </span>
                <span className="instrument-value text-[12px] font-semibold tabular-nums">
                  {activity.frames === 1
                    ? "1 frame"
                    : `${activity.frames ?? 0} frames`}
                </span>
              </div>
            )}
          </div>
        )}
        <div aria-busy={loading}>
        {err && (
          <div className="text-[12px] text-[var(--color-error)] py-3 text-center">
            {err}
          </div>
        )}
        {!err && !loading && files.length === 0 && (
          <div className="py-8 text-center">
            <Film className="w-8 h-8 mx-auto text-[var(--color-fg-subtle)] mb-2" />
            <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">
              No timelapses yet
            </div>
            {/* This line used to point at a control that did not exist
                anywhere in the app. The switch is in the print dialog, on
                the print confirmation, and it is off by default. */}
            <div className="text-[11px] text-[var(--color-fg-subtle)] mt-1">
              Turn on “Record timelapse” when you start a print.
            </div>
          </div>
        )}
        {/* Steady placeholder rows during the initial load — the list keeps
            its shape instead of collapsing to blank glass. */}
        {loading && files.length === 0 && !err && (
          <ul
            aria-hidden="true"
            data-testid="timelapse-skeleton"
            className="divide-y divide-[var(--color-border)] bleed"
          >
            {[0, 1, 2].map((row) => (
              <li
                key={row}
                className="flex items-center gap-3 px-[var(--card-pad)] py-2"
              >
                <span className="h-9 w-12 shrink-0 rounded-inner bg-[var(--color-elevated)]" />
                <span className="min-w-0 flex-1 space-y-1.5">
                  <span className="block h-3 w-3/5 rounded-inner bg-[var(--color-elevated)]" />
                  <span className="block h-2.5 w-2/5 rounded-inner bg-[var(--color-elevated)]" />
                </span>
              </li>
            ))}
          </ul>
        )}
        <ul className="divide-y divide-[var(--color-border)] max-h-[60vh] overflow-y-auto bleed">
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                aria-pressed={selected?.path === f.path}
                className={cn(
                  "press-flat flex min-h-11 w-full items-center gap-3 border-l-2 border-transparent px-[var(--card-pad)] py-2 text-left transition-colors",
                  selected?.path === f.path
                    ? "border-l-[var(--color-accent)] bg-(--color-accent)/8"
                    : "hover:bg-[var(--color-elevated)]",
                )}
                onClick={() => setSelected(f)}
              >
                <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded-inner border border-[var(--color-border)] bg-black">
                  <Film className="w-4 h-4 text-[var(--color-fg-muted)]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium">
                    {f.path}
                  </span>
                  <span className="block text-[11px] text-[var(--color-fg-muted)] tabular-nums">
                    {formatBytes(f.size)} ·{" "}
                    {new Date(f.modified * 1000).toLocaleString()}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        </div>
      </Card>

      <Card title="Preview" icon={<Play />} className="md:col-span-5 lg:col-span-7">
        {!selected ? (
          <div className="py-8 text-center text-[var(--color-fg-muted)] text-[12px] uppercase tracking-[0.1em]">
            Select a timelapse to play
          </div>
        ) : (
          <div className="space-y-[var(--stack)]">
            <video
              key={selected.path}
              src={downloadUrl(selected)}
              controls
              className="w-full rounded-inner border border-[var(--color-border)] bg-black aspect-video"
            />
            <div className="text-[12px] font-mono break-all" title={selected.path}>
              {selected.path}
            </div>
            <div className="text-[11px] text-[var(--color-fg-muted)]">
              {formatBytes(selected.size)} ·{" "}
              {new Date(selected.modified * 1000).toLocaleString()}
            </div>
            {deleteError && (
              <div
                role="alert"
                className="text-[11px] leading-relaxed text-[var(--color-error)]"
              >
                {deleteError}
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <a
                href={downloadUrl(selected)}
                download={selected.path}
                className={buttonClassName({ size: "sm" })}
              >
                <Download className="w-3 h-3" /> Download
              </a>
              <Button
                size="md"
                variant="danger"
                onClick={() => {
                  setDeleteError(null);
                  setPendingDelete(selected);
                }}
              >
                <Trash2 className="w-3 h-3" /> Delete
              </Button>
            </div>
          </div>
        )}
      </Card>

      {pendingDelete && (
        <ActionConfirmDialog
          details={{
            risk: "critical",
            title: "Delete this timelapse?",
            message: `"${pendingDelete.path}" will be removed from the printer. You can't undo this.`,
            confirmLabel: "Delete",
          }}
          onConfirm={() => remove(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
