import { useState } from "react";
import { Card } from "./Card";
import { Button } from "./Button";
import { Palette, Check } from "lucide-react";
import { useDeviceName, useAccent, ACCENT_PRESETS } from "@/lib/useTheme";
import type { AccentName } from "@/lib/useTheme";
import { cn } from "@/lib/utils";

export function ThemeSettings() {
  const [name, setName] = useDeviceName();
  const [accent, setAccent] = useAccent();
  const [draftName, setDraftName] = useState(name);
  const dirty = draftName !== name;

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
          <div className="grid grid-cols-8 gap-1.5">
            {(Object.entries(ACCENT_PRESETS) as [AccentName, { base: string }][]).map(
              ([key, p]) => {
                const active = accent === key;
                return (
                  <button
                    key={key}
                    onClick={() => setAccent(key)}
                    className={cn(
                      "aspect-square rounded-md border-2 transition-all flex items-center justify-center",
                      active
                        ? "border-[var(--color-fg)] scale-105"
                        : "border-transparent hover:border-[var(--color-border-strong)]",
                    )}
                    style={{ backgroundColor: p.base }}
                    title={key}
                  >
                    {active && <Check className="w-3.5 h-3.5 text-white" />}
                  </button>
                );
              },
            )}
          </div>
          <div className="text-[10px] text-[var(--color-fg-muted)] mt-1.5 capitalize">
            Current: {accent}
          </div>
        </div>
      </div>
    </Card>
  );
}
