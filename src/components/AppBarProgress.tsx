import { usePrinter } from "@/lib/usePrinter";

/**
 * Thin progress strip pinned to the bottom of the AppBar.
 * Visible across the whole app whenever a print is active.
 * Renders nothing when idle.
 */
export function AppBarProgress() {
  const { state } = usePrinter();
  const ps = state.print_stats?.state;
  const progress = state.virtual_sdcard?.progress ?? 0;
  const active = ps === "printing" || ps === "paused";
  if (!active) return null;

  const paused = ps === "paused";

  return (
    <div className="absolute left-0 right-0 -bottom-px h-0.5 bg-[var(--color-elevated)] overflow-hidden">
      <div
        className="h-full transition-[width,background-color] duration-150 ease-out"
        style={{
          width: `${progress * 100}%`,
          backgroundColor: paused ? "var(--color-warning)" : "var(--color-accent)",
        }}
      />
    </div>
  );
}
