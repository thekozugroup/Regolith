import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/Card";
import { moonraker } from "@/lib/moonraker";
import { useGcodeLog } from "@/lib/useGcodeLog";
import { Terminal, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { cn } from "@/lib/utils";

export function ConsolePage() {
  const lines = useGcodeLog(200);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    if (!cmd) return;
    moonraker.recordCommand(cmd);
    setHistory((h) => [cmd, ...h].slice(0, 50));
    setHistoryIdx(-1);
    setInput("");
    try {
      await moonraker.runGcode(cmd);
    } catch (e) {
      // Show error inline as a response line
      const err = (e as Error).message;
      moonraker.recordCommand(`!! ${err}`);
    }
  };

  return (
    <div className="p-3 h-[calc(100vh-3.5rem)]">
      <Card
        title="Console"
        icon={<Terminal />}
        className="h-full flex flex-col"
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
        {/* Live feed — fills remaining height */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto bg-black -mx-3.5 -mt-3.5 px-3 py-2 font-mono text-[12px] leading-relaxed border-y border-[var(--color-border)] min-h-[200px]"
        >
          {lines.length === 0 && (
            <div className="text-[var(--color-fg-muted)] italic">
              Waiting for klipper output…
            </div>
          )}
          {lines.map((l, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-[var(--color-fg-muted)]/60 shrink-0 tabular-nums">
                {new Date(l.ts).toLocaleTimeString("en-US", { hour12: false })}
              </span>
              <span
                className={cn(
                  l.type === "command" &&
                    "text-[var(--color-accent)] font-semibold",
                  l.type === "response" && "text-[var(--color-fg)]",
                  l.text.startsWith("//") &&
                    "text-[var(--color-fg-muted)]/80",
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
        <div className="flex items-center justify-between text-[10px] text-[var(--color-fg-muted)] uppercase tracking-[0.1em] py-1.5 -mx-3.5 px-3.5 border-b border-[var(--color-border)] bg-[var(--color-bg)]/50">
          <span>{lines.length} lines</span>
          <button
            onClick={() => setAutoScroll((s) => !s)}
            className={cn(
              "flex items-center gap-1 hover:text-[var(--color-fg)]",
              autoScroll && "text-[var(--color-accent)]",
            )}
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                autoScroll
                  ? "bg-[var(--color-accent)]"
                  : "bg-[var(--color-fg-muted)]/30",
              )}
            />
            Autoscroll
          </button>
        </div>

        {/* Input row — always visible above keyboard / below feed */}
        <div className="flex gap-2 pt-3 -mb-1">
          <span className="self-center text-[var(--color-accent)] font-mono select-none">
            ›
          </span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
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
            placeholder="gcode command…"
            className="flex-1 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-sm px-3 h-8 text-[12px] font-mono focus:border-[var(--color-accent)] focus:outline-none"
          />
          <Button onClick={send} variant="primary" size="md">
            <Send className="w-3 h-3" /> Send
          </Button>
        </div>
      </Card>
    </div>
  );
}
