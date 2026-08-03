import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "./Button";

/**
 * A one-shot, user-initiated prose gloss.
 *
 * Two properties matter here and both are deliberate:
 *
 *   · The answer is rendered in an explicitly labelled block that looks
 *     nothing like telemetry. Every measured value in this app earns its
 *     confident styling; a model's opinion does not inherit it.
 *   · Failure is SILENT. `run` returning null — offline, API error, timeout,
 *     nothing displayable in the response — clears back to the button with no
 *     toast, no banner, and no "unavailable" placeholder. The panel looks
 *     exactly as it does with the feature switched off.
 *
 * Nothing this component renders is ever read back by anything. It cannot
 * reach the printer: the modules behind `run` live under src/lib/ai, which
 * the ESLint fence forbids from importing moonraker or printerActions.
 */
export function AiGloss({
  label,
  run,
}: {
  label: string;
  run: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setText(null);
    try {
      setText(await run());
    } catch {
      setText(null); // silent by contract
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={go}>
          <Sparkles className="w-3 h-3" aria-hidden="true" />
          {busy ? "Asking…" : label}
        </Button>
      </div>
      {text && (
        <div
          data-ai-gloss
          role="status"
          className="rounded-inner border border-dashed border-[var(--color-border-strong)] bg-[var(--color-elevated)] p-2.5"
        >
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-[var(--color-fg-muted)]">
            Assistant — not printer data
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-fg-muted)] whitespace-pre-wrap">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}
