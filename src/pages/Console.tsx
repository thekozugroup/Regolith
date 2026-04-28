import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/Card";
import { moonraker } from "@/lib/moonraker";
import { Terminal, Send } from "lucide-react";
import { Button } from "@/components/Button";

interface ConsoleLine {
  ts: string;
  type: "command" | "response";
  text: string;
}

export function ConsolePage() {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Subscribe to gcode response notifications via WebSocket
  useEffect(() => {
    moonraker.connect();
    // Hook into raw WS messages — Moonraker emits notify_gcode_response
    const handler = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.method === "notify_gcode_response") {
          const [text] = msg.params as [string];
          setLines((prev) => [
            ...prev,
            {
              ts: new Date().toLocaleTimeString("en-US", { hour12: false }),
              type: "response",
              text,
            },
          ]);
        }
      } catch {
        /* ignore */
      }
    };

    // We need direct WS access — expose it through an event
    const interval = setInterval(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws = (moonraker as any).ws as (WebSocket & { __hooked?: boolean }) | null;
      if (ws && !ws.__hooked) {
        ws.addEventListener("message", handler);
        ws.__hooked = true;
        clearInterval(interval);
      }
    }, 200);

    return () => {
      clearInterval(interval);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws = (moonraker as any).ws as WebSocket | null;
      if (ws) ws.removeEventListener("message", handler);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [lines]);

  const send = async () => {
    const cmd = input.trim();
    if (!cmd) return;
    setLines((prev) => [
      ...prev,
      {
        ts: new Date().toLocaleTimeString("en-US", { hour12: false }),
        type: "command",
        text: cmd,
      },
    ]);
    setHistory((h) => [cmd, ...h].slice(0, 50));
    setHistoryIdx(-1);
    setInput("");
    try {
      await moonraker.runGcode(cmd);
    } catch (e) {
      setLines((prev) => [
        ...prev,
        {
          ts: new Date().toLocaleTimeString("en-US", { hour12: false }),
          type: "response",
          text: `// !! ${(e as Error).message}`,
        },
      ]);
    }
  };

  return (
    <div className="p-3 h-[calc(100vh-3.5rem-1.5rem)]">
      <Card title="Console" icon={<Terminal />} className="h-full flex flex-col">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto bg-black -mx-3.5 -mt-3.5 px-3 py-2 font-mono text-[12px] leading-relaxed border-y border-[var(--color-border)]"
        >
          {lines.length === 0 && (
            <div className="text-[var(--color-fg-muted)] italic">
              Connected. Type gcode commands below.
            </div>
          )}
          {lines.map((l, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-[var(--color-fg-muted)] shrink-0 tabular-nums">
                {l.ts}
              </span>
              <span
                className={
                  l.type === "command"
                    ? "text-[var(--color-accent)] font-semibold"
                    : "text-[var(--color-fg)]"
                }
              >
                {l.type === "command" ? "$ " : ""}
                {l.text}
              </span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-3 -mb-1">
          <span className="self-center text-[var(--color-accent)] font-mono">
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
            className="flex-1 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-sm px-3 h-7.5 text-[12px] font-mono focus:border-[var(--color-accent)] focus:outline-none"
          />
          <Button onClick={send} variant="primary" size="md">
            <Send className="w-3 h-3" /> Send
          </Button>
        </div>
      </Card>
    </div>
  );
}
