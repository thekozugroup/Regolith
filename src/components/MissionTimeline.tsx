import { useEffect, useState } from "react";
import { Pause, Play, Square, FileText, Activity, X, RotateCcw, AlertTriangle } from "lucide-react";
import { ActionConfirmDialog } from "./ActionConfirmDialog";
import { Button } from "./Button";
import { Card } from "./Card";
import { usePrinter } from "@/lib/usePrinter";
import { useGcodeLog } from "@/lib/useGcodeLog";
import { moonraker } from "@/lib/moonraker";
import {
  guardPrinterAction,
  runPrinterAction,
  type ActionConfirmation,
  type PrinterAction,
} from "@/lib/printerActions";
import { AiGloss } from "./AiGloss";
import { AiPostMortem } from "./AiPostMortem";
import { useAiFeatureReady } from "@/lib/ai/flags";
import { explainKlipperLine } from "@/lib/ai/explain";
import { computeJobTiming } from "@/lib/jobProgress";
import { useJobHistory } from "@/lib/useJobHistory";
import { formatDuration, cn, recentMeaningfulLines } from "@/lib/utils";

/**
 * `print_stats.info.current_layer` / `.total_layer` are whatever the slicer
 * chose to emit. Plenty of slicers emit neither, some emit only one of the
 * two, and Klipper forwards explicit `null`s through untouched. Render each
 * side only when it is a real number, so a partial answer stays a partial
 * answer instead of becoming "null / 250" or "undefined".
 *
 * Returns `null` when nothing is known — the caller drops the whole row rather
 * than printing an empty one.
 */
function formatLayer(
  current: number | null | undefined,
  total: number | null | undefined,
): string | null {
  const value = (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 ? String(Math.trunc(n)) : null;
  const c = value(current);
  const t = value(total);
  if (c && t) return `${c} / ${t}`;
  if (c) return c;
  if (t) return `— / ${t}`;
  return null;
}

/**
 * `print_stats.message` is where Klipper puts the REASON a print stopped —
 * "Heater extruder not heating at expected rate", "Move out of range",
 * "Print cancelled by user". It is free text from firmware, so anything could
 * be in it; drop the JS-placeholder words outright rather than letting them
 * onto the glass looking like telemetry.
 */
function jobReason(message: string | null | undefined): string {
  const text = (message ?? "").trim();
  if (!text) return "";
  if (/^(null|undefined|nan)$/i.test(text)) return "";
  return text;
}

/** Hoisted once (WP-MEMO): five static markers, never a per-render array. */
const CHECKPOINTS = [
  { label: "Start", at: 0 },
  { label: "25%", at: 0.25 },
  { label: "50%", at: 0.5 },
  { label: "75%", at: 0.75 },
  { label: "Done", at: 1 },
] as const;

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
  const { state, connected } = usePrinter();
  const ps = state.print_stats;
  const sd = state.virtual_sdcard;
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<{
    details: ActionConfirmation;
    resolve: (accepted: boolean) => void;
  } | null>(null);

  const printState = ps?.state ?? "standby";
  const isPrintingFile = printState === "printing" || printState === "paused";
  const isComplete = printState === "complete";
  // A job that STOPPED. It is not running, so nothing about it may be
  // presented as live — but it is also not nothing: it has a reason and it is
  // the job the owner most wants to run again.
  const isStopped = printState === "cancelled" || printState === "error";
  const filename = ps?.filename ?? "";
  const klipperBusy = state.idle_timeout?.state === "Printing";
  // Non-print activity: klipper busy but no print file
  const isTuning = klipperBusy && !filename;

  // Calibration inputs for the early-job estimate: this printer's measured
  // bias against its slicer's guesses, plus the guess for THIS file. Both are
  // optional read-only REST reads that fail to null — see lib/useJobHistory.
  const { slicerEstimate, calibration } = useJobHistory(
    isPrintingFile ? filename : undefined,
  );

  // Remaining is derived from the JOB's own progress and elapsed time and
  // returns null when it cannot be trusted — see lib/jobProgress.ts. It must
  // never come from `toolhead.estimated_print_time`, which is Klipper's
  // monotonic clock, not a job duration.
  //
  // Before the job has printed enough of its file to extrapolate from, the
  // history calibration can answer instead. That answer is arithmetic over
  // past prints, not a measurement of this one, so it is rendered as an
  // estimate and never in the measured value's confident styling.
  const { elapsed, progress, remaining, calibrated } = computeJobTiming(
    ps?.print_duration,
    sd?.progress,
    { slicerEstimate, calibration },
  );
  // Optional, opt-in glosses on a job that STOPPED. Both default to off and
  // render nothing at all until the owner configures the assistant, so the
  // panel below is byte-identical to its pre-assistant form by default.
  const explainReady = useAiFeatureReady("explain");
  const postMortemReady = useAiFeatureReady("postmortem");
  const filamentMm = ps?.filament_used ?? 0;
  const layerText = formatLayer(ps?.info?.current_layer, ps?.info?.total_layer);
  const reason = jobReason(ps?.message);

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

  const dispatch = async (action: PrinterAction) => {
    setActionBusy(action.type);
    setActionError(null);
    try {
      await runPrinterAction(action, {
        // The app's own dialog, never `window.confirm`: a native confirm
        // blocks the main thread, freezing telemetry and the alert stack for
        // as long as it sits open. runPrinterAction awaits the promise and
        // re-guards against LIVE state after the owner answers.
        confirm: (details: ActionConfirmation) =>
          new Promise<boolean>((resolve) =>
            setConfirmRequest({ details, resolve }),
          ),
      });
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Printer action failed.",
      );
    } finally {
      setActionBusy(null);
    }
  };

  const settleConfirm = (accepted: boolean) => {
    if (!confirmRequest) return;
    confirmRequest.resolve(accepted);
    setConfirmRequest(null);
  };

  const confirmDialog = confirmRequest ? (
    <ActionConfirmDialog
      details={confirmRequest.details}
      onConfirm={() => settleConfirm(true)}
      onCancel={() => settleConfirm(false)}
    />
  ) : null;

  const can = (action: PrinterAction) =>
    guardPrinterAction(state, connected, action).allowed;

  // ---------- TUNING / MACRO MODE ----------
  if (isTuning) {
    return (
      <>
        <TuningStatus
          connected={connected}
          actionBusy={actionBusy}
          actionError={actionError}
          position={state.toolhead?.position}
          idleState={state.idle_timeout?.state}
          onEmergencyStop={() =>
            dispatch({
              type: "emergency-stop",
              context:
                "Klipper has no universal safe cancel command for this calibration.",
            })
          }
        />
        {confirmDialog}
      </>
    );
  }

  // ---------- IDLE / NO ACTIVITY ----------
  // Gate on the STATE, not on whether a filename happens to be lying around.
  // Klipper keeps `print_stats.filename` populated after a job ends, so the
  // old `!filename` test let every cancelled, errored and leftover-standby job
  // fall through into the print-active layout below and claim a live-looking
  // Progress readout for something that was not running.
  const hasJob = isPrintingFile || isComplete || isStopped;
  if (!hasJob) {
    return (
      <>
      <Card title="Mission Status" icon={<FileText />}>
        <div className="flex items-center justify-between py-1">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
              {printState}
            </div>
            <div className="text-[14px] font-medium mt-1">Ready to print</div>
          </div>
        </div>
      </Card>
      {/* A confirmation opened from another branch must survive the state
          flipping to idle underneath it, or its promise never settles. */}
      {confirmDialog}
      </>
    );
  }

  // ---------- JOB PANEL (running, finished, or stopped) ----------
  const repeatGuard = filename
    ? guardPrinterAction(state, connected, { type: "repeat-print", filename })
    : { allowed: false, reason: "No job file to repeat." };

  return (
    <>
    <Card
      title="Mission Status"
      icon={<FileText />}
      action={
        isPrintingFile ? (
          <div className="flex gap-1">
            {printState === "printing" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={!!actionBusy || !can({ type: "pause-print" })}
                onClick={() => dispatch({ type: "pause-print" })}
              >
                <Pause className="w-3 h-3" /> Pause
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                disabled={!!actionBusy || !can({ type: "resume-print" })}
                onClick={() => dispatch({ type: "resume-print" })}
              >
                <Play className="w-3 h-3" /> Resume
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              disabled={!!actionBusy || !can({ type: "cancel-print" })}
              onClick={() => dispatch({ type: "cancel-print" })}
            >
              <Square className="w-3 h-3" /> Cancel
            </Button>
          </div>
        ) : (isComplete || isStopped) && filename ? (
          // A stopped job is exactly what the owner most wants to retry, so
          // "Print again" is offered for cancelled/errored jobs too — not just
          // for completed ones. When the machine will not accept it yet, the
          // guard's own reason rides along on the disabled control instead of
          // leaving a dead button with no explanation.
          <Button
            size="sm"
            variant="primary"
            disabled={!!actionBusy || !repeatGuard.allowed}
            title={repeatGuard.allowed ? undefined : repeatGuard.reason}
            onClick={() => dispatch({ type: "repeat-print", filename })}
          >
            <RotateCcw className="w-3 h-3" /> Print again
          </Button>
        ) : null
      }
    >
      {actionError && (
        <div role="alert" className="mb-3 rounded-inner border border-(--color-error)/35 bg-(--color-error)/8 p-3 text-[13px] text-[var(--color-error)]">
          {actionError}
        </div>
      )}
      <div className="mission-media-grid">
        {/* Thumbnail */}
        <div className="flex aspect-square items-center justify-center overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)]">
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={filename}
              className="w-full h-full object-contain"
            />
          ) : (
            <FileText className="w-10 h-10 text-[var(--color-fg-subtle)]" />
          )}
        </div>

        <div className="flex flex-col justify-between gap-3">
          <div className="flex items-baseline gap-2 min-w-0">
            <span
              className="text-[13px] font-medium truncate"
              title={filename}
            >
              {filename ? filename.split("/").pop()?.replace(/\.gcode$/i, "") : "—"}
            </span>
            <StateBadge state={printState} />
          </div>

          {/* Timeline. A stopped job gets none: a part-filled accent track
              reads as a job that is still advancing. The frozen percentage is
              still reported below, labelled as the point it stopped at. */}
          {!isStopped && <div className="relative pt-3 pb-2">
            <div className="absolute left-0 right-0 top-[18px] h-0.5 bg-[var(--color-elevated)]" />
            <div
              className="absolute left-0 top-[18px] h-0.5 bg-[var(--color-accent)] transition-[width] duration-150"
              style={{ width: `${progress * 100}%` }}
            />
            <div className="relative flex justify-between">
              {CHECKPOINTS.map((cp) => {
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
                        "block h-3 w-3 border-2 transition-[background-color,border-color,transform] duration-150",
                        current &&
                          "bg-[var(--color-accent)] border-[var(--color-accent)] scale-110",
                        reached &&
                          !current &&
                          "bg-[var(--color-accent)] border-[var(--color-accent)]",
                        !reached &&
                          "bg-[var(--color-bg)] border-[var(--color-border-strong)]",
                      )}
                    />
                    <span
                      className={cn(
                        "text-[11px] uppercase tracking-[0.1em] font-semibold mt-1",
                        reached
                          ? "text-[var(--color-fg)]"
                          : "text-[var(--color-fg-muted)]",
                      )}
                    >
                      {cp.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>}

          {/* Why it stopped. Klipper writes the cause into
              `print_stats.message` — "Heater extruder not heating at expected
              rate", "Move out of range", "Print cancelled by user". Nothing in
              this UI used to read it, so every failure looked identical: the
              job simply vanished mid-print with no explanation anywhere. */}
          {isStopped && reason && (
            <div
              data-job-reason
              role="status"
              className={cn(
                "flex items-start gap-2 border p-2 text-[13px] leading-relaxed",
                printState === "error"
                  ? "border-(--color-error)/35 bg-(--color-error)/8 text-[var(--color-error)]"
                  : "border-[var(--color-border)] bg-[var(--color-elevated)] text-[var(--color-fg)]",
              )}
            >
              <AlertTriangle aria-hidden="true" className="mt-0.5 w-3.5 h-3.5 shrink-0" />
              <span className="min-w-0">
                <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-[var(--color-fg-muted)]">
                  Reason{" "}
                </span>
                {reason}
              </span>
            </div>
          )}

          {isStopped && (explainReady || postMortemReady) && (
            <div className="flex flex-col gap-2">
              {explainReady && reason && (
                <AiGloss
                  label="Explain this reason"
                  run={() => explainKlipperLine(reason)}
                />
              )}
              {postMortemReady && <AiPostMortem />}
            </div>
          )}

          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
            <Stat
              // A stopped job is not making progress. Report the point it got
              // to, under a label that says so, instead of a live "Progress".
              label={isStopped ? "Stopped at" : "Progress"}
              value={`${(progress * 100).toFixed(1)}%`}
              accent={!isStopped}
            />
            {layerText && <Stat label="Layer" value={layerText} accent={!isStopped} />}
            <Stat
              // Only a running job has time left, and only when the estimate
              // is trustworthy — see lib/jobProgress.ts. Everything else gets
              // the honest placeholder rather than a confident wrong number.
              //
              // A calibrated (pre-trend) answer is prefixed `~`, dropped out
              // of the accent treatment measured values wear, and carries its
              // provenance in text — it is derived from other prints, not
              // from this one, and it must never look like telemetry.
              label="Remaining"
              value={
                isPrintingFile && remaining != null
                  ? `${calibrated ? "~" : ""}${formatDuration(remaining)}`
                  : "—"
              }
              accent={isPrintingFile && remaining != null && !calibrated}
              estimate={isPrintingFile && remaining != null && calibrated}
              hint={
                isPrintingFile && remaining != null && calibrated && calibration
                  ? `Estimated from your last ${calibration.samples} completed prints`
                  : undefined
              }
            />
            <Stat label="Elapsed" value={formatDuration(elapsed)} />
            <Stat
              label="Filament used"
              value={
                filamentMm > 0 ? `${(filamentMm / 1000).toFixed(2)} m` : "—"
              }
            />
          </div>
        </div>
      </div>
    </Card>
    {confirmDialog}
    </>
  );
}

/**
 * Tuning/macro mode, split out (WP-MEMO) so the gcode-log subscription only
 * exists while a calibration is actually running: useGcodeLog re-renders on
 * every klipper response line, which is exactly the traffic a long macro
 * produces and exactly what the idle/print branches never read. Mounting
 * the component IS the activity-start marker — it appears when isTuning
 * flips true, so elapsed counts from the moment the machine went busy.
 */
function TuningStatus({
  connected,
  actionBusy,
  actionError,
  position,
  idleState,
  onEmergencyStop,
}: {
  connected: boolean;
  actionBusy: string | null;
  actionError: string | null;
  position?: [number, number, number, number];
  idleState?: string;
  onEmergencyStop: () => void;
}) {
  const log = useGcodeLog(20);
  const [startedAt] = useState(() => Date.now());
  const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
  // Newest-first meaningful lines (bare "ok" acknowledgements dropped).
  const recentLines = recentMeaningfulLines(log);
  // What is it doing RIGHT NOW — the newest line, index 0. The old code
  // read the last element of this newest-first window, i.e. the OLDEST of
  // the four, so the headline op lagged three commands behind the machine.
  const guessedOp = recentLines[0]?.text || "—";

  return (
    <Card
      title="Mission Status"
      icon={<Activity />}
      action={
        <Button
          size="sm"
          variant="danger"
          disabled={!!actionBusy || !connected}
          onClick={onEmergencyStop}
        >
          <X className="w-3 h-3" /> Emergency stop
        </Button>
      }
    >
      {actionError && (
        <div role="alert" className="mb-3 rounded-inner border border-(--color-error)/35 bg-(--color-error)/8 p-3 text-[13px] text-[var(--color-error)]">
          {actionError}
        </div>
      )}
      <div className="mission-media-grid">
        <div className="flex aspect-square items-center justify-center overflow-hidden border border-[var(--color-accent)] bg-[var(--color-accent-faint)]">
          <Activity
            className="w-12 h-12 text-[var(--color-accent)]"
            strokeWidth={1.25}
          />
        </div>

        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)] font-semibold">
              Calibration · Tuning
            </span>
            <span className="shrink-0 px-1.5 py-0.5 rounded-inner border text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-accent)] bg-[var(--color-accent-soft)] border-[var(--color-accent-edge)]">
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
          <div className="max-h-[88px] overflow-y-auto border border-[var(--color-border)] bg-[var(--color-bg)] p-2 font-mono text-[11px] leading-relaxed">
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

          <div className="flex gap-3 text-[11px] tabular-nums">
            <Stat
              label="Elapsed"
              value={formatDuration(elapsedSec)}
              accent
            />
            <Stat
              label="Position"
              value={
                position
                  ? `${position[0]?.toFixed(0)},${position[1]?.toFixed(0)},${position[2]?.toFixed(1)}`
                  : "—"
              }
            />
            <Stat label="State" value={idleState ?? "—"} />
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * A labelled readout. `accent` marks a MEASURED live value; `estimate` marks
 * a derived one and deliberately renders weaker — same 15px so the 11px floor
 * is never in question, but muted and unaccented so no glance mistakes it for
 * telemetry. `hint` states the provenance as ALWAYS-VISIBLE text under the
 * value — never `title`-only: a hover tooltip does not exist on the K1's
 * touch panel or any phone, and provenance is exactly what a touch user must
 * be able to see. Visible text also reaches screen readers, so no sr-only
 * duplicate is needed.
 */
function Stat({
  label,
  value,
  accent,
  estimate,
  hint,
}: {
  label: string;
  value: string;
  accent?: boolean;
  estimate?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
        {label}
      </div>
      <div
        data-estimate={estimate ? "true" : undefined}
        className={cn(
          "text-[15px] font-semibold tabular-nums mt-0.5",
          accent && "text-[var(--color-accent)]",
          estimate && "text-[var(--color-fg-muted)]",
        )}
      >
        {value}
        {hint && (
          <span
            data-provenance
            className="mt-0.5 block max-w-[24ch] text-[11px] font-normal leading-snug text-[var(--color-fg-muted)]"
          >
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const variants: Record<string, string> = {
    printing:
      "text-[var(--color-accent)] bg-[var(--color-accent-soft)] border-[var(--color-accent-edge)]",
    paused:
      "text-[var(--color-warning)] bg-(--color-warning)/10 border-(--color-warning)/30",
    complete:
      "text-[var(--color-success)] bg-(--color-success)/10 border-(--color-success)/30",
    cancelled:
      "text-[var(--color-fg-muted)] bg-[var(--color-elevated)] border-[var(--color-border)]",
    error:
      "text-[var(--color-error)] bg-(--color-error)/10 border-(--color-error)/30",
    standby:
      "text-[var(--color-fg-muted)] bg-[var(--color-elevated)] border-[var(--color-border)]",
  };
  return (
    <span
      className={cn(
        "shrink-0 px-1.5 py-0.5 rounded-inner border text-[11px] font-semibold uppercase tracking-[0.1em]",
        variants[state] ?? variants.standby,
      )}
    >
      {state}
    </span>
  );
}
