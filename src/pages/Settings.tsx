import { Card } from "@/components/Card";
import { Settings as Cog, RotateCw, Power } from "lucide-react";
import { Button } from "@/components/Button";
import { moonraker } from "@/lib/moonraker";

export function SettingsPage() {
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

      <Card title="About" icon={<Cog />}>
        <div className="space-y-1 text-[12px] text-[var(--color-fg-muted)]">
          <div>
            <span className="font-medium text-[var(--color-fg)]">Forge</span> ·
            Regolith UI v0.1
          </div>
          <div>Greenfield Moonraker frontend, React + shadcn aesthetic.</div>
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
