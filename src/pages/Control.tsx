import { useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { usePrinter } from "@/lib/usePrinter";
import {
  Move,
  Home,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  PowerOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

const DISTANCES = [0.1, 1, 10, 25, 50, 100];

export function Control() {
  const { state, mr } = usePrinter();
  const [dist, setDist] = useState(1);
  const homed = state.toolhead?.homed_axes ?? "";
  const pos = state.toolhead?.position ?? [0, 0, 0, 0];

  const jog = (axis: string, sign: 1 | -1) => {
    const d = sign * dist;
    mr.runGcode(`SAVE_GCODE_STATE NAME=jog\nG91\nG1 ${axis}${d} F3000\nRESTORE_GCODE_STATE NAME=jog`);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 p-3">
      <Card title="Toolhead" icon={<Move />}>
        <div className="space-y-3">
          {/* Position display */}
          <div className="grid grid-cols-3 gap-2">
            {(["X", "Y", "Z"] as const).map((axis, i) => (
              <div key={axis}>
                <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] font-semibold">
                  {axis}{" "}
                  {homed.toLowerCase().includes(axis.toLowerCase()) ? (
                    <span className="text-[var(--color-accent)]">●</span>
                  ) : (
                    <span className="text-[var(--color-error)]">○</span>
                  )}
                </div>
                <div className="text-[14px] font-semibold tabular-nums mt-0.5">
                  {pos[i]?.toFixed(2) ?? "—"}
                </div>
              </div>
            ))}
          </div>

          {/* Jog grid: X+ Y+ on row, ←home→ middle, X- Y- bottom */}
          <div className="grid grid-cols-[1fr_auto] gap-3 pt-2">
            <div className="grid grid-cols-3 gap-1 w-fit">
              <span />
              <Button
                size="sm"
                onClick={() => jog("Y", 1)}
                className="w-9 h-9 p-0"
              >
                <ChevronUp className="w-4 h-4" />
              </Button>
              <span />
              <Button
                size="sm"
                onClick={() => jog("X", -1)}
                className="w-9 h-9 p-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => mr.runGcode("G28")}
                className="w-9 h-9 p-0"
                title="Home all"
              >
                <Home className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                onClick={() => jog("X", 1)}
                className="w-9 h-9 p-0"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <span />
              <Button
                size="sm"
                onClick={() => jog("Y", -1)}
                className="w-9 h-9 p-0"
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
              <span />
            </div>
            {/* Z controls */}
            <div className="flex flex-col gap-1">
              <Button
                size="sm"
                onClick={() => jog("Z", 1)}
                className="w-9 h-9 p-0"
              >
                <ChevronUp className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => mr.runGcode("G28 Z")}
                className="w-9 h-9 p-0"
                title="Home Z"
              >
                Z
              </Button>
              <Button
                size="sm"
                onClick={() => jog("Z", -1)}
                className="w-9 h-9 p-0"
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Distance presets */}
          <div className="flex gap-1 p-0.5 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md w-fit">
            {DISTANCES.map((d) => (
              <button
                key={d}
                onClick={() => setDist(d)}
                className={cn(
                  "h-6 px-2.5 rounded text-[11px] font-medium tabular-nums transition-colors",
                  dist === d
                    ? "bg-[var(--color-bg)] text-[var(--color-accent)] shadow-[inset_0_0_0_1px_var(--color-border-strong)]"
                    : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                )}
              >
                {d}
              </button>
            ))}
            <span className="text-[10px] text-[var(--color-fg-muted)] self-center px-1.5">
              mm
            </span>
          </div>

          {/* Motors off */}
          <div className="pt-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => mr.runGcode("M84")}
            >
              <PowerOff className="w-3 h-3" /> Motors off
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
