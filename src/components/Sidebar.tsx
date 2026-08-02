import { useEffect, useId, useState } from "react";
import { NavLink, useLocation } from "react-router";
import {
  LayoutDashboard,
  FileText,
  Move,
  Sliders,
  Film,
  Terminal,
  Settings,
  Menu,
  X,
} from "lucide-react";
import { BrandLogo } from "./BrandLogo";
import { ModalSurface } from "./ModalSurface";
import { cn } from "@/lib/utils";
import { usePrinter } from "@/lib/usePrinter";
import { useExperienceMode } from "@/lib/useExperienceMode";

const NAV = [
  { to: "/", icon: LayoutDashboard, label: "Home" },
  { to: "/print", icon: FileText, label: "Files" },
  { to: "/control", icon: Move, label: "Control" },
  { to: "/tune", icon: Sliders, label: "Tune", expert: true },
  { to: "/timelapses", icon: Film, label: "Timelapses" },
  { to: "/console", icon: Terminal, label: "Console", expert: true },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const { state } = usePrinter();
  const [experienceMode] = useExperienceMode();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTitleId = useId();
  const ps = state.print_stats?.state;
  const progress = state.virtual_sdcard?.progress ?? 0;
  const isPrinting = ps === "printing" || ps === "paused";
  const visibleNav = NAV.filter(
    (item) => !item.expert || experienceMode === "expert",
  );
  const mobilePrimary = visibleNav.slice(0, 3);
  const mobileMore = visibleNav.slice(3);

  // Pulse the document title + favicon when a print is active so a
  // background tab still surfaces progress at a glance.
  useEffect(() => {
    if (!isPrinting) {
      document.title = "Forge";
      return;
    }
    const pct = (progress * 100).toFixed(0);
    document.title =
      ps === "paused" ? `⏸ ${pct}% · Forge` : `▶ ${pct}% · Forge`;
  }, [isPrinting, progress, ps]);

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  return (
    <>
      <aside className="app-chrome fixed left-0 top-0 bottom-0 z-20 hidden w-56 flex-col border-r border-[var(--color-border)] md:flex">
        <div className="h-[60px] px-4 flex items-center gap-3 border-b border-[var(--color-border)]">
          <div className="relative flex h-9 w-9 items-center justify-center border border-[var(--color-border)] bg-[var(--color-elevated)]">
            <BrandLogo size={20} />
            {isPrinting && <span aria-label={`Print ${Math.round(progress * 100)} percent`} className="absolute -bottom-px -left-px h-0.5 bg-[var(--color-accent)]" style={{ width: `${progress * 100}%` }} />}
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-tight">Regolith</div>
            <div className="text-[11px] text-[var(--color-fg-muted)]">Instrument panel</div>
          </div>
        </div>

        <nav aria-label="Primary" className="flex flex-col gap-1 p-2 flex-1">
          {visibleNav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "relative min-h-11 border-l-2 border-transparent px-3 flex items-center gap-3 text-[13px] font-medium transition-colors",
                  "hover:bg-[var(--color-elevated)] hover:text-[var(--color-fg)]",
                  isActive && "border-l-[var(--color-accent)] bg-[color-mix(in_oklch,var(--color-accent)_8%,transparent)] text-[var(--color-fg)]",
                  !isActive && "text-[var(--color-fg-muted)]",
                )
              }
            >
              <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {moreOpen && (
        <ModalSurface
          labelledBy={moreTitleId}
          onDismiss={() => setMoreOpen(false)}
          overlayClassName="items-end bg-black/55 p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] md:hidden"
          panelClassName="app-chrome max-w-none rounded-2xl p-2"
        >
            <div className="flex items-center justify-between px-2 py-1">
              <h2 id={moreTitleId} className="text-[17px] font-semibold tracking-tight">
                More
              </h2>
              <button
                type="button"
                aria-label="Close more navigation"
                onClick={() => setMoreOpen(false)}
                className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg text-[var(--color-fg-muted)] hover:bg-[var(--color-elevated)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav aria-label="More" className="grid grid-cols-2 gap-1">
              {mobileMore.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      "min-h-14 border-l-2 border-transparent px-3 flex items-center gap-3 text-[13px] font-medium",
                      isActive
                        ? "border-l-[var(--color-accent)] bg-[color-mix(in_oklch,var(--color-accent)_8%,transparent)] text-[var(--color-fg)]"
                        : "text-[var(--color-fg-muted)] hover:bg-[var(--color-elevated)]",
                    )
                  }
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </NavLink>
              ))}
            </nav>
        </ModalSurface>
      )}

      <nav
        aria-label="Mobile primary"
        className="app-chrome fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-[var(--color-border)] px-2 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {mobilePrimary.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "min-h-16 flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium",
                isActive ? "text-[var(--color-accent)]" : "text-[var(--color-fg-muted)]",
              )
            }
          >
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-label="More navigation"
          onClick={() => setMoreOpen((value) => !value)}
          className={cn(
            "min-h-16 flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium",
            moreOpen || mobileMore.some((item) => item.to === location.pathname)
              ? "text-[var(--color-accent)]"
              : "text-[var(--color-fg-muted)]",
          )}
        >
          <Menu className="h-5 w-5" />
          More
        </button>
      </nav>
    </>
  );
}
