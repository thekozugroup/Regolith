import { useEffect, useState } from "react";
import { Check, Film } from "lucide-react";
import { Card } from "./Card";
import { moonraker, type TimelapseSettings as LiveSettings } from "@/lib/moonraker";
import {
  TIMELAPSE_MODE_STORAGE_KEY,
  timelapseModeFromStorage,
  type TimelapseMode,
} from "@/lib/timelapse";
import { readStored, writeStored } from "@/lib/safeStorage";
import { cn } from "@/lib/utils";

/**
 * The tradeoff, stated plainly. Getting this wrong is not a cosmetic
 * difference: `layermacro` on a file the slicer never instrumented records
 * NOTHING, silently, while every status field says the feature is on.
 */
const OPTIONS: Array<{
  mode: TimelapseMode;
  title: string;
  description: string;
  recommended?: boolean;
}> = [
  {
    mode: "hyperlapse",
    title: "Hyperlapse",
    description:
      "Frames on a timer. Works with any g-code file you already have, no re-slicing. Frames are time-spaced, so fast layers and slow layers get the same coverage.",
    recommended: true,
  },
  {
    mode: "layermacro",
    title: "Layer macro",
    description:
      "One frame per layer — smoother, better looking. Requires your slicer to call TIMELAPSE_TAKE_FRAME in its layer-change g-code. Files sliced without it record nothing.",
  },
];

/**
 * Timelapse capture mode.
 *
 * This is a Regolith PREFERENCE, not a live printer setting: it is written to
 * the printer at the moment a print starts with recording turned on, together
 * with the enable flag, so the two can never disagree. The printer's current
 * value is shown alongside — read-only — because the setting is global and
 * Fluidd or the stock touchscreen may have changed it since.
 */
export function TimelapseSettings() {
  const [mode, setMode] = useState<TimelapseMode>(() =>
    timelapseModeFromStorage(readStored(TIMELAPSE_MODE_STORAGE_KEY)),
  );
  const [live, setLive] = useState<LiveSettings | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    moonraker
      .getTimelapseSettings()
      .then((settings) => {
        if (cancelled) return;
        setLive(settings);
        setUnavailable(false);
      })
      .catch(() => {
        // A host without the timelapse component, or one that is not
        // answering. Neither is an incident: the panel simply says it cannot
        // read the printer's current value.
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = (next: TimelapseMode) => {
    writeStored(TIMELAPSE_MODE_STORAGE_KEY, next);
    setMode(next);
  };

  const liveMode = typeof live?.mode === "string" ? live.mode : null;

  return (
    <Card title="Timelapse" icon={<Film />} className="lg:col-span-2">
      <fieldset>
        <legend className="sr-only">Timelapse capture mode</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {OPTIONS.map((option) => {
            const selected = mode === option.mode;
            return (
              <button
                key={option.mode}
                type="button"
                aria-pressed={selected}
                data-testid={`timelapse-mode-${option.mode}`}
                onClick={() => choose(option.mode)}
                className={cn(
                  "press-flat min-h-20 rounded-inner border p-3 text-left transition-[background,border-color,color,transform]",
                  selected
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                    : "border-[var(--color-border)] bg-[var(--color-elevated)]/35 hover:border-[var(--color-border-strong)]",
                )}
              >
                <span className="flex items-center gap-2 text-[13px] font-semibold">
                  <span
                    className={cn(
                      "inline-flex h-5 w-5 items-center justify-center rounded-full border",
                      selected
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                        : "border-[var(--color-border-strong)]",
                    )}
                  >
                    {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  {option.title}
                  {option.recommended && (
                    <span className="ml-auto text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-success)]">
                      Records any file
                    </span>
                  )}
                </span>
                <span className="mt-1.5 block text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
          <p>
            Recording is chosen per print, on the print confirmation. Regolith
            writes this mode and the on/off state to the printer every time a
            print starts — never in the background.
          </p>
          {/* The setting is one global value shared with every other UI on
              the machine, so what the printer currently holds is worth
              showing and is NOT assumed from the preference above. */}
          <p data-testid="timelapse-live-state">
            {unavailable
              ? "Printer setting: unavailable — this host did not answer the timelapse API."
              : liveMode
                ? `Printer setting: ${liveMode}, recording ${live?.enabled ? "on" : "off"}.`
                : "Printer setting: reading…"}
          </p>
        </div>
      </fieldset>
    </Card>
  );
}
