import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { BrowserRouter, Link, Routes, Route, useLocation } from "react-router";
import { LockKeyhole } from "lucide-react";
import { buttonClassName } from "./components/buttonStyles";
import { Sidebar } from "./components/Sidebar";
import { AppBar } from "./components/AppBar";
import { HealthAlerts } from "./components/HealthAlerts";
import { MissionBar } from "./components/MissionBar";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import {
  ChromeErrorBoundary,
  CrashSeam,
} from "./components/ChromeErrorBoundary";
import { useNotifications } from "./lib/useNotifications";
import { useKeyboardShortcuts } from "./lib/useKeyboardShortcuts";
import { useExperienceMode } from "./lib/useExperienceMode";

const Dashboard = lazy(() =>
  import("./pages/Dashboard").then((module) => ({ default: module.Dashboard })),
);
const Files = lazy(() =>
  import("./pages/Files").then((module) => ({ default: module.Files })),
);
const Control = lazy(() =>
  import("./pages/Control").then((module) => ({ default: module.Control })),
);
const Tune = lazy(() =>
  import("./pages/Tune").then((module) => ({ default: module.Tune })),
);
const Timelapses = lazy(() =>
  import("./pages/Timelapses").then((module) => ({ default: module.Timelapses })),
);
const ConsolePage = lazy(() =>
  import("./pages/Console").then((module) => ({ default: module.ConsolePage })),
);
const SettingsPage = lazy(() =>
  import("./pages/Settings").then((module) => ({ default: module.SettingsPage })),
);

function RouteLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[40dvh] items-center justify-center p-6 text-[13px] text-[var(--color-fg-muted)]"
    >
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="status-lamp text-[var(--color-accent)]" />
        Loading view…
      </span>
    </div>
  );
}

function ExpertOnly({ children }: { children: ReactNode }) {
  const [experienceMode] = useExperienceMode();
  if (experienceMode === "expert") return children;

  return (
    <section className="mx-auto flex min-h-[55dvh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-inner border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-accent)]">
        <LockKeyhole className="h-5 w-5" />
      </span>
      <h2 className="text-[17px] font-semibold tracking-tight">Expert tool hidden</h2>
      <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
        This view can move, heat, calibrate, or directly command the printer. Enable Expert mode when maintenance requires it.
      </p>
      <Link
        to="/settings"
        className={buttonClassName({ variant: "primary", className: "mt-5" })}
      >
        Review experience settings
      </Link>
    </section>
  );
}

function AppShell() {
  const location = useLocation();
  useNotifications();
  useKeyboardShortcuts();
  return (
    <>
      {/* Each persistent surface is contained separately. They render on
          every route, ABOVE the route boundary, so one throw used to take the
          whole document — including the navigation needed to get anywhere
          else. Losing one panel now costs exactly that panel. */}
      <ChromeErrorBoundary id="sidebar" label="Navigation unavailable — reload to restore it">
        <CrashSeam id="sidebar" />
        <Sidebar />
      </ChromeErrorBoundary>
      <ChromeErrorBoundary id="appbar" label="Toolbar unavailable — reload to restore it">
        <CrashSeam id="appbar" />
        <AppBar />
      </ChromeErrorBoundary>
      {/* Alerts fail LOUD, not silent: this host carries the thermal-runaway
          and stale-telemetry warnings, so its absence has to be stated
          outright rather than looking like "nothing is wrong". */}
      <ChromeErrorBoundary
        id="health-alerts"
        label="Printer alerts unavailable — watch the machine directly until this is reloaded"
      >
        <CrashSeam id="health-alerts" />
        <HealthAlerts />
      </ChromeErrorBoundary>
      {/* Mission bar renders BEFORE main so the dashboard task order
          ("is it OK?" first) holds in the DOM; it is pinned to the bottom
          of the glass visually. Content clearance = mission bar height,
          plus the bottom nav's on compact chrome (they stack). */}
      <ChromeErrorBoundary id="mission-bar" label="Status bar unavailable — reload to restore it">
        <CrashSeam id="mission-bar" />
        <MissionBar />
      </ChromeErrorBoundary>
      <main
        id="main-content"
        tabIndex={-1}
        className="mt-[var(--appbar-h)] min-h-[calc(100dvh-var(--appbar-h))] pb-[calc(var(--bottomnav-h)+var(--mission-h)+0.5rem)] transition-[margin-left] duration-[var(--dur-slow)] ease-[var(--ease-emphasized)] desk:ml-[var(--sidebar-w,14rem)] desk:pb-[var(--mission-h)]"
      >
        <RouteErrorBoundary key={location.pathname}>
          <CrashSeam id="route" />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/print" element={<Files />} />
              <Route path="/control" element={<Control />} />
              <Route path="/tune" element={<ExpertOnly><Tune /></ExpertOnly>} />
              <Route path="/timelapses" element={<Timelapses />} />
              <Route path="/console" element={<ExpertOnly><ConsolePage /></ExpertOnly>} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </main>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
