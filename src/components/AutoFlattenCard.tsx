import { useEffect, useRef, useState } from "react";
import { Card } from "./Card";
import { Button } from "./Button";
import {
  Brain,
  RotateCw,
  Check,
  AlertTriangle,
  ChevronRight,
  Square,
} from "lucide-react";
import { moonraker } from "@/lib/moonraker";
import { useGcodeLog } from "@/lib/useGcodeLog";
import { cn, formatDuration } from "@/lib/utils";

/**
 * Auto Flatten — iterative guided bed leveling.
 *
 * Honest framing: K1 Max bed screws are MANUAL. There's no actuator that
 * can turn them autonomously. But Klipper's SCREWS_TILT_CALCULATE measures
 * deviation and tells you which screws to turn. We can:
 *
 *   1. Run SCREWS_TILT_CALCULATE
 *   2. Parse output (which screws need turning, by how much)
 *   3. Show the user a clear "turn this screw N° clockwise" diagram
 *   4. Wait for them to confirm adjustment
 *   5. Re-run; convergence when all 4 screws report "adjusted" or <0.05mm
 *   6. Auto-run BED_MESH_CALIBRATE once converged for soft compensation
 *
 * This is RL with the human as actuator, not autonomous, but it's the most
 * efficient closed loop available on this hardware. Output is identical.
 */

type ScrewMeasurement = {
  name: string;
  z: number;
  needsTurn: boolean;
  direction: "CW" | "CCW" | "OK";
  hours: number; // e.g. 1.5 = "1:30"
};

type Phase =
  | "idle"
  | "running_tilt"
  | "awaiting_user"
  | "converged"
  | "running_mesh"
  | "complete"
  | "error";

const TOLERANCE_MM = 0.05;

export function AutoFlattenCard() {
  const log = useGcodeLog(120);
  const [phase, setPhase] = useState<Phase>("idle");
  const [iteration, setIteration] = useState(0);
  const [maxIterations] = useState(8);
  const [screws, setScrews] = useState<ScrewMeasurement[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logSnapshot, setLogSnapshot] = useState<number>(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const tickerRef = useRef<number | null>(null);

  // Force render every second for elapsed timer
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    if (phase === "running_tilt" || phase === "running_mesh") {
      tickerRef.current = window.setInterval(() => setNow(Date.now()), 1000);
      return () => {
        if (tickerRef.current) clearInterval(tickerRef.current);
      };
    }
  }, [phase]);

  // Parse SCREWS_TILT_CALCULATE output once it lands in the log buffer
  useEffect(() => {
    if (phase !== "running_tilt") return;
    const recent = log.slice(logSnapshot);
    const parsed = parseScrewsTilt(recent);
    if (parsed.length === 4) {
      setScrews(parsed);
      const allOk = parsed.every(
        (s) => s.direction === "OK" || Math.abs(s.z) < TOLERANCE_MM,
      );
      if (allOk) {
        setPhase("converged");
      } else if (iteration + 1 >= maxIterations) {
        setPhase("error");
        setErrorMsg(
          `Hit iteration cap (${maxIterations}). Largest deviation still ${Math.max(...parsed.map((s) => Math.abs(s.z))).toFixed(3)} mm.`,
        );
      } else {
        setPhase("awaiting_user");
      }
    }
  }, [log, logSnapshot, phase, iteration, maxIterations]);

  const start = async () => {
    if (phase !== "idle" && phase !== "complete" && phase !== "error") return;
    setIteration(0);
    setScrews([]);
    setErrorMsg(null);
    setStartedAt(Date.now());
    await runTilt();
  };

  const runTilt = async () => {
    setLogSnapshot(moonraker.getGcodeLog().length);
    setPhase("running_tilt");
    setIteration((i) => i + 1);
    try {
      await moonraker.runGcode("G28\nSCREWS_TILT_CALCULATE");
    } catch (e) {
      setPhase("error");
      setErrorMsg((e as Error).message);
    }
  };

  const userAdjusted = async () => {
    setScrews([]);
    await runTilt();
  };

  const runMesh = async () => {
    setPhase("running_mesh");
    try {
      await moonraker.runGcode(
        "G28\nBED_MESH_CALIBRATE PROFILE=default",
      );
      // Save once probing finishes
      await waitIdle();
      await moonraker.runGcode(
        "BED_MESH_PROFILE SAVE=default\nSAVE_CONFIG",
      );
      setPhase("complete");
    } catch (e) {
      setPhase("error");
      setErrorMsg((e as Error).message);
    }
  };

  const abort = async () => {
    try {
      await moonraker.runGcode("CANCEL_PRINT");
    } catch {
      /* ignore */
    }
    setPhase("idle");
    setStartedAt(null);
  };

  const elapsed = startedAt
    ? Math.floor((Date.now() - startedAt) / 1000)
    : 0;
  const peakDeviation = screws.length
    ? Math.max(...screws.map((s) => Math.abs(s.z)))
    : 0;

  return (
    <Card
      title="Auto Flatten"
      icon={<Brain />}
      action={
        phase !== "idle" &&
        phase !== "complete" &&
        phase !== "error" && (
          <Button size="sm" variant="danger" onClick={abort}>
            <Square className="w-3 h-3" /> Abort
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {/* Honest framing banner */}
        <div className="flex items-start gap-2 p-2 bg-[rgba(59,130,246,0.06)] border border-[rgba(59,130,246,0.2)] rounded-sm text-[11px] leading-relaxed">
          <Brain className="w-4 h-4 text-[var(--color-info)] shrink-0 mt-0.5" />
          <div>
            <span className="text-[var(--color-info)] font-semibold">
              Iterative guided loop:
            </span>{" "}
            K1 Max bed screws are manual, so this isn't fully autonomous.
            Klipper measures, this UI tells you which screw to turn how far.
            You confirm; we re-measure. Repeats until peak deviation &lt; {TOLERANCE_MM}mm,
            then bed mesh kicks in for soft compensation.
          </div>
        </div>

        {/* Status row */}
        <div className="grid grid-cols-4 gap-3 py-2 border-y border-[var(--color-border)]">
          <Stat
            label="Phase"
            value={phaseLabel(phase)}
            color={phaseColor(phase)}
          />
          <Stat
            label="Iter"
            value={`${iteration} / ${maxIterations}`}
          />
          <Stat
            label="Peak Dev"
            value={
              screws.length ? `${peakDeviation.toFixed(3)} mm` : "—"
            }
            color={
              peakDeviation < TOLERANCE_MM
                ? "var(--color-success)"
                : peakDeviation < 0.15
                  ? "var(--color-accent)"
                  : "var(--color-warning)"
            }
          />
          <Stat
            label="Elapsed"
            value={
              startedAt && phase !== "complete" && phase !== "idle"
                ? formatDuration(elapsed)
                : "—"
            }
          />
        </div>

        {/* Screw layout — top-down map of bed */}
        {screws.length > 0 && (
          <div className="aspect-[4/3] border border-[var(--color-border)] rounded-md bg-[var(--color-bg)] p-3 relative">
            {/* Bed outline */}
            <div className="absolute inset-3 border border-[var(--color-border-strong)] rounded-sm" />
            <div className="absolute top-1 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-[0.2em] text-[var(--color-fg-muted)]/50">
              Rear
            </div>
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-[0.2em] text-[var(--color-fg-muted)]/50">
              Front
            </div>
            {/* Screws */}
            {screws.map((s) => {
              const pos = screwPosition(s.name);
              if (!pos) return null;
              return (
                <ScrewIndicator
                  key={s.name}
                  screw={s}
                  style={{
                    position: "absolute",
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Action zone */}
        <div className="flex items-center gap-2 flex-wrap">
          {phase === "idle" && (
            <Button variant="primary" onClick={start}>
              <Brain className="w-3 h-3" /> Start Auto Flatten
            </Button>
          )}
          {phase === "running_tilt" && (
            <div className="text-[12px] text-[var(--color-accent)] flex items-center gap-2">
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
              Probing 4 corners…
            </div>
          )}
          {phase === "awaiting_user" && (
            <>
              <span className="text-[12px] text-[var(--color-warning)] flex items-center gap-1.5 mr-auto">
                <AlertTriangle className="w-3.5 h-3.5" />
                Adjust the screws above. Then click below.
              </span>
              <Button variant="primary" onClick={userAdjusted}>
                <ChevronRight className="w-3 h-3" /> Re-test
              </Button>
            </>
          )}
          {phase === "converged" && (
            <>
              <span className="text-[12px] text-[var(--color-success)] flex items-center gap-1.5 mr-auto">
                <Check className="w-3.5 h-3.5" />
                Bed leveled within tolerance. Generate mesh now?
              </span>
              <Button variant="primary" onClick={runMesh}>
                <ChevronRight className="w-3 h-3" /> Run Bed Mesh
              </Button>
            </>
          )}
          {phase === "running_mesh" && (
            <div className="text-[12px] text-[var(--color-accent)] flex items-center gap-2">
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
              Generating bed mesh…
            </div>
          )}
          {phase === "complete" && (
            <>
              <span className="text-[12px] text-[var(--color-success)] flex items-center gap-1.5 mr-auto">
                <Check className="w-3.5 h-3.5" />
                Done. Mesh saved.
              </span>
              <Button onClick={start}>Run again</Button>
            </>
          )}
          {phase === "error" && (
            <>
              <span className="text-[12px] text-[var(--color-error)] flex items-center gap-1.5 mr-auto">
                <AlertTriangle className="w-3.5 h-3.5" />
                {errorMsg ?? "Error"}
              </span>
              <Button onClick={start}>Restart</Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function ScrewIndicator({
  screw,
  style,
}: {
  screw: ScrewMeasurement;
  style: React.CSSProperties;
}) {
  const isOk = screw.direction === "OK" || Math.abs(screw.z) < TOLERANCE_MM;
  return (
    <div
      style={style}
      className={cn(
        "w-20 h-20 rounded-full border-2 flex flex-col items-center justify-center text-center",
        isOk
          ? "border-[var(--color-success)] bg-[rgba(16,185,129,0.10)]"
          : "border-[var(--color-warning)] bg-[rgba(245,158,11,0.10)] animate-pulse",
      )}
    >
      {isOk ? (
        <>
          <Check className="w-4 h-4 text-[var(--color-success)]" />
          <span className="text-[9px] text-[var(--color-success)] uppercase tracking-[0.1em] font-bold mt-0.5">
            OK
          </span>
        </>
      ) : (
        <>
          <RotateCw
            className={cn(
              "w-4 h-4 text-[var(--color-warning)]",
              screw.direction === "CCW" && "scale-x-[-1]",
            )}
          />
          <span className="text-[10px] text-[var(--color-warning)] font-bold mt-0.5">
            {screw.direction}
          </span>
          <span className="text-[10px] text-[var(--color-fg)] tabular-nums font-semibold">
            {hoursToClockTime(screw.hours)}
          </span>
        </>
      )}
      <span className="text-[8px] text-[var(--color-fg-muted)] uppercase tracking-[0.1em] mt-0.5">
        {screw.name}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
        {label}
      </div>
      <div
        className="text-[13px] font-semibold tabular-nums font-mono mt-0.5"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}

// ---------- helpers ----------

/**
 * Parse SCREWS_TILT_CALCULATE klipper output. Lines look like:
 *
 *   front left screw : x=15.00, y=15.00, z=2.81875
 *   front right screw : x=305.00, y=15.00, z=2.86250
 *   rear right screw (base) : x=305.00, y=305.00, z=2.78750
 *   rear left screw : x=15.00, y=305.00, z=2.71250
 *   front left screw : adjust CW 01:30
 *   front right screw : adjust CW 02:15
 *   rear right screw : base
 *   rear left screw : adjust CCW 00:45
 */
function parseScrewsTilt(lines: { text: string }[]): ScrewMeasurement[] {
  const corners = ["front left", "front right", "rear left", "rear right"];
  const measurements = new Map<string, Partial<ScrewMeasurement>>();

  for (const { text } of lines) {
    const t = text.trim().replace(/^\/\/\s*/, "");
    for (const corner of corners) {
      if (!t.toLowerCase().startsWith(corner)) continue;
      // Z position line
      const zMatch = t.match(/z=([0-9.-]+)/i);
      if (zMatch) {
        const z = parseFloat(zMatch[1]);
        const existing = measurements.get(corner) ?? { name: corner };
        measurements.set(corner, { ...existing, z });
      }
      // Adjustment line
      if (/(:\s*)?(adjust|base)/i.test(t)) {
        if (/base/i.test(t)) {
          const existing = measurements.get(corner) ?? { name: corner };
          measurements.set(corner, {
            ...existing,
            direction: "OK",
            hours: 0,
            needsTurn: false,
          });
        } else {
          const dirMatch = t.match(/adjust\s+(CW|CCW)\s+(\d+):(\d+)/i);
          if (dirMatch) {
            const direction = dirMatch[1].toUpperCase() as "CW" | "CCW";
            const hh = parseInt(dirMatch[2], 10);
            const mm = parseInt(dirMatch[3], 10);
            const hours = hh + mm / 60;
            const existing = measurements.get(corner) ?? { name: corner };
            measurements.set(corner, {
              ...existing,
              direction,
              hours,
              needsTurn: hours > 0,
            });
          }
        }
      }
    }
  }

  const out: ScrewMeasurement[] = [];
  for (const corner of corners) {
    const m = measurements.get(corner);
    if (m && m.direction !== undefined) {
      out.push({
        name: corner,
        z: m.z ?? 0,
        direction: m.direction,
        hours: m.hours ?? 0,
        needsTurn: m.needsTurn ?? false,
      });
    }
  }
  return out;
}

function screwPosition(name: string): { x: number; y: number } | null {
  // Bed orientation: top of card = rear, bottom = front
  // Returns percentages within the card
  switch (name) {
    case "front left":
      return { x: 18, y: 78 };
    case "front right":
      return { x: 82, y: 78 };
    case "rear left":
      return { x: 18, y: 22 };
    case "rear right":
      return { x: 82, y: 22 };
    default:
      return null;
  }
}

function hoursToClockTime(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}:${String(mm).padStart(2, "0")}`;
}

function phaseLabel(p: Phase): string {
  return {
    idle: "Idle",
    running_tilt: "Probing",
    awaiting_user: "Adjust",
    converged: "Leveled",
    running_mesh: "Meshing",
    complete: "Complete",
    error: "Error",
  }[p];
}

function phaseColor(p: Phase): string {
  return {
    idle: "var(--color-fg)",
    running_tilt: "var(--color-accent)",
    awaiting_user: "var(--color-warning)",
    converged: "var(--color-success)",
    running_mesh: "var(--color-accent)",
    complete: "var(--color-success)",
    error: "var(--color-error)",
  }[p];
}

async function waitIdle(timeoutMs = 30 * 60 * 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 4000));
    if (moonraker.getState().idle_timeout?.state !== "Printing") return;
  }
}
