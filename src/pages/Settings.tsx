import { useState } from "react";
import { Card } from "@/components/Card";
import {
  Settings as Cog,
  RotateCw,
  Power,
  Cpu,
  Activity,
} from "lucide-react";
import { Button } from "@/components/Button";
import { ThemeSettings } from "@/components/ThemeSettings";
import { BackupSettings } from "@/components/BackupSettings";
import { ProfileSettings } from "@/components/ProfileSettings";
import { ExperienceSettings } from "@/components/ExperienceSettings";
import { TimelapseSettings } from "@/components/TimelapseSettings";
import { TailscaleSettings } from "@/components/TailscaleSettings";
import { useActionConfirm } from "@/components/useActionConfirm";
import { usePrinter } from "@/lib/usePrinter";
import { useExperienceMode } from "@/lib/useExperienceMode";
import {
  guardPrinterAction,
  runPrinterAction,
  type PrinterAction,
} from "@/lib/printerActions";
import { formatBytes, formatDuration } from "@/lib/utils";
import { useSystemInfo } from "@/lib/useSystemInfo";

export function SettingsPage() {
  const { state, connected, profile } = usePrinter();
  const [experienceMode] = useExperienceMode();
  const isExpert = experienceMode === "expert";
  const systemInfo = useSystemInfo(
    isExpert,
    connected,
    state.webhooks?.state === "ready" ? "ready" : "not-ready",
  );
  const info = systemInfo.info;
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  // In-app confirm, never window.confirm: the native dialog blocks the main
  // thread and freezes the health watchdog for as long as it sits open —
  // exactly what must not happen around an emergency-stop decision.
  const { confirm, confirmDialog } = useActionConfirm();

  const dispatch = async (action: PrinterAction, success: string) => {
    setBusyAction(action.type);
    setActionError(null);
    setActionStatus(null);
    try {
      const result = await runPrinterAction(action, { confirm });
      if (result.executed) setActionStatus(success);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Printer action failed.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const can = (action: PrinterAction) =>
    guardPrinterAction(state, connected, action).allowed;

  const memPct =
    info.memTotal && info.memUsed
      ? (info.memUsed / info.memTotal) * 100
      : 0;
  const ageLabel = (updatedAt: number | null) => {
    if (updatedAt == null) return "unavailable";
    const seconds = Math.max(0, Math.floor((systemInfo.now - updatedAt) / 1000));
    if (seconds === 0) return "now";
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m`;
  };
  return (
    <>
    <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-[var(--grid-gap)] p-[var(--page-gutter)] md:grid-cols-2 lg:grid-cols-3">
      <ExperienceSettings />
      <ThemeSettings />
      {isExpert && <ProfileSettings />}
      {isExpert && <BackupSettings />}
      {/* Capture mode is not an expert control: choosing it wrong is the
          difference between a timelapse and an empty folder, so it belongs
          wherever the owner turns recording on. */}
      {profile.features.timelapse && <TimelapseSettings />}
      {/* Infrastructure, not a printing control: the mesh VPN decides who can
          reach the printer at all. Expert-gated like Host and Backup, and
          read-only — see the header of lib/tailscale.ts. */}
      {isExpert && <TailscaleSettings />}

      <Card title="System" icon={<Cog />} className="lg:col-span-2">
        <div className="space-y-[var(--stack)]">
          <p className="text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
            Emergency stop is only for immediate physical danger. It remains available in both experience modes.
          </p>
          {isExpert && <Row label="Controller firmware" subtitle="Reconnect the motion controller">
            <Button
              size="sm"
              variant="default"
              disabled={
                !!busyAction || !can({ type: "firmware-restart" })
              }
              onClick={() =>
                dispatch({ type: "firmware-restart" }, "Firmware restart requested.")
              }
            >
              <RotateCw className="w-3 h-3" /> Firmware restart
            </Button>
          </Row>}
          {isExpert && <Row label="Klipper software" subtitle="Restart printer control software">
            <Button
              size="sm"
              variant="default"
              disabled={!!busyAction || !can({ type: "restart-klipper" })}
              onClick={() =>
                dispatch({ type: "restart-klipper" }, "Klipper restart requested.")
              }
            >
              <RotateCw className="w-3 h-3" /> Restart Klipper
            </Button>
          </Row>}
          <Row label="Emergency stop" subtitle="Only for immediate physical danger">
            <Button
              size="sm"
              variant="danger"
              disabled={!!busyAction || !can({ type: "emergency-stop" })}
              onClick={() =>
                dispatch({ type: "emergency-stop" }, "Emergency stop sent.")
              }
            >
              <Power className="w-3 h-3" /> Emergency stop
            </Button>
          </Row>
          {actionError && (
            <div role="alert" className="rounded-inner border border-(--color-error)/35 bg-(--color-error)/8 p-3 text-[13px] text-[var(--color-error)]">
              {actionError}
            </div>
          )}
          {actionStatus && (
            <div role="status" className="rounded-inner border border-(--color-success)/30 bg-(--color-success)/8 p-3 text-[13px] text-[var(--color-success)]">
              {actionStatus}
            </div>
          )}
        </div>
      </Card>

      {isExpert && <Card title="Host" icon={<Cpu />} className="lg:col-span-1">
        <div className="space-y-[var(--stack-tight)] text-[12px]">
          {systemInfo.error && (
            <div role="status" className="rounded-inner border border-(--color-warning)/35 bg-(--color-warning)/8 p-3 text-[13px] text-[var(--color-warning)]">
              Host details unavailable or stale. {systemInfo.error}
            </div>
          )}
          <Row label="CPU">{info.cpu ?? "—"}</Row>
          <Row label="Memory">
            <span className="tabular-nums">
              {info.memUsed && info.memTotal
                ? `${formatBytes(info.memUsed * 1024)} / ${formatBytes(info.memTotal * 1024)}`
                : "—"}
            </span>
          </Row>
          <div aria-hidden="true" className="h-1 bg-[var(--color-elevated)] rounded-full overflow-hidden">
            <div
              data-testid="host-memory-bar"
              className="h-full w-full origin-left transition-[transform] duration-[var(--dur-fast)]"
              style={{
                transform: `scaleX(${Math.max(0, Math.min(1, memPct / 100))})`,
                background:
                  memPct > 85
                    ? "var(--color-error)"
                    : memPct > 70
                      ? "var(--color-warning)"
                      : "var(--color-accent)",
              }}
            />
          </div>
          <Row label="Uptime">
            <span className="tabular-nums">
              {info.uptime != null && systemInfo.uptimeUpdatedAt != null
                ? formatDuration(info.uptime + (systemInfo.connected
                    ? Math.max(0, Math.floor((systemInfo.now - systemInfo.uptimeUpdatedAt) / 1000))
                    : 0))
                : "—"}
            </span>
          </Row>
          <p className="text-[11px] text-[var(--color-fg-muted)]" data-testid="host-data-freshness">
            {!systemInfo.connected
              ? `Offline · Last-known host data · memory ${ageLabel(systemInfo.memoryUpdatedAt)}, uptime ${ageLabel(systemInfo.uptimeUpdatedAt)}`
              : `Memory ${systemInfo.memoryUpdatedAt != null && systemInfo.now - systemInfo.memoryUpdatedAt < 15_000 ? "live" : `last seen ${ageLabel(systemInfo.memoryUpdatedAt)}`} · Uptime ${systemInfo.uptimeUpdatedAt != null && systemInfo.now - systemInfo.uptimeUpdatedAt < 15_000 ? "live" : `last seen ${ageLabel(systemInfo.uptimeUpdatedAt)}`}`}
          </p>
        </div>
      </Card>}

      {isExpert && <Card title="About" icon={<Activity />} className="lg:col-span-1">
        <div className="space-y-[var(--stack-tight)] text-[12px]">
          <Row label="UI">
            <span className="font-mono">Regolith v0.1</span>
          </Row>
          <Row label="Klipper">
            <span className="font-mono text-[var(--color-fg-muted)]">
              {info.klipper ?? "—"}
            </span>
          </Row>
          <Row label="Moonraker">
            <span className="font-mono text-[var(--color-fg-muted)]">
              {info.moonraker ?? "—"}
            </span>
          </Row>
          <div className="text-[11px] text-[var(--color-fg-muted)] pt-2 border-t border-[var(--color-border)] mt-2">
            Source:{" "}
            <a
              href="https://github.com/thekozugroup/Regolith"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center text-[var(--color-accent)] hover:underline"
            >
              github/Regolith
            </a>
          </div>
        </div>
      </Card>}
    </div>
    {confirmDialog}
    </>
  );
}

function Row({
  label,
  subtitle,
  children,
}: {
  label: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between py-2 border-b border-[var(--color-border)] last:border-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        {subtitle && (
          <div className="text-[11px] text-[var(--color-fg-muted)] mt-0.5">
            {subtitle}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
