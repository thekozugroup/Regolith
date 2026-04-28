import { NavLink } from "react-router";
import {
  LayoutDashboard,
  FileText,
  Move,
  Sliders,
  Terminal,
  Settings,
  Hammer,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/print", icon: FileText, label: "Files" },
  { to: "/control", icon: Move, label: "Control" },
  { to: "/tune", icon: Sliders, label: "Tune" },
  { to: "/console", icon: Terminal, label: "Console" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 bottom-0 w-14 border-r border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col items-center py-2 z-10">
      {/* Logo */}
      <div className="w-12 h-12 flex items-center justify-center mb-2 group">
        <Hammer
          className="w-6 h-6 text-[var(--color-accent)] transition-transform group-hover:rotate-12"
          strokeWidth={2}
        />
      </div>

      <div className="w-8 h-px bg-[var(--color-border)] mb-2" />

      {/* Nav items */}
      <nav className="flex flex-col gap-1 flex-1">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "relative w-12 h-12 flex items-center justify-center rounded-md transition-all group",
                "hover:bg-[rgba(249,115,22,0.06)]",
                isActive && "bg-[rgba(249,115,22,0.10)] text-[var(--color-accent)]",
                !isActive && "text-[var(--color-fg-muted)]"
              )
            }
            title={label}
          >
            {({ isActive }) => (
              <>
                <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                {isActive && (
                  <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-[var(--color-accent)] rounded-r" />
                )}
                {/* Tooltip on hover */}
                <span
                  className={cn(
                    "absolute left-14 px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap",
                    "bg-[var(--color-elevated)] border border-[var(--color-border-strong)]",
                    "opacity-0 pointer-events-none transition-opacity duration-150 delay-200",
                    "group-hover:opacity-100 z-50"
                  )}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
