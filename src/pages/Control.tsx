import { useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { usePrinter } from "@/lib/usePrinter";
import { canJog, getSafetyState, type Axis } from "@/lib/safety";
import {
  runPrinterAction,
  type ActionConfirmation,
  type PrinterAction,
} from "@/lib/printerActions";
import {
  Move,
  Home,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  PowerOff,
  AlertTriangle,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useExperienceMode } from "@/lib/useExperienceMode";

const DISTANCES = [0.1, 1, 10, 25, 50, 100];
const BASIC_DISTANCES = [1, 10, 50];

export function Control() {
  const { state } = usePrinter();
  const [experienceMode] = useExperienceMode();
  const isExpert = experienceMode === "expert";
  const [dist, setDist] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const safety = getSafetyState(state);
  const homed = state.toolhead?.homed_axes ?? "";
  const pos = state.toolhead?.position ?? [0, 0, 0, 0];

  const dispatch = async (action: PrinterAction) => {
    setError(null);
    try {
      await runPrinterAction(action, {
        confirm: (details: ActionConfirmation) =>
          window.confirm(`${details.title}\n\n${details.message}`),
      });
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Printer action failed.",
      );
      setTimeout(() => setError(null), 5000);
    }
  };

  const tryJog = (axis: Axis, sign: 1 | -1) => {
    const delta = sign * dist;
    const check = canJog(state, safety, axis, delta);
    if (!check.allowed) {
      setError(check.reason ?? "Move blocked");
      setTimeout(() => setError(null), 3500);
      return;
    }
    void dispatch({ type: "jog", axis, delta });
  };

  // Per-axis directional reachability (used to grey out OOB buttons)
  const reach = (axis: Axis, sign: 1 | -1) =>
    canJog(state, safety, axis, sign * dist).allowed;

  return (
    <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-3 p-[clamp(0.75rem,2vw,1.5rem)] md:grid-cols-8 lg:grid-cols-12">
      {/* Status banner */}
      {(safety.isBusy || !safety.klipperReady || !safety.fullyHomed) && (
        <div className="md:col-span-8 lg:col-span-12 flex items-center gap-2 border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.10)] px-3 py-2 text-[12px]">
          {safety.isBusy ? (
            <>
              <AlertTriangle className="w-4 h-4 text-[var(--color-warning)] shrink-0" />
              <span className="text-[var(--color-warning)] font-medium">
                {safety.busyReason} — manual controls disabled.
              </span>
            </>
          ) : !safety.klipperReady ? (
            <>
              <AlertTriangle className="w-4 h-4 text-[var(--color-error)] shrink-0" />
              <span className="text-[var(--color-error)] font-medium">
                Klipper not ready ({state.webhooks?.state}). Resolve before moving.
              </span>
            </>
          ) : (
            <>
              <Lock className="w-4 h-4 text-[var(--color-warning)] shrink-0" />
              <span className="text-[var(--color-warning)] font-medium">
                Not homed — only HOME ALL is enabled. Home first to use jog.
              </span>
            </>
          )}
        </div>
      )}

      {/* Toast */}
      {error && (
        <div className="md:col-span-8 lg:col-span-12 flex items-center gap-2 border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.10)] px-3 py-2 text-[12px]">
          <AlertTriangle className="w-4 h-4 text-[var(--color-error)] shrink-0" />
          <span className="text-[var(--color-error)] font-medium">{error}</span>
        </div>
      )}

      <Card title="Toolhead" icon={<Move />} className="md:col-span-5 lg:col-span-7">
        <div className="space-y-3">
          {/* Position display */}
          <div className="grid grid-cols-3 gap-2">
            {(["X", "Y", "Z"] as const).map((axis, i) => (
              <div key={axis}>
                <div className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] font-semibold flex items-center gap-1">
                  {axis}
                  {homed.toLowerCase().includes(axis.toLowerCase()) ? (
                    <span className="text-[var(--color-accent)]" title="homed">
                      ●
                    </span>
                  ) : (
                    <span className="text-[var(--color-error)]" title="not homed">
                      ○
                    </span>
                  )}
                  {isExpert && <span className="ml-auto text-[11px] tabular-nums text-[var(--color-fg-muted)]/60">
                    {safety.bounds.min[i].toFixed(0)}–
                    {safety.bounds.max[i].toFixed(0)}
                  </span>}
                </div>
                <div className="text-[14px] font-semibold tabular-nums mt-0.5">
                  {pos[i]?.toFixed(2) ?? "—"}
                </div>
              </div>
            ))}
          </div>

          {/* Jog grid */}
          <div className="grid grid-cols-[1fr_auto] gap-3 pt-2">
            <div className="grid grid-cols-3 gap-1 w-fit">
              <span />
              <JogBtn
                disabled={!reach("Y", 1)}
                onClick={() => tryJog("Y", 1)}
                title="Y+"
              >
                <ChevronUp className="w-4 h-4" />
              </JogBtn>
              <span />
              <JogBtn
                disabled={!reach("X", -1)}
                onClick={() => tryJog("X", -1)}
                title="X−"
              >
                <ChevronLeft className="w-4 h-4" />
              </JogBtn>
              <Button
                size="sm"
                variant="primary"
                onClick={() => dispatch({ type: "home", axis: "all" })}
                disabled={safety.isBusy}
                className="w-9 h-9 p-0"
                title="Home all"
              >
                <Home className="w-4 h-4" />
              </Button>
              <JogBtn
                disabled={!reach("X", 1)}
                onClick={() => tryJog("X", 1)}
                title="X+"
              >
                <ChevronRight className="w-4 h-4" />
              </JogBtn>
              <span />
              <JogBtn
                disabled={!reach("Y", -1)}
                onClick={() => tryJog("Y", -1)}
                title="Y−"
              >
                <ChevronDown className="w-4 h-4" />
              </JogBtn>
              <span />
            </div>
            {/* Z controls */}
            <div className="flex flex-col gap-1">
              <JogBtn
                disabled={!reach("Z", 1)}
                onClick={() => tryJog("Z", 1)}
                title="Z+"
              >
                <ChevronUp className="w-4 h-4" />
              </JogBtn>
              <Button
                size="sm"
                variant="primary"
                disabled={safety.isBusy}
                onClick={() => dispatch({ type: "home", axis: "z" })}
                className="w-9 h-9 p-0"
                title="Home Z"
              >
                Z
              </Button>
              <JogBtn
                disabled={!reach("Z", -1)}
                onClick={() => tryJog("Z", -1)}
                title="Z−"
              >
                <ChevronDown className="w-4 h-4" />
              </JogBtn>
            </div>
          </div>

          {/* Distance presets */}
          <div
            role="group"
            aria-label="Jog distance"
            className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-1"
          >
            {(isExpert ? DISTANCES : BASIC_DISTANCES).map((d) => (
              <button
                type="button"
                key={d}
                onClick={() => setDist(d)}
                aria-label={`Jog ${d} millimeters`}
                aria-pressed={dist === d}
                className={cn(
                  "min-h-11 min-w-11 rounded-lg px-2.5 text-[12px] font-medium tabular-nums transition-colors",
                  dist === d
                    ? "border border-[var(--color-border-strong)] bg-[var(--color-bg)] text-[var(--color-accent)]"
                    : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                )}
              >
                {d}
              </button>
            ))}
            <span aria-hidden="true" className="self-center px-1.5 text-[11px] text-[var(--color-fg-muted)]">
              mm
            </span>
          </div>

          {/* Motors off — confirms when busy */}
          {isExpert && <div className="pt-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={safety.isBusy}
              onClick={() => dispatch({ type: "disable-motors" })}
            >
              <PowerOff className="w-3 h-3" /> Motors off
            </Button>
          </div>}
        </div>
      </Card>

      {/* Top-down bed visualization */}
      <Card title="Position" icon={<Move />} className="md:col-span-3 lg:col-span-5">
        <BedView state={state} safety={safety} />
      </Card>

      {isExpert && <Card title="Bounds & Safety" icon={<Lock />} className="md:col-span-8 lg:col-span-12">
        <div className="space-y-2 text-[12px]">
          <Row label="Klipper">
            <Pill ok={safety.klipperReady}>
              {state.webhooks?.state ?? "—"}
            </Pill>
          </Row>
          <Row label="Activity">
            <Pill ok={!safety.isBusy}>
              {safety.isBusy ? "Busy" : "Idle"}
            </Pill>
          </Row>
          <Row label="Homed">
            <span className="font-mono tabular-nums">
              {(["X", "Y", "Z"] as const).map((a) => {
                const ok =
                  safety.homed[a.toLowerCase() as "x" | "y" | "z"];
                return (
                  <span
                    key={a}
                    className={cn(
                      "inline-block w-5 text-center font-bold",
                      ok
                        ? "text-[var(--color-success)]"
                        : "text-[var(--color-error)]",
                    )}
                  >
                    {ok ? a : "·"}
                  </span>
                );
              })}
            </span>
          </Row>
          <div className="pt-2 border-t border-[var(--color-border)] mt-2">
            <div className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] font-semibold mb-1">
              Travel limits
            </div>
            <div className="grid grid-cols-3 gap-3 font-mono tabular-nums text-[11px]">
              {(["X", "Y", "Z"] as const).map((a, i) => (
                <div key={a}>
                  <div className="text-[var(--color-fg-muted)]">{a}</div>
                  <div className="text-[12px]">
                    {safety.bounds.min[i].toFixed(0)} →{" "}
                    {safety.bounds.max[i].toFixed(0)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>}
    </div>
  );
}

function BedView({
  state,
  safety,
}: {
  state: ReturnType<typeof usePrinter>["state"];
  safety: ReturnType<typeof getSafetyState>;
}) {
  const pos = state.toolhead?.position ?? [0, 0, 0, 0];
  const livePos = state.motion_report?.live_position ?? pos;
  const [minX, minY] = [safety.bounds.min[0], safety.bounds.min[1]];
  const [maxX, maxY] = [safety.bounds.max[0], safety.bounds.max[1]];
  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const x = ((livePos[0] - minX) / sizeX) * 100;
  // Y: bed-front is up in our view (= bottom of viewport)
  const y = ((maxY - livePos[1]) / sizeY) * 100;
  const z = livePos[2];
  const homed = safety.fullyHomed;
  const printing =
    state.print_stats?.state === "printing" ||
    state.print_stats?.state === "paused";

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden border border-[var(--color-border-strong)] bg-[var(--color-bg)]">
        {/* Origin label */}
        <div className="absolute bottom-1 left-1 text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-muted)]/40 font-mono">
          Front · 0,0
        </div>
        <div className="absolute top-1 right-1 text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-muted)]/40 font-mono">
          {maxX.toFixed(0)},{maxY.toFixed(0)}
        </div>
        {/* Center crosshair */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-px h-full bg-[var(--color-elevated)]/50" />
          <div className="absolute w-full h-px bg-[var(--color-elevated)]/50" />
        </div>
        {/* Toolhead marker */}
        {homed && (
          <div
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 border-2 transition-[left,top] duration-150 ease-out"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              borderColor: printing
                ? "var(--color-accent)"
                : "var(--color-fg)",
              backgroundColor: printing
                ? "var(--color-accent)"
                : "transparent",
            }}
          />
        )}
        {!homed && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-muted)]/50 font-mono">
            Not homed
          </div>
        )}
      </div>
      {/* Live coords */}
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
            X
          </div>
          <div className="text-[14px] font-semibold tabular-nums font-mono">
            {livePos[0]?.toFixed(2) ?? "—"}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
            Y
          </div>
          <div className="text-[14px] font-semibold tabular-nums font-mono">
            {livePos[1]?.toFixed(2) ?? "—"}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
            Z
          </div>
          <div className="text-[14px] font-semibold tabular-nums font-mono">
            {z?.toFixed(3) ?? "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

function JogBtn({
  disabled,
  onClick,
  children,
  title,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <Button
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="min-h-11 min-w-11 p-0"
    >
      {children}
    </Button>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[rgba(63,63,70,0.3)] last:border-0">
      <span className="text-[11px] text-[var(--color-fg-muted)] uppercase tracking-[0.1em] font-semibold">
        {label}
      </span>
      {children}
    </div>
  );
}

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-sm border text-[11px] font-bold uppercase tracking-[0.1em]",
        ok
          ? "text-[var(--color-success)] bg-[rgba(16,185,129,0.10)] border-[rgba(16,185,129,0.3)]"
          : "text-[var(--color-warning)] bg-[rgba(245,158,11,0.10)] border-[rgba(245,158,11,0.3)]",
      )}
    >
      {children}
    </span>
  );
}
