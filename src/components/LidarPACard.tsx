import { useEffect, useState } from "react";
import { Card } from "./Card";
import { Button } from "./Button";
import {
  Crosshair,
  Eye,
  AlertTriangle,
  Info,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Creality K1 Max Lidar — Pressure Advance + first-layer auto-tune.
 *
 * The lidar is controlled NOT through Moonraker but Creality's proprietary
 * WebSocket on port 9999. Setting `enableSelfTest=1` makes the next print
 * scan a PA test pattern + first layer and auto-adjust before continuing.
 *
 * Source: https://github.com/Guilouz/Creality-Helper-Script-Wiki/discussions/527
 *
 * Caveats:
 *   - Slicer must NOT have "Enable pressure advance" checked (it overrides)
 *   - Lidar runs WITH a print, not standalone
 *   - "flowControl" parameter has no documented control path
 *
 * This card sets the flags via fetch to the printer's port 9999 WebSocket.
 * It is a stateless toggle — flags persist on the printer for the next print.
 */

interface LidarFlags {
  enableSelfTest: 0 | 1;
  aiDetection: 0 | 1;
  aiFirstFloor: 0 | 1;
  aiPausePrint: 0 | 1;
  aiSw: 0 | 1;
}

const DEFAULT_FLAGS: LidarFlags = {
  enableSelfTest: 0,
  aiDetection: 0,
  aiFirstFloor: 0,
  aiPausePrint: 0,
  aiSw: 0,
};

const STORAGE_KEY = "forge.lidar.flags";

export function LidarPACard() {
  const [flags, setFlags] = useState<LidarFlags>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LidarFlags) : DEFAULT_FLAGS;
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<
    "checking" | "online" | "offline"
  >("checking");

  // Probe port 9999 reachability on mount
  useEffect(() => {
    const ws = new WebSocket(`ws://${location.hostname}:9999`);
    const timer = setTimeout(() => {
      setBridgeStatus("offline");
      ws.close();
    }, 2500);
    ws.onopen = () => {
      clearTimeout(timer);
      setBridgeStatus("online");
      ws.close();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      setBridgeStatus("offline");
    };
    return () => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }, []);

  const updateFlag = (k: keyof LidarFlags, v: 0 | 1) => {
    const next = { ...flags, [k]: v };
    setFlags(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const apply = async () => {
    setBusy(true);
    setStatus(null);
    try {
      // Connect to the Creality lidar/AI websocket on port 9999
      const ws = new WebSocket(`ws://${location.hostname}:9999`);
      const result = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("WS timeout"));
          ws.close();
        }, 5000);

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              method: "set",
              params: flags,
            }),
          );
        };
        ws.onmessage = (e) => {
          clearTimeout(timer);
          ws.close();
          resolve(String(e.data).slice(0, 200));
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error("WS error — port 9999 unreachable"));
        };
      });
      setStatus(`Applied. Reply: ${result}`);
    } catch (e) {
      setStatus(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    const reset = { ...DEFAULT_FLAGS };
    setFlags(reset);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reset));
  };

  return (
    <Card
      title="Lidar Calibration"
      icon={<Crosshair />}
      action={
        <a
          href="https://github.com/Guilouz/Creality-Helper-Script-Wiki/discussions/527"
          target="_blank"
          rel="noreferrer"
          className="text-[10px] uppercase tracking-[0.05em] text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] flex items-center gap-1"
        >
          <ExternalLink className="w-3 h-3" /> Docs
        </a>
      }
    >
      <div className="space-y-3">
        {/* Bridge status banner */}
        {bridgeStatus === "offline" && (
          <div className="flex items-start gap-2 p-2 bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.25)] rounded-sm">
            <AlertTriangle className="w-4 h-4 text-[var(--color-warning)] shrink-0 mt-0.5" />
            <div className="text-[11px] leading-relaxed">
              <span className="text-[var(--color-warning)] font-semibold">
                Bridge offline:
              </span>{" "}
              Creality's port 9999 control bridge isn't running on this
              firmware (we removed the Creality web stack). The lidar hardware
              itself still works during prints if the slicer enables it. These
              toggles persist locally for reference but won't apply remotely.
            </div>
          </div>
        )}
        {bridgeStatus === "online" && (
          <div className="flex items-start gap-2 p-2 bg-[rgba(16,185,129,0.06)] border border-[rgba(16,185,129,0.25)] rounded-sm">
            <Info className="w-4 h-4 text-[var(--color-success)] shrink-0 mt-0.5" />
            <div className="text-[11px] leading-relaxed">
              <span className="text-[var(--color-success)] font-semibold">
                Bridge online.
              </span>{" "}
              Settings will be applied to the printer's AI middleware.
            </div>
          </div>
        )}
        <div className="flex items-start gap-2 p-2 bg-[rgba(59,130,246,0.06)] border border-[rgba(59,130,246,0.2)] rounded-sm">
          <Info className="w-4 h-4 text-[var(--color-info)] shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed">
            <span className="text-[var(--color-info)] font-semibold">
              How it works:
            </span>{" "}
            The K1 Max lidar runs <em>during</em> a print — not standalone. With{" "}
            <code className="text-[var(--color-accent)]">enableSelfTest=1</code>
            , the printer scans a PA zigzag + first layer at start of every
            print and auto-adjusts. Settings persist for next print.
          </div>
        </div>

        <div className="space-y-1.5">
          <Toggle
            label="Auto Pressure Advance"
            description="Scan PA zigzag at print start, adjust extrusion advance"
            checked={!!flags.enableSelfTest}
            onChange={(v) => updateFlag("enableSelfTest", v ? 1 : 0)}
          />
          <Toggle
            label="First-Layer Detection"
            description="Inspect first layer with lidar, halt if extrusion is wrong"
            checked={!!flags.aiFirstFloor}
            onChange={(v) => updateFlag("aiFirstFloor", v ? 1 : 0)}
          />
          <Toggle
            label="AI Object Detection"
            description="Spaghetti / failure detection during print"
            checked={!!flags.aiDetection}
            onChange={(v) => updateFlag("aiDetection", v ? 1 : 0)}
          />
          <Toggle
            label="Auto-Pause on Failure"
            description="Pause print if AI detects failure (requires aiDetection)"
            checked={!!flags.aiPausePrint}
            onChange={(v) => updateFlag("aiPausePrint", v ? 1 : 0)}
          />
          <Toggle
            label="AI Disclaimer Acknowledged"
            description="Required by Creality firmware to enable AI features"
            checked={!!flags.aiSw}
            onChange={(v) => updateFlag("aiSw", v ? 1 : 0)}
          />
        </div>

        {flags.enableSelfTest === 1 && (
          <div className="flex items-start gap-2 p-2 bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.25)] rounded-sm">
            <AlertTriangle className="w-4 h-4 text-[var(--color-warning)] shrink-0 mt-0.5" />
            <div className="text-[11px] leading-relaxed text-[var(--color-warning)]">
              Slicer must NOT have "Enable Pressure Advance" checked — it
              overrides the lidar's value. Disable in Orca / CrealityPrint
              filament settings.
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="primary"
            onClick={apply}
            disabled={busy || bridgeStatus !== "online"}
          >
            <Eye className="w-3 h-3" />{" "}
            {bridgeStatus === "online" ? "Apply to Printer" : "Bridge offline"}
          </Button>
          <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>
            Reset all
          </Button>
          {status && (
            <span
              className={cn(
                "text-[11px] font-mono ml-auto",
                status.startsWith("Applied")
                  ? "text-[var(--color-success)]"
                  : "text-[var(--color-error)]",
              )}
            >
              {status}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        "w-full flex items-center gap-3 p-2 rounded-sm border text-left transition-all",
        checked
          ? "border-[rgba(249,115,22,0.4)] bg-[rgba(249,115,22,0.06)]"
          : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]",
      )}
    >
      <span
        className={cn(
          "shrink-0 w-8 h-4 rounded-full border transition-colors relative",
          checked
            ? "bg-[var(--color-accent)] border-[var(--color-accent)]"
            : "bg-[var(--color-elevated)] border-[var(--color-border-strong)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12px] font-medium leading-tight">
          {label}
        </span>
        <span className="block text-[10.5px] text-[var(--color-fg-muted)] leading-tight mt-0.5">
          {description}
        </span>
      </span>
    </button>
  );
}
