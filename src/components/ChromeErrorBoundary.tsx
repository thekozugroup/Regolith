import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { readStored } from "@/lib/safeStorage";

/**
 * Containment for the persistent chrome — sidebar, app bar, mission bar,
 * health alerts.
 *
 * `RouteErrorBoundary` only covers what renders inside `<main>`. Everything
 * around it renders on EVERY route, above that boundary, so one throw in one
 * of those four components took the entire document with it: a white screen
 * on a machine that is very possibly mid-print, with no navigation left to
 * reach Settings and no words explaining what happened.
 *
 * The fallback here is deliberately small and quiet. A failed chrome panel is
 * a degraded UI, not a printer fault, and it must not be mistaken for one:
 * no alert role, no red, no modal, no button competing with the real
 * controls. It names the panel that is missing and gets out of the way, so
 * the rest of the shell — including whichever panel the owner is actually
 * looking at — keeps working.
 *
 * Nothing here touches the printer. A UI panel failing is never a reason to
 * send a command.
 */

interface Props {
  /** Stable id — also the fault-injection handle (see CrashSeam). */
  id: string;
  /** What the owner has lost, in their words: "Status bar unavailable". */
  label: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class ChromeErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Dev gets the stack; production stays silent rather than filling the
    // console of a kiosk nobody is watching. No telemetry leaves the LAN.
    if (import.meta.env.DEV) {
      console.error(`[regolith] chrome panel "${this.props.id}" failed`, error);
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="status"
        data-chrome-failed={this.props.id}
        className="flex items-center gap-1.5 px-[var(--page-gutter)] py-1 text-[11px] text-[var(--color-fg-muted)]"
      >
        <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span>{this.props.label}</span>
      </div>
    );
  }
}

/**
 * Fault injection for the containment guarantee.
 *
 * "An error in one panel must never white-screen the app" is only a claim
 * until something proves it on the bundle that actually ships, so this seam
 * stays in every build: e2e runs against `vite preview`, not the dev server,
 * and a guarantee tested on a different artifact than the deployed one is not
 * tested. It is inert unless a key that exists for no other purpose is set by
 * hand in this browser's storage, it is read once per render, and it cannot
 * be reached from the UI, from the network, or from the printer.
 *
 * A boundary cannot catch a throw from its own render, so this mounts as a
 * CHILD of the boundary it is testing.
 */
export function CrashSeam({ id }: { id: string }) {
  if (readStored("forge.debug.crash") === id) {
    throw new Error(`Injected crash: ${id}`);
  }
  return null;
}
