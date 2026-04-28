import { useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { BedMeshHeatmap } from "@/components/BedMeshHeatmap";
import { LidarPACard } from "@/components/LidarPACard";
import { moonraker } from "@/lib/moonraker";
import { usePrinter } from "@/lib/usePrinter";
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

interface RunningAction {
  id: string;
  title: string;
  startedAt: number;
}

export function Tune() {
  const { state, mr } = usePrinter();
  const [pending, setPending] = useState<TuneAction | null>(null);
  const [running, setRunning] = useState<RunningAction | null>(null);
  const [pa, setPa] = useState<number | null>(null);
  const isPrinting =
    state.print_stats?.state === "printing" ||
    state.print_stats?.state === "paused";

  const currentPa = state.extruder?.pressure_advance ?? 0.04;
  const displayedPa = pa ?? currentPa;

  const runAction = async (action: TuneAction) => {
    setRunning({ id: action.id, title: action.title, startedAt: Date.now() });
    setPending(null);
    try {
      await mr.runGcode(action.gcode);
      // Wait for klipper to finish (poll idle_timeout)
      await waitForIdle();
      if (action.followup) {
        await mr.runGcode(action.followup);
      }
    } catch (e) {
      console.error("Action failed", e);
    } finally {
      setRunning(null);
    }
  };

  const applyPa = async (save: boolean) => {
    await mr.runGcode(`SET_PRESSURE_ADVANCE ADVANCE=${displayedPa.toFixed(4)}`);
    if (save) {
      await mr.runGcode("SAVE_CONFIG");
    }
    setPa(null);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 p-3">
      {/* Banner: warn if printing */}
      {isPrinting && (
        <div className="lg:col-span-2 flex items-center gap-2 px-3 py-2 bg-[rgba(245,158,11,0.10)] border border-[rgba(245,158,11,0.4)] rounded-md text-[12px]">
          <AlertTriangle className="w-4 h-4 text-[var(--color-warning)] shrink-0" />
          <span className="text-[var(--color-warning)] font-medium">
            Printing in progress — calibration actions disabled.
          </span>
        </div>
      )}

      {/* Live action toast */}
      {running && (
        <div className="lg:col-span-2 flex items-center gap-2 px-3 py-2 bg-[rgba(249,115,22,0.10)] border border-[rgba(249,115,22,0.4)] rounded-md text-[12px]">
          <Activity className="w-4 h-4 text-[var(--color-accent)] shrink-0 animate-pulse" />
          <span className="text-[var(--color-accent)] font-medium flex-1">
            Running: {running.title}
          </span>
          <span className="text-[var(--color-fg-muted)] tabular-nums">
            {Math.floor((Date.now() - running.startedAt) / 1000)}s
          </span>
        </div>
      )}

      {/* Pressure Advance — special interactive card */}
      <Card title="Pressure Advance" icon={<Sliders />}>
        <div className="space-y-2">
          <div className="text-[12px] text-[var(--color-fg-muted)]">
            Live tunable. Apply temporarily or save permanently.
          </div>
          <div className="flex items-center gap-3 py-2">
            <input
              type="range"
              min="0"
              max="0.2"
              step="0.005"
              value={displayedPa}
              onChange={(e) => setPa(parseFloat(e.target.value))}
              className="flex-1 accent-[var(--color-accent)]"
              disabled={isPrinting}
            />
            <span className="text-[14px] font-semibold tabular-nums w-16 text-right">
              {displayedPa.toFixed(4)}
            </span>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              disabled={isPrinting || pa === null}
              onClick={() => applyPa(false)}
            >
              Apply
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={isPrinting || pa === null}
              onClick={() => applyPa(true)}
            >
              Apply & Save
            </Button>
            {pa !== null && (
              <Button size="sm" variant="ghost" onClick={() => setPa(null)}>
                Reset
              </Button>
            )}
          </div>
          <div className="text-[11px] text-[var(--color-fg-muted)] pt-1">
            Current: <span className="font-mono tabular-nums">{currentPa.toFixed(4)}</span>{" "}
            · Typical PLA 0.03-0.05 · PETG 0.05-0.07 · TPU 0.10-0.20
          </div>
        </div>
      </Card>

      {/* Lidar PA card — K1 Max-specific lidar tuning */}
      <div className="lg:col-span-2">
        <LidarPACard />
      </div>

      {/* Bed mesh heatmap — read-only, safe during any state */}
      <div className="lg:col-span-2">
        <BedMeshHeatmap />
      </div>

      {/* Sectioned actions */}
      {Object.entries(ACTIONS).map(([section, actions]) => (
        <Card key={section} title={section} icon={SECTION_ICONS[section]}>
          <div className="space-y-2">
            {actions.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                disabled={isPrinting || !!running}
                onClick={() => setPending(action)}
              />
            ))}
          </div>
        </Card>
      ))}

      {/* Confirm modal */}
      {pending && (
        <ConfirmModal
          action={pending}
          onConfirm={() => runAction(pending)}
          onCancel={() => setPending(null)}
        />
      )}
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
    <div className="flex items-center gap-3 py-2 border-b border-[rgba(63,63,70,0.4)] last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium">{action.title}</span>
          <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] bg-[var(--color-elevated)] px-1.5 py-0.5 rounded-sm">
            {action.duration}
          </span>
          {action.movesPrinthead && (
            <span
              className="text-[10px] text-[var(--color-warning)]"
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
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-md max-w-md w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-[13px] font-semibold tracking-tight">
            Confirm: {action.title}
          </h2>
          <button
            onClick={onCancel}
            className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-4 space-y-3">
          <p className="text-[13px] leading-relaxed">{action.confirm}</p>
          {action.movesPrinthead && (
            <div className="flex items-center gap-2 p-2 bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.3)] rounded-sm">
              <AlertTriangle className="w-4 h-4 text-[var(--color-warning)]" />
              <span className="text-[11px] text-[var(--color-warning)]">
                Will move the printhead aggressively.
              </span>
            </div>
          )}
          <details className="text-[11px] font-mono">
            <summary className="text-[var(--color-fg-muted)] cursor-pointer hover:text-[var(--color-fg)]">
              View gcode
            </summary>
            <pre className="mt-2 p-2 bg-black border border-[var(--color-border)] rounded-sm overflow-x-auto whitespace-pre-wrap">
              {action.gcode}
              {action.followup && `\n\n# After completion:\n${action.followup}`}
            </pre>
          </details>
          <div className="text-[11px] text-[var(--color-fg-muted)] flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-[var(--color-fg-muted)]" />
            Estimated duration: {action.duration}
          </div>
        </div>
        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-border)] bg-[rgba(255,255,255,0.01)]">
          <Button size="md" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="md" variant="primary" onClick={onConfirm}>
            <CheckCircle2 className="w-3.5 h-3.5" /> Run
          </Button>
        </footer>
      </div>
    </div>
  );
}

async function waitForIdle(maxMs = 30 * 60 * 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 4000));
    const s = moonraker.getState();
    if (s.idle_timeout?.state !== "Printing") return;
  }
}
