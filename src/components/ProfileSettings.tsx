import { useRef, useState } from "react";
import { Boxes, Upload, Download, Trash2, Check } from "lucide-react";
import { Card } from "./Card";
import { Button } from "./Button";
import {
  addCustomProfile,
  getActiveProfileId,
  isBuiltin,
  isValidProfile,
  removeCustomProfile,
  setActiveProfile,
} from "@/profiles";
import { useProfile, useProfileList } from "@/lib/useProfile";
import { cn } from "@/lib/utils";

/**
 * Printer profile picker + uploader.
 *
 * A profile is a JSON description of a printer's heaters, sensors,
 * temperature fans, macros, and feature flags. Switching profiles
 * re-subscribes the moonraker WebSocket to the right klipper objects
 * and re-keys the dashboard's aux sensor list. Supporting a new
 * printer is a config change, not a code change.
 */
export function ProfileSettings() {
  const profile = useProfile();
  const profiles = useProfileList();
  const activeId = getActiveProfileId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);

  const exportActive = () => {
    const blob = new Blob([JSON.stringify(profile, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${profile.id}.profile.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File) => {
    setError(null);
    setImported(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!isValidProfile(parsed)) {
        setError("File is not a valid printer profile (schema check failed).");
        return;
      }
      addCustomProfile(parsed);
      setImported(parsed.name);
      setActiveProfile(parsed.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read file");
    }
  };

  return (
    <Card title="Printer Profile" icon={<Boxes />}>
      <div className="space-y-2">
        <div className="text-[11px] text-[var(--color-fg-muted)] leading-relaxed">
          A profile defines your printer's heaters, sensors, fans, and
          macros. Upload a JSON profile to support a different printer
          without code changes.
        </div>

        <div className="space-y-1">
          {profiles.map((p) => {
            const active = p.id === activeId;
            const builtin = isBuiltin(p.id);
            return (
              <div
                key={p.id}
                className={cn(
                  "flex items-center justify-between px-2 py-1.5 rounded-sm border text-[12px]",
                  active
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/8"
                    : "border-[var(--color-border)] bg-[var(--color-elevated)]/30",
                )}
              >
                <button
                  type="button"
                  className="flex-1 text-left flex items-center gap-2"
                  onClick={() => setActiveProfile(p.id)}
                >
                  <span
                    className={cn(
                      "w-3 h-3 flex items-center justify-center",
                      active && "text-[var(--color-accent)]",
                    )}
                  >
                    {active && <Check className="w-3 h-3" />}
                  </span>
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-[10px] text-[var(--color-fg-muted)] font-mono">
                      {p.id}
                      {builtin ? " · built-in" : " · custom"}
                    </div>
                  </div>
                </button>
                {!builtin && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeCustomProfile(p.id)}
                    title="Remove custom profile"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 pt-2 border-t border-[rgba(63,63,70,0.4)]">
          <Button size="sm" variant="default" onClick={() => fileInput.current?.click()}>
            <Upload className="w-3 h-3" /> Upload profile
          </Button>
          <Button size="sm" variant="default" onClick={exportActive}>
            <Download className="w-3 h-3" /> Export active
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {imported && (
          <div className="text-[11px] text-[var(--color-accent)]">
            Imported "{imported}" and set as active.
          </div>
        )}
        {error && (
          <div className="text-[11px] text-[var(--color-error)]">{error}</div>
        )}
      </div>
    </Card>
  );
}
