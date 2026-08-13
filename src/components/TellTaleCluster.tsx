import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CircleSlash,
  Cpu,
  Fan,
  Flame,
  Gauge,
  Grid3x3,
  Home,
  ShieldAlert,
  Thermometer,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/Card";
import { usePrinter } from "@/lib/usePrinter";
import { useHostHealth } from "@/lib/useHostHealth";
import { hostLamp } from "@/lib/hostHealth";
import { detectHeaterDrift, isRunawayConfirmed } from "@/lib/health";
import { WATCHDOG_TICK_MS } from "@/lib/telemetryWatchdog";
import {
  acknowledgeLamp,
  homedAxes,
  nextLampPhase,
  readLamps,
  type LampPhase,
  type LampReading,
} from "@/lib/telltales";

/**
 * SD1 tell-tale block — the persistent faults-at-a-glance lamp panel,
 * drawn as ENGINE LIGHTS (owner: "no square on the side, just the colored
 * active icons"): the glyph ITSELF is the lamp — no lamp square, no cell
 * backdrop, no well chrome. HealthAlerts toasts remain the interrupt
 * channel; both read the SAME detectors in src/lib/health.ts so they can
 * never disagree.
 *
 * Every lamp carries three channels (no color-only state): glyph weight
 * (lit strokes are heavy, unlit are hairline), severity color, and an
 * always-visible 11px label. Latched lamps stay lit after their condition
 * clears until acknowledged — the whole 44px cell is the acknowledge
 * target. A 700ms one-shot bulb-test lights every cell on the first
 * WebSocket connect (a discrete on→off step, not a pulse —
 * reduced-motion-safe by construction), ref-guarded so a reconnect never
 * re-runs it.
 */

/** Key-on bulb check duration — one discrete step, no stagger, no repeat. */
const BULB_TEST_MS = 700;

const LAMP_ICON: Record<string, LucideIcon> = {
  "thermal-runaway": AlertTriangle,
  "heater-fault": Flame,
  firmware: Cpu,
  "link-lost": WifiOff,
  "fan-fault": Fan,
  "host-load": Gauge,
  "mcu-hot": Thermometer,
  "mesh-active": Grid3x3,
  homed: Home,
};

const SEVERITY_COLOR: Record<LampReading["severity"], string> = {
  error: "var(--color-error)",
  warning: "var(--color-warning)",
  info: "var(--color-info)",
  success: "var(--color-success)",
};

interface CellState {
  phase: LampPhase;
  /** Sub-text captured while the condition was true (klippy messages vanish
   *  on recovery, but a latched lamp must still say why it tripped). */
  detail?: string;
}

export function TellTaleCluster() {
  const { state, connected, profile } = usePrinter();
  // Watchdog clock — the runaway confirmation window must elapse on time
  // even if the feed dies mid-divergence (same rule as HealthAlerts).
  const [now, setNow] = useState(() => Date.now());
  const [driftIssue, setDriftIssue] = useState<{
    heater: string;
    since: number;
  } | null>(null);
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [testing, setTesting] = useState(false);
  const testedRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), WATCHDOG_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Track drift onset — the shared detector decides WHAT drift is; this
  // component only remembers WHEN it started, mirroring HealthAlerts.
  useEffect(() => {
    const issue = detectHeaterDrift(state.extruder, state.heater_bed);
    if (!issue) {
      setDriftIssue(null);
      return;
    }
    setDriftIssue((prev) =>
      prev && prev.heater === issue.heater
        ? prev
        : { heater: issue.heater, since: Date.now() },
    );
  }, [state.extruder, state.heater_bed]);

  const runawayConfirmed =
    driftIssue != null && isRunawayConfirmed(driftIssue.since, now);

  // HOST LOAD verdict — the shared detector over the proc-stat ring the
  // client already receives (~1 Hz heartbeat traffic, nothing added to the
  // printer). Destructured to primitives so the latch effect below can
  // depend on the VALUES, not a per-render object identity.
  const { lampLoad, buffer } = useHostHealth();
  const { condition: hostCondition, detail: hostDetail } = hostLamp(
    lampLoad,
    buffer,
  );

  // Bulb test: once per mount, on the FIRST connect (a dead WS lighting all
  // lamps then going dark would read as mass failure). Ref-guarded against
  // reconnect re-trigger.
  useEffect(() => {
    if (!connected || testedRef.current) return;
    testedRef.current = true;
    setTesting(true);
    const id = window.setTimeout(() => setTesting(false), BULB_TEST_MS);
    return () => window.clearTimeout(id);
  }, [connected]);

  const lamps = readLamps({
    state,
    profile,
    connected,
    runawayConfirmed,
    host: { condition: hostCondition, detail: hostDetail },
  });

  // Latch phases advance through the pure reducer on every input change.
  useEffect(() => {
    const reading = readLamps({
      state,
      profile,
      connected,
      runawayConfirmed,
      host: { condition: hostCondition, detail: hostDetail },
    });
    setCells((prev) => {
      let changed = false;
      const next: Record<string, CellState> = { ...prev };
      for (const lamp of reading) {
        const prevCell = prev[lamp.id] ?? { phase: "off" as LampPhase };
        const phase = nextLampPhase(prevCell.phase, lamp.condition, lamp.latching);
        const detail =
          lamp.condition && lamp.detail
            ? lamp.detail
            : phase === "off"
              ? undefined
              : prevCell.detail;
        if (phase !== prevCell.phase || detail !== prevCell.detail) {
          next[lamp.id] = { phase, detail };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [state, profile, connected, runawayConfirmed, hostCondition, hostDetail]);

  const acknowledge = (lamp: LampReading) => {
    setCells((prev) => {
      const phase = acknowledgeLamp(lamp.condition);
      return {
        ...prev,
        [lamp.id]: {
          phase,
          detail: phase === "off" ? undefined : prev[lamp.id]?.detail,
        },
      };
    });
  };

  const litLamps = lamps.filter(
    (lamp) => (cells[lamp.id]?.phase ?? "off") !== "off",
  );

  return (
    <Card title="Systems" icon={<ShieldAlert />}>
      {/*
       * SR channel — HealthAlerts pattern: visually-hidden live entries with
       * STABLE text (no interpolated telemetry), assertive for errors,
       * polite for warnings. Info/status lamps are routine state and do not
       * announce. The whole region is withheld during the bulb test so the
       * sweep never reads as eight simultaneous faults.
       */}
      {!testing && litLamps.length > 0 && (
        <div className="sr-only">
          {litLamps
            .filter(
              (lamp) => lamp.severity === "error" || lamp.severity === "warning",
            )
            .map((lamp) => (
              <p
                key={lamp.id}
                role={lamp.severity === "error" ? "alert" : "status"}
              >
                {cells[lamp.id]?.phase === "latched"
                  ? `${lamp.label} indicator latched — condition has cleared, acknowledge to reset.`
                  : `${lamp.label} indicator lit.`}
              </p>
            ))}
        </div>
      )}
      <ul
        className="telltale-grid"
        aria-label="System indicators"
        data-testing={testing || undefined}
      >
        {lamps.map((lamp) => (
          <LampCell
            key={lamp.id}
            lamp={lamp}
            cell={cells[lamp.id] ?? { phase: "off" }}
            testing={testing}
            axes={lamp.id === "homed" ? homedAxes(state) : undefined}
            onAcknowledge={() => acknowledge(lamp)}
          />
        ))}
      </ul>
    </Card>
  );
}

function LampCell({
  lamp,
  cell,
  testing,
  axes,
  onAcknowledge,
}: {
  lamp: LampReading;
  cell: CellState;
  testing: boolean;
  axes?: { axis: string; homed: boolean | null }[];
  onAcknowledge: () => void;
}) {
  const lit = testing || cell.phase !== "off";
  const Icon = LAMP_ICON[lamp.id] ?? CircleSlash;
  const litFlag = lit ? "true" : "false";

  const body = (
    <>
      {/* The glyph IS the lamp: severity-colored heavy stroke when lit,
          dim hairline outline when dark — weight is the non-color channel
          that survives forced colors, and the unlit tick color keeps the
          3:1 discoverability floor (never invisible, never looking lit). */}
      <Icon
        aria-hidden="true"
        data-lit={litFlag}
        className="telltale-icon"
      />
      {axes ? (
        <>
          <span aria-hidden="true" className="instrument-label">
            Homed{" "}
            {axes.map(({ axis, homed }) =>
              // Unknown (no toolhead telemetry yet) renders neutral dashes —
              // never the struck-through NOT-homed assertion. Same rule as
              // the em-dash temperature readouts before the first push.
              homed == null ? (
                <span key={axis} className="telltale-axis-unknown">
                  —
                </span>
              ) : homed ? (
                <span key={axis}>{axis}</span>
              ) : (
                <span key={axis} className="telltale-axis-unhomed">
                  {axis}
                </span>
              ),
            )}
          </span>
          <span className="sr-only">
            {axes.some(({ homed }) => homed == null)
              ? "Homed axes: unknown — awaiting telemetry."
              : `Homed axes: ${
                  axes
                    .filter(({ homed }) => homed)
                    .map(({ axis }) => axis)
                    .join(" ") || "none"
                }`}
          </span>
        </>
      ) : (
        <span className="instrument-label">
          {lamp.label}
          {cell.phase === "latched" && (
            <span className="telltale-ack">ACK</span>
          )}
        </span>
      )}
      {cell.phase !== "off" && cell.detail && (
        <span className="telltale-detail">{cell.detail}</span>
      )}
    </>
  );

  const dataProps = {
    "data-lamp": lamp.id,
    "data-lit": litFlag,
    "data-phase": cell.phase,
    "data-severity": lamp.severity,
  };

  // A latched cell is the acknowledge affordance: the WHOLE 44px cell is the
  // button. Momentary / live cells are non-interactive list items.
  if (cell.phase === "latched") {
    return (
      <li className="telltale-cell-host">
        <button
          type="button"
          onClick={onAcknowledge}
          aria-label={`Acknowledge ${lamp.label}`}
          className="telltale-cell min-h-11 w-full"
          style={{ color: SEVERITY_COLOR[lamp.severity] }}
          {...dataProps}
        >
          {body}
        </button>
      </li>
    );
  }

  return (
    <li
      className="telltale-cell"
      style={lit ? { color: SEVERITY_COLOR[lamp.severity] } : undefined}
      {...dataProps}
    >
      {body}
    </li>
  );
}
