import { Card } from "@/components/Card";
import { SegmentGauge } from "@/components/SegmentGauge";
import { ThermalGauge } from "@/components/ThermalGauge";
import { Sparkline } from "@/components/Sparkline";
import { PrinterCard } from "@/components/PrinterCard";
import { MissionTimeline } from "@/components/MissionTimeline";
import { CameraStream } from "@/components/CameraStream";
import { usePrinter } from "@/lib/usePrinter";
import { Camera, Flame, ThermometerSun, Wind } from "lucide-react";
import { cn, factorDeviates } from "@/lib/utils";
import { useExperienceMode } from "@/lib/useExperienceMode";

/**
 * Mission-control dashboard. Zones per the design spec:
 *   Z2 gauge cluster · Z3 job · Z4 viewport · Z5 secondary vitals ·
 *   Z6 readiness. (Z1, the mission status, is the app shell's bottom
 *   MissionBar — pinned to the glass, not part of this scroll.)
 * DOM order follows the mobile task order ("what is it doing?" → "how hot?"
 * → "show me" → details) and never changes. Lane count is CONTENT-driven:
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
    <div className="dashboard-shell mx-auto max-w-[min(100%,2200px)] p-[var(--page-gutter)]">
      <div className="dashboard-grid">
        {/* Z3 — JOB / PROGRESS */}
        <div>
          <MissionTimeline />
        </div>

        {/* Z2 — PRIMARY GAUGE CLUSTER */}
        <div>
          <ThermalsPanel state={state} profile={profile} isExpert={isExpert} />
        </div>

        {/* Z4 — VIEWPORT */}
        <div>
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

        {/* Z5 — SECONDARY VITALS. Both modes: the cockpit spends its
            reclaimed space on information — chamber, fan, speed, flow,
            Z-offset, filament — with the deeper motion internals kept for
            expert mode. Wide slot so the tiles spread across a full row. */}
        <div className="dash-wide">
          {/* Binnacle strip (S2 §1.3): Telemetry now, the Systems tell-tale
              cluster later — side by side ≥720px, headers on one baseline. */}
          <div className="binnacle-strip">
            <TelemetryPanel state={state} profile={profile} fanSpeed={fanSpeed} isExpert={isExpert} />
          </div>
        </div>

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
        <div className="mt-3 grid grid-cols-2 gap-[var(--grid-gap)] border-t border-[var(--color-border)] pt-3">
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

function TelemetryPanel({
  state,
  profile,
  fanSpeed,
  isExpert,
}: {
  state: ReturnType<typeof usePrinter>["state"];
  profile: ReturnType<typeof usePrinter>["profile"];
  fanSpeed: number;
  isExpert: boolean;
}) {
  const chamber = profile.sensors.find((sensor) => /chamber/i.test(sensor.label));
  const chamberTemp = chamber
    ? state[chamber.klipper as `temperature_sensor ${string}`]?.temperature
    : undefined;
  const chamberMax = chamber?.maxTemp ?? 80;
  const chamberWarn =
    chamber?.warnAbove != null && chamberTemp != null && chamberTemp >= chamber.warnAbove;
  const filamentMm = state.print_stats?.filament_used ?? 0;
  const speedFactor = state.gcode_move?.speed_factor;
  const flowFactor = state.gcode_move?.extrude_factor;
  const hotendPower = state.extruder?.power;
  const bedPower = state.heater_bed?.power;
  /* Segment strips (SD1 spec §2.1) carry the stepped quantities — duty
     cycles, factor offsets, the bounded chamber with its warn-zone cap.
     Scalar readouts (Z-offset, filament, MCU temp) stay numeric tiles: a
     strip for an unbounded number would be false precision. */
  return <Card title="Telemetry" icon={<Wind />}><div className="telemetry-grid">
    {chamber && <SegmentGauge label={chamber.label} display={chamberTemp != null ? `${chamberTemp.toFixed(1)}°C` : "—"} value={chamberTemp} max={chamberMax} warnFrom={chamber.warnAbove} stateColor={chamberWarn ? "var(--color-warning)" : undefined} description={`Scale 0 to ${chamberMax} degrees Celsius${chamber.warnAbove != null ? `, warning above ${chamber.warnAbove}` : ""}.`} />}
    <SegmentGauge label="Part Fan" display={`${(fanSpeed * 100).toFixed(0)}%`} value={fanSpeed * 100} max={100} stateColor={fanSpeed > 0 ? "var(--color-accent)" : undefined} description="Duty cycle, 0 to 100 percent." />
    {/* Strict !==1 latched a permanent false warning off M220/M221 float
        noise (0.9999999 renders as "100%" yet warned forever). The epsilon
        in factorDeviates matches the display resolution instead. */}
    <SegmentGauge label="Speed Factor" display={`${((speedFactor ?? 1) * 100).toFixed(0)}%`} value={(speedFactor ?? 1) * 100} min={50} max={150} centerIndex stateColor={factorDeviates(speedFactor) ? "var(--color-warning)" : undefined} description="Scale 50 to 150 percent, index at nominal 100." />
    <SegmentGauge label="Flow Factor" display={`${((flowFactor ?? 1) * 100).toFixed(0)}%`} value={(flowFactor ?? 1) * 100} min={50} max={150} centerIndex stateColor={factorDeviates(flowFactor) ? "var(--color-warning)" : undefined} description="Scale 50 to 150 percent, index at nominal 100." />
    <MetricTile label="Z-Offset" value={formatZOffset(state.gcode_move?.homing_origin?.[2])} />
    <MetricTile label="Filament" value={filamentMm > 0 ? `${(filamentMm / 1000).toFixed(2)} m` : "—"} />
    {isExpert && <>
      <MetricTile label="Pressure Adv." value={state.extruder?.pressure_advance?.toFixed(4) ?? "—"} />
      <MetricTile label="Live Vel." value={state.motion_report?.live_velocity != null ? `${state.motion_report.live_velocity.toFixed(0)} mm/s` : "—"} active={(state.motion_report?.live_velocity ?? 0) > 1} />
      <MetricTile label="Max Accel" value={state.toolhead?.max_accel ? `${(state.toolhead.max_accel / 1000).toFixed(1)}k` : "—"} />
      <MetricTile label="Position Z" value={state.toolhead?.position?.[2]?.toFixed(3) ?? "—"} />
      <MetricTile label="Homed" value={state.toolhead?.homed_axes?.toUpperCase() || "none"} active={!!state.toolhead?.homed_axes} />
      {/* Heater power IS a PWM duty strip — the spec's clearest segment case. */}
      <SegmentGauge label="Hotend Power" display={hotendPower != null ? `${Math.round(hotendPower * 100)}%` : "—"} value={hotendPower != null ? hotendPower * 100 : null} max={100} stateColor={(hotendPower ?? 0) > 0 ? "var(--color-accent)" : undefined} description="PWM duty, 0 to 100 percent." />
      <SegmentGauge label="Bed Power" display={bedPower != null ? `${Math.round(bedPower * 100)}%` : "—"} value={bedPower != null ? bedPower * 100 : null} max={100} stateColor={(bedPower ?? 0) > 0 ? "var(--color-accent)" : undefined} description="PWM duty, 0 to 100 percent." />
    </>}
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
