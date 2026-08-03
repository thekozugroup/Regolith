import { useEffect, useId, useState } from "react";
import { Card } from "./Card";
import { Button } from "./Button";
import { Palette, Check } from "lucide-react";
import {
  useDeviceName,
  useAccent,
  ACCENT_PRESETS,
  isValidHex,
  normalizeHex,
} from "@/lib/useTheme";
import { cn } from "@/lib/utils";

export function ThemeSettings() {
  const [name, setName] = useDeviceName();
  const [accent, setAccent] = useAccent();
  const [draftName, setDraftName] = useState(name);
  const [draftHex, setDraftHex] = useState(accent);
  const deviceNameId = useId();
  const accentPickerId = useId();
  const accentHexId = useId();
  const accentErrorId = useId();
  const dirty = draftName !== name;
  const hexValid = isValidHex(draftHex);
  const hexDirty = hexValid && normalizeHex(draftHex) !== accent;

  useEffect(() => setDraftHex(accent), [accent]);

  const commitHex = () => {
    if (hexValid) setAccent(draftHex);
  };

  return (
    <Card title="Theme" icon={<Palette />} className="lg:col-span-1">
      <div className="space-y-4">
        {/* Device name */}
        <div>
          <label
            htmlFor={deviceNameId}
            className="block text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold mb-1.5"
          >
            Device name
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={deviceNameId}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              maxLength={24}
              placeholder="Forge"
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 text-[13px] focus:border-[var(--color-accent)] focus:outline-none"
            />
            <Button
              size="md"
              variant={dirty ? "primary" : "default"}
              disabled={!dirty}
              onClick={() => setName(draftName)}
              className="w-full sm:w-auto"
            >
              Save
            </Button>
          </div>
          <div className="text-[11px] text-[var(--color-fg-muted)] mt-1.5">
            Shown in the top bar and browser tab.
          </div>
        </div>

        {/* Accent color */}
        <fieldset>
          <legend className="block text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold mb-1.5">
            Accent color
          </legend>

          {/* Hex input + native color picker swatch */}
          <div className="mb-2 grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto]">
            <div className="relative">
              <label htmlFor={accentPickerId} className="sr-only">
                Choose accent color
              </label>
              <input
                id={accentPickerId}
                type="color"
                value={hexValid ? normalizeHex(draftHex) : accent}
                onChange={(e) => {
                  setDraftHex(e.target.value);
                  setAccent(e.target.value);
                }}
                className="absolute inset-0 z-10 min-h-11 min-w-11 cursor-pointer opacity-0"
              />
              <div
                className="pointer-events-none h-11 w-11 rounded-lg border border-[var(--color-border)]"
                style={{ backgroundColor: hexValid ? normalizeHex(draftHex) : accent }}
              />
            </div>
            <label htmlFor={accentHexId} className="sr-only">
              Accent color hex value
            </label>
            <input
              id={accentHexId}
              value={draftHex}
              onChange={(e) => setDraftHex(e.target.value)}
              onBlur={commitHex}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitHex();
                if (e.key === "Escape") setDraftHex(accent);
              }}
              placeholder="#f97316"
              spellCheck={false}
              aria-invalid={!hexValid}
              aria-describedby={!hexValid ? accentErrorId : undefined}
              className={cn(
                "min-h-11 min-w-0 flex-1 rounded-lg border bg-[var(--color-elevated)] px-3 text-[13px] font-mono uppercase tracking-wider focus:outline-none",
                hexValid
                  ? "border-[var(--color-border)] focus:border-[var(--color-accent)]"
                  : "border-[var(--color-error)] focus:border-[var(--color-error)]",
              )}
            />
            <Button
              size="md"
              variant={hexDirty ? "primary" : "default"}
              disabled={!hexDirty}
              onClick={commitHex}
              className="col-span-2 w-full sm:col-span-1 sm:w-auto"
            >
              Apply
            </Button>
          </div>

          {/* Preset chips */}
          <div className="grid grid-cols-5 gap-1.5 min-[380px]:grid-cols-6">
            {Object.entries(ACCENT_PRESETS).map(([key, hex]) => {
              const active = accent.toLowerCase() === hex.toLowerCase();
              return (
                <button
                  key={key}
                  onClick={() => setAccent(hex)}
                  className={cn(
                    "flex min-h-11 min-w-11 items-center justify-center rounded-lg border-2 transition-[border-color,transform]",
                    active
                      ? "border-[var(--color-fg)] scale-105"
                      : "border-transparent hover:border-[var(--color-border-strong)]",
                  )}
                  style={{ backgroundColor: hex }}
                  aria-label={`${key} accent, ${hex}`}
                  aria-pressed={active}
                >
                  {active && (
                    <Check className="w-4 h-4 text-[var(--color-accent-fg)]" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="text-[11px] text-[var(--color-fg-muted)] mt-1.5 font-mono">
            Current: {accent.toUpperCase()}
          </div>
          {!hexValid && (
            <div id={accentErrorId} role="alert" className="mt-1.5 text-[11px] text-[var(--color-error)]">
              Enter a 3- or 6-digit hex color, such as #f97316.
            </div>
          )}
        </fieldset>
      </div>
    </Card>
  );
}
