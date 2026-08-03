import { Component, type ReactNode } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/Button";
import { isChunkLoadError } from "@/lib/chunkError";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch() {
    // The recovery UI is intentionally local. No printer command or telemetry
    // is sent when a route bundle fails to load.
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const likelyUpdate = isChunkLoadError(error);
    return (
      <section
        role="alert"
        className="mx-auto flex min-h-[55dvh] max-w-lg flex-col items-center justify-center px-6 text-center"
      >
        <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-accent)]">
          <RefreshCw className="h-5 w-5" />
        </span>
        <h2 className="text-[17px] font-semibold tracking-tight">
          {likelyUpdate ? "Update ready" : "View could not load"}
        </h2>
        <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
          {likelyUpdate
            ? "Regolith changed while this tab was open. Reload once to use the current interface."
            : "The interface hit an unexpected problem. Reload to restore this view."}
        </p>
        <Button
          type="button"
          variant="primary"
          onClick={() => window.location.reload()}
          className="mt-5 gap-2"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Reload Regolith
        </Button>
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--color-fg-muted)]">
          <ShieldCheck className="h-3.5 w-3.5 text-[var(--color-success)]" />
          Reloading the UI does not change printer state.
        </div>
      </section>
    );
  }
}
