import { memo, type ReactNode } from "react";
import { Card } from "@/components/Card";
import { SegmentGauge } from "@/components/SegmentGauge";
import { TellTaleCluster } from "@/components/TellTaleCluster";
import { ThermalGauge } from "@/components/ThermalGauge";
import { Sparkline } from "@/components/Sparkline";
import { PrinterCard } from "@/components/PrinterCard";
import { MissionTimeline } from "@/components/MissionTimeline";
import { CameraStream } from "@/components/CameraStream";
import { usePrinterSelector } from "@/lib/usePrinter";
import { useProfile } from "@/lib/useProfile";
import type { PrinterProfile } from "@/profiles";
import { Camera, Flame, ThermometerSun, Wind } from "lucide-react";
import { cn, factorDeviates } from "@/lib/utils";
import { useExperienceMode } from "@/lib/useExperienceMode";

/**
 * Mission-control dashboard. Zones per the design spec:
 *   Z2 gauge cluster · Z3 job · Z4 viewport · Z5 secondary vitals ·
 *   Z6 readiness. (Z1, the mission status, is the app shell's bottom
 *   MissionBar — pinned to the glass, not part of this scroll.)
 * DOM order follows the mobile task order ("what is it doing?" → "how hot?"
 * → "show me" → details) and never changes. Column count is CONTENT-driven:
 * `.dashboard-grid` (index.css) measures the width that actually exists
 * (container query on the shell) instead of viewport breakpoints — a Swiss
 * modular grid of 4/8/12 columns placed by NAMED AREAS (.z-* classes).
 * AMENDED rule: the old "no order-* / col-start-*" ban's intent (no DOM
 * reordering, no orphaned rows) holds because every area map allocates
 * every cell of every row; zones are placed by name, never by DOM shuffle.
 *
 * WP-MEMO (S5 P2): the page selects a FLAT bag of primitives and hands each
 * panel exactly the primitives it renders; the panels are memo'd, so a
 * change in one instrument no longer re-renders the others.
 */
export function Dashboard() {
  const profile = useProfile();
  const [experienceMode] = useExperienceMode();
  const isExpert = experienceMode === "expert";
  const chamber = profile.sensors.find((sensor) => /chamber/i.test(sensor.label));

  const t = usePrinterSelector((state) => ({
    extTemp: state.extruder?.temperature,
    extTarget: state.extruder?.target,
    extPower: state.extruder?.power,
    bedTemp: state.heater_bed?.temperature,
    bedTarget: state.heater_bed?.target,
    bedPower: state.heater_bed?.power,
    fanSpeed: state.fan?.speed ?? 0,
    chamberTemp: chamber
      ? state[chamber.klipper as `temperature_sensor ${string}`]?.temperature
      : undefined,
    filamentMm: state.print_stats?.filament_used ?? 0,
    speedFactor: state.gcode_move?.speed_factor,
    flowFactor: state.gcode_move?.extrude_factor,
    zHome: state.gcode_move?.homing_origin?.[2],
    pressureAdvance: state.extruder?.pressure_advance,
    liveVelocity: state.motion_report?.live_velocity,
    maxAccel: state.toolhead?.max_accel,
    // Range sources for the honest bars (segmented-dials spec §2.1). None of
    // these move at telemetry cadence — max_velocity and the axis limits are
    // config-static — so the memo boundaries stay effective.
    maxVelocity: state.toolhead?.max_velocity,
    axisMinZ: state.toolhead?.axis_minimum?.[2],
    axisMaxZ: state.toolhead?.axis_maximum?.[2],
    posX: state.toolhead?.position?.[0],
    posY: state.toolhead?.position?.[1],
    posZ: state.toolhead?.position?.[2],
    homedAxes: state.toolhead?.homed_axes,
    // motion_report only streams while claimed — the expert "Live Vel."
    // tile is its sole Dashboard reader (WP-PERF).
  }), { motion: isExpert });

  return (
    <div className="dashboard-shell mx-auto max-w-[min(100%,2200px)] p-[var(--page-gutter)]">
      <div className="dashboard-grid">
        {/* Z3 — JOB / PROGRESS */}
        <div className="z-mission">
          <MissionTimeline />
        </div>

        {/* Z2 — PRIMARY GAUGE CLUSTER */}
        <div className="z-thermals">
          <ThermalsPanel
            profile={profile}
            isExpert={isExpert}
            extTemp={t.extTemp}
            extTarget={t.extTarget}
            extPower={t.extPower}
            bedTemp={t.bedTemp}
            bedTarget={t.bedTarget}
            bedPower={t.bedPower}
          />
        </div>

        {/* Z4 — VIEWPORT */}
        <div className="z-camera">
          <Card
            title="Camera"
            icon={<Camera />}
            // Center the full-bleed viewport when the stretched row leaves
            // slack — symmetric margins instead of a hollow tail. The feed
            // itself keeps its 16:9 box (object-cover: growing it would
            // crop the print out of frame).
            bodyClassName="flex flex-col justify-center"
          >
            <div className="relative -m-[var(--card-pad)] aspect-video overflow-hidden bg-black">
              <CameraStream className="absolute inset-0" />
              {isExpert && t.posX != null && (
                <div className="absolute bottom-2 left-2 z-10 flex gap-2 border border-white/20 bg-black/78 px-2 py-1 text-[11px] tabular-nums">
                  <span>X{t.posX?.toFixed(1) ?? "—"}</span>
                  <span>Y{t.posY?.toFixed(1) ?? "—"}</span>
                  <span>Z{t.posZ?.toFixed(2) ?? "—"}</span>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Z5 — SECONDARY VITALS. Both modes: the cockpit spends its
            reclaimed space on information — chamber, fan, speed, flow,
            Z-offset, filament — with the deeper motion internals kept for
            expert mode. Telemetry and the Systems tell-tale cluster are
            SIBLING zones: the Swiss area maps place them on one row (mid)
            or give the lamp block its own full-width binnacle row (desk),
            so their alignment is grid-guaranteed, not wrapper-managed. */}
        <div className="z-telemetry">
          <TelemetryPanel
            chamber={chamber}
            isExpert={isExpert}
            chamberTemp={t.chamberTemp}
            fanSpeed={t.fanSpeed}
            filamentMm={t.filamentMm}
            speedFactor={t.speedFactor}
            flowFactor={t.flowFactor}
            zHome={t.zHome}
            pressureAdvance={t.pressureAdvance}
            liveVelocity={t.liveVelocity}
            maxAccel={t.maxAccel}
            maxVelocity={t.maxVelocity}
            axisMinZ={t.axisMinZ}
            axisMaxZ={t.axisMaxZ}
            profileZMin={profile.bounds?.min[2]}
            profileZMax={profile.bounds?.max[2]}
            posZ={t.posZ}
            homedAxes={t.homedAxes}
            hotendPower={t.extPower}
            bedPower={t.bedPower}
          />
        </div>

        <div className="z-telltales">
          <TellTaleCluster />
        </div>

        {/* Z6 — READINESS (top-left by area placement on multi-column
            classes; DOM-last so the mobile task order is untouched). */}
        <div className="z-readiness">
          <PrinterCard />
        </div>
      </div>
    </div>
  );
}

const ThermalsPanel = memo(function ThermalsPanel({
  profile,
  isExpert,
  extTemp,
  extTarget,
  extPower,
  bedTemp,
  bedTarget,
  bedPower,
}: {
  profile: PrinterProfile;
  isExpert: boolean;
  extTemp?: number;
  extTarget?: number;
  extPower?: number;
  bedTemp?: number;
  bedTarget?: number;
  bedPower?: number;
}) {
  const hotend = profile.heaters.find((heater) => heater.klipper === "extruder");
  const bedH = profile.heaters.find((heater) => heater.klipper === "heater_bed");
  return (
    <Card
      title="Thermals"
      icon={<Flame />}
      // Center the instrument group when a stretched dashboard row makes
      // this card taller than its dials — slack splits above/below the
      // instruments instead of pooling in a hollow tail. No effect when
      // the card is content-sized (compact chrome).
      bodyClassName="flex flex-col justify-center"
    >
      <div className="thermal-grid">
        <ThermalGauge label={hotend?.label ?? "Hotend"} actual={extTemp} target={extTarget} power={extPower} maxTemp={hotend?.maxTemp ?? 300} icon={<Flame className="w-3 h-3" />} />
        <ThermalGauge label={bedH?.label ?? "Bed"} actual={bedTemp} target={bedTarget} power={bedPower} maxTemp={bedH?.maxTemp ?? 120} icon={<ThermometerSun className="w-3 h-3" />} />
      </div>
      {isExpert && <>
        <div className="mt-3 grid grid-cols-2 gap-[var(--grid-gap)] border-t border-[var(--color-border)] pt-3">
          <Trend label="Hotend trend" value={extTemp} />
          <Trend label="Bed trend" value={bedTemp} color="var(--color-info)" />
        </div>
        <AuxSensors profile={profile} />
      </>}
    </Card>
  );
});

/**
 * Expert-only auxiliary rows. Owns its own (flat, primitive) selection so
 * the memo'd ThermalsPanel above stays skippable when only an aux sensor
 * moved — and vice versa.
 */
const AuxSensors = memo(function AuxSensors({ profile }: { profile: PrinterProfile }) {
  const aux = usePrinterSelector((state) => {
    const flat: Record<string, number | undefined> = {};
    for (const sensor of profile.sensors) {
      flat[sensor.klipper] =
        state[sensor.klipper as `temperature_sensor ${string}`]?.temperature;
    }
    for (const fan of profile.fans) {
      const reading = state[fan.klipper as `temperature_fan ${string}`];
      flat[`${fan.klipper}:temperature`] = reading?.temperature;
      flat[`${fan.klipper}:target`] = reading?.target;
      flat[`${fan.klipper}:speed`] = reading?.speed;
    }
    return flat;
  });
  if (profile.sensors.length === 0 && profile.fans.length === 0) return null;
  return (
    <div className="mt-3 border-t border-[var(--color-border)] pt-3">
      <div className="instrument-label mb-2 text-[11px]">Aux sensors</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {profile.sensors.map((sensor) => <AuxRow key={sensor.klipper} label={sensor.label} actual={aux[sensor.klipper]} warnAbove={sensor.warnAbove} criticalAbove={sensor.criticalAbove} />)}
        {profile.fans.map((fan) => <AuxRow key={fan.klipper} label={fan.label} actual={aux[`${fan.klipper}:temperature`]} target={aux[`${fan.klipper}:target`]} speed={aux[`${fan.klipper}:speed`]} driftWarn={fan.driftWarn} />)}
      </div>
    </div>
  );
});

function Trend({ label, value, color }: { label: string; value?: number; color?: string }) {
  return <div><div className="instrument-label mb-1 flex items-center justify-between text-[11px]"><span>{label}</span><span className="tabular-nums">{value?.toFixed(1) ?? "—"}°</span></div><Sparkline value={value} quantity={label} unit="degrees Celsius" color={color} /></div>;
}

/** Z-offset (babystep) per spec §2 row 17: signed, 3 dp, mm — `—` when unknown. */
function formatZOffset(offset: number | null | undefined): string {
  if (offset == null || !Number.isFinite(offset)) return "—";
  return `${offset < 0 ? "" : "+"}${offset.toFixed(3)} mm`;
}

const TelemetryPanel = memo(function TelemetryPanel({
  chamber,
  isExpert,
  chamberTemp,
  fanSpeed,
  filamentMm,
  speedFactor,
  flowFactor,
  zHome,
  pressureAdvance,
  liveVelocity,
  maxAccel,
  maxVelocity,
  axisMinZ,
  axisMaxZ,
  profileZMin,
  profileZMax,
  posZ,
  homedAxes,
  hotendPower,
  bedPower,
}: {
  chamber: PrinterProfile["sensors"][number] | undefined;
  isExpert: boolean;
  chamberTemp?: number;
  fanSpeed: number;
  filamentMm: number;
  speedFactor?: number;
  flowFactor?: number;
  zHome?: number;
  pressureAdvance?: number;
  liveVelocity?: number;
  maxAccel?: number;
  maxVelocity?: number;
  axisMinZ?: number;
  axisMaxZ?: number;
  profileZMin?: number;
  profileZMax?: number;
  posZ?: number;
  homedAxes?: string;
  hotendPower?: number;
  bedPower?: number;
}) {
  /* DEGRADATION LAW (segmented-dials spec §2.4): an unknown range yields NO
     BAR — never a default, never a "sane" fallback. The old `?? 80` here
     drew a fabricated 0–80° chamber scale for any profile that omits
     maxTemp. Do NOT borrow safety.ts's `?? [300,300,300,0]` for the Z scale
     either: that default makes a MOTION CLAMP fail safe (a smaller assumed
     volume is conservative); as a DISPLAY scale it would report the toolhead
     at a fraction of a travel the printer does not have. Fail-safe defaults
     and display truth are different problems. */
  const chamberMax = chamber?.maxTemp;
  const chamberWarn =
    chamber?.warnAbove != null && chamberTemp != null && chamberTemp >= chamber.warnAbove;
  const velocityMax = maxVelocity != null && maxVelocity > 0 ? maxVelocity : undefined;
  const zMin = axisMinZ ?? profileZMin;
  const zMax = axisMaxZ ?? profileZMax;
  /* Position Z is additionally homing-gated: an unhomed position[2] is a raw
     stepper coordinate with no relation to the build volume. Unknown homing
     (no toolhead telemetry) must never render as a "not homed" claim — the
     same rule as .telltale-axis-unknown. */
  const zHomed = homedAxes != null && homedAxes.toLowerCase().includes("z");
  const zKnownUnhomed = homedAxes != null && !homedAxes.toLowerCase().includes("z");
  const zBar = zHomed && zMin != null && zMax != null && zMax > zMin;
  /* Segment strips (SD1 spec §2.1) carry the stepped quantities — duty
     cycles, factor offsets, the bounded chamber with its warn-zone cap.
     Factors with no published range (Z-offset, filament, pressure advance,
     max accel, homed) stay bar-less ON PRINCIPLE — a bar would invent a
     ceiling, the exact pressure-advance incident class — and their tiles
     carry NO filler: no ghost track, no neutral rule. A ghost track reads
     as "0% of something", i.e. a false ceiling, and filler would reverse
     the flatten pass; top-alignment already carries the layout. */
  /* ZONES (density pass). Bar-less tiles used to share the gauges' 49.5px
     grid rows, so each left a bar-shaped 27–33px void — the hole read as a
     MISSING bar, which is the one thing it must never look like. The fix
     removes the hole rather than filling it: the SCALED factors keep their
     own zone and column rhythm, and the bar-less READINGS get a denser zone
     that packs at their natural size. Nothing new is drawn to occupy space,
     so no ceiling is implied and the flatten pass is preserved.
     A tile's zone follows what it actually RENDERS, not its label — Live
     Vel. and Position Z are bars only when their range is known, so they
     move zones with the telemetry rather than lying about their type. */
  const scaled: ReactNode[] = [];
  const readings: ReactNode[] = [];

  if (chamber) {
    if (chamberMax != null) scaled.push(<SegmentGauge key="chamber" label={chamber.label} display={chamberTemp != null ? `${chamberTemp.toFixed(1)}°C` : "—"} value={chamberTemp} max={chamberMax} warnFrom={chamber.warnAbove} stateColor={chamberWarn ? "var(--color-warning)" : undefined} description={`Scale 0 to ${chamberMax} degrees Celsius${chamber.warnAbove != null ? `, warning above ${chamber.warnAbove}` : ""}.`} />);
    else readings.push(<MetricTile key="chamber" label={chamber.label} value={chamberTemp != null ? `${chamberTemp.toFixed(1)}°C` : "—"} warn={chamberWarn} />);
  }
  scaled.push(<SegmentGauge key="fan" label="Part Fan" display={`${(fanSpeed * 100).toFixed(0)}%`} value={fanSpeed * 100} max={100} stateColor={fanSpeed > 0 ? "var(--color-accent)" : undefined} description="Duty cycle, 0 to 100 percent." />);
  /* Strict !==1 latched a permanent false warning off M220/M221 float noise
     (0.9999999 renders as "100%" yet warned forever). The epsilon in
     factorDeviates matches the display resolution instead.
     TRUTHFULNESS: an absent gcode_move is UNKNOWN, not "nominal 100%". The
     old `?? 1` lit a full-confidence 100% strip off no telemetry at all —
     and did it in BASIC mode. null flows through to SegmentGauge's own
     em-dash unknown state, the same way hotendPower already does. */
  scaled.push(<SegmentGauge key="speed" label="Speed Factor" display={speedFactor != null ? `${(speedFactor * 100).toFixed(0)}%` : "—"} value={speedFactor != null ? speedFactor * 100 : null} min={50} max={150} centerIndex stateColor={factorDeviates(speedFactor) ? "var(--color-warning)" : undefined} description="Scale 50 to 150 percent, index at nominal 100; values beyond the scale are marked." />);
  scaled.push(<SegmentGauge key="flow" label="Flow Factor" display={flowFactor != null ? `${(flowFactor * 100).toFixed(0)}%` : "—"} value={flowFactor != null ? flowFactor * 100 : null} min={50} max={150} centerIndex stateColor={factorDeviates(flowFactor) ? "var(--color-warning)" : undefined} description="Scale 50 to 150 percent, index at nominal 100; values beyond the scale are marked." />);
  /* Z-OFFSET carries a trend: it is constant except during live
     babystepping, and during babystepping the trend IS the thing the
     operator is watching. The line auto-scales to its own samples — no
     axis, no endpoints, no track — so it states a shape, never a ceiling. */
  readings.push(<MetricTile key="zoffset" label="Z-Offset" value={formatZOffset(zHome)} trend={zHome} trendQuantity="Z-offset" trendUnit="millimetres" />);
  /* FILAMENT gets NO trend on purpose: it is monotonic, so auto-scaling
     renders every extrusion rate as the same ~45° ramp — a slope that
     carries no information while looking like it does. */
  readings.push(<MetricTile key="filament" label="Filament" value={filamentMm > 0 ? `${(filamentMm / 1000).toFixed(2)} m` : "—"} />);
  if (isExpert) {
    /* Pressure advance has NO universal range (direct drive ~0–0.1, bowden
       up to ~1.0) — a bar implying a ceiling here is the invented `?? 0.04`
       incident in graphical form. Never a bar. And no trend either: it is
       flat >99% of the time, and buildSparklineGeometry floors the range at
       2, so a constant PA renders as a dead line pinned mid-box — noise that
       invites "is it broken?". */
    readings.push(<MetricTile key="pa" label="Pressure Adv." value={pressureAdvance?.toFixed(4) ?? "—"} />);
    if (velocityMax != null) scaled.push(<SegmentGauge key="vel" label="Live Vel." display={liveVelocity != null ? `${liveVelocity.toFixed(0)} mm/s` : "—"} value={liveVelocity} max={velocityMax} stateColor={(liveVelocity ?? 0) > 1 ? "var(--color-accent)" : undefined} description={`Scale 0 to ${velocityMax} millimetres per second.`} />);
    else readings.push(<MetricTile key="vel" label="Live Vel." value={liveVelocity != null ? `${liveVelocity.toFixed(0)} mm/s` : "—"} active={(liveVelocity ?? 0) > 1} />);
    /* Max accel IS the limit — there is no honest ceiling above a ceiling,
       and configfile is deliberately not subscribed. Never a bar. It does
       earn a trend: Orca/Klipper emit SET_VELOCITY_LIMIT ACCEL=… per
       feature, so it genuinely steps during a print. */
    readings.push(<MetricTile key="accel" label="Max Accel" value={maxAccel ? `${(maxAccel / 1000).toFixed(1)}k` : "—"} trend={maxAccel} trendQuantity="Max accel" trendUnit="millimetres per second squared" />);
    if (zBar) scaled.push(<SegmentGauge key="posz" label="Position Z" display={posZ?.toFixed(3) ?? "—"} value={posZ} min={zMin} max={zMax} description={`Scale ${zMin} to ${zMax} millimetres.`} />);
    else readings.push(<MetricTile key="posz" label="Position Z" value={posZ?.toFixed(3) ?? "—"} affix={zKnownUnhomed ? "unhomed" : undefined} />);
    /* HOMED is a per-axis boolean set, not a scalar — a trend of it is not
       a weak signal, it is undefined. */
    readings.push(<MetricTile key="homed" label="Homed" value={homedAxes?.toUpperCase() || "none"} active={!!homedAxes} />);
    /* Heater power IS a PWM duty strip — the spec's clearest segment case. */
    scaled.push(<SegmentGauge key="hotendpwr" label="Hotend Power" display={hotendPower != null ? `${Math.round(hotendPower * 100)}%` : "—"} value={hotendPower != null ? hotendPower * 100 : null} max={100} stateColor={(hotendPower ?? 0) > 0 ? "var(--color-accent)" : undefined} description="PWM duty, 0 to 100 percent." />);
    scaled.push(<SegmentGauge key="bedpwr" label="Bed Power" display={bedPower != null ? `${Math.round(bedPower * 100)}%` : "—"} value={bedPower != null ? bedPower * 100 : null} max={100} stateColor={(bedPower ?? 0) > 0 ? "var(--color-accent)" : undefined} description="PWM duty, 0 to 100 percent." />);
  }

  return <Card title="Telemetry" icon={<Wind />}><div className="telemetry-grid">
    {scaled.length > 0 && <div className="telemetry-zone" data-zone="scaled">{scaled}</div>}
    {readings.length > 0 && <div className="telemetry-zone" data-zone="readings">{readings}</div>}
  </div></Card>;
});

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
  affix,
  active,
  warn,
  trend,
  trendQuantity,
  trendUnit,
}: {
  label: string;
  value: string;
  /** Muted explanatory word beside the value — an information channel for a
   *  data-conditional absence (Position Z's "unhomed"), never decoration. */
  affix?: string;
  active?: boolean;
  warn?: boolean;
  /** Live scalar to trend. A trend is an INFORMATION decision, not a filler:
   *  pass it only where the shape over time is itself a signal. The line
   *  auto-scales to its own samples — it draws no axis, no endpoints and no
   *  track, so it never encodes a value against an invented range. */
  trend?: number | null;
  trendQuantity?: string;
  trendUnit?: string;
}) {
  const showTrend = trend != null && trendQuantity != null && trendUnit != null;
  return (
    <div
      className={cn(
        // flex-wrap + content-start packs the flex lines to the TOP of the
        // box (telemetry row law: a tile's internal layout must not depend
        // on the row's height); items-center keeps the 11px label optically
        // centred against the 13px value, exactly as SegmentGauge's header
        // row does. The row gap is tight so a trended tile still fits inside
        // the 44px module rather than pushing its zone's rows taller.
        "flex min-h-11 flex-wrap content-start items-center justify-between gap-x-3 gap-y-1",
        warn && "text-[var(--color-warning)]",
      )}
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
        {affix && (
          <span className="ml-1.5 text-[11px] font-normal text-[var(--color-fg-muted)]">
            {affix}
          </span>
        )}
      </span>
      {showTrend && (
        <div className="w-full">
          <Sparkline value={trend} quantity={trendQuantity} unit={trendUnit} height={20} />
        </div>
      )}
    </div>
  );
}
