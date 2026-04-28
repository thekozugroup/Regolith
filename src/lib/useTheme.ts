import { useEffect, useState } from "react";

const NAME_KEY = "forge.device.name";
const ACCENT_KEY = "forge.theme.accent";

/**
 * Quick-pick swatches. The accent itself is a free-form hex — these
 * are just convenience presets shown as chips alongside the hex input.
 */
export const ACCENT_PRESETS = {
  orange: "#f97316",
  amber: "#f59e0b",
  emerald: "#10b981",
  blue: "#3b82f6",
  violet: "#8b5cf6",
  rose: "#f43f5e",
  cyan: "#06b6d4",
  zinc: "#71717a",
} as const;

export type AccentPreset = keyof typeof ACCENT_PRESETS;

const HEX_RE = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

export function isValidHex(value: string): boolean {
  return HEX_RE.test(value.trim());
}

export function normalizeHex(value: string): string {
  const m = value.trim().match(HEX_RE);
  if (!m) return "#f97316";
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h.toLowerCase()}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Darken by ~12% — matches the visual relationship of the original presets. */
function darken(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.round(c * 0.85));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function applyAccent(hex: string): void {
  const root = document.documentElement;
  const [r, g, b] = hexToRgb(hex);
  root.style.setProperty("--color-accent", hex);
  root.style.setProperty("--color-accent-hover", darken(hex));
  root.style.setProperty("--accent-soft-r", hex);
  root.style.setProperty("--color-accent-rgb", `${r},${g},${b}`);
}

function loadStoredAccent(): string {
  const raw = localStorage.getItem(ACCENT_KEY);
  if (!raw) return ACCENT_PRESETS.orange;
  // Migrate legacy preset-name values
  if (raw in ACCENT_PRESETS) return ACCENT_PRESETS[raw as AccentPreset];
  return isValidHex(raw) ? normalizeHex(raw) : ACCENT_PRESETS.orange;
}

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
  const [accent, setAccentState] = useState<string>(() => loadStoredAccent());

  useEffect(() => applyAccent(accent), [accent]);

  useEffect(() => {
    const handler = (e: Event) => {
      const next = (e as CustomEvent<string>).detail;
      if (next !== accent) setAccentState(next);
    };
    window.addEventListener("forge:accent-changed", handler);
    return () => window.removeEventListener("forge:accent-changed", handler);
  }, [accent]);

  const setAccent = (next: string) => {
    if (!isValidHex(next)) return;
    const hex = normalizeHex(next);
    localStorage.setItem(ACCENT_KEY, hex);
    setAccentState(hex);
    window.dispatchEvent(
      new CustomEvent("forge:accent-changed", { detail: hex }),
    );
  };

  return [accent, setAccent] as const;
}
