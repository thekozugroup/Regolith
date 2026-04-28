/**
 * Profile registry + active-profile loader.
 *
 * Bundled profiles ship in the binary; user-supplied profiles uploaded
 * through Settings are persisted to localStorage. The active profile id
 * is also stored in localStorage so reloads remember the choice.
 *
 * Anywhere in the app that needs printer-shaped knowledge (heater limits,
 * sensor labels, klipper object names, macro buttons, camera path) reads
 * from `getActiveProfile()` rather than hardcoding K1 Max specifics.
 */
import { K1_MAX } from "./k1max";
import type { PrinterProfile } from "./types";

export type { PrinterProfile } from "./types";
export {
  type FanRole,
  type ProfileSensor,
  type ProfileTemperatureFan,
  type ProfileHeater,
  type ProfileMacro,
  type ProfileCamera,
  type ProfileFeatures,
} from "./types";

const BUILTIN: PrinterProfile[] = [K1_MAX];
const ACTIVE_KEY = "regolith.profile.active";
const CUSTOM_KEY = "regolith.profile.custom";
const CHANGE_EVENT = "regolith:profile-change";

function loadCustom(): PrinterProfile[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidProfile);
  } catch {
    return [];
  }
}

function saveCustom(list: PrinterProfile[]): void {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
}

/** Minimal runtime validation — enough to refuse obvious garbage uploads. */
export function isValidProfile(p: unknown): p is PrinterProfile {
  if (!p || typeof p !== "object") return false;
  const x = p as Partial<PrinterProfile>;
  return (
    typeof x.id === "string" &&
    typeof x.name === "string" &&
    Array.isArray(x.heaters) &&
    Array.isArray(x.sensors) &&
    Array.isArray(x.fans) &&
    Array.isArray(x.macros) &&
    typeof x.features === "object" &&
    x.schema === 1
  );
}

export function listProfiles(): PrinterProfile[] {
  return [...BUILTIN, ...loadCustom()];
}

export function getProfile(id: string): PrinterProfile | undefined {
  return listProfiles().find((p) => p.id === id);
}

export function getActiveProfileId(): string {
  return localStorage.getItem(ACTIVE_KEY) ?? K1_MAX.id;
}

export function getActiveProfile(): PrinterProfile {
  return getProfile(getActiveProfileId()) ?? K1_MAX;
}

export function setActiveProfile(id: string): void {
  if (!getProfile(id)) throw new Error(`Unknown profile: ${id}`);
  localStorage.setItem(ACTIVE_KEY, id);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function addCustomProfile(profile: PrinterProfile): void {
  if (!isValidProfile(profile)) throw new Error("Invalid profile");
  const custom = loadCustom().filter((p) => p.id !== profile.id);
  custom.push(profile);
  saveCustom(custom);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function removeCustomProfile(id: string): void {
  if (BUILTIN.some((p) => p.id === id)) {
    throw new Error("Cannot remove built-in profile");
  }
  saveCustom(loadCustom().filter((p) => p.id !== id));
  if (getActiveProfileId() === id) {
    localStorage.setItem(ACTIVE_KEY, K1_MAX.id);
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function isBuiltin(id: string): boolean {
  return BUILTIN.some((p) => p.id === id);
}

export function onProfileChange(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
}

/**
 * Klipper object names a profile cares about — used to build the
 * moonraker subscription field list dynamically.
 */
export function profileFields(profile: PrinterProfile): string[] {
  const base = [
    "print_stats",
    "idle_timeout",
    "toolhead",
    "display_status",
    "virtual_sdcard",
    "fan",
    "webhooks",
    "gcode_move",
    "motion_report",
  ];
  const heaters = profile.heaters.map((h) => h.klipper);
  const sensors = profile.sensors.map((s) => s.klipper);
  const fans = profile.fans.map((f) => f.klipper);
  return [...new Set([...base, ...heaters, ...sensors, ...fans])];
}
