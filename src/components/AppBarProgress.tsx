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
        className="h-full transition-[width] duration-700 ease-out"
        style={{
          width: `${progress * 100}%`,
          background: paused
            ? "var(--color-warning)"
            : "linear-gradient(90deg, var(--color-accent), #fb923c, var(--color-accent))",
          backgroundSize: paused ? undefined : "200% 100%",
          animation: paused ? undefined : "appBarShimmer 2.5s ease-in-out infinite",
        }}
      />
      <style>{`
        @keyframes appBarShimmer {
          0%, 100% { background-position: 0 0; }
          50% { background-position: 100% 0; }
        }
      `}</style>
    </div>
  );
}
