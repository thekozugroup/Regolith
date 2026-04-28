import { useEffect, useState } from "react";
import { AlertTriangle, WifiOff } from "lucide-react";
import { usePrinter } from "@/lib/usePrinter";
import { cn } from "@/lib/utils";

/**
 * Floating alert stack — pinned to top of viewport, low opacity until
 * something demands attention. Aggregates:
 *   - Thermal runaway: actual diverging from target by ±15°C for >30s
 *   - MCU temp watchdog: SoC > 70°C (K1 throttles around there)
 *   - Network: moonraker WS dropped
 *
 * Each alert is dismissible per-page-load; reappears if the condition
 * persists across page reloads.
 */
export function HealthAlerts() {
  const { state, connected } = usePrinter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [thermalIssue, setThermalIssue] = useState<{
    heater: string;
    drift: number;
    since: number;
  } | null>(null);

  // Thermal runaway: track divergence over time
  useEffect(() => {
    const ext = state.extruder;
    const bed = state.heater_bed;
    let issue: { heater: string; drift: number } | null = null;
    if (
      ext &&
      ext.target > 0 &&
      Math.abs(ext.temperature - ext.target) > 15
    ) {
      issue = {
        heater: "Hotend",
        drift: ext.temperature - ext.target,
      };
    } else if (
      bed &&
      bed.target > 0 &&
      Math.abs(bed.temperature - bed.target) > 15
    ) {
      issue = { heater: "Bed", drift: bed.temperature - bed.target };
    }

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
    icon: React.ReactNode;
  }> = [];

  // Network alert
  if (!connected) {
    alerts.push({
      id: "network",
      severity: "error",
      message:
        "Moonraker disconnected — UI showing last known state. Reconnecting…",
      icon: <WifiOff className="w-4 h-4" />,
    });
  }

  // Thermal runaway (only if persisting >15s to avoid flapping)
  if (thermalIssue && Date.now() - thermalIssue.since > 15_000) {
    alerts.push({
      id: "thermal",
      severity: "error",
      message: `${thermalIssue.heater} temperature diverging by ${thermalIssue.drift.toFixed(1)}°C — possible thermal runaway`,
      icon: <AlertTriangle className="w-4 h-4" />,
    });
  }

  // MCU watchdog
  const mcuTemp = state["temperature_sensor mcu_temp"]?.temperature ?? 0;
  if (mcuTemp > 70) {
    alerts.push({
      id: "mcu",
      severity: "warn",
      message: `MCU at ${mcuTemp.toFixed(1)}°C — SoC throttling possible. Check intake fan.`,
      icon: <AlertTriangle className="w-4 h-4" />,
    });
  }

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="fixed top-14 right-3 z-50 flex flex-col gap-2 max-w-md">
      {visible.map((a) => (
        <div
          key={a.id}
          className={cn(
            "flex items-start gap-2 px-3 py-2 rounded-md border backdrop-blur-sm shadow-lg",
            a.severity === "error"
              ? "bg-[rgba(239,68,68,0.12)] border-[rgba(239,68,68,0.5)]"
              : "bg-[rgba(245,158,11,0.12)] border-[rgba(245,158,11,0.5)]",
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
            onClick={() =>
              setDismissed((d) => new Set([...d, a.id]))
            }
            className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] text-[16px] leading-none"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
