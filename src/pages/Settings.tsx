import { useEffect, useState } from "react";
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
import { usePrinter } from "@/lib/usePrinter";
import {
  guardPrinterAction,
  runPrinterAction,
  type ActionConfirmation,
  type PrinterAction,
} from "@/lib/printerActions";
import { formatBytes, formatDuration } from "@/lib/utils";

interface SystemInfo {
  cpu: string;
  memUsed: number;
  memTotal: number;
  uptime: number;
  load: number[];
  diskTotal: number;
  diskUsed: number;
  klipper: string;
  moonraker: string;
}

export function SettingsPage() {
  const { state, connected } = usePrinter();
  const [info, setInfo] = useState<Partial<SystemInfo>>({});
  const [infoError, setInfoError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const [sys, ver, jobs] = await Promise.all([
          fetchJson("/machine/system_info", controller.signal),
          fetchJson("/printer/info", controller.signal),
          fetchJson("/server/info", controller.signal),
        ]);
        const si = sys.result?.system_info ?? {};
        const proc = sys.result?.cpu_info ?? si.cpu_info ?? {};
        const mem = si.distribution?.like ? null : null;
        setInfo({
          cpu:
            proc.cpu_desc ?? proc.processor ?? proc.model ?? "—",
          memTotal: si.cpu_temp ? 0 : (mem ?? 0),
          uptime: si.last_boot
            ? (Date.now() / 1000 - si.last_boot) | 0
            : 0,
          klipper: ver.result?.software_version ?? "—",
          moonraker: jobs.result?.moonraker_version ?? "—",
        });

        // Memory + disk via /machine/proc_stats
        const ps = await fetchJson("/machine/proc_stats", controller.signal);
        const sysmem = ps.result?.system_memory ?? {};
        const sysuptime = ps.result?.system_uptime ?? 0;
        const sysload = ps.result?.system_load_avg ?? [0, 0, 0];
        setInfo((prev) => ({
          ...prev,
          memUsed: (sysmem.total ?? 0) - (sysmem.available ?? 0),
          memTotal: sysmem.total ?? 0,
          uptime: sysuptime,
          load: sysload,
        }));
        setInfoError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setInfoError(
          error instanceof Error
            ? error.message
            : "System details are temporarily unavailable.",
        );
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, []);

  const dispatch = async (action: PrinterAction, success: string) => {
    setBusyAction(action.type);
    setActionError(null);
    setActionStatus(null);
    try {
      const result = await runPrinterAction(action, {
        confirm: (details: ActionConfirmation) =>
          window.confirm(`${details.title}\n\n${details.message}`),
      });
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
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
      <ThemeSettings />
      <ProfileSettings />
      <BackupSettings />

      <Card title="System" icon={<Cog />}>
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
            Recovery controls interrupt printer software. Restarts stay blocked during prints and calibration.
          </p>
          <Row label="Controller firmware" subtitle="Reconnect the motion controller">
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
          </Row>
          <Row label="Klipper software" subtitle="Restart printer control software">
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
          </Row>
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
            <div role="alert" className="rounded-lg border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.08)] p-3 text-[13px] text-[var(--color-error)]">
              {actionError}
            </div>
          )}
          {actionStatus && (
            <div role="status" className="rounded-lg border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.08)] p-3 text-[13px] text-[var(--color-success)]">
              {actionStatus}
            </div>
          )}
        </div>
      </Card>

      <Card title="Host" icon={<Cpu />}>
        <div className="space-y-2 text-[12px]">
          {infoError && (
            <div role="status" className="rounded-lg border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] p-3 text-[13px] text-[var(--color-warning)]">
              Host details unavailable. {infoError}
            </div>
          )}
          <Row label="CPU">{info.cpu ?? "—"}</Row>
          <Row label="Memory">
            <span className="font-mono tabular-nums">
              {info.memUsed && info.memTotal
                ? `${formatBytes(info.memUsed * 1024)} / ${formatBytes(info.memTotal * 1024)}`
                : "—"}
            </span>
          </Row>
          <div className="h-1 bg-[var(--color-elevated)] rounded-full overflow-hidden">
            <div
              className="h-full transition-[width] duration-700"
              style={{
                width: `${memPct}%`,
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
            <span className="font-mono tabular-nums">
              {info.uptime ? formatDuration(info.uptime) : "—"}
            </span>
          </Row>
          <Row label="Load (1·5·15m)">
            <span className="font-mono tabular-nums text-[var(--color-fg-muted)]">
              {info.load
                ? info.load.map((l) => l.toFixed(2)).join(" · ")
                : "—"}
            </span>
          </Row>
        </div>
      </Card>

      <Card title="About" icon={<Activity />}>
        <div className="space-y-2 text-[12px]">
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
      </Card>
    </div>
  );
}

async function fetchJson(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Could not load ${url} (${response.status}).`);
  }
  return response.json();
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
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between py-2 border-b border-[rgba(63,63,70,0.4)] last:border-0">
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
