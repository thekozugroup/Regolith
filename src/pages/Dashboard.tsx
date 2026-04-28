import { Card } from "@/components/Card";
import { ThermalGauge } from "@/components/ThermalGauge";
import { Sparkline } from "@/components/Sparkline";
import { PrinterCard } from "@/components/PrinterCard";
import { MissionTimeline } from "@/components/MissionTimeline";
import { usePrinter } from "@/lib/usePrinter";
import { Camera, Flame, ThermometerSun, Wind } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dashboard() {
  const { state } = usePrinter();
  const ext = state.extruder;
  const bed = state.heater_bed;
  const fanSpeed = state.fan?.speed ?? 0;

  return (
    <div className="grid grid-cols-12 gap-2 p-3">
      {/* LEFT — Printer card + Visual stacked */}
      <div className="col-span-12 lg:col-span-7 flex flex-col gap-2">
        <PrinterCard />

        <Card title="Visual" icon={<Camera />}>
          <div className="aspect-video bg-black rounded overflow-hidden -m-3.5 relative">
            <img
              src="/webcam/?action=stream"
              alt="Live"
              className="w-full h-full object-cover"
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                img.style.display = "none";
              }}
            />
            <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded bg-black/60 backdrop-blur-sm border border-white/10">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] uppercase tracking-[0.1em] font-semibold">
                Live
              </span>
            </div>
            {state.toolhead?.position && (
              <div className="absolute bottom-2 left-2 flex gap-2 px-2 py-1 rounded bg-black/60 backdrop-blur-sm border border-white/10 font-mono text-[10px] tabular-nums">
                <span>X{state.toolhead.position[0]?.toFixed(1) ?? "—"}</span>
                <span>Y{state.toolhead.position[1]?.toFixed(1) ?? "—"}</span>
                <span>Z{state.toolhead.position[2]?.toFixed(2) ?? "—"}</span>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* RIGHT — Thermals + Telemetry stacked */}
      <div className="col-span-12 lg:col-span-5 flex flex-col gap-2">
        <Card title="Thermals" icon={<Flame />}>
          <div className="grid grid-cols-2 gap-2">
            <ThermalGauge
              label="Hotend"
              actual={ext?.temperature}
              target={ext?.target}
              power={ext?.power}
              maxTemp={300}
              icon={<Flame className="w-3 h-3" />}
            />
            <ThermalGauge
              label="Bed"
              actual={bed?.temperature}
              target={bed?.target}
              power={bed?.power}
              maxTemp={120}
              icon={<ThermometerSun className="w-3 h-3" />}
            />
          </div>
          {/* Sparklines */}
          <div className="grid grid-cols-2 gap-3 mt-2 pt-2 border-t border-[rgba(63,63,70,0.4)]">
            <div>
              <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] mb-0.5 flex items-center justify-between">
                <span>Hotend trend</span>
                <span className="tabular-nums">
                  {ext?.temperature?.toFixed(1) ?? "—"}°
                </span>
              </div>
              <Sparkline value={ext?.temperature ?? 0} />
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] mb-0.5 flex items-center justify-between">
                <span>Bed trend</span>
                <span className="tabular-nums">
                  {bed?.temperature?.toFixed(1) ?? "—"}°
                </span>
              </div>
              <Sparkline value={bed?.temperature ?? 0} color="var(--color-info)" />
            </div>
          </div>
          {/* Aux thermals */}
          <div className="mt-2 pt-2 border-t border-[rgba(63,63,70,0.4)]">
            <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold mb-1.5">
              Aux sensors
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <AuxRow
                label="Chamber"
                actual={state["temperature_sensor chamber_temp"]?.temperature}
              />
              <AuxRow
                label="MCU"
                actual={state["temperature_sensor mcu_temp"]?.temperature}
              />
              <AuxRow
                label="Chamber Fan"
                actual={state["temperature_fan chamber_fan"]?.temperature}
                target={state["temperature_fan chamber_fan"]?.target}
                speed={state["temperature_fan chamber_fan"]?.speed}
              />
              <AuxRow
                label="SoC Fan"
                actual={state["temperature_fan soc_fan"]?.temperature}
                target={state["temperature_fan soc_fan"]?.target}
                speed={state["temperature_fan soc_fan"]?.speed}
              />
            </div>
          </div>
        </Card>

        <Card title="Telemetry" icon={<Wind />}>
          <div className="grid grid-cols-2 gap-2">
            <MetricTile
              label="Part Fan"
              value={`${(fanSpeed * 100).toFixed(0)}%`}
              active={fanSpeed > 0}
            />
            <MetricTile
              label="Speed"
              value={
                state.toolhead?.max_velocity
                  ? `${state.toolhead.max_velocity.toFixed(0)} mm/s`
                  : "—"
              }
            />
            <MetricTile
              label="Accel"
              value={
                state.toolhead?.max_accel
                  ? `${(state.toolhead.max_accel / 1000).toFixed(1)}k`
                  : "—"
              }
            />
            <MetricTile
              label="Pressure Adv."
              value={ext?.pressure_advance?.toFixed(4) ?? "—"}
            />
            <MetricTile
              label="Position X"
              value={state.toolhead?.position?.[0]?.toFixed(2) ?? "—"}
            />
            <MetricTile
              label="Position Y"
              value={state.toolhead?.position?.[1]?.toFixed(2) ?? "—"}
            />
            <MetricTile
              label="Position Z"
              value={state.toolhead?.position?.[2]?.toFixed(3) ?? "—"}
            />
            <MetricTile
              label="Homed"
              value={state.toolhead?.homed_axes?.toUpperCase() || "none"}
              active={!!state.toolhead?.homed_axes}
            />
          </div>
        </Card>
      </div>

      {/* BOTTOM — Mission timeline full width */}
      <div className="col-span-12">
        <MissionTimeline />
      </div>
    </div>
  );
}

function AuxRow({
  label,
  actual,
  target,
  speed,
}: {
  label: string;
  actual?: number;
  target?: number;
  speed?: number;
}) {
  const active = (target ?? 0) > 0 || (speed ?? 0) > 0.01;
  const overTarget = target != null && actual != null && actual > target;
  return (
    <div className="flex items-center justify-between text-[11px] py-0.5">
      <span className="text-[var(--color-fg-muted)] font-mono">{label}</span>
      <div className="flex items-baseline gap-1.5 tabular-nums">
        <span
          className={cn(
            "font-mono font-medium",
            overTarget && "text-[var(--color-warning)]",
            active && !overTarget && "text-[var(--color-accent)]",
          )}
        >
          {actual != null ? `${actual.toFixed(1)}°C` : "—"}
        </span>
        {target != null && target > 0 && (
          <span className="text-[var(--color-fg-muted)] text-[10px]">
            / {target.toFixed(0)}°
          </span>
        )}
        {speed != null && speed > 0 && (
          <span className="text-[var(--color-fg-muted)] text-[10px]">
            · {(speed * 100).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded-sm bg-[var(--color-elevated)]/40 border border-[var(--color-border)]">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] font-semibold">
        {label}
      </span>
      <span
        className={cn(
          "text-[13px] font-semibold tabular-nums font-mono",
          active && "text-[var(--color-accent)]",
        )}
      >
        {value}
      </span>
    </div>
  );
}
