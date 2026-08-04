import { useEffect, useState } from "react";
import { AlertTriangle, WifiOff } from "lucide-react";
import { usePrinter } from "@/lib/usePrinter";
import {
  BED_SLOPE_LIMITS,
  detectHeaterDrift,
  detectThermalSlope,
  HOTEND_SLOPE_LIMITS,
  isRunawayConfirmed,
  linkLost,
  sensorVerdict,
} from "@/lib/health";
import { useTempHistory } from "@/lib/useTempHistory";
import {
  WATCHDOG_TICK_MS,
  heatersHoldHeat,
  isTelemetryStale,
} from "@/lib/telemetryWatchdog";
import { cn } from "@/lib/utils";

/**
 * Floating alert stack — pinned to top of viewport, low opacity until
 * something demands attention. Aggregates:
 *   - Thermal runaway: actual diverging from target by ±15°C for >30s
 *   - Thermal slope: a heater at full power that is not gaining heat, one
 *     gaining heat with its heater off, or one losing heat while commanded
 *     hot. Early EXPLAINERS, not protection — Klipper's own `verify_heater`
 *     is the safety net; see the WP-THERM block in lib/health.ts.
 *   - Stale telemetry: no data for 10s while heaters were last known hot
 *   - MCU temp watchdog: SoC > 70°C (K1 throttles around there)
 *   - Network: moonraker WS dropped
 *
 * Each alert is dismissible per-page-load; reappears if the condition
 * persists across page reloads.
 *
 * Every condition here re-evaluates on a WATCHDOG TIMER, not only when
 * WebSocket data arrives. Data-driven evaluation alone has a fatal blind
 * spot: a dropped feed stops the evaluation exactly when the heaters may be
 * running unmonitored — the precise scenario the thermal alert exists for.
 */
export function HealthAlerts() {
  const { state, connected, profile } = usePrinter();
  // Rolling 1 Hz heater buffers, sampled off the render path. Empty until
  // real data has arrived, and frozen while the feed is quiet — so the slope
  // rules below stay silent rather than reading a flat line into a fault.
  const tempHistory = useTempHistory(state.extruder, state.heater_bed);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [thermalIssue, setThermalIssue] = useState<{
    heater: string;
    drift: number;
    since: number;
  } | null>(null);
  // Watchdog clock. Ticking this re-renders and re-runs every alert check
  // below even when no telemetry arrives at all.
  const [now, setNow] = useState(() => Date.now());
  // When telemetry last arrived, and whether the heaters were hot then.
  // Initialized "fresh and cold" so a page just loading does not alarm.
  const [telemetry, setTelemetry] = useState(() => ({
    at: Date.now(),
    hot: false,
  }));

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), WATCHDOG_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Record telemetry arrival. Moonraker's merge produces fresh object
  // identities for every heater diff, so this runs on every status push.
  useEffect(() => {
    const ext = state.extruder;
    const bed = state.heater_bed;
    if (!ext && !bed) return; // nothing has ever arrived yet
    setTelemetry({ at: Date.now(), hot: heatersHoldHeat(ext, bed) });
  }, [state.extruder, state.heater_bed]);

  // Thermal runaway: track divergence over time. Detection itself lives in
  // the shared src/lib/health.ts detector — the same verdict the tell-tale
  // lamp reads, so toast and lamp can never disagree.
  useEffect(() => {
    const issue = detectHeaterDrift(state.extruder, state.heater_bed);

    if (!issue) {
      setThermalIssue(null);
      return;
    }

    if (!thermalIssue || thermalIssue.heater !== issue.heater) {
      setThermalIssue({ ...issue, since: Date.now() });
    }
  }, [state.extruder, state.heater_bed, thermalIssue]);

  const alerts: Array<{
    id: string;
    severity: "warn" | "error";
    message: string;
    /**
     * Screen-reader announcement. Must be STABLE text — the visible message
     * may interpolate live telemetry that mutates on every status update,
     * which would flood an atomic live region with re-announcements.
     */
    announcement: string;
    icon: React.ReactNode;
  }> = [];

  // Network alert
  if (linkLost(connected)) {
    const message =
      "Moonraker disconnected — UI showing last known state. Reconnecting…";
    alerts.push({
      id: "network",
      severity: "error",
      message,
      announcement: message,
      icon: <WifiOff className="w-4 h-4" />,
    });
  }

  // Stale telemetry while hot. Fires whether or not the socket still CLAIMS
  // to be connected: a silently wedged link and a dropped link both leave the
  // heaters unmonitored, and the owner has to hear about it either way.
  const staleForMs = now - telemetry.at;
  if (telemetry.hot && isTelemetryStale(now, telemetry.at)) {
    alerts.push({
      id: "stale-data",
      severity: "error",
      message: `No printer data for ${Math.floor(staleForMs / 1000)}s while heaters were hot — temperatures are no longer being monitored`,
      announcement:
        "Printer telemetry is stale while heaters are hot — temperatures are no longer being monitored.",
      icon: <AlertTriangle className="w-4 h-4" />,
    });
  }

  // Thermal runaway (only if persisting >15s to avoid flapping). Gated on the
  // watchdog clock, so it fires on time even if the feed died mid-divergence.
  if (thermalIssue && isRunawayConfirmed(thermalIssue.since, now)) {
    // `drift` is frozen at first detection, so this text is stable.
    const message = `${thermalIssue.heater} temperature diverging by ${thermalIssue.drift.toFixed(1)}°C — possible thermal runaway`;
    alerts.push({
      id: "thermal",
      severity: "error",
      message,
      announcement: message,
      icon: <AlertTriangle className="w-4 h-4" />,
    });
  }

  // Thermal slope explainers. These sit BELOW the runaway alert on purpose:
  // they are warnings, not errors. The ±15°C rule above and Klipper's own
  // verify_heater remain the authorities on "this is a fault" — these three
  // only get in front of the owner earlier, in words, and they are tuned to
  // stay quiet through every healthy heat-up (lib/health.ts, WP-THERM).
  const slopeIssues = [
    detectThermalSlope("Hotend", tempHistory.hotend, HOTEND_SLOPE_LIMITS),
    detectThermalSlope("Bed", tempHistory.bed, BED_SLOPE_LIMITS),
  ];
  for (const issue of slopeIssues) {
    if (!issue) continue;
    alerts.push({
      id: `thermal-slope-${issue.heater.toLowerCase()}`,
      severity: "warn",
      message: issue.message,
      announcement: issue.announcement,
      icon: <AlertTriangle className="w-4 h-4" />,
    });
  }

  // Sensor watchdogs — profile thresholds through the shared verdict
  for (const sensor of profile.sensors) {
    const live = state[sensor.klipper as `temperature_sensor ${string}`];
    const t = live?.temperature;
    if (t == null) continue;
    const verdict = sensorVerdict(sensor, t);
    if (verdict === "critical") {
      alerts.push({
        id: `sensor-${sensor.klipper}`,
        severity: "error",
        message: `${sensor.label} at ${t.toFixed(1)}°C — critical threshold exceeded.`,
        announcement: `${sensor.label} above ${sensor.criticalAbove}°C — critical threshold exceeded.`,
        icon: <AlertTriangle className="w-4 h-4" />,
      });
    } else if (verdict === "warn") {
      alerts.push({
        id: `sensor-${sensor.klipper}`,
        severity: "warn",
        message: `${sensor.label} at ${t.toFixed(1)}°C — running hot.`,
        announcement: `${sensor.label} above ${sensor.warnAbove}°C — running hot.`,
        icon: <AlertTriangle className="w-4 h-4" />,
      });
    }
  }

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="fixed top-14 right-3 z-50 flex flex-col gap-2 max-w-md">
      {/*
       * Live regions live in a visually-hidden sibling so mounting an alert
       * is announced (assertive for errors, polite for warnings) while the
       * visible copy stays free to interpolate live telemetry without
       * re-announcing on every tick. Each entry gets its own role so mixed
       * severities announce at the correct urgency.
       */}
      <div className="sr-only">
        {visible.map((a) => (
          <p key={a.id} role={a.severity === "error" ? "alert" : "status"}>
            {a.announcement}
          </p>
        ))}
      </div>
      {visible.map((a) => (
        <div
          key={a.id}
          data-alert-id={a.id}
          className={cn(
            // Derived-radius rule: toasts pad with p-3 (12px), not the
            // modal's default --modal-pad (16px). Overriding the pad token
            // HERE makes .modal-panel's cascade re-derive the inner radius
            // from the pad the markup actually uses: --radius-inner =
            // max(0, --radius-modal − 12px) = 8px, concentric with the 20px
            // outer corner. (--radius-modal itself resolves at :root and
            // stays 20px.) Same re-check BrandLogo's popover got.
            "modal-panel [--modal-pad:0.75rem] flex items-start gap-2 p-3 border backdrop-blur-sm shadow-lg",
            a.severity === "error"
              ? "bg-(--color-error)/12 border-(--color-error)/50"
              : "bg-(--color-warning)/12 border-(--color-warning)/50",
          )}
        >
          <span
            className={
              a.severity === "error"
                ? "text-[var(--color-error)]"
                : "text-[var(--color-warning)]"
            }
          >
            {a.icon}
          </span>
          <div className="flex-1 text-[12px] leading-relaxed">
            <span
              className={cn(
                "font-medium",
                a.severity === "error"
                  ? "text-[var(--color-error)]"
                  : "text-[var(--color-warning)]",
              )}
            >
              {a.message}
            </span>
          </div>
          <button
            type="button"
            onClick={() =>
              setDismissed((d) => new Set([...d, a.id]))
            }
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-inner text-[16px] leading-none text-[var(--color-fg-muted)] hover:bg-(--color-fg)/8 hover:text-[var(--color-fg)]"
            aria-label="Dismiss alert"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
