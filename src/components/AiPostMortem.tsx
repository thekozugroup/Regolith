import { useState } from "react";
import { FileSearch } from "lucide-react";
import { Button } from "./Button";
import {
  excerptKlippyLog,
  explainFailure,
  fetchKlippyLog,
} from "@/lib/ai/postmortem";

/**
 * Failure post-mortem — manual trigger, after a job has already stopped.
 *
 * THE PREVIEW STEP IS THE FEATURE'S SAFETY PROPERTY, not a nicety.
 * `klippy.log` embeds the full printer.cfg dump, MCU serials, filesystem
 * paths and sometimes network details. So the flow is strictly:
 *
 *   fetch → excerpt → SHOW the owner exactly what would leave the network →
 *   the owner presses send, or does not.
 *
 * There is no code path that sends without the preview, and none that sends
 * the whole file. Nothing is ever sent automatically. Every failure is
 * silent: no log, no excerpt, no answer ⇒ nothing is rendered.
 */
export function AiPostMortem() {
  const [excerpt, setExcerpt] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const review = async () => {
    setBusy(true);
    setAnswer(null);
    try {
      const text = excerptKlippyLog(await fetchKlippyLog());
      setExcerpt(text || null);
    } catch {
      setExcerpt(null);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!excerpt) return;
    setBusy(true);
    try {
      // Exactly the text on screen — never a wider slice.
      setAnswer(await explainFailure(excerpt));
    } catch {
      setAnswer(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={review}>
          <FileSearch className="w-3 h-3" aria-hidden="true" />
          {busy && !excerpt ? "Reading log…" : "Review failure log"}
        </Button>
      </div>

      {excerpt && (
        <div className="rounded-inner border border-[var(--color-border-strong)] bg-[var(--color-bg)] p-2.5">
          <p className="text-[11px] leading-relaxed text-[var(--color-warning)]">
            This is exactly what would be sent to your configured endpoint —
            nothing more, and nothing is sent until you press Send.
          </p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
            {excerpt}
          </pre>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={send}>
              Send this excerpt
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setExcerpt(null);
                setAnswer(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {answer && (
        <div
          data-ai-gloss
          role="status"
          className="rounded-inner border border-dashed border-[var(--color-border-strong)] bg-[var(--color-elevated)] p-2.5"
        >
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-[var(--color-fg-muted)]">
            Assistant — not printer data
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-fg-muted)] whitespace-pre-wrap">
            {answer}
          </p>
        </div>
      )}
    </div>
  );
}
