import { useEffect, useState } from "react";
import { AlertTriangle, WifiOff } from "lucide-react";
import { usePrinter } from "@/lib/usePrinter";
import {
  BED_SLOPE_LIMITS,
  classifyHostStarvationShutdown,
  detectHeaterDrift,
  detectThermalSlope,
  HOTEND_SLOPE_LIMITS,
  isRunawayConfirmed,
  linkLost,
  sensorVerdict,
} from "@/lib/health";
import { faultContextHasData, formatMb } from "@/lib/hostHealth";
import { useGcodeLog } from "@/lib/useGcodeLog";
import { useTempHistory } from "@/lib/useTempHistory";
import {
  WATCHDOG_TICK_MS,
  heatersHoldHeat,
  isLinkStale,
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
  const { state, connected, profile, mr } = usePrinter();
  // Rolling 1 Hz heater buffers, sampled off the render path. Empty until
  // real data has arrived, and frozen while the feed is quiet — so the slope
  // rules below stay silent rather than reading a flat line into a fault.
  const tempHistory = useTempHistory(state.extruder, state.heater_bed);
  // Recent klipper responses — the shutdown classifier's second arm. The
  // prtouch wording arrives HERE, not in webhooks.state_message.
  const gcodeLines = useGcodeLog(40);
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
    message: React.ReactNode;
    /**
     * Screen-reader announcement. Must be STABLE text — the visible message
     * may interpolate live telemetry that mutates on every status update,
     * which would flood an atomic live region with re-announcements.
     */
    announcement: string;
    icon: React.ReactNode;
  }> = [];

  // Host-starvation shutdown explainer (host-health guard §4) — FIRST, above
  // everything: it is the alert that stops the owner from replacing a probe
  // that is not broken. The FIRMWARE lamp keeps carrying the raw
  // state_message; this adds the interpretation without hiding the original.
  // The classifier's gcode arm matters: incident 2's wording arrived as a
  // gcode response, never as state_message.
  //
  // What the gcode arm is handed is deliberately narrow. Only machine
  // responses (`type === "response"`) from the CURRENT console generation go
  // in — user typing is not evidence, and lines from before a reconnect or a
  // firmware restart describe a machine that is no longer in front of us.
  // The classifier applies the recency window itself, anchored on the frozen
  // fault time rather than on render time so the explainer does not expire
  // while the owner is reading it.
  const fault = mr.getHostFaultContext();
  const epoch = mr.getGcodeEpoch();
  const starvation = classifyHostStarvationShutdown(
    state.webhooks,
    gcodeLines
      .filter((line) => line.epoch === epoch && line.type === "response")
      .map((line) => ({ text: line.text, at: line.ts, fromUser: false })),
    { faultAt: fault?.at ?? null },
  );
  if (starvation.kind === "starvation") {
    // Context is FROZEN at the fault by the client (moonraker.ts snapshots
    // on the shutdown transition). Live values here would be wrong: by the
    // time this renders, the load that caused the fault may have cleared.
    const contextParts: string[] = [];
    if (faultContextHasData(fault)) {
      if (fault.cpuAvg != null) {
        contextParts.push(`CPU ${Math.round(fault.cpuAvg)}% (60 s average)`);
      }
      if (fault.memAvailKb != null) {
        contextParts.push(`${formatMb(fault.memAvailKb)} memory free`);
      }
      if (fault.bufferS != null) {
        contextParts.push(
          `motion buffer ${fault.bufferS.toFixed(1)} s (healthy is about 2 s)`,
        );
      }
    }
    alerts.push({
      id: "host-starvation-shutdown",
      severity: "error",
      message: (
        <span className="block space-y-1.5">
          {/*
           * The probe wording is asserted ONLY when the query that went
           * unanswered actually belongs to the probe family — the classifier
           * captured the name. Saying "the strain-gauge probe asked Klipper
           * for a result" over an unrelated query is exactly the kind of
           * confident wrong sentence this alert exists to prevent.
           */}
          {starvation.probeMessenger ? (
            <span className="block">
              <strong>The probe is the messenger, not the fault.</strong>{" "}
              <span className="font-mono">{starvation.matchedText}</span>{" "}
              means the strain-gauge probe asked Klipper for a result and
              Klipper never answered. That is Klipper being starved of CPU,
              not a failing probe. Do not start by replacing the probe.
            </span>
          ) : (
            <span className="block">
              <strong>This is a timing fault, not a hardware fault.</strong>{" "}
              Klipper stopped because the printer&rsquo;s computer could not
              run it on time — the message{" "}
              <span className="font-mono">{starvation.matchedText}</span> is
              Klipper reporting that it missed its own deadline, not a bad
              probe, sensor, or cable.
            </span>
          )}
          <span className="block" data-testid="host-starvation-context">
            {contextParts.length > 0 ? (
              <>
                <strong>Host at the moment of the fault:</strong>{" "}
                {contextParts.join(" · ")}.
              </>
            ) : (
              <>
                <strong>
                  Host load at the moment of the fault: not recorded.
                </strong>{" "}
                Regolith did not have host statistics for that window.
              </>
            )}
          </span>
          <span className="block">
            Sustained CPU or disk activity on the printer&rsquo;s computer
            causes this. Before replacing or recalibrating anything, stop
            background work on the printer and run the same file again. See{" "}
            <strong>Load shedding before a long print</strong>{" "}
            (docs/load-shedding.md).
          </span>
        </span>
      ),
      announcement:
        "Klipper shut down with a timing fault. This is usually host CPU or disk load, not a hardware failure.",
      icon: <AlertTriangle className="w-4 h-4" />,
    });
  } else if (starvation.kind === "mcu-comms") {
    // The handshake/keepalive queries. Klipper asks these to establish and
    // hold the link to the mainboard, so one going unanswered points at the
    // board, its cable, or its power — NOT at host load. This used to be
    // swept into the starvation copy, which told the owner "not a hardware
    // fault" over the dead-board signature.
    alerts.push({
      id: "host-mcu-comms-shutdown",
      severity: "error",
      message: (
        <span className="block space-y-1.5">
          <span className="block">
            <strong>The mainboard did not answer.</strong>{" "}
            <span className="font-mono">{starvation.matchedText}</span> is
            Klipper&rsquo;s connection check to the mainboard going
            unanswered, not a timing problem on the printer&rsquo;s computer.
          </span>
          <span className="block">
            Start with the physical link: the board&rsquo;s power, its data
            cable at both ends, and any connector that has been disturbed
            recently. Regolith cannot tell you which of those it is — it can
            only tell you the board stopped replying.
          </span>
        </span>
      ),
      announcement:
        "Klipper shut down because the mainboard stopped answering. Check the board's power and data cable.",
      icon: <AlertTriangle className="w-4 h-4" />,
    });
  } else if (starvation.kind === "unclear") {
    // An unanswered query we cannot attribute. The honest answer, and a
    // better one than a confident guess: naming the wrong subsystem on a
    // machine with 255 °C heaters costs more than admitting the gap.
    alerts.push({
      id: "host-shutdown-unclear",
      severity: "error",
      message: (
        <span className="block space-y-1.5">
          <span className="block">
            <strong>Klipper stopped; the cause is unclear.</strong>{" "}
            <span className="font-mono">{starvation.matchedText}</span> says a
            request went unanswered, but the request{" "}
            <span className="font-mono">
              {starvation.queryName ?? "(unnamed)"}
            </span>{" "}
            is not one Regolith recognises, so it will not guess between host
            load and a hardware fault.
          </span>
          <span className="block">
            Both are worth checking: background work on the printer&rsquo;s
            computer, and the mainboard&rsquo;s power and data cable. The full
            firmware message is on the FIRMWARE lamp.
          </span>
        </span>
      ),
      announcement:
        "Klipper shut down after an unanswered request. Regolith cannot determine the cause.",
      icon: <AlertTriangle className="w-4 h-4" />,
    });
  }

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
  const heatersFlyingBlind = telemetry.hot && isTelemetryStale(now, telemetry.at);
  if (heatersFlyingBlind) {
    alerts.push({
      id: "stale-data",
      severity: "error",
      message: `No printer data for ${Math.floor(staleForMs / 1000)}s while heaters were hot — temperatures are no longer being monitored`,
      announcement:
        "Printer telemetry is stale while heaters are hot — temperatures are no longer being monitored.",
      icon: <AlertTriangle className="w-4 h-4" />,
    });
  }

  // General telemetry age. The rule above only speaks when the machine is
  // HOT; a cold printer whose feed died leaves a dashboard that is simply
  // WRONG, and a frozen progress bar is indistinguishable from a steady one
  // by looking at it. `hasServerPush` is the guard against crying wolf: a
  // server that has never pushed unprompted is quiet by design, not dead.
  const linkAgeMs = mr.telemetryAge(now);
  if (
    isLinkStale({
      connected,
      hasServerPush: mr.hasServerPush(),
      ageMs: linkAgeMs,
      heatersFlyingBlind,
    })
  ) {
    const seconds = Math.floor((linkAgeMs ?? 0) / 1000);
    alerts.push({
      id: "link-stale",
      severity: "warn",
      message: `No printer data for ${seconds}s — every reading on screen is that old. Reconnecting…`,
      announcement:
        "The printer feed has gone quiet. Readings on screen are stale and are not being updated.",
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
            // HERE makes .modal-panel derive BOTH sides from the pad the
            // markup actually uses: outer = 12px + control = 16px, and
            // --radius-inner = control (4px) for the corner children. Same
            // re-check BrandLogo's popover got.
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
            className="press-flat inline-flex min-h-11 min-w-11 items-center justify-center rounded-inner text-[16px] leading-none text-[var(--color-fg-muted)] hover:bg-(--color-fg)/8 hover:text-[var(--color-fg)]"
            aria-label="Dismiss alert"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
