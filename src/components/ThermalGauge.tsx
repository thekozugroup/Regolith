import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Dial } from "@/components/Dial";

export interface ThermalGaugeProps {
  label: string;
  actual: number | null | undefined;
  target: number | null | undefined;
  power: number | null | undefined;
  maxTemp?: number;
  icon?: ReactNode;
}

/**
 * Thermal instrument. Renders an honest dial (labeled scale, ticks, target
 * index, dominant readout) when its container is at least 148px wide, and
 * falls back to the rectangular bar renderer below that. The switch is a
 * CSS container query (`.dial-slot` / `.bar-slot` in index.css) — no JS
 * measurement.
 */
export function ThermalGauge({
  label,
  actual,
  target,
  power,
  maxTemp = 280,
  icon,
}: ThermalGaugeProps) {
  const hasActual = actual != null && Number.isFinite(actual);
  const value = hasActual ? actual : 0;
  const setpoint = target ?? 0;
  const active = setpoint > 0;
  const heating = active && value < setpoint - 2;
  const stable = active && Math.abs(value - setpoint) < 2;
  const overTarget = active && value > setpoint + 5;
  const percent = Math.max(0, Math.min(100, (value / maxTemp) * 100));
  const status = overTarget ? "Above target" : stable ? "Stable" : heating ? "Heating" : active ? "Regulating" : "Standby";
  const stateColor = overTarget
    ? "var(--color-error)"
    : stable
      ? "var(--color-success)"
      : active
        ? "var(--color-accent)"
        : "var(--color-fg-muted)";

  return (
    <section
      role="img"
      aria-label={`${label} temperature ${hasActual ? `${value.toFixed(1)} degrees Celsius` : "unavailable"}`}
      aria-description={`${setpoint > 0 ? `Target ${setpoint.toFixed(0)} degrees Celsius. ` : "No target. "}${status}.`}
      className="thermal-instrument instrument-well min-w-0"
      style={{ "--gauge-stroke": stateColor } as CSSProperties}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {icon && <span aria-hidden="true" className="text-[var(--color-fg-muted)]">{icon}</span>}
          <h3 className="instrument-label truncate">{label}</h3>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium" style={{ color: stateColor }}>
          <span aria-hidden="true" className="status-lamp" />
          {status}
        </span>
      </div>

      {/* Dial renderer — shown only when the instrument is ≥148px wide */}
      <div className="dial-slot mt-3">
        <Dial actual={actual} target={setpoint} power={power} maxTemp={maxTemp} />
      </div>

      {/* Bar renderer — the fallback below the 148px dial floor */}
      <div className="bar-slot">
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className={cn("instrument-value text-[clamp(1.65rem,3vw,2.35rem)] font-semibold leading-none tracking-[-0.06em]", !hasActual && "text-[var(--color-fg-muted)]")}>
              {hasActual ? value.toFixed(1) : "—"}<span className="ml-1 text-[0.45em] tracking-normal">°C</span>
            </div>
            <div className="mt-2 flex gap-3 text-[11px] text-[var(--color-fg-muted)]">
              <span><span className="instrument-label mr-1 text-[11px]">Set</span>{setpoint > 0 ? `${setpoint.toFixed(0)}°` : "—"}</span>
              <span><span className="instrument-label mr-1 text-[11px]">Power</span>{power != null ? `${Math.round(power * 100)}%` : "—"}</span>
            </div>
          </div>
          <span className="instrument-label shrink-0 text-right">Max<br />{maxTemp}°</span>
        </div>

        <div className="mt-3 h-1.5 overflow-hidden bg-[var(--color-bg)]" aria-hidden="true">
          <div className="h-full transition-[width,background-color] duration-150" style={{ width: `${percent}%`, backgroundColor: stateColor }} />
        </div>
      </div>
    </section>
  );
}
