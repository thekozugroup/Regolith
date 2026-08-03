import { useEffect, useState } from "react";

const NAME_KEY = "forge.device.name";
const ACCENT_KEY = "forge.theme.accent";

/**
 * The designed default accent (Regolith amber). Single source of truth —
 * `--color-accent` in src/index.css must stay byte-identical to this value.
 * Enforced by tests/accentDefault.test.ts so the two can never drift again.
 */
export const DEFAULT_ACCENT = "#f7a224";

/**
 * Quick-pick swatches. The accent itself is a free-form hex — these
 * are just convenience presets shown as chips alongside the hex input.
 * The designed default comes first so it is reachable as a one-click reset.
 */
export const ACCENT_PRESETS = {
  amber: DEFAULT_ACCENT,
  orange: "#f97316",
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
  if (!m) return DEFAULT_ACCENT;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h.toLowerCase()}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(a: string, b: string): number {
  const light = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (light + 0.05) / (dark + 0.05);
}

const DARK_ACTION_TEXT = "#120b07";
const LIGHT_ACTION_TEXT = "#fff8f1";

export function getAccessibleAccentForeground(hex: string): string {
  return contrastRatio(hex, DARK_ACTION_TEXT) >=
    contrastRatio(hex, LIGHT_ACTION_TEXT)
    ? DARK_ACTION_TEXT
    : LIGHT_ACTION_TEXT;
}

function mixHex(a: string, b: string, amount: number): string {
  const first = hexToRgb(a);
  const second = hexToRgb(b);
  const mixed = first.map((value, index) =>
    Math.round(value + (second[index] - value) * amount),
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The tokens applyAccent() writes for a given accent, exported so tests can
 * pin the CSS defaults in src/index.css to the exact same values.
 */
export function computeAccentTokens(hex: string): {
  accent: string;
  fg: string;
  hover: string;
} {
  const fg = getAccessibleAccentForeground(hex);
  return {
    accent: hex,
    fg,
    hover: mixHex(
      hex,
      fg === DARK_ACTION_TEXT ? LIGHT_ACTION_TEXT : DARK_ACTION_TEXT,
      0.12,
    ),
  };
}

function applyAccent(hex: string): void {
  const root = document.documentElement;
  const tokens = computeAccentTokens(hex);
  root.style.setProperty("--color-accent", tokens.accent);
  root.style.setProperty("--color-accent-fg", tokens.fg);
  root.style.setProperty("--color-accent-hover", tokens.hover);
}

function loadStoredAccent(): string {
  const raw = localStorage.getItem(ACCENT_KEY);
  if (!raw) return DEFAULT_ACCENT;
  // Migrate legacy preset-name values
  if (raw in ACCENT_PRESETS) return ACCENT_PRESETS[raw as AccentPreset];
  return isValidHex(raw) ? normalizeHex(raw) : DEFAULT_ACCENT;
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

/**
 * Apply the persisted accent to the document root. Called once at boot
 * (main.tsx) so the user's accent survives reloads on every route —
 * `useAccent()` only runs while Settings is mounted.
 */
export function applyStoredAccent(): void {
  applyAccent(loadStoredAccent());
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
