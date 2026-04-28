import { useEffect, useState } from "react";

const NAME_KEY = "forge.device.name";
const ACCENT_KEY = "forge.theme.accent";

const PRESETS = {
  orange: { base: "#f97316", hover: "#ea580c", soft: "rgba(249,115,22," },
  amber: { base: "#f59e0b", hover: "#d97706", soft: "rgba(245,158,11," },
  emerald: { base: "#10b981", hover: "#059669", soft: "rgba(16,185,129," },
  blue: { base: "#3b82f6", hover: "#2563eb", soft: "rgba(59,130,246," },
  violet: { base: "#8b5cf6", hover: "#7c3aed", soft: "rgba(139,92,246," },
  rose: { base: "#f43f5e", hover: "#e11d48", soft: "rgba(244,63,94," },
  cyan: { base: "#06b6d4", hover: "#0891b2", soft: "rgba(6,182,212," },
  zinc: { base: "#71717a", hover: "#52525b", soft: "rgba(113,113,122," },
} as const;

export type AccentName = keyof typeof PRESETS;
export const ACCENT_PRESETS = PRESETS;

export function useDeviceName() {
  const [name, setName] = useState(() => {
    return localStorage.getItem(NAME_KEY) ?? "Forge";
  });
  useEffect(() => {
    const handler = (e: Event) => {
      const next = (e as CustomEvent<string>).detail;
      if (next !== name) setName(next);
    };
    window.addEventListener("forge:device-name-changed", handler);
    return () => window.removeEventListener("forge:device-name-changed", handler);
  }, [name]);

  const update = (next: string) => {
    const trimmed = next.trim() || "Forge";
    localStorage.setItem(NAME_KEY, trimmed);
    setName(trimmed);
    window.dispatchEvent(
      new CustomEvent("forge:device-name-changed", { detail: trimmed }),
    );
  };

  return [name, update] as const;
}

export function useAccent() {
  const [accent, setAccentState] = useState<AccentName>(() => {
    const v = localStorage.getItem(ACCENT_KEY) as AccentName | null;
    return v && PRESETS[v] ? v : "orange";
  });

  // Apply CSS variables on change
  useEffect(() => {
    const p = PRESETS[accent];
    const root = document.documentElement;
    root.style.setProperty("--color-accent", p.base);
    root.style.setProperty("--color-accent-hover", p.hover);
    root.style.setProperty("--accent-soft-r", p.base);
  }, [accent]);

  // Sync across instances
  useEffect(() => {
    const handler = (e: Event) => {
      const next = (e as CustomEvent<AccentName>).detail;
      if (next !== accent) setAccentState(next);
    };
    window.addEventListener("forge:accent-changed", handler);
    return () => window.removeEventListener("forge:accent-changed", handler);
  }, [accent]);

  const setAccent = (next: AccentName) => {
    localStorage.setItem(ACCENT_KEY, next);
    setAccentState(next);
    window.dispatchEvent(
      new CustomEvent("forge:accent-changed", { detail: next }),
    );
  };

  return [accent, setAccent] as const;
}
