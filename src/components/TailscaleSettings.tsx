import { useCallback, useEffect, useRef, useState } from "react";
import { Network, RefreshCw } from "lucide-react";
import { Card } from "./Card";
import { Button } from "./Button";
import {
  TAILSCALE_CONTROL_AVAILABLE,
  TAILSCALE_OWNER_COMMANDS,
  TAILSCALE_AGE_TICK_MS,
  TAILSCALE_OPEN_DELAY_MS,
  TAILSCALE_PUBLISH_SETUP,
  describeTailscale,
  readTailscaleStatus,
  type TailscaleDisplay,
  type TailscaleReading,
  type TailscaleTone,
} from "@/lib/tailscale";
import { cn, formatDuration } from "@/lib/utils";

/**
 * Tailscale status — read-only, on purpose.
 *
 * See the header of `lib/tailscale.ts` for the three read paths that were
 * checked on the real printer and why two of them cannot work. The short
 * version: this app has no shell, Moonraker cannot see Entware services, and
 * the only honest channel is a status document the printer publishes into its
 * own config directory. When that document is absent the panel says so and
 * prints the one-time setup — it does not invent a state.
 *
 * There are no start/stop buttons because there is no control path that does
 * not involve granting a web UI arbitrary root commands through g-code. The
 * owner's commands are printed instead.
 */

const TONE_CLASS: Record<TailscaleTone, string> = {
  ok: "text-[var(--color-success)]",
  warn: "text-[var(--color-warning)]",
  idle: "text-[var(--color-fg-muted)]",
  unknown: "text-[var(--color-fg-muted)]",
};

export function TailscaleSettings() {
  const [reading, setReading] = useState<TailscaleReading | null>(null);
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const abort = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setChecking(true);
    // readTailscaleStatus settles every failure into a reading; an aborted
    // read is the one case with nothing to report.
    const next = await readTailscaleStatus(fetch, controller.signal);
    if (controller.signal.aborted) return;
    setReading(next);
    setNow(Date.now());
    setChecking(false);
  }, []);

  useEffect(() => {
    // ONE read, a beat after the panel settles, and thereafter only when the
    // owner asks.
    //
    // Not a poll: this is infrastructure on a settings page, not a cockpit
    // gauge, and a value that changes about as often as the printer reboots
    // does not deserve permanent traffic. Freshness is not lost by that —
    // the document carries its own timestamp, so an untouched panel still
    // crosses into "Unknown" on the local clock below.
    //
    // And not instant: Settings already has four host reads in flight when it
    // opens. Firing a fifth into the same six-connection pool during the
    // opening frame is how a panel nobody looked at slows the page they were
    // actually navigating to. Someone passing through Settings never spends
    // a request on this.
    const open = setTimeout(() => {
      void check().catch(() => setChecking(false));
    }, TAILSCALE_OPEN_DELAY_MS);
    const tick = setInterval(() => setNow(Date.now()), TAILSCALE_AGE_TICK_MS);
    const controller = abort;
    return () => {
      clearTimeout(open);
      clearInterval(tick);
      controller.current?.abort();
    };
  }, [check]);

  const display: TailscaleDisplay | null = reading
    ? describeTailscale(reading, now)
    : null;
  const status = reading?.status ?? null;
  const showSetup =
    display !== null &&
    (display.state === "not-configured" || display.state === "unavailable");

  return (
    <Card
      title="Tailscale"
      icon={<Network />}
      className="lg:col-span-2"
      action={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void check().catch(() => setChecking(false))}
          disabled={checking}
        >
          <RefreshCw className={cn("w-3 h-3", checking && "animate-spin")} />
          Check now
        </Button>
      }
    >
      <div className="space-y-[var(--stack)]">
        <Row label="State">
          <span
            data-testid="tailscale-state"
            className={cn(
              "text-[13px] font-medium",
              display ? TONE_CLASS[display.tone] : "text-[var(--color-fg-muted)]",
            )}
          >
            {display ? display.label : "Reading…"}
          </span>
        </Row>

        {/* Identity is printed only for a fresh document from a running
            daemon — never from a stale one, which is the whole staleness law
            in lib/tailscale.ts made visible. */}
        {display?.showsIdentity && status && (
          <>
            <Row label="Tailnet address">
              <span className="tabular-nums" data-testid="tailscale-address">
                {status.ipv4 ?? "—"}
              </span>
            </Row>
            <Row label="Machine name">
              <span className="text-[var(--color-fg-muted)]">
                {status.dnsName ?? "—"}
              </span>
            </Row>
            <Row label="Tailscale version">
              <span className="text-[var(--color-fg-muted)] tabular-nums">
                {status.version ?? "—"}
              </span>
            </Row>
          </>
        )}

        <Row label="Last report">
          <span
            className="text-[var(--color-fg-muted)] tabular-nums"
            data-testid="tailscale-age"
          >
            {display?.ageMs != null && display.ageMs >= 0
              ? `${formatDuration(Math.floor(display.ageMs / 1000))} ago`
              : "—"}
          </span>
        </Row>

        <p
          data-testid="tailscale-detail"
          className="text-[11px] leading-relaxed text-[var(--color-fg-muted)]"
        >
          {display ? display.detail : "Asking the printer for its last report…"}
        </p>

        {/* No box around the box: the command block below already carries the
            panel's inner radius, and a rounded wrapper around a rounded child
            at the same radius breaks the concentricity law. */}
        {showSetup && (
          <div role="status" data-testid="tailscale-setup" className="space-y-2">
            <div className="text-[11px] font-medium">
              One-time setup, on the printer
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
              This publishes <code>tailscale status</code> once a minute where
              Moonraker can serve it. It reads state only — it changes nothing
              about the tailnet, and Regolith never runs it for you.
            </p>
            <Commands text={TAILSCALE_PUBLISH_SETUP} />
          </div>
        )}

        {/* Start, stop, sign-in and boot-hook repair are shell work. See
            TAILSCALE_CONTROL_AVAILABLE for why they are printed, not wired. */}
        {!TAILSCALE_CONTROL_AVAILABLE && (
          <div className="space-y-2" data-testid="tailscale-owner-commands">
            <div className="text-[11px] font-medium">
              Run these yourself, over ssh
            </div>
            {TAILSCALE_OWNER_COMMANDS.map((entry) => (
              <div key={entry.title} className="space-y-1">
                <div className="text-[11px] text-[var(--color-fg-muted)]">
                  {entry.title}
                </div>
                <Commands text={entry.command} />
                <p className="text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
                  {entry.note}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Command text wraps rather than scrolls: a horizontal scroller inside a card
 * is the classic way a 320px viewport ends up with a page-wide overflow.
 */
function Commands({ text }: { text: string }) {
  return (
    <pre className="max-w-full overflow-hidden whitespace-pre-wrap break-words rounded-inner border border-[var(--color-border)] p-2 text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
      <code>{text}</code>
    </pre>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between py-2 border-b border-[var(--color-border)] last:border-0">
      <div className="min-w-0 text-[13px] font-medium">{label}</div>
      {children}
    </div>
  );
}
