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
import { moonraker } from "@/lib/moonraker";
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
  const [info, setInfo] = useState<Partial<SystemInfo>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const [sys, ver, jobs] = await Promise.all([
          fetch("/machine/system_info").then((r) => r.json()),
          fetch("/printer/info").then((r) => r.json()),
          fetch("/server/info").then((r) => r.json()),
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
        const ps = await fetch("/machine/proc_stats").then((r) => r.json());
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
      } catch {
        /* ignore */
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const memPct =
    info.memTotal && info.memUsed
      ? (info.memUsed / info.memTotal) * 100
      : 0;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
      <Card title="System" icon={<Cog />}>
        <div className="space-y-3">
          <Row label="Klipper">
            <Button
              size="sm"
              variant="default"
              onClick={() => moonraker.firmwareRestart()}
            >
              <RotateCw className="w-3 h-3" /> Firmware restart
            </Button>
          </Row>
          <Row label="Host">
            <Button
              size="sm"
              variant="default"
              onClick={() => moonraker.restart()}
            >
              <RotateCw className="w-3 h-3" /> Restart
            </Button>
          </Row>
          <Row label="Emergency stop" subtitle="Stops klipper immediately">
            <Button
              size="sm"
              variant="danger"
              onClick={() => moonraker.emergencyStop()}
            >
              <Power className="w-3 h-3" /> E-stop
            </Button>
          </Row>
        </div>
      </Card>

      <Card title="Host" icon={<Cpu />}>
        <div className="space-y-2 text-[12px]">
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
            Greenfield Moonraker frontend. React 19 + Tailwind v4 + shadcn
            aesthetic. Source:{" "}
            <a
              href="https://github.com/thekozugroup/Regolith"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-accent)] hover:underline"
            >
              github/Regolith
            </a>
          </div>
        </div>
      </Card>
    </div>
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
    <div className="flex items-center justify-between py-2 border-b border-[rgba(63,63,70,0.4)] last:border-0">
      <div>
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
