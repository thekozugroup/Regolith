import { useId, useRef, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { ModalSurface } from "@/components/ModalSurface";
import { BedMeshHeatmap } from "@/components/BedMeshHeatmap";
import { useActionConfirm } from "@/components/useActionConfirm";
import { usePrinter } from "@/lib/usePrinter";
import { getSafetyState } from "@/lib/safety";
import { runPrinterAction } from "@/lib/printerActions";
import {
  Sliders,
  Activity,
  Layers,
  Flame,
  Crosshair,
  Wrench,
  AlertTriangle,
  CheckCircle2,
  X,
  Play,
} from "lucide-react";
interface TuneAction {
  id: string;
  title: string;
  subtitle: string;
  duration: string;
  gcode: string;
  followup?: string; // e.g. SAVE_CONFIG
  confirm: string;
  movesPrinthead: boolean;
}

const ACTIONS: Record<string, TuneAction[]> = {
  "Input Shaper": [
    {
      id: "shaper_calibrate",
      title: "Auto Calibrate",
      subtitle: "Sweeps X & Y resonance via accelerometer, picks optimal damper.",
      duration: "~5 min",
      gcode: "G28\nSHAPER_CALIBRATE",
      followup: "SAVE_CONFIG",
      confirm:
        "This will home the printer, then move both axes through a frequency sweep. Continue?",
      movesPrinthead: true,
    },
    {
      id: "belts_shaper",
      title: "Belt Tension Check",
      subtitle: "Measures only belts; useful after retensioning.",
      duration: "~2 min",
      gcode: "BELTS_SHAPER_CALIBRATION",
      confirm: "Belt-only resonance check. Continue?",
      movesPrinthead: true,
    },
  ],
  "Bed Mesh": [
    {
      id: "bed_mesh",
      title: "Calibrate Bed Mesh",
      subtitle: "Probes a grid across the bed for first-layer compensation.",
      duration: "~3 min",
      gcode: "G28\nBED_MESH_CALIBRATE PROFILE=default",
      followup: "BED_MESH_PROFILE SAVE=default\nSAVE_CONFIG",
      confirm: "This homes and probes the bed grid. Continue?",
      movesPrinthead: true,
    },
    {
      id: "screws_tilt",
      title: "Bed Screws Tilt",
      subtitle: "Measures bed level; tells which screws to adjust.",
      duration: "~2 min",
      gcode: "G28\nSCREWS_TILT_CALCULATE",
      confirm:
        "Probes 4 corners. Output appears in Console. You'll manually turn screws after.",
      movesPrinthead: true,
    },
  ],
  "Probe & Position": [
    {
      id: "probe_accuracy",
      title: "Probe Accuracy",
      subtitle: "Checks Z probe repeatability (5 samples).",
      duration: "~1 min",
      gcode: "G28\nPROBE_ACCURACY SAMPLES=5",
      confirm: "Read-only probe sanity check. Continue?",
      movesPrinthead: true,
    },
    {
      id: "z_offset",
      title: "Calibrate Z-Offset",
      subtitle: "Live first-layer adjustment via paper test.",
      duration: "~3 min",
      gcode: "G28\nZ_ENDSTOP_CALIBRATE",
      followup: "SAVE_CONFIG",
      confirm: "Manual paper-test adjustment. Use TESTZ Z=±0.05 in console.",
      movesPrinthead: true,
    },
  ],
  Heaters: [
    {
      id: "pid_hotend",
      title: "PID Tune Hotend",
      subtitle: "Cycles hotend to 220°C and measures response.",
      duration: "~7 min",
      gcode: "PID_CALIBRATE HEATER=extruder TARGET=220",
      followup: "SAVE_CONFIG",
      confirm:
        "Hotend will heat to 220°C and oscillate. Make sure no filament is loaded.",
      movesPrinthead: false,
    },
    {
      id: "pid_bed",
      title: "PID Tune Bed",
      subtitle: "Cycles bed to 70°C and measures response.",
      duration: "~10 min",
      gcode: "PID_CALIBRATE HEATER=heater_bed TARGET=70",
      followup: "SAVE_CONFIG",
      confirm: "Bed will heat to 70°C and oscillate. Continue?",
      movesPrinthead: false,
    },
  ],
  "Quick Actions": [
    {
      id: "save_config",
      title: "Save Config",
      subtitle:
        "Persist any pending calibration values; klipper restarts.",
      duration: "instant",
      gcode: "SAVE_CONFIG",
      confirm: "Klipper will restart after saving. Continue?",
      movesPrinthead: false,
    },
    {
      id: "firmware_restart",
      title: "Firmware Restart",
      subtitle: "Restart klipper without saving anything.",
      duration: "~5s",
      gcode: "FIRMWARE_RESTART",
      confirm: "Restart klipper firmware?",
      movesPrinthead: false,
    },
  ],
};

const SECTION_ICONS: Record<string, React.ReactNode> = {
  "Input Shaper": <Activity />,
  "Bed Mesh": <Layers />,
  "Probe & Position": <Crosshair />,
  Heaters: <Flame />,
  "Quick Actions": <Wrench />,
};

const SECTION_LAYOUT: Record<string, string> = {
  "Input Shaper": "sm:col-span-2",
  "Bed Mesh": "",
  "Probe & Position": "",
  Heaters: "",
  "Quick Actions": "",
};

interface RunningAction {
  id: string;
  title: string;
  startedAt: number;
}

export function Tune() {
  const { state, connected } = usePrinter();
  const [pending, setPending] = useState<TuneAction | null>(null);
  const [running, setRunning] = useState<RunningAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pa, setPa] = useState<number | null>(null);
  const actionBusyRef = useRef(false);
  const pressureAdvanceId = useId();
  const pressureAdvanceHintId = useId();
  const safety = getSafetyState(state);
  const isPrinting = safety.isBusy;
  // In-app confirm, never window.confirm: the native dialog blocks the main
  // thread and freezes the health watchdog for as long as it sits open.
  const { confirm, confirmDialog } = useActionConfirm();

  // TRUTHFULNESS: never substitute a plausible default for an unknown machine
  // value. The old `?? 0.04` did not merely mislabel the readout — Apply sent
  // that invented number to the hardware. With no `extruder` telemetry the
  // value is UNKNOWN: the readout says so, and the slider plus both Apply
  // buttons stay disabled, so there is nothing to send.
  const currentPa = state.extruder?.pressure_advance ?? null;
  const paKnown = currentPa != null;
  const displayedPa = pa ?? currentPa;

  const runAction = async (action: TuneAction) => {
    if (actionBusyRef.current) return;
    actionBusyRef.current = true;
    setRunning({ id: action.id, title: action.title, startedAt: Date.now() });
    setPending(null);
    setActionError(null);
    try {
      await runPrinterAction(
        {
          type: "tune-command",
          title: action.title,
          command: [action.gcode, action.followup].filter(Boolean).join("\n"),
          confirmation: action.confirm,
        },
        {
          // Confirmation already occurred in the accessible Tune modal. The
          // shared runner still awaits this callback, then re-checks live state.
          confirm: () => true,
        },
      );
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Tune action failed. Printer returned an unknown error.",
      );
    } finally {
      actionBusyRef.current = false;
      setRunning(null);
    }
  };

  const applyPa = async (save: boolean) => {
    if (actionBusyRef.current) return;
    // Belt-and-braces against the fabricated-value class of bug: even if a
    // future edit re-enables the controls, an unknown value is never sent.
    if (displayedPa == null) return;
    actionBusyRef.current = true;
    setRunning({
      id: "pressure_advance",
      title: save ? "Save Pressure Advance" : "Apply Pressure Advance",
      startedAt: Date.now(),
    });
    setActionError(null);
    try {
      const result = await runPrinterAction(
        { type: "set-pressure-advance", value: displayedPa, save },
        { confirm },
      );
      if (result.executed) setPa(null);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Pressure advance change failed. Printer returned an unknown error.",
      );
    } finally {
      actionBusyRef.current = false;
      setRunning(null);
    }
  };

  return (
    <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-[var(--grid-gap)] p-[var(--page-gutter)] md:grid-cols-2 lg:grid-cols-4">
      {/* Banner: warn if printer is busy (any reason) */}
      {safety.isBusy && (
        <div className="md:col-span-2 lg:col-span-4 flex items-center gap-2 border border-(--color-warning)/40 bg-(--color-warning)/10 px-3 py-2 text-[12px]">
          <AlertTriangle className="w-4 h-4 text-[var(--color-warning)] shrink-0" />
          <span className="text-[var(--color-warning)] font-medium">
            {safety.busyReason ?? "Busy"} — calibration actions disabled.
          </span>
        </div>
      )}
      {!safety.klipperReady && (
        <div className="md:col-span-2 lg:col-span-4 flex items-center gap-2 border border-(--color-error)/40 bg-(--color-error)/10 px-3 py-2 text-[12px]">
          <AlertTriangle className="w-4 h-4 text-[var(--color-error)] shrink-0" />
          <span className="text-[var(--color-error)] font-medium">
            Klipper not ready ({state.webhooks?.state ?? "?"}) — fix before
            running calibrations.
          </span>
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          className="md:col-span-2 lg:col-span-4 border border-(--color-error)/40 bg-(--color-error)/10 px-3 py-2 text-[13px] text-[var(--color-error)]"
        >
          {actionError}
        </div>
      )}

      {/* Live action toast */}
      {running && (
        <div className="md:col-span-2 lg:col-span-4 flex items-center gap-2 border border-[var(--color-accent-edge)] bg-[var(--color-accent-soft)] px-3 py-2 text-[12px]">
          <Activity className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
          <span className="text-[var(--color-accent)] font-medium flex-1">
            Running: {running.title}
          </span>
          <span className="text-[var(--color-fg-muted)] tabular-nums">
            {Math.floor((Date.now() - running.startedAt) / 1000)}s
          </span>
        </div>
      )}

      <section aria-labelledby="calibration-groups" className="md:col-span-2 lg:col-span-4 xl:col-span-3">
        <div className="mb-2 flex items-center justify-between border-b border-[var(--color-border)] pb-2">
          <h2 id="calibration-groups" className="text-[14px] font-semibold">Calibration & maintenance</h2>
          <span className="instrument-label">Guarded expert tools</span>
        </div>
        <div className="grid grid-cols-1 gap-[var(--grid-gap)] sm:grid-cols-2">
          {Object.entries(ACTIONS).map(([section, actions]) => (
            <Card key={section} title={section} icon={SECTION_ICONS[section]} className={SECTION_LAYOUT[section]}>
              <div className="space-y-[var(--stack-tight)]">
                {actions.map((action) => (
                  <ActionRow
                    key={action.id}
                    action={action}
                    disabled={!connected || isPrinting || !safety.klipperReady || !!running}
                    onClick={() => setPending(action)}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* The right rail. Pressure Advance used to be a bare grid item, a
          SIBLING of the calibration <section> — so at xl it started where
          that section's HEADING started, 38px above where Input Shaper's
          card actually begins, and then absorbed the whole 768px row height
          as internal slack (owner: "pressure advance … is too high" /
          "wasted space in card"). Giving column 4 its own section, with the
          identical 38px heading block, makes both first cards start at
          Y₀+38 — the alignment is structural, not a tuned offset. The Bed
          Mesh heatmap moves in below Pressure Advance, so the rail reads
          calibrate → tune → mesh at every width.

          The section is the grid item and takes the row stretch; its
          children sit in an auto-rows grid and keep their natural heights,
          so the residual lands in a transparent wrapper, never inside a
          card. Below xl the rail spans full width and stacks under the
          calibration section — item 2 is a no-op on the K1's own 800x480
          panel. The children carry NO span classes on purpose: a stale
          lg:col-span-4 inside this 1-column grid manufactures implicit
          tracks and mis-sizes the card. */}
      <section
        aria-labelledby="live-tuning"
        className="md:col-span-2 lg:col-span-4 xl:col-span-1"
      >
        <div className="mb-2 flex items-center justify-between border-b border-[var(--color-border)] pb-2">
          <h2 id="live-tuning" className="text-[14px] font-semibold">Live tuning</h2>
          <span className="instrument-label">Machine state</span>
        </div>
        <div className="grid grid-cols-1 gap-[var(--grid-gap)]">
          <Card title="Pressure Advance" icon={<Sliders />}>
            <div className="space-y-[var(--stack-tight)]">
              <div className="text-[12px] text-[var(--color-fg-muted)]">
                Live tunable. Apply temporarily or save permanently.
              </div>
              <div className="flex items-center gap-3 py-2">
                <label htmlFor={pressureAdvanceId} className="sr-only">
                  Pressure advance in seconds
                </label>
                <input
                  id={pressureAdvanceId}
                  type="range"
                  min="0"
                  max="0.2"
                  step="0.005"
                  // A range input must carry a number. When the machine value is
                  // unknown the control is disabled, so this position is inert —
                  // and aria-valuetext says "unknown" rather than announcing a
                  // number the printer never reported.
                  value={displayedPa ?? 0}
                  onChange={(e) => setPa(parseFloat(e.target.value))}
                  aria-describedby={pressureAdvanceHintId}
                  aria-valuetext={
                    displayedPa != null ? `${displayedPa.toFixed(4)} seconds` : "Unknown"
                  }
                  className="min-h-11 flex-1 accent-[var(--color-accent)]"
                  disabled={
                    !paKnown || !connected || isPrinting || !safety.klipperReady || !!running
                  }
                />
                <output
                  htmlFor={pressureAdvanceId}
                  className="w-24 text-right text-[14px] font-semibold tabular-nums"
                  aria-live="polite"
                  data-pa-known={paKnown ? "true" : "false"}
                >
                  {displayedPa != null ? `${displayedPa.toFixed(4)} s` : "—"}
                </output>
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  disabled={
                    !paKnown ||
                    !connected ||
                    isPrinting ||
                    !safety.klipperReady ||
                    !!running ||
                    pa === null
                  }
                  onClick={() => applyPa(false)}
                >
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={
                    !paKnown ||
                    !connected ||
                    isPrinting ||
                    !safety.klipperReady ||
                    !!running ||
                    pa === null
                  }
                  onClick={() => applyPa(true)}
                >
                  Apply & Save
                </Button>
                {pa !== null && (
                  <Button size="sm" variant="ghost" disabled={!!running} onClick={() => setPa(null)}>
                    Reset
                  </Button>
                )}
              </div>
              <div
                id={pressureAdvanceHintId}
                className="text-[11px] text-[var(--color-fg-muted)] pt-1"
              >
                {paKnown ? (
                  <>
                    Current:{" "}
                    <span className="tabular-nums">{currentPa.toFixed(4)}</span>
                  </>
                ) : (
                  <>Current: unknown — waiting for extruder telemetry.</>
                )}{" "}
                · Typical PLA 0.03-0.05 · PETG 0.05-0.07 · TPU 0.10-0.20
              </div>
            </div>
          </Card>
          <BedMeshHeatmap />
        </div>
      </section>

      {/* Confirm modal */}
      {pending && (
        <ConfirmModal
          action={pending}
          onConfirm={() => runAction(pending)}
          onCancel={() => setPending(null)}
        />
      )}
      {confirmDialog}
    </div>
  );
}

function ActionRow({
  action,
  disabled,
  onClick,
}: {
  action: TuneAction;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-[var(--color-border)] last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium">{action.title}</span>
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] bg-[var(--color-elevated)] px-1.5 py-0.5 rounded-inner">
            {action.duration}
          </span>
          {action.movesPrinthead && (
            <span
              className="text-[11px] text-[var(--color-warning)]"
              title="Moves the printhead"
            >
              ⚠
            </span>
          )}
        </div>
        <div className="text-[11px] text-[var(--color-fg-muted)] mt-0.5">
          {action.subtitle}
        </div>
      </div>
      <Button size="sm" disabled={disabled} onClick={onClick}>
        <Play className="w-3 h-3" /> Run
      </Button>
    </div>
  );
}

function ConfirmModal({
  action,
  onConfirm,
  onCancel,
}: {
  action: TuneAction;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <ModalSurface
      labelledBy={titleId}
      describedBy={descriptionId}
      onDismiss={onCancel}
      panelClassName="max-w-md"
    >
        {/* p-4 = --modal-pad: the corner close button keeps the strict
            concentric gap (radius-modal − pad = control radius). */}
        <header className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
          <h2 id={titleId} className="text-[17px] font-semibold tracking-tight">
            Confirm: {action.title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close calibration confirmation"
            className="press-flat inline-flex min-h-11 min-w-11 items-center justify-center rounded-inner text-[var(--color-fg-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-fg)]"
          >
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="p-4 space-y-[var(--stack)]">
          <p id={descriptionId} className="text-[13px] leading-relaxed">
            {action.confirm}
          </p>
          {action.movesPrinthead && (
            <div className="flex items-center gap-2 p-2 bg-(--color-warning)/8 border border-(--color-warning)/30 rounded-inner">
              <AlertTriangle className="w-4 h-4 text-[var(--color-warning)]" />
              <span className="text-[11px] text-[var(--color-warning)]">
                Will move the printhead aggressively.
              </span>
            </div>
          )}
          <details className="text-[11px] font-mono">
            <summary className="flex min-h-11 cursor-pointer items-center text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
              View gcode
            </summary>
            <pre className="mt-2 p-2 bg-black border border-[var(--color-border)] rounded-inner overflow-x-auto whitespace-pre-wrap">
              {action.gcode}
              {action.followup && `\n\n# After completion:\n${action.followup}`}
            </pre>
          </details>
          <div className="text-[11px] text-[var(--color-fg-muted)] flex items-center gap-1.5">
            Estimated duration: {action.duration}
          </div>
        </div>
        <footer className="flex justify-end gap-2 p-4 border-t border-[var(--color-border)] bg-(--color-fg)/1">
          <Button size="md" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="md" variant="primary" onClick={onConfirm}>
            <CheckCircle2 className="w-3.5 h-3.5" /> Run
          </Button>
        </footer>
    </ModalSurface>
  );
}
