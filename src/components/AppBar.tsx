import { Hammer, AlertCircle, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrinter } from "@/lib/usePrinter";

export function AppBar() {
  const { state, connected } = usePrinter();
  const klipperOk = state.webhooks?.state === "ready";
  const printState = state.print_stats?.state;

  return (
    <header className="fixed top-0 left-14 right-0 h-13 border-b border-[var(--color-border)] bg-[var(--color-bg)] flex items-center px-4 z-10">
      {/* Logo + brand */}
      <div className="flex items-center gap-2">
        <Hammer
          className="w-4 h-4 text-[var(--color-accent)]"
          strokeWidth={2}
        />
        <span className="text-[13px] font-semibold tracking-tight">
          Forge
        </span>
        {printState && printState !== "standby" && printState !== "complete" && (
          <span
            className={cn(
              "ml-3 px-2 py-0.5 rounded text-[10px] font-semibold tracking-[0.1em] uppercase border",
              printState === "printing" &&
                "text-[var(--color-accent)] bg-[rgba(249,115,22,0.10)] border-[rgba(249,115,22,0.3)]",
              printState === "paused" &&
                "text-[var(--color-warning)] bg-[rgba(245,158,11,0.10)] border-[rgba(245,158,11,0.3)]",
              printState === "error" &&
                "text-[var(--color-error)] bg-[rgba(239,68,68,0.10)] border-[rgba(239,68,68,0.3)]"
            )}
          >
            {printState}
          </span>
        )}
      </div>

      <div className="flex-1" />

      {/* Connection indicator */}
      <div className="flex items-center gap-3">
        {!klipperOk && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-error)]">
            <AlertCircle className="w-3.5 h-3.5" strokeWidth={2} />
            <span className="font-medium">Klipper {state.webhooks?.state ?? "?"}</span>
          </div>
        )}
        <div
          className={cn(
            "flex items-center gap-1.5 text-[11px]",
            connected ? "text-[var(--color-fg-muted)]" : "text-[var(--color-error)]"
          )}
          title={connected ? "Moonraker connected" : "Moonraker offline"}
        >
          {connected ? (
            <Wifi className="w-3.5 h-3.5" strokeWidth={2} />
          ) : (
            <WifiOff className="w-3.5 h-3.5" strokeWidth={2} />
          )}
        </div>
      </div>
    </header>
  );
}
