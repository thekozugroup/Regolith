import { AlertCircle, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrinter } from "@/lib/usePrinter";
import { useDeviceName } from "@/lib/useTheme";
import { AppBarProgress } from "./AppBarProgress";
import { useLocation } from "react-router";

const ROUTE_TITLES: Record<string, string> = {
  "/": "Home",
  "/print": "Files",
  "/control": "Control",
  "/tune": "Tune",
  "/timelapses": "Timelapses",
  "/console": "Console",
  "/settings": "Settings",
};

export function AppBar() {
  const { state, connected } = usePrinter();
  const [deviceName] = useDeviceName();
  const location = useLocation();
  const klipperState = state.webhooks?.state;
  const printState = state.print_stats?.state;

  return (
    <header className="app-chrome fixed top-0 left-0 right-0 z-20 flex h-[60px] items-center border-b border-[var(--color-border)] px-[clamp(0.75rem,2vw,1.5rem)] md:left-56">
      <div className="flex items-center gap-3">
        <h1 className="max-w-[42vw] truncate text-[17px] font-semibold tracking-tight sm:max-w-none">
          {ROUTE_TITLES[location.pathname] ?? "Regolith"}
        </h1>
        <span aria-hidden="true" className="hidden h-4 w-px bg-[var(--color-border-strong)] sm:block" />
        <span className="hidden max-w-[28vw] truncate text-[12px] text-[var(--color-fg-muted)] sm:block">
          {deviceName}
        </span>
        {printState && printState !== "standby" && printState !== "complete" && (
          <span
            className={cn(
              "flex items-center gap-1.5 border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] uppercase",
              printState === "printing" &&
                "text-[var(--color-accent)] bg-[var(--color-accent-soft)] border-[var(--color-accent-edge)]",
              printState === "paused" &&
                "text-[var(--color-warning)] bg-[rgba(245,158,11,0.10)] border-[rgba(245,158,11,0.3)]",
              printState === "error" &&
                "text-[var(--color-error)] bg-[rgba(239,68,68,0.10)] border-[rgba(239,68,68,0.3)]"
            )}
          >
            <span aria-hidden="true" className="status-lamp" />{printState}
          </span>
        )}
      </div>

      <div className="flex-1" />

      {/* Connection indicator */}
      <div className="flex items-center gap-3">
        {klipperState && klipperState !== "ready" && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-error)]">
            <AlertCircle className="w-3.5 h-3.5" strokeWidth={2} />
            <span className="font-medium">Klipper {klipperState}</span>
          </div>
        )}
        <div
          className={cn(
            "flex min-h-11 items-center gap-1.5 text-[12px]",
            connected ? "text-[var(--color-fg-muted)]" : "text-[var(--color-error)]"
          )}
          title={connected ? "Moonraker connected" : "Moonraker offline"}
        >
          {connected ? (
            <Wifi className="w-3.5 h-3.5" strokeWidth={2} />
          ) : (
            <WifiOff className="w-3.5 h-3.5" strokeWidth={2} />
          )}
          <span className="hidden sm:inline">{connected ? "Connected" : "Offline"}</span>
        </div>
      </div>
      <AppBarProgress />
    </header>
  );
}
