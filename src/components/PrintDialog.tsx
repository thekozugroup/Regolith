import { useEffect, useId, useState } from "react";
import { Button } from "./Button";
import { ModalSurface } from "./ModalSurface";
import { type MoonrakerFile } from "@/lib/moonraker";
import { pickThumbnail, thumbnailUrlFor } from "@/lib/thumbnails";
import { usePrinter } from "@/lib/usePrinter";
import {
  KAMP_STORAGE_KEY,
  guardPrinterAction,
  kampEnabledFromStorage,
  runPrinterAction,
  type PrinterAction,
  type PrintSetupOption,
} from "@/lib/printerActions";
import {
  TIMELAPSE_MODE_STORAGE_KEY,
  TIMELAPSE_STORAGE_KEY,
  timelapseEnabledFromStorage,
  timelapseModeFromStorage,
} from "@/lib/timelapse";
import { ChromeErrorBoundary, CrashSeam } from "./ChromeErrorBoundary";
import { HostLoadAdvisory } from "./HostLoadAdvisory";
import {
  X,
  Play,
  Clock,
  Layers,
  HardDrive,
  Layers3,
  Film,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { formatBytes, cn } from "@/lib/utils";
import { readStored, writeStoredFlag } from "@/lib/safeStorage";

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
  /** Embedded previews as Moonraker reports them; absent when the slicer
   *  wrote none — the signal the UI uses to skip a doomed thumbnail fetch. */
  thumbnails?: Array<{
    width?: number;
    height?: number;
    size?: number;
    relative_path?: string;
  }>;
}

export function PrintDialog({ file, metadata, open, onClose }: PrintDialogProps) {
  const { state, connected, profile } = usePrinter();
  // Default ON (basic QoL for kamp-capable profiles); only a persisted,
  // explicit opt-out disables it — see kampEnabledFromStorage.
  const [kamp, setKamp] = useState(() =>
    kampEnabledFromStorage(readStored(KAMP_STORAGE_KEY)),
  );
  // Persist the choice the moment it is TOGGLED, not only when a print
  // starts — closing the dialog after flipping the switch must still stick.
  const updateKamp = (value: boolean) => {
    writeStoredFlag(KAMP_STORAGE_KEY, value);
    setKamp(value);
  };
  // Recording defaults OFF — it consumes printer storage and re-encodes video
  // on the host at the end of every job. Sticky, like the KAMP choice.
  const [timelapse, setTimelapse] = useState(() =>
    timelapseEnabledFromStorage(readStored(TIMELAPSE_STORAGE_KEY)),
  );
  const updateTimelapse = (value: boolean) => {
    writeStoredFlag(TIMELAPSE_STORAGE_KEY, value);
    setTimelapse(value);
  };
  // The owner's PINNED capture mode, if they set one in Settings. Read when
  // the dialog opens, because Settings may have changed it since mount.
  const [timelapseMode, setTimelapseMode] = useState(() =>
    timelapseModeFromStorage(readStored(TIMELAPSE_MODE_STORAGE_KEY)),
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Optional setup that did NOT happen, on a print that DID start. */
  const [notices, setNotices] = useState<string[]>([]);
  const [thumbFailed, setThumbFailed] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  // Preview resolved from the path metadata REPORTS — relative to the FILE's
  // own directory — never from a flat `.thumbs/` guess at the gcode root,
  // which could not exist for a file in a subdirectory.
  const previewRelative = pickThumbnail(metadata?.thumbnails);
  const previewUrl = previewRelative
    ? thumbnailUrlFor(file.path, previewRelative)
    : null;

  const setup: PrintSetupOption[] = [];
  if (profile.features.kamp) setup.push(kamp ? "kamp-on" : "kamp-off");
  // Written on EVERY start, in BOTH directions. Moonraker holds one global
  // timelapse flag shared with Fluidd and the stock touchscreen, so whatever
  // it currently holds is never safe to assume — "do not record this one"
  // has to be asserted just as explicitly as "record this one".
  if (profile.features.timelapse) {
    setup.push({ kind: "timelapse", enabled: timelapse, mode: timelapseMode });
  }
  const action: PrinterAction = {
    type: "start-print",
    filename: file.path,
    setup,
  };
  const preflight = guardPrinterAction(state, connected, action);
  // The host-health ADVISORY — proc-stat feed, verdict, and markup — lives
  // entirely in <HostLoadAdvisory/> below, behind an error boundary. It is
  // wired to NOTHING here: the Start button's disabled state reads
  // busy/acknowledged/preflight only, guardPrinterAction does not know it
  // exists, and safety.ts has never heard of it.
  // layermacro captures ONLY when the sliced file itself calls
  // TIMELAPSE_TAKE_FRAME. Most files do not, so a toggle left unqualified
  // here would promise a recording this file cannot produce.
  const mayCaptureNothing = timelapse && timelapseMode === "layermacro";

  useEffect(() => {
    if (!open) return;
    setAcknowledged(false);
    setError(null);
    setNotices([]);
    setThumbFailed(false);
    setTimelapseMode(timelapseModeFromStorage(readStored(TIMELAPSE_MODE_STORAGE_KEY)));
  }, [open, file.path]);

  if (!open) return null;

  const start = async () => {
    setBusy(true);
    setError(null);
    setNotices([]);
    try {
      const result = await runPrinterAction(action, {
        confirm: () => acknowledged,
      });
      // The print is running either way. When an OPTIONAL step could not be
      // carried out, the dialog stays up to say so rather than closing on a
      // silent half-success — it is a notice, never an error.
      if (result.executed && result.notices?.length) {
        setNotices(result.notices);
      } else if (result.executed) {
        onClose();
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Print did not start. Printer returned an unknown error.",
      );
    } finally {
      setBusy(false);
    }
  };

  const time = metadata?.estimated_time;
  const filamentMeters = metadata?.filament_total
    ? metadata.filament_total / 1000
    : null;

  return (
    <ModalSurface
      labelledBy={titleId}
      describedBy={descriptionId}
      onDismiss={onClose}
      dismissLocked={busy}
      /* The BODY scrolls, not the panel. With the whole panel as the scroll
         region, a dialog taller than a phone viewport pushed its own footer
         out of the panel's box — the START control drifted off the corner it
         is supposed to sit concentric to, and on a short screen it could be
         scrolled away entirely. Header and footer are pinned; only the
         reviewable content moves. */
      panelClassName="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden"
    >
        {/* p-4 = --modal-pad: the corner close button keeps the strict
            concentric gap (radius-modal − pad = control radius). */}
        <header className="flex shrink-0 items-center justify-between p-4 border-b border-[var(--color-border)]">
          <h2 id={titleId} className="text-[17px] font-semibold tracking-tight">
            Ready to print?
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close print confirmation"
            className="press-flat min-w-11 min-h-11 inline-flex items-center justify-center rounded-inner text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          <p id={descriptionId} className="text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
            Review file and printer area. Regolith checks live printer state again immediately before starting.
          </p>
          {/* Preview */}
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <div className="aspect-square rounded-inner border border-[var(--color-border)] bg-black overflow-hidden flex items-center justify-center">
              {/* Same rule as the Files preview: metadata says whether a
                  thumbnail exists AND where it lives, so a thumbless file
                  shows its designed placeholder instead of a 404 and a
                  hollow black square. */}
              {previewUrl !== null && !thumbFailed ? (
                <img
                  src={previewUrl}
                  alt=""
                  onError={() => setThumbFailed(true)}
                  className="w-full h-full object-contain"
                />
              ) : (
                <Layers3
                  aria-hidden="true"
                  className="h-7 w-7 text-[var(--color-fg-subtle)]"
                />
              )}
            </div>
            <div className="min-w-0 flex flex-col justify-between">
              <div>
                <div className="text-[12px] font-mono font-medium break-words">
                  {file.path}
                </div>
                <div className="text-[11px] text-[var(--color-fg-muted)] mt-1 tabular-nums">
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
          {(profile.features.kamp || profile.features.timelapse) && (
            <div className="space-y-1.5 pt-3 border-t border-[var(--color-border)]">
              <div className="text-[12px] text-[var(--color-fg-muted)] font-semibold mb-1">
                Print setup
              </div>
              {profile.features.kamp && (
                <Toggle
                  icon={<Layers3 className="w-4 h-4" />}
                  label="Adaptive bed mesh"
                  description="Probe only this model’s print area before printing. Skipped if this printer does not support it; the print still starts."
                  checked={kamp}
                  onChange={updateKamp}
                />
              )}
              {profile.features.timelapse && (
                <>
                  <Toggle
                    testId="timelapse-toggle"
                    icon={<Film className="w-4 h-4" />}
                    label="Record timelapse"
                    description={
                      timelapseMode === "hyperlapse"
                        ? "Capture frames on a timer while this job runs; the video renders on the printer when it finishes."
                        : "Capture on layer change, driven by your slicer’s TIMELAPSE_TAKE_FRAME command."
                    }
                    checked={timelapse}
                    onChange={updateTimelapse}
                  />
                  {mayCaptureNothing && (
                    <div
                      role="status"
                      data-testid="timelapse-mode-warning"
                      className="flex items-start gap-2 p-3 bg-(--color-warning)/8 border border-(--color-warning)/35 rounded-inner"
                    >
                      <AlertTriangle className="w-4 h-4 text-[var(--color-warning)] shrink-0 mt-0.5" />
                      <span className="text-[11px] leading-relaxed text-[var(--color-warning)]">
                        Capture mode is set to layer macro, so frames are taken only
                        where this file’s g-code calls TIMELAPSE_TAKE_FRAME. A file
                        sliced without it records nothing. Choose hyperlapse in
                        Settings to record any file.
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* HOST LOAD advisory — a heads-up, never a gate, and now
              CONTAINED. /print is the only route that starts a print and it
              renders inside the shared RouteErrorBoundary, so a throw on the
              advisory path used to blank the page and take the Start button
              with it. An optional warning must never be able to remove the
              control it warns about. Keyed on the file so reopening the
              dialog for a different job re-evaluates from scratch. */}
          <ChromeErrorBoundary
            id="host-load-advisory"
            label="Host load check unavailable"
          >
            <CrashSeam id="host-load-advisory" />
            <HostLoadAdvisory
              key={file.path}
              printState={state.print_stats?.state}
            />
          </ChromeErrorBoundary>

          <button
            type="button"
            role="checkbox"
            aria-checked={acknowledged}
            onClick={() => setAcknowledged((value) => !value)}
            className={cn(
              "press-flat w-full min-h-11 flex items-start gap-3 rounded-inner border p-3 text-left transition-colors",
              acknowledged
                ? "border-[var(--color-success)] bg-(--color-success)/8"
                : "border-[var(--color-border-strong)] bg-[var(--color-bg)]",
            )}
          >
            <span className="mt-0.5 w-5 h-5 shrink-0 rounded-inner border border-current inline-flex items-center justify-center text-[var(--color-success)]">
              {acknowledged && <CheckCircle2 className="w-4 h-4" />}
            </span>
            <span className="text-[13px] leading-relaxed">
              I checked that the build plate is seated, the bed is clear, and filament can feed freely.
            </span>
          </button>

          {!preflight.allowed && (
            <div role="status" className="flex items-start gap-2 p-3 bg-(--color-warning)/8 border border-(--color-warning)/35 rounded-inner">
              <AlertTriangle className="w-4 h-4 text-[var(--color-warning)] shrink-0 mt-0.5" />
              <span className="text-[13px] text-[var(--color-warning)]">
                {preflight.reason}
              </span>
            </div>
          )}

          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 bg-(--color-error)/8 border border-(--color-error)/30 rounded-inner">
              <AlertTriangle className="w-3.5 h-3.5 text-[var(--color-error)] shrink-0 mt-0.5" />
              <span className="text-[11px] text-[var(--color-error)]">
                {error}
              </span>
            </div>
          )}

          {/* The print IS running. An optional step that did not happen is a
              notice, not a failure — the only wrong answer here would be to
              close silently and let the owner believe a recording exists. */}
          {notices.length > 0 && (
            <div
              role="status"
              data-testid="print-setup-notice"
              className="flex items-start gap-2 p-3 bg-(--color-warning)/8 border border-(--color-warning)/35 rounded-inner"
            >
              <AlertTriangle className="w-4 h-4 text-[var(--color-warning)] shrink-0 mt-0.5" />
              <span className="text-[11px] leading-relaxed text-[var(--color-warning)]">
                Print started. {notices.join(" ")}
              </span>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-col-reverse sm:flex-row sm:justify-end gap-2 p-4 border-t border-[var(--color-border)]">
          <div className="grid grid-cols-2 gap-2 sm:flex">
            {notices.length > 0 ? (
              <Button
                size="md"
                variant="primary"
                onClick={onClose}
                className="col-span-2"
              >
                Close
              </Button>
            ) : (
              <>
                <Button size="md" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  size="md"
                  variant="primary"
                  onClick={start}
                  disabled={busy || !acknowledged || !preflight.allowed}
                >
                  <Play className="w-3.5 h-3.5" />
                  {busy ? "Checking printer…" : "Start print"}
                </Button>
              </>
            )}
          </div>
        </footer>
    </ModalSurface>
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
        {icon && <span className="text-[var(--color-fg-muted)]">{icon}</span>}
        {label}
      </div>
      <div className="text-[12px] font-medium tabular-nums mt-0.5">
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
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "press-flat w-full min-h-11 flex items-center gap-3 p-3 rounded-inner border text-left transition-colors",
        checked
          ? "border-[var(--color-accent-edge)] bg-[var(--color-accent-faint)]"
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
        <span className="block text-[11px] text-[var(--color-fg-muted)] leading-tight mt-0.5">
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
            "absolute top-0.5 w-3 h-3 rounded-full bg-[var(--color-fg)] transition-transform",
            checked ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
