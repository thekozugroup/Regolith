import { useEffect, useRef, useState } from "react";
import { Card } from "./Card";
import { Button } from "./Button";
import {
  Brain,
  RotateCw,
  Check,
  AlertTriangle,
  Square,
  Info,
} from "lucide-react";
import { moonraker } from "@/lib/moonraker";
import { cn, formatDuration } from "@/lib/utils";

/**
 * Auto Flatten — fully autonomous bed mesh convergence.
 *
 * Reality of K1 Max bed:
 *   - 4 manual screws (no actuators) — physical leveling needs hands
 *   - Klipper bed_mesh creates a Z-compensation map that "flattens" the
 *     bed in software during printing; this IS the autonomous path
 *   - SCREWS_TILT_CALCULATE just measures + tells human what to turn —
 *     can't be autonomous
 *
 * What this loop does:
 *   1. BED_MESH_CALIBRATE → probes full grid
 *   2. Read peak-to-peak deviation
 *   3. If <0.05mm three times in a row → converged, SAVE_CONFIG
 *   4. Else iterate (thermal drift / probe noise settles after 2-3 runs)
 *   5. After 5 iterations without convergence → warn that physical
 *      screws need adjusting (mesh can't compensate >~0.5mm)
 */

interface MeshSample {
  iter: number;
  ts: number;
  min: number;
  max: number;
  peakToPeak: number;
}

type Phase =
  | "idle"
  | "running"
  | "converged"
  | "needs_screws"
  | "saving"
  | "complete"
  | "error";

const TOLERANCE_MM = 0.05;
const STABILITY_REQ = 3; // consecutive iterations within tolerance
const PHYSICAL_LIMIT = 0.5; // mesh comp practical limit
const MAX_ITERATIONS = 5;

export function AutoFlattenCard() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [samples, setSamples] = useState<MeshSample[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const cancelRef = useRef(false);

  // Force re-render every second for elapsed counter
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    if (phase === "running" || phase === "saving") {
      const id = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(id);
    }
  }, [phase]);

  const start = async () => {
    cancelRef.current = false;
    setSamples([]);
    setErrorMsg(null);
    setStartedAt(Date.now());
    await runLoop();
  };

  const runLoop = async () => {
    setPhase("running");
    let iter = 0;
    let stableCount = 0;
    const local: MeshSample[] = [];
    try {
      while (iter < MAX_ITERATIONS) {
        if (cancelRef.current) {
          setPhase("idle");
          return;
        }
        iter++;

        // Run probe
        await moonraker.runGcode(
          "G28\nBED_MESH_CALIBRATE PROFILE=default",
        );
        await waitIdle(20 * 60 * 1000);
        if (cancelRef.current) {
          setPhase("idle");
          return;
        }

        // Read mesh from moonraker
        const sample = await fetchMeshSample(iter);
        if (!sample) {
          throw new Error("No mesh data returned from moonraker");
        }
        local.push(sample);
        setSamples([...local]);

        // Convergence check
        if (sample.peakToPeak < TOLERANCE_MM) {
          stableCount++;
          if (stableCount >= STABILITY_REQ) {
            setPhase("saving");
            await moonraker.runGcode(
              "BED_MESH_PROFILE SAVE=default\nSAVE_CONFIG",
            );
            setPhase("complete");
            return;
          }
        } else {
          stableCount = 0;
        }

        // Physical limit check
        if (sample.peakToPeak > PHYSICAL_LIMIT) {
          setPhase("needs_screws");
          return;
        }
      }

      // Hit cap without converging
      const last = local[local.length - 1];
      if (last && last.peakToPeak < TOLERANCE_MM * 2) {
        // Close enough, save anyway
        setPhase("saving");
        await moonraker.runGcode(
          "BED_MESH_PROFILE SAVE=default\nSAVE_CONFIG",
        );
        setPhase("complete");
      } else {
        setPhase("needs_screws");
      }
    } catch (e) {
      setPhase("error");
      setErrorMsg((e as Error).message);
    }
  };

  const cancel = () => {
    cancelRef.current = true;
    moonraker.runGcode("CANCEL_PRINT").catch(() => {});
    setPhase("idle");
    setStartedAt(null);
  };

  const elapsed = startedAt
    ? Math.floor((Date.now() - startedAt) / 1000)
    : 0;
  const latest = samples[samples.length - 1];
  const trend = computeTrend(samples);

  return (
    <Card
      title="Auto Flatten"
      icon={<Brain />}
      action={
        (phase === "running" || phase === "saving") && (
          <Button size="sm" variant="danger" onClick={cancel}>
            <Square className="w-3 h-3" /> Abort
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {/* Honest framing */}
        <div className="flex items-start gap-2 p-2 bg-[rgba(59,130,246,0.06)] border border-[rgba(59,130,246,0.2)] rounded-sm text-[11px] leading-relaxed">
          <Info className="w-4 h-4 text-[var(--color-info)] shrink-0 mt-0.5" />
          <div>
            <span className="text-[var(--color-info)] font-semibold">
              Fully autonomous:
            </span>{" "}
            Iterates <code className="text-[var(--color-accent)]">BED_MESH_CALIBRATE</code>{" "}
            until peak-to-peak deviation stabilizes &lt; {TOLERANCE_MM}mm for{" "}
            {STABILITY_REQ} runs. K1 Max screws are manual — if mesh shows
            &gt; {PHYSICAL_LIMIT}mm tilt, this stops and you'll need to turn
            screws first.
          </div>
        </div>

        {/* Status grid */}
        <div className="grid grid-cols-4 gap-3 py-2 border-y border-[var(--color-border)]">
          <Stat
            label="Phase"
            value={phaseLabel(phase)}
            color={phaseColor(phase)}
          />
          <Stat
            label="Iter"
            value={`${samples.length} / ${MAX_ITERATIONS}`}
          />
          <Stat
            label="Latest Δ"
            value={
              latest ? `${latest.peakToPeak.toFixed(3)} mm` : "—"
            }
            color={
              latest
                ? latest.peakToPeak < TOLERANCE_MM
                  ? "var(--color-success)"
                  : latest.peakToPeak < 0.15
                    ? "var(--color-accent)"
                    : "var(--color-warning)"
                : undefined
            }
          />
          <Stat
            label="Elapsed"
            value={
              startedAt && (phase === "running" || phase === "saving")
                ? formatDuration(elapsed)
                : phase === "complete" && startedAt
                  ? formatDuration(elapsed)
                  : "—"
            }
          />
        </div>

        {/* Iteration history sparkbar */}
        {samples.length > 0 && (
          <div>
            <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold mb-1">
              Convergence trend
            </div>
            <div className="flex items-end gap-1 h-12">
              {samples.map((s) => {
                const max = Math.max(0.1, ...samples.map((x) => x.peakToPeak));
                const h = Math.max(4, (s.peakToPeak / max) * 100);
                const ok = s.peakToPeak < TOLERANCE_MM;
                return (
                  <div
                    key={s.iter}
                    className="flex-1 flex flex-col items-center gap-1"
                    title={`Iter ${s.iter}: ${s.peakToPeak.toFixed(3)} mm`}
                  >
                    <div
                      className={cn(
                        "w-full rounded-sm transition-all",
                        ok
                          ? "bg-[var(--color-success)]"
                          : s.peakToPeak < 0.15
                            ? "bg-[var(--color-accent)]"
                            : "bg-[var(--color-warning)]",
                      )}
                      style={{ height: `${h}%` }}
                    />
                    <span className="text-[8px] tabular-nums text-[var(--color-fg-muted)]">
                      {s.peakToPeak.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
            {trend && (
              <div className="text-[10px] text-[var(--color-fg-muted)] mt-1 tabular-nums">
                Trend: {trend > 0 ? "+" : ""}
                {trend.toFixed(3)} mm/iter ·{" "}
                {Math.abs(trend) < 0.005
                  ? "stable"
                  : trend < 0
                    ? "improving"
                    : "diverging"}
              </div>
            )}
          </div>
        )}

        {/* Action zone */}
        <div className="flex items-center gap-2 flex-wrap">
          {phase === "idle" && (
            <Button variant="primary" onClick={start}>
              <Brain className="w-3 h-3" /> Start
            </Button>
          )}
          {phase === "running" && (
            <div className="text-[12px] text-[var(--color-accent)] flex items-center gap-2">
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
              Probing iteration {samples.length + 1}…
            </div>
          )}
          {phase === "saving" && (
            <div className="text-[12px] text-[var(--color-accent)] flex items-center gap-2">
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
              Saving mesh…
            </div>
          )}
          {phase === "complete" && (
            <>
              <span className="text-[12px] text-[var(--color-success)] flex items-center gap-1.5 mr-auto">
                <Check className="w-3.5 h-3.5" />
                Converged. Mesh saved as default.
              </span>
              <Button onClick={start}>Run again</Button>
            </>
          )}
          {phase === "needs_screws" && (
            <>
              <span className="text-[12px] text-[var(--color-warning)] flex items-center gap-1.5 mr-auto">
                <AlertTriangle className="w-3.5 h-3.5" />
                Mesh can't compensate this much tilt. Turn bed screws first.
              </span>
              <Button onClick={start}>Retry</Button>
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

// ----- helpers -----

async function fetchMeshSample(iter: number): Promise<MeshSample | null> {
  const res = await fetch("/printer/objects/query?bed_mesh");
  const data = await res.json();
  const bm = data?.result?.status?.bed_mesh;
  const m = bm?.probed_matrix as number[][] | undefined;
  if (!m || m.length === 0) return null;
  const flat = m.flat();
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  return {
    iter,
    ts: Date.now(),
    min,
    max,
    peakToPeak: max - min,
  };
}

async function waitIdle(timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 4000));
    if (moonraker.getState().idle_timeout?.state !== "Printing") return;
  }
  throw new Error("Probe timeout");
}

function computeTrend(s: MeshSample[]): number | null {
  if (s.length < 2) return null;
  const first = s[0].peakToPeak;
  const last = s[s.length - 1].peakToPeak;
  return (last - first) / (s.length - 1);
}

function phaseLabel(p: Phase): string {
  return {
    idle: "Idle",
    running: "Probing",
    saving: "Saving",
    converged: "Converged",
    needs_screws: "Manual Adjust",
    complete: "Complete",
    error: "Error",
  }[p];
}

function phaseColor(p: Phase): string {
  return {
    idle: "var(--color-fg)",
    running: "var(--color-accent)",
    saving: "var(--color-accent)",
    converged: "var(--color-success)",
    needs_screws: "var(--color-warning)",
    complete: "var(--color-success)",
    error: "var(--color-error)",
  }[p];
}
