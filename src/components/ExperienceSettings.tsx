import { Check, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Card } from "./Card";
import {
  type ExperienceMode,
  useExperienceMode,
} from "@/lib/useExperienceMode";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{
  mode: ExperienceMode;
  title: string;
  description: string;
}> = [
  {
    mode: "basic",
    title: "Basic",
    description: "Everyday printing, status, camera, and safe movement controls.",
  },
  {
    mode: "expert",
    title: "Expert",
    description: "Adds calibration, console, host details, profiles, and recovery tools.",
  },
];

export function ExperienceSettings() {
  const [mode, setMode] = useExperienceMode();

  return (
    <Card title="Experience" icon={<SlidersHorizontal />} className="lg:col-span-2">
      <fieldset>
        <legend className="sr-only">Interface experience</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {OPTIONS.map((option) => {
            const selected = mode === option.mode;
            return (
              <button
                key={option.mode}
                type="button"
                aria-pressed={selected}
                onClick={() => setMode(option.mode)}
                className={cn(
                  "min-h-20 rounded-inner border p-3 text-left transition-[background,border-color,color]",
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
                  {option.mode === "basic" && (
                    <span className="ml-auto text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-success)]">
                      Recommended
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
        <div className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-success)]" />
          Safety status and emergency stop stay available in both modes. Changing modes never changes printer settings.
        </div>
      </fieldset>
    </Card>
  );
}
