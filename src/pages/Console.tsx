import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/Card";
import { moonraker } from "@/lib/moonraker";
import { usePrinter } from "@/lib/usePrinter";
import {
  getConsoleCommandRisk,
  guardPrinterAction,
  runPrinterAction,
  type PrinterAction,
} from "@/lib/printerActions";
import { useActionConfirm } from "@/components/useActionConfirm";
import { useGcodeLog } from "@/lib/useGcodeLog";
import { AlertTriangle, LockKeyhole, Send, Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { AiGloss } from "@/components/AiGloss";
import { useAiFeatureReady } from "@/lib/ai/flags";
import { explainKlipperLine, isExplainable } from "@/lib/ai/explain";
import { cn } from "@/lib/utils";

export function ConsolePage() {
  const { state, connected } = usePrinter();
  const lines = useGcodeLog(200);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expertMode, setExpertMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // In-app confirm, never window.confirm: the native dialog blocks the main
  // thread and freezes the health watchdog for as long as it sits open.
  const { confirm, confirmDialog } = useActionConfirm();
  const commandRisk = useMemo(() => {
    if (!input.trim()) return null;
    try {
      return getConsoleCommandRisk(input);
    } catch {
      return null;
    }
  }, [input]);

  // Ensure WS is connected
  useEffect(() => {
    moonraker.connect();
  }, []);

  // Autoscroll on new lines
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    setAutoScroll(atBottom);
  };

  const send = async () => {
    const cmd = input.trim();
    if (!cmd || !expertMode || sending) return;
    const action: PrinterAction = { type: "console-gcode", command: cmd };
    setSending(true);
    setError(null);
    try {
      const result = await runPrinterAction(action, { confirm });
      if (result.executed) {
        moonraker.recordCommand(cmd);
        setHistory((historyItems) => [cmd, ...historyItems].slice(0, 50));
        setHistoryIdx(-1);
        setInput("");
      }
    } catch (actionError) {
      const message =
        actionError instanceof Error
          ? actionError.message
          : "Printer rejected the command.";
      setError(message);
      moonraker.recordCommand(`!! ${message}`);
    } finally {
      setSending(false);
    }
  };

  // Explain affordance. One button, for the newest klipper response — not one
  // per line: a 44px control on every row of a 200-line log would wreck the
  // feed and the hit-target floor at the same time. User-initiated and
  // one-shot; the log is never streamed anywhere. Absent unless the owner has
  // configured and enabled the feature, so by default this renders nothing.
  const explainReady = useAiFeatureReady("explain");
  const newestResponse = [...lines]
    .reverse()
    .find((line) => line.type === "response" && isExplainable(line.text));

  const candidateAction: PrinterAction = {
    type: "console-gcode",
    command: input,
  };
  const candidateCheck = input.trim()
    ? guardPrinterAction(state, connected, candidateAction)
    : { allowed: false, reason: "Enter a command." };

  return (
    <div className="h-[calc(100dvh-var(--appbar-h)-var(--bottomnav-h)-var(--mission-h))] p-[var(--page-gutter)] desk:h-[calc(100dvh-var(--appbar-h)-var(--mission-h))]">
      <Card
        title="Console"
        icon={<Terminal />}
        className="h-full flex flex-col"
        // The body must be a flex column that is allowed to shrink: without
        // it the feed's flex-1 is inert and the column overflows the
        // overflow-hidden panel, clipping the G-code input and Send button
        // out of reach on the K1 Max's own 800x480 panel. overflow-y-auto is
        // the last-resort escape hatch — if a short viewport still cannot fit
        // the fixed rows, the body scrolls instead of discarding the tail.
        bodyClassName="flex min-h-0 flex-col overflow-y-auto"
        action={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => location.reload()}
            title="Refresh"
          >
            <Trash2 className="w-3 h-3" /> Clear
          </Button>
        }
      >
        <div className="mb-3 border border-[var(--color-border-strong)] bg-[var(--color-bg)] p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2 min-w-0">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
              <div>
                <div className="text-[13px] font-semibold">Expert commands</div>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
                  Commands can move or heat the printer. Read-only diagnostics run directly; unknown and hardware commands require confirmation.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant={expertMode ? "danger" : "default"}
              aria-pressed={expertMode}
              onClick={() => {
                setExpertMode((value) => !value);
                setError(null);
              }}
            >
              {expertMode ? "Disable console" : "Enable console"}
            </Button>
          </div>
        </div>

        {/* Live feed — fills remaining height */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="bleed -mt-[var(--card-pad)] min-h-0 flex-1 overflow-y-auto border-y border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-[12px] leading-relaxed"
        >
          {lines.length === 0 && (
            <div className="text-[var(--color-fg-muted)] italic">
              Waiting for klipper output…
            </div>
          )}
          {lines.map((l, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-[var(--color-fg-muted)] shrink-0 tabular-nums">
                {new Date(l.ts).toLocaleTimeString("en-US", { hour12: false })}
              </span>
              <span
                className={cn(
                  l.type === "command" &&
                    "text-[var(--color-accent)] font-semibold",
                  l.type === "response" && "text-[var(--color-fg)]",
                  l.text.startsWith("//") &&
                    "text-[var(--color-fg-subtle)]",
                  l.text.startsWith("!!") && "text-[var(--color-error)]",
                )}
              >
                {l.type === "command" && "$ "}
                {l.text}
              </span>
            </div>
          ))}
        </div>

        {/* Status / autoscroll toggle */}
        <div className="bleed flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg)] px-[var(--card-pad)] py-1.5 text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          <span>{lines.length} lines</span>
          <button
            type="button"
            onClick={() => setAutoScroll((s) => !s)}
            aria-pressed={autoScroll}
            className={cn(
              "flex min-h-11 min-w-11 items-center gap-1 rounded-inner p-2 hover:text-[var(--color-fg)]",
              autoScroll && "text-[var(--color-accent)]",
            )}
          >
            <span
              className={cn(
                "status-lamp",
                autoScroll
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-fg-subtle)]",
              )}
            />
            Autoscroll
          </button>
        </div>

        {explainReady && newestResponse && (
          <div className="pt-3">
            <AiGloss
              label="Explain last message"
              run={() => explainKlipperLine(newestResponse.text)}
            />
          </div>
        )}

        {/* Input row — always visible above keyboard / below feed. No
            negative bottom margin here: the row now sits against the panel's
            bottom corner, and the concentricity law needs the full card pad
            as its gap (inner = outer − gap). */}
        <div className="flex gap-2 pt-3">
          <span className="self-center text-[var(--color-accent)] font-mono select-none">
            ›
          </span>
          <input
            aria-label="G-code command"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void send();
              else if (e.key === "ArrowUp") {
                e.preventDefault();
                const idx = Math.min(historyIdx + 1, history.length - 1);
                if (history[idx]) {
                  setHistoryIdx(idx);
                  setInput(history[idx]);
                }
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                const idx = historyIdx - 1;
                if (idx < 0) {
                  setHistoryIdx(-1);
                  setInput("");
                } else {
                  setHistoryIdx(idx);
                  setInput(history[idx]);
                }
              }
            }}
            disabled={!expertMode || sending}
            placeholder={expertMode ? "Enter G-code command" : "Enable expert commands to type"}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 min-w-0 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-inner px-3 min-h-11 text-[13px] font-mono focus:border-[var(--color-accent)] disabled:opacity-50"
          />
          <Button
            onClick={send}
            variant={commandRisk?.risk === "critical" ? "danger" : "primary"}
            size="md"
            disabled={
              !expertMode || sending || !input.trim() || !candidateCheck.allowed
            }
          >
            <Send className="w-3 h-3" /> Send
          </Button>
        </div>
        {(commandRisk || error || (input.trim() && !candidateCheck.allowed)) && (
          <div
            role={error ? "alert" : "status"}
            className={cn(
              "mt-2 flex items-start gap-2 rounded-inner border p-2.5 text-[12px]",
              error || !candidateCheck.allowed
                ? "border-(--color-error)/35 bg-(--color-error)/8 text-[var(--color-error)]"
                : commandRisk?.risk === "routine"
                  ? "border-(--color-success)/30 bg-(--color-success)/6 text-[var(--color-success)]"
                  : "border-(--color-warning)/35 bg-(--color-warning)/8 text-[var(--color-warning)]",
            )}
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error ?? (!candidateCheck.allowed ? candidateCheck.reason : commandRisk?.summary)}</span>
          </div>
        )}
      </Card>
      {confirmDialog}
    </div>
  );
}
