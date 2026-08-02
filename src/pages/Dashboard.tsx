import { Card } from "@/components/Card";
import { ThermalGauge } from "@/components/ThermalGauge";
import { Sparkline } from "@/components/Sparkline";
import { PrinterCard } from "@/components/PrinterCard";
import { MissionTimeline } from "@/components/MissionTimeline";
import { CameraStream } from "@/components/CameraStream";
import { usePrinter } from "@/lib/usePrinter";
import { Camera, Flame, ThermometerSun, Wind } from "lucide-react";
import { cn } from "@/lib/utils";
import { useExperienceMode } from "@/lib/useExperienceMode";

export function Dashboard() {
  const { state, profile } = usePrinter();
  const [experienceMode] = useExperienceMode();
  const isExpert = experienceMode === "expert";
  const ext = state.extruder;
  const bed = state.heater_bed;
  const fanSpeed = state.fan?.speed ?? 0;
  const hotend = profile.heaters.find((h) => h.klipper === "extruder");
  const bedH = profile.heaters.find((h) => h.klipper === "heater_bed");

  return (
    <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-3 p-[clamp(0.75rem,2vw,1.5rem)] md:grid-cols-8 lg:grid-cols-12">
      <div className="order-2 flex min-h-full flex-col gap-3 md:col-span-5 lg:col-span-8 lg:order-1">
        <Card title="Camera" icon={<Camera />}>
          <div className="relative -m-[clamp(0.75rem,1.4vw,1.25rem)] aspect-video overflow-hidden bg-black">
            <CameraStream className="absolute inset-0" />
            {isExpert && state.toolhead?.position && (
              <div className="absolute bottom-2 left-2 z-10 flex gap-2 border border-white/20 bg-black/78 px-2 py-1 font-mono text-[10px] tabular-nums">
                <span>X{state.toolhead.position[0]?.toFixed(1) ?? "—"}</span>
                <span>Y{state.toolhead.position[1]?.toFixed(1) ?? "—"}</span>
                <span>Z{state.toolhead.position[2]?.toFixed(2) ?? "—"}</span>
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="order-1 flex min-h-full flex-col gap-3 md:col-span-3 lg:col-span-4 lg:order-2">
        <MissionTimeline />
        <PrinterCard />
        <Card title="Thermals" icon={<Flame />}>
          <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
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
          {isExpert && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--color-border)] pt-3">
                <div>
                  <div className="instrument-label mb-1 flex items-center justify-between text-[9px]">
                    <span>Hotend trend</span>
                    <span className="tabular-nums">
                      {ext?.temperature?.toFixed(1) ?? "—"}°
                    </span>
                  </div>
                  <Sparkline value={ext?.temperature} />
                </div>
                <div>
                  <div className="instrument-label mb-1 flex items-center justify-between text-[9px]">
                    <span>Bed trend</span>
                    <span className="tabular-nums">
                      {bed?.temperature?.toFixed(1) ?? "—"}°
                    </span>
                  </div>
                  <Sparkline value={bed?.temperature} color="var(--color-info)" />
                </div>
              </div>
              {(profile.sensors.length > 0 || profile.fans.length > 0) && (
                <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                  <div className="instrument-label mb-2 text-[9px]">
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
            </>
          )}
        </Card>

        {isExpert && <Card title="Telemetry" icon={<Wind />}>
          <div className="divide-y divide-[var(--color-border)]">
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
        </Card>}
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
    <div className="ruled-row flex items-center justify-between py-2 text-[11px]">
      <span className="text-[var(--color-fg-muted)]">{label}</span>
      <div className="flex items-baseline gap-1.5 tabular-nums">
        <span
          className={cn(
            "instrument-value font-medium",
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
      className={cn("flex min-h-11 items-center justify-between gap-3 py-2", warn && "text-[var(--color-warning)]")}
    >
      <span className="instrument-label text-[10px]">
        {label}
      </span>
      <span
        className={cn(
          "instrument-value text-[13px] font-semibold",
          active && "text-[var(--color-accent)]",
          warn && "text-[var(--color-warning)]",
        )}
      >
        {value}
      </span>
    </div>
  );
}
