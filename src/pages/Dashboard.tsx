import { Card } from "@/components/Card";
import { ThermalGauge } from "@/components/ThermalGauge";
import { Sparkline } from "@/components/Sparkline";
import { PrinterCard } from "@/components/PrinterCard";
import { MissionTimeline } from "@/components/MissionTimeline";
import { CameraStream } from "@/components/CameraStream";
import { StatusRail } from "@/components/StatusRail";
import { usePrinter } from "@/lib/usePrinter";
import { Camera, Flame, ThermometerSun, Wind } from "lucide-react";
import { cn } from "@/lib/utils";
import { useExperienceMode } from "@/lib/useExperienceMode";

/**
 * Mission-control dashboard. Zones per the design spec:
 *   Z1 status rail · Z2 gauge cluster · Z3 job · Z4 viewport ·
 *   Z5 secondary vitals (expert) · Z6 readiness.
 * DOM order follows the mobile task order ("is it OK?" → "how hot?" →
 * "show me" → details) and never changes. Lane count is CONTENT-driven:
 * `.dashboard-grid` (index.css) measures the width that actually exists
 * (container query on the shell) instead of viewport breakpoints, and
 * dense flow backfills — no order-* / col-start-* orphaned rows.
 */
export function Dashboard() {
  const { state, profile } = usePrinter();
  const [experienceMode] = useExperienceMode();
  const isExpert = experienceMode === "expert";
  const fanSpeed = state.fan?.speed ?? 0;

  return (
    <div className="dashboard-shell mx-auto max-w-[min(100%,1800px)] p-[var(--page-gutter)]">
      {/* Z1 — STATUS RAIL (sticky under the app bar on compact screens) */}
      <StatusRail />

      <div className="dashboard-grid mt-3">
        {/* Z3 — JOB / PROGRESS */}
        <div>
          <MissionTimeline />
        </div>

        {/* Z2 — PRIMARY GAUGE CLUSTER */}
        <div>
          <ThermalsPanel state={state} profile={profile} isExpert={isExpert} />
        </div>

        {/* Z4 — VIEWPORT. In basic mode (4 panels) the camera widens on the
            three-lane grid so the last row stays filled; in expert mode
            (5 panels) the wide slot belongs to Telemetry below. */}
        <div className={cn(!isExpert && "dash-wide-3")}>
          <Card title="Camera" icon={<Camera />}>
            <div className="relative -m-[var(--card-pad)] aspect-video overflow-hidden bg-black">
              <CameraStream className="absolute inset-0" />
              {isExpert && state.toolhead?.position && (
                <div className="absolute bottom-2 left-2 z-10 flex gap-2 border border-white/20 bg-black/78 px-2 py-1 font-mono text-[11px] tabular-nums">
                  <span>X{state.toolhead.position[0]?.toFixed(1) ?? "—"}</span>
                  <span>Y{state.toolhead.position[1]?.toFixed(1) ?? "—"}</span>
                  <span>Z{state.toolhead.position[2]?.toFixed(2) ?? "—"}</span>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Z5 — SECONDARY VITALS (expert). Wide: 9 tiles spread across the
            full row instead of crowding a 250px column. */}
        {isExpert && (
          <div className="dash-wide">
            <TelemetryPanel state={state} fanSpeed={fanSpeed} />
          </div>
        )}

        {/* Z6 — READINESS */}
        <div>
          <PrinterCard />
        </div>
      </div>
    </div>
  );
}

function ThermalsPanel({
  state,
  profile,
  isExpert,
}: {
  state: ReturnType<typeof usePrinter>["state"];
  profile: ReturnType<typeof usePrinter>["profile"];
  isExpert: boolean;
}) {
  const ext = state.extruder;
  const bed = state.heater_bed;
  const hotend = profile.heaters.find((heater) => heater.klipper === "extruder");
  const bedH = profile.heaters.find((heater) => heater.klipper === "heater_bed");
  return (
    <Card title="Thermals" icon={<Flame />}>
      <div className="thermal-grid">
        <ThermalGauge label={hotend?.label ?? "Hotend"} actual={ext?.temperature} target={ext?.target} power={ext?.power} maxTemp={hotend?.maxTemp ?? 300} icon={<Flame className="w-3 h-3" />} />
        <ThermalGauge label={bedH?.label ?? "Bed"} actual={bed?.temperature} target={bed?.target} power={bed?.power} maxTemp={bedH?.maxTemp ?? 120} icon={<ThermometerSun className="w-3 h-3" />} />
      </div>
      {isExpert && <>
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--color-border)] pt-3">
          <Trend label="Hotend trend" value={ext?.temperature} />
          <Trend label="Bed trend" value={bed?.temperature} color="var(--color-info)" />
        </div>
        {(profile.sensors.length > 0 || profile.fans.length > 0) && <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <div className="instrument-label mb-2 text-[11px]">Aux sensors</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {profile.sensors.map((sensor) => <AuxRow key={sensor.klipper} label={sensor.label} actual={state[sensor.klipper as `temperature_sensor ${string}`]?.temperature} warnAbove={sensor.warnAbove} criticalAbove={sensor.criticalAbove} />)}
            {profile.fans.map((fan) => <AuxRow key={fan.klipper} label={fan.label} actual={state[fan.klipper as `temperature_fan ${string}`]?.temperature} target={state[fan.klipper as `temperature_fan ${string}`]?.target} speed={state[fan.klipper as `temperature_fan ${string}`]?.speed} driftWarn={fan.driftWarn} />)}
          </div>
        </div>}
      </>}
    </Card>
  );
}

function Trend({ label, value, color }: { label: string; value?: number; color?: string }) {
  return <div><div className="instrument-label mb-1 flex items-center justify-between text-[11px]"><span>{label}</span><span className="tabular-nums">{value?.toFixed(1) ?? "—"}°</span></div><Sparkline value={value} color={color} /></div>;
}

/** Z-offset (babystep) per spec §2 row 17: signed, 3 dp, mm — `—` when unknown. */
function formatZOffset(offset: number | null | undefined): string {
  if (offset == null || !Number.isFinite(offset)) return "—";
  return `${offset < 0 ? "" : "+"}${offset.toFixed(3)} mm`;
}

function TelemetryPanel({ state, fanSpeed }: { state: ReturnType<typeof usePrinter>["state"]; fanSpeed: number }) {
  return <Card title="Telemetry" icon={<Wind />}><div className="telemetry-grid">
    <MetricTile label="Part Fan" value={`${(fanSpeed * 100).toFixed(0)}%`} active={fanSpeed > 0} />
    <MetricTile label="Speed Factor" value={`${((state.gcode_move?.speed_factor ?? 1) * 100).toFixed(0)}%`} warn={state.gcode_move?.speed_factor != null && state.gcode_move.speed_factor !== 1} />
    <MetricTile label="Flow Factor" value={`${((state.gcode_move?.extrude_factor ?? 1) * 100).toFixed(0)}%`} warn={state.gcode_move?.extrude_factor != null && state.gcode_move.extrude_factor !== 1} />
    <MetricTile label="Pressure Adv." value={state.extruder?.pressure_advance?.toFixed(4) ?? "—"} />
    <MetricTile label="Live Vel." value={state.motion_report?.live_velocity != null ? `${state.motion_report.live_velocity.toFixed(0)} mm/s` : "—"} active={(state.motion_report?.live_velocity ?? 0) > 1} />
    <MetricTile label="Max Accel" value={state.toolhead?.max_accel ? `${(state.toolhead.max_accel / 1000).toFixed(1)}k` : "—"} />
    <MetricTile label="Position Z" value={state.toolhead?.position?.[2]?.toFixed(3) ?? "—"} />
    <MetricTile label="Z-Offset" value={formatZOffset(state.gcode_move?.homing_origin?.[2])} />
    <MetricTile label="Homed" value={state.toolhead?.homed_axes?.toUpperCase() || "none"} active={!!state.toolhead?.homed_axes} />
  </div></Card>;
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
          <span className="text-[var(--color-fg-muted)] text-[11px]">
            / {target.toFixed(0)}°
          </span>
        )}
        {speed != null && speed > 0 && (
          <span className="text-[var(--color-fg-muted)] text-[11px]">
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
      className={cn("flex min-h-11 items-center justify-between gap-3 px-3 py-2", warn && "text-[var(--color-warning)]")}
    >
      <span className="instrument-label text-[11px]">
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
