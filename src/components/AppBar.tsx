import { AlertCircle, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrinterSelector } from "@/lib/usePrinter";
import { useDeviceName } from "@/lib/useTheme";
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
  // Chrome components select the few fields they read — a temperature tick
  // must not commit the app bar (WP-MEMO / S5 P2).
  const { klipperState, printState, connected } = usePrinterSelector(
    (state, isConnected) => ({
      klipperState: state.webhooks?.state,
      printState: state.print_stats?.state,
      connected: isConnected,
    }),
  );
  const [deviceName] = useDeviceName();
  const location = useLocation();

  return (
    <header className="app-chrome fixed top-0 left-0 right-0 z-20 flex h-[var(--appbar-h)] items-center gap-3 border-b border-[var(--color-border)] px-[var(--page-gutter)] transition-[left] duration-[var(--dur-slow)] ease-[var(--ease-emphasized)] desk:left-[var(--sidebar-w,14rem)]">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <h1 className="min-w-0 truncate text-[17px] font-semibold tracking-tight">
          {ROUTE_TITLES[location.pathname] ?? "Regolith"}
        </h1>
        <span aria-hidden="true" className="hidden h-4 w-px shrink-0 bg-[var(--color-border-strong)] sm:block" />
        <span className="hidden min-w-0 truncate text-[12px] text-[var(--color-fg-muted)] sm:block">
          {deviceName}
        </span>
        {printState && printState !== "standby" && printState !== "complete" && (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] uppercase",
              printState === "printing" &&
                "text-[var(--color-accent)] bg-[var(--color-accent-soft)] border-[var(--color-accent-edge)]",
              printState === "paused" &&
                "text-[var(--color-warning)] bg-(--color-warning)/10 border-(--color-warning)/30",
              printState === "error" &&
                "text-[var(--color-error)] bg-(--color-error)/10 border-(--color-error)/30"
            )}
          >
            <span aria-hidden="true" className="status-lamp" />{printState}
          </span>
        )}
      </div>

      {/* Connection indicator */}
      <div className="flex shrink-0 items-center gap-3">
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
    </header>
  );
}
