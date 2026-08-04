import { useEffect, useId, useLayoutEffect, useState } from "react";
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
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { BrandLogo } from "./BrandLogo";
import { ModalSurface } from "./ModalSurface";
import { cn } from "@/lib/utils";
import { readStoredFlag, writeStoredFlag } from "@/lib/safeStorage";
import { usePrinterSelector } from "@/lib/usePrinter";
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

/**
 * Collapsible desktop sidebar (owner request). Collapsed it becomes an ICON
 * RAIL, never fully hidden — every route stays one tap away. The width lives
 * in `--sidebar-w` on the root element so the app bar and the content column
 * (App.tsx `main`) reflow with it: the dashboard grid is width-driven
 * (container queries), so the freed glass goes straight to the instruments —
 * up to the dashboard shell's deliberate 2200px readability cap
 * (Dashboard.tsx `max-w-[min(100%,2200px)]`). Above ~2424px viewport width
 * (cap + expanded rail) the shell is already at its cap, so collapsing the
 * rail widens the centring margins instead of the dials. That is the
 * accepted trade (measured 2026-08-03, SD1 fit pass): the cap is a
 * readability decision and outranks squeezing more width from the rail.
 * The preference persists; the `desk` height-gate that keeps the K1's
 * 800x480 panel on touch chrome is untouched (the rail only exists inside
 * the desk variant).
 */
const COLLAPSE_KEY = "forge.sidebar.collapsed";
const SIDEBAR_EXPANDED_W = "14rem"; /* = the old fixed w-56 */
const SIDEBAR_RAIL_W = "4rem"; /* 64px: 44px targets with room to breathe */

function readCollapsedPreference(): boolean {
  return readStoredFlag(COLLAPSE_KEY, false);
}

/**
 * The job progress sliver under the mark, and the tab-title pulse that goes
 * with it.
 *
 * Split out of Sidebar because progress is the only thing in the whole
 * navigation chrome that moves at telemetry cadence. Selecting it in Sidebar
 * meant the entire tree — seven NavLinks and their icons, the brand mark, the
 * rail toggle, the mobile bar and the more-sheet — re-rendered four times a
 * second so a half-pixel bar could grow. Measured on the profiling build over
 * 60 pushes, Sidebar was the single most expensive component on the page at
 * 36.2ms of render time, more than either dial.
 *
 * Both consumers of `progress` live here now: the sliver and the document
 * title. Sidebar keeps only the print-state WORD, which changes when the job
 * does and not when the extruder does.
 */
function PrintProgress() {
  const { printState, progress } = usePrinterSelector((state) => ({
    printState: state.print_stats?.state,
    progress: state.virtual_sdcard?.progress ?? 0,
  }));
  const isPrinting = printState === "printing" || printState === "paused";

  // Pulse the document title + favicon when a print is active so a
  // background tab still surfaces progress at a glance.
  useEffect(() => {
    if (!isPrinting) {
      document.title = "Forge";
      return;
    }
    const pct = (progress * 100).toFixed(0);
    document.title =
      printState === "paused" ? `⏸ ${pct}% · Forge` : `▶ ${pct}% · Forge`;
  }, [isPrinting, progress, printState]);

  if (!isPrinting) return null;
  return (
    <span
      aria-label={`Print ${Math.round(progress * 100)} percent`}
      className="absolute -bottom-px -left-px h-0.5 bg-[var(--color-accent)]"
      style={{ width: `${progress * 100}%` }}
    />
  );
}

export function Sidebar() {
  // No printer subscription at all any more. Everything the navigation drew
  // from telemetry — the sliver and the tab title — moved into PrintProgress
  // above, so this tree now renders on navigation, experience mode, and the
  // rail toggle: the three things that actually change it.
  const [experienceMode] = useExperienceMode();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);
  const moreTitleId = useId();
  const visibleNav = NAV.filter(
    (item) => !item.expert || experienceMode === "expert",
  );
  const mobilePrimary = visibleNav.slice(0, 3);
  const mobileMore = visibleNav.slice(3);

  // Publish the width BEFORE paint so main/AppBar (which read the token with
  // a 14rem fallback) never flash the wrong offset on load.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-w",
      collapsed ? SIDEBAR_RAIL_W : SIDEBAR_EXPANDED_W,
    );
  }, [collapsed]);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      // A preference is a nicety; storage refusing the write never breaks
      // navigation, so the return value is deliberately ignored.
      writeStoredFlag(COLLAPSE_KEY, next);
      return next;
    });
  };

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  return (
    <>
      {/* bottom-[var(--mission-h)]: the mission bar is full-bleed across the
          bottom edge, so the sidebar ends where the bar begins. The width
          transition collapses to instant under prefers-reduced-motion via
          the global reduced-motion rule. */}
      <aside
        data-collapsed={collapsed || undefined}
        className="app-chrome fixed left-0 top-0 bottom-[var(--mission-h)] z-20 hidden w-[var(--sidebar-w,14rem)] flex-col overflow-hidden border-r border-[var(--color-border)] transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-emphasized)] desk:flex"
      >
        <div
          className={cn(
            "flex h-[var(--appbar-h)] items-center gap-3 border-b border-[var(--color-border)]",
            collapsed ? "justify-center px-2" : "px-4",
          )}
        >
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center border border-[var(--color-border)] bg-[var(--color-elevated)]">
            <BrandLogo size={20} />
            <PrintProgress />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold tracking-tight">Regolith</div>
              <div className="truncate text-[11px] text-[var(--color-fg-muted)]">Instrument panel</div>
            </div>
          )}
        </div>

        <nav aria-label="Primary" className="flex flex-col gap-1 p-2 flex-1">
          {visibleNav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  "relative min-h-11 border-l-2 border-transparent flex items-center text-[13px] font-medium transition-colors",
                  collapsed ? "justify-center px-0" : "gap-3 px-3",
                  "hover:bg-[var(--color-elevated)] hover:text-[var(--color-fg)]",
                  isActive && "border-l-[var(--color-accent)] bg-(--color-accent)/8 text-[var(--color-fg)]",
                  !isActive && "text-[var(--color-fg-muted)]",
                )
              }
            >
              <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
              {/* sr-only, not unmounted: the accessible name of every link is
                  identical in both widths. */}
              <span className={cn(collapsed && "sr-only")}>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-[var(--color-border)] p-2">
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggleCollapsed}
            className={cn(
              "min-h-11 w-full flex items-center rounded-inner text-[13px] font-medium text-[var(--color-fg-muted)] transition-colors",
              collapsed ? "justify-center px-0" : "gap-3 px-3",
              "hover:bg-[var(--color-elevated)] hover:text-[var(--color-fg)]",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
            ) : (
              <PanelLeftClose className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
            )}
            <span className={cn(collapsed && "sr-only")}>Collapse</span>
          </button>
        </div>
      </aside>

      {moreOpen && (
        <ModalSurface
          labelledBy={moreTitleId}
          onDismiss={() => setMoreOpen(false)}
          overlayClassName="items-end bg-black/55 p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] desk:hidden"
          // The sheet is padded p-2, not the modal default 16px — override
          // the pad token so the derived radius cascade reflects the REAL
          // pad (radius = pad + inner; same fix as the brand popover).
          panelClassName="app-chrome max-w-none p-2 [--modal-pad:0.5rem]"
        >
            <div className="flex items-center justify-between px-2 py-1">
              <h2 id={moreTitleId} className="text-[17px] font-semibold tracking-tight">
                More
              </h2>
              <button
                type="button"
                aria-label="Close more navigation"
                onClick={() => setMoreOpen(false)}
                className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-inner text-[var(--color-fg-muted)] hover:bg-[var(--color-elevated)]"
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
                        ? "border-l-[var(--color-accent)] bg-(--color-accent)/8 text-[var(--color-fg)]"
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
        className="app-chrome fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-[var(--color-border)] px-2 pb-[env(safe-area-inset-bottom)] desk:hidden"
      >
        {mobilePrimary.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "min-h-16 flex flex-col items-center justify-center gap-1 rounded-inner text-[11px] font-medium",
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
            "min-h-16 flex flex-col items-center justify-center gap-1 rounded-inner text-[11px] font-medium",
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
