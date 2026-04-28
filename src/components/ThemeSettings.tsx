import { useEffect, useState } from "react";
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
  const dirty = draftName !== name;
  const hexValid = isValidHex(draftHex);
  const hexDirty = hexValid && normalizeHex(draftHex) !== accent;

  useEffect(() => setDraftHex(accent), [accent]);

  const commitHex = () => {
    if (hexValid) setAccent(draftHex);
  };

  return (
    <Card title="Theme" icon={<Palette />}>
      <div className="space-y-4">
        {/* Device name */}
        <div>
          <label className="block text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold mb-1.5">
            Device name
          </label>
          <div className="flex gap-2">
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              maxLength={24}
              placeholder="Forge"
              className="flex-1 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-sm px-3 h-8 text-[13px] font-mono focus:border-[var(--color-accent)] focus:outline-none"
            />
            <Button
              size="md"
              variant={dirty ? "primary" : "default"}
              disabled={!dirty}
              onClick={() => setName(draftName)}
            >
              Save
            </Button>
          </div>
          <div className="text-[10px] text-[var(--color-fg-muted)] mt-1.5">
            Shown in the top bar and browser tab.
          </div>
        </div>

        {/* Accent color */}
        <div>
          <label className="block text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold mb-1.5">
            Accent color
          </label>

          {/* Hex input + native color picker swatch */}
          <div className="flex gap-2 mb-2">
            <div className="relative">
              <input
                type="color"
                value={hexValid ? normalizeHex(draftHex) : accent}
                onChange={(e) => {
                  setDraftHex(e.target.value);
                  setAccent(e.target.value);
                }}
                className="absolute inset-0 w-8 h-8 opacity-0 cursor-pointer"
                title="Open color picker"
              />
              <div
                className="w-8 h-8 rounded-sm border border-[var(--color-border)] pointer-events-none"
                style={{ backgroundColor: hexValid ? normalizeHex(draftHex) : accent }}
              />
            </div>
            <input
              value={draftHex}
              onChange={(e) => setDraftHex(e.target.value)}
              onBlur={commitHex}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitHex();
                if (e.key === "Escape") setDraftHex(accent);
              }}
              placeholder="#f97316"
              spellCheck={false}
              className={cn(
                "flex-1 bg-[var(--color-elevated)] border rounded-sm px-3 h-8 text-[13px] font-mono uppercase tracking-wider focus:outline-none",
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
            >
              Apply
            </Button>
          </div>

          {/* Preset chips */}
          <div className="grid grid-cols-8 gap-1.5">
            {Object.entries(ACCENT_PRESETS).map(([key, hex]) => {
              const active = accent.toLowerCase() === hex.toLowerCase();
              return (
                <button
                  key={key}
                  onClick={() => setAccent(hex)}
                  className={cn(
                    "aspect-square rounded-md border-2 transition-all flex items-center justify-center",
                    active
                      ? "border-[var(--color-fg)] scale-105"
                      : "border-transparent hover:border-[var(--color-border-strong)]",
                  )}
                  style={{ backgroundColor: hex }}
                  title={`${key} · ${hex}`}
                >
                  {active && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
              );
            })}
          </div>
          <div className="text-[10px] text-[var(--color-fg-muted)] mt-1.5 font-mono">
            Current: {accent.toUpperCase()}
          </div>
        </div>
      </div>
    </Card>
  );
}
