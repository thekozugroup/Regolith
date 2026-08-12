import { useEffect, useId, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { buttonClassName } from "@/components/buttonStyles";
import { ActionConfirmDialog } from "@/components/ActionConfirmDialog";
import { Film, Download, Trash2, Play, RefreshCw } from "lucide-react";
import { formatBytes, cn } from "@/lib/utils";
import { useTimelapse } from "@/lib/useTimelapse";
import { usePrinterSelector } from "@/lib/usePrinter";
import { getSafetyState } from "@/lib/safety";
import { moonraker } from "@/lib/moonraker";
import {
  RENDER_CONFIRMATION,
  timelapseRenderGate,
  type TimelapseRender,
} from "@/lib/timelapse";

interface TimelapseFile {
  path: string;
  size: number;
  modified: number;
}

/** Frame files the plugin leaves in its working directory. */
const FRAME_FILE = /\.(jpe?g|png)$/i;

/**
 * Deadline on EVERY read and write this page makes.
 *
 * A browser fetch has no default timeout, and a wedged Moonraker is not an
 * error path — the socket accepts, then never answers, so no rejection ever
 * arrives on its own. This printer has already been observed CPU-starved and
 * unresponsive while still accepting connections, which is precisely that
 * state. Without a deadline the page sits in its loading skeleton forever:
 * the exact "looks like it is working" lie this cockpit refuses to render.
 *
 * The two supporting reads resolve an abort to "unknown", which the page
 * states plainly. The list read has no such fallback — it is the page — so
 * its abort surfaces as a named failure with a retry.
 */
const READ_TIMEOUT_MS = 5_000;

/**
 * A failed read, in the owner's words.
 *
 * Neither way a fetch rejects produces a message fit for an instrument: our
 * own deadline aborts with browser boilerplate ("signal timed out"), and a
 * dead link rejects with "Failed to fetch". An error this page threw itself
 * already reads plainly and is passed through unchanged.
 */
function readFailure(error: unknown): string {
  const err = error as { name?: string; message?: string } | null;
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return "The printer accepted the connection and then didn't answer within 5 seconds.";
  }
  if (err?.name === "TypeError" || !err?.message) {
    return "The printer could not be reached.";
  }
  return err.message;
}

/**
 * Frames waiting on the printer, or null when this host does not expose the
 * plugin's frame directory. Unknown is reported as unknown — never as zero.
 */
async function readFrameBacklog(): Promise<number | null> {
  try {
    const res = await fetch("/server/files/list?root=timelapse_frames", {
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const list = (data.result ?? []) as Array<{ path?: string }>;
    if (!Array.isArray(list)) return null;
    return list.filter((file) => FRAME_FILE.test(file?.path ?? "")).length;
  } catch {
    return null;
  }
}

/**
 * Jobs waiting in Moonraker's queue, or null when the host has no queue API.
 * A queued job is a print that is about to start, and a render must not be
 * running into it.
 */
async function readQueuedJobs(): Promise<number | null> {
  try {
    const res = await fetch("/server/job_queue/status", {
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const jobs = data.result?.queued_jobs;
    return Array.isArray(jobs) ? jobs.length : null;
  } catch {
    return null;
  }
}

const frameCount = (n: number) =>
  n === 1 ? "1 frame" : `${n.toLocaleString()} frames`;

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
  const [frameBacklog, setFrameBacklog] = useState<number | null>(null);
  const [queuedJobs, setQueuedJobs] = useState<number | null>(null);
  const [confirmingRender, setConfirmingRender] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  /** The render banner as it stood when the owner asked, or null if unasked. */
  const [renderAsked, setRenderAsked] = useState<{
    was: TimelapseRender | null;
  } | null>(null);
  const blockedId = useId();
  const { activity, recording } = useTimelapse();
  const render = activity.render;

  // The printer's live state is the authority on whether a render may run:
  // ffmpeg and Klipper share the same two cores, and the loser of that fight
  // is the print. Flat bag of primitives so the selector gate holds.
  const printer = usePrinterSelector((state, connected) => {
    const safety = getSafetyState(state);
    return {
      connected,
      busyReason: safety.isBusy ? (safety.busyReason ?? "Printer is busy") : null,
    };
  });

  // The request is "pending" only until the plugin's own stream answers it —
  // comparing identity means the NEXT event clears it, whatever it says.
  const renderAsking = renderAsked !== null && render === renderAsked.was;
  const gate = timelapseRenderGate({
    connected: printer.connected,
    busyReason: printer.busyReason,
    queuedJobs,
    rendering: render?.status === "running" || renderAsking,
  });

  const load = async () => {
    setLoading(true);
    try {
      // The library read carries the same deadline as the two beside it. It
      // is the one fetch on this page with no "unknown" to fall back to, so
      // an unbounded one is the difference between an honest failure and a
      // skeleton that never resolves.
      const [res, frames, queued] = await Promise.all([
        fetch("/server/files/list?root=timelapse", {
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        }),
        readFrameBacklog(),
        readQueuedJobs(),
      ]);
      setFrameBacklog(frames);
      setQueuedJobs(queued);
      if (!res.ok) throw new Error(`The printer answered HTTP ${res.status}.`);
      const data = await res.json();
      const list = (data.result ?? []) as TimelapseFile[];
      // Show only video files (mp4/avi/mov), sorted newest first
      const videos = list
        .filter((f) => /\.(mp4|avi|mov|webm)$/i.test(f.path))
        .sort((a, b) => b.modified - a.modified);
      setFiles(videos);
      setErr(null);
    } catch (e) {
      setErr(readFailure(e));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Ask the printer to render, having warned first.
   *
   * Re-gated at the moment of dispatch: a print can start while the warning
   * sits open, and starting an ffmpeg pass into a live job is the exact
   * failure this whole change exists to prevent.
   */
  const startRender = async () => {
    setConfirmingRender(false);
    setRenderError(null);
    if (!gate.allowed) {
      setRenderError(gate.reason);
      return;
    }
    setRenderAsked({ was: render });
    try {
      await moonraker.renderTimelapse();
    } catch (e) {
      setRenderAsked(null);
      setRenderError(
        `The printer did not start the render — ${(e as Error).message}`,
      );
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
      // Deadlined like every other call here: a delete that never settles
      // leaves the owner watching a file that is neither gone nor reported.
      const res = await fetch(
        `/server/files/timelapse/${encodeURIComponent(file.path)}`,
        {
          method: "DELETE",
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        },
      );
      if (!res.ok) throw new Error(`The printer answered HTTP ${res.status}.`);
      setSelected(null);
      await load();
    } catch (e) {
      setDeleteError(`The timelapse wasn't deleted. ${readFailure(e)}`);
    }
  };

  const downloadUrl = (file: TimelapseFile) =>
    `/server/files/timelapse/${encodeURIComponent(file.path)}`;

  // Frames on the printer's disk are the honest backlog: the plugin clears
  // them only after a SUCCESSFUL render, so a failed render leaves them
  // queued for the next one. That compounding is what turned a single armed
  // autorender into an unattended 1873-frame encode.
  const sessionFrames = render?.status === "success" ? null : activity.frames;
  const backlogLine =
    frameBacklog !== null
      ? frameBacklog > 0
        ? `${frameCount(frameBacklog)} waiting on the printer, not yet rendered. Frames are cleared only after a render succeeds, so a failed one leaves them queued for the next.`
        : "No frames are waiting to be rendered."
      : sessionFrames && sessionFrames > 0
        ? `${frameCount(sessionFrames)} captured on this link, with no video rendered from them yet.`
        : "No frames are waiting to be rendered.";

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
        {(render || recording || renderAsking) && (
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
            ) : recording ? (
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
            ) : (
              /* Asked, not yet answered. The plugin's first event replaces
                 this — it is never a claim that anything is encoding yet. */
              <div className="flex items-baseline justify-between gap-3">
                <span className="instrument-label text-[11px]">
                  Waiting for the printer to start rendering
                </span>
              </div>
            )}
          </div>
        )}
        {/* THE MANUAL RENDER.
            Regolith disarms the plugin's autorender on every print start,
            because an unattended ffmpeg pass over a finished print's frames
            drove this printer's load to 30 and shut Klipper down. Rendering
            is therefore something the owner starts, on an idle printer,
            watching it happen — and the backlog is stated plainly, because
            frames survive a failed render and pile onto the next one. */}
        <div className="mb-[var(--stack)] flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <p
              data-testid="timelapse-backlog"
              className="text-[11px] leading-relaxed text-[var(--color-fg-muted)]"
            >
              {backlogLine}
            </p>
            {gate.reason && (
              <p
                id={blockedId}
                data-testid="timelapse-render-blocked"
                className="text-[11px] leading-relaxed text-[var(--color-warning)]"
              >
                {gate.reason}
              </p>
            )}
            {renderError && (
              <p
                role="alert"
                data-testid="timelapse-render-error"
                className="text-[11px] leading-relaxed text-[var(--color-error)]"
              >
                {renderError}
              </p>
            )}
          </div>
          <Button
            size="sm"
            data-testid="timelapse-render"
            disabled={!gate.allowed}
            aria-describedby={gate.reason ? blockedId : undefined}
            onClick={() => {
              setRenderError(null);
              setConfirmingRender(true);
            }}
          >
            <Film className="w-3 h-3" /> Render timelapse
          </Button>
        </div>
        <div aria-busy={loading}>
        {/* THE HONEST FAILURE. A read that timed out is not a blank list and
            not an eternal skeleton: it is a printer that did not answer, said
            in those words, with the way out attached. */}
        {err && (
          <div
            role="alert"
            data-testid="timelapse-list-error"
            className="py-6 text-center"
          >
            <div className="text-[12px] font-medium text-[var(--color-error)]">
              Couldn't reach the printer
            </div>
            <div className="mx-auto mt-1 max-w-[42ch] text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
              {err} The timelapses on it are unknown, not gone.
            </div>
            <Button
              size="sm"
              className="mt-3"
              data-testid="timelapse-list-retry"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
              Try again
            </Button>
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

      {/* The warning is not a formality: this is the operation that hung the
          machine, and the owner has to know what it costs before it runs. */}
      {confirmingRender && (
        <ActionConfirmDialog
          details={RENDER_CONFIRMATION}
          onConfirm={() => void startRender()}
          onCancel={() => setConfirmingRender(false)}
        />
      )}

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
