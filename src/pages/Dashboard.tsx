import { Card } from "@/components/Card";
import { ThermalGauge } from "@/components/ThermalGauge";
import { Sparkline } from "@/components/Sparkline";
import { PrinterCard } from "@/components/PrinterCard";
import { MissionTimeline } from "@/components/MissionTimeline";
import { CameraStream } from "@/components/CameraStream";
import { usePrinter } from "@/lib/usePrinter";
import { Camera, Flame, ThermometerSun, Wind } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dashboard() {
  const { state, profile } = usePrinter();
  const ext = state.extruder;
  const bed = state.heater_bed;
  const fanSpeed = state.fan?.speed ?? 0;
  const hotend = profile.heaters.find((h) => h.klipper === "extruder");
  const bedH = profile.heaters.find((h) => h.klipper === "heater_bed");

  return (
    <div className="grid grid-cols-12 gap-2 p-3">
      {/* LEFT — Printer card + Visual stacked, fills available height */}
      <div className="col-span-12 sm:col-span-7 flex flex-col gap-2 min-h-full">
        <PrinterCard />

        <Card title="Visual" icon={<Camera />}>
          <div className="aspect-video rounded overflow-hidden -m-3.5 relative">
            <CameraStream className="absolute inset-0" />
            <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded bg-black/60 backdrop-blur-sm border border-white/10 z-10">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] uppercase tracking-[0.1em] font-semibold">
                Live
              </span>
            </div>
            {state.toolhead?.position && (
              <div className="absolute bottom-2 left-2 flex gap-2 px-2 py-1 rounded bg-black/60 backdrop-blur-sm border border-white/10 font-mono text-[10px] tabular-nums z-10">
                <span>X{state.toolhead.position[0]?.toFixed(1) ?? "—"}</span>
                <span>Y{state.toolhead.position[1]?.toFixed(1) ?? "—"}</span>
                <span>Z{state.toolhead.position[2]?.toFixed(2) ?? "—"}</span>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* RIGHT — Thermals + Telemetry stacked, fills available height */}
      <div className="col-span-12 sm:col-span-5 flex flex-col gap-2 min-h-full">
        <Card title="Thermals" icon={<Flame />}>
          <div className="grid grid-cols-2 gap-2">
            <ThermalGauge
              label={hotend?.label ?? "Hotend"}
              actual={ext?.temperature}
              target={ext?.target}
              power={ext?.power}
              maxTemp={hotend?.maxTemp ?? 300}
              icon={<Flame className="w-3 h-3" />}
            />
            <ThermalGauge
              label={bedH?.label ?? "Bed"}
              actual={bed?.temperature}
              target={bed?.target}
              power={bed?.power}
              maxTemp={bedH?.maxTemp ?? 120}
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
          {/* Aux thermals — driven by active profile */}
          {(profile.sensors.length > 0 || profile.fans.length > 0) && (
            <div className="mt-2 pt-2 border-t border-[rgba(63,63,70,0.4)]">
              <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold mb-1.5">
                Aux sensors
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {profile.sensors.map((s) => {
                  const live = state[s.klipper as `temperature_sensor ${string}`];
                  return (
                    <AuxRow
                      key={s.klipper}
                      label={s.label}
                      actual={live?.temperature}
                      warnAbove={s.warnAbove}
                      criticalAbove={s.criticalAbove}
                    />
                  );
                })}
                {profile.fans.map((f) => {
                  const live = state[f.klipper as `temperature_fan ${string}`];
                  return (
                    <AuxRow
                      key={f.klipper}
                      label={f.label}
                      actual={live?.temperature}
                      target={live?.target}
                      speed={live?.speed}
                      driftWarn={f.driftWarn}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        <Card title="Telemetry" icon={<Wind />} className="flex-1">
          <div className="grid grid-cols-2 gap-2">
            <MetricTile
              label="Part Fan"
              value={`${(fanSpeed * 100).toFixed(0)}%`}
              active={fanSpeed > 0}
            />
            <MetricTile
              label="Speed Factor"
              value={`${((state.gcode_move?.speed_factor ?? 1) * 100).toFixed(0)}%`}
              warn={
                state.gcode_move?.speed_factor != null &&
                state.gcode_move.speed_factor !== 1
              }
            />
            <MetricTile
              label="Flow Factor"
              value={`${((state.gcode_move?.extrude_factor ?? 1) * 100).toFixed(0)}%`}
              warn={
                state.gcode_move?.extrude_factor != null &&
                state.gcode_move.extrude_factor !== 1
              }
            />
            <MetricTile
              label="Pressure Adv."
              value={ext?.pressure_advance?.toFixed(4) ?? "—"}
            />
            <MetricTile
              label="Live Vel."
              value={
                state.motion_report?.live_velocity != null
                  ? `${state.motion_report.live_velocity.toFixed(0)} mm/s`
                  : "—"
              }
              active={(state.motion_report?.live_velocity ?? 0) > 1}
            />
            <MetricTile
              label="Max Accel"
              value={
                state.toolhead?.max_accel
                  ? `${(state.toolhead.max_accel / 1000).toFixed(1)}k`
                  : "—"
              }
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
  warnAbove,
  criticalAbove,
  driftWarn,
}: {
  label: string;
  actual?: number;
  target?: number;
  speed?: number;
  warnAbove?: number;
  criticalAbove?: number;
  driftWarn?: number;
}) {
  const active = (target ?? 0) > 0 || (speed ?? 0) > 0.01;
  const driftOver =
    driftWarn != null && target != null && actual != null && actual - target > driftWarn;
  const overTarget =
    driftOver || (target != null && actual != null && actual > target && driftWarn == null);
  const critical = criticalAbove != null && actual != null && actual >= criticalAbove;
  const warn = !critical && warnAbove != null && actual != null && actual >= warnAbove;
  return (
    <div className="flex items-center justify-between text-[11px] py-0.5">
      <span className="text-[var(--color-fg-muted)] font-mono">{label}</span>
      <div className="flex items-baseline gap-1.5 tabular-nums">
        <span
          className={cn(
            "font-mono font-medium",
            critical && "text-[var(--color-error)]",
            !critical && (warn || overTarget) && "text-[var(--color-warning)]",
            active && !overTarget && !warn && !critical && "text-[var(--color-accent)]",
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
  warn,
}: {
  label: string;
  value: string;
  active?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between py-1.5 px-2 rounded-sm bg-[var(--color-elevated)]/40 border",
        warn
          ? "border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.06)]"
          : "border-[var(--color-border)]",
      )}
    >
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] font-semibold">
        {label}
      </span>
      <span
        className={cn(
          "text-[13px] font-semibold tabular-nums font-mono",
          active && "text-[var(--color-accent)]",
          warn && "text-[var(--color-warning)]",
        )}
      >
        {value}
      </span>
    </div>
  );
}
