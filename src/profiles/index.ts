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
import {
  readStored,
  readStoredJson,
  writeStored,
  writeStoredJson,
} from "../lib/safeStorage";
import type { PrinterProfile } from "./types";

export type { PrinterProfile } from "./types";
export {
  type FanRole,
  type ProfileSensor,
  type ProfileTemperatureFan,
  type ProfileFilamentSensor,
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
  // Element-wise validation, deliberately: one corrupt entry in an imported
  // backup must cost the owner that one profile, not every custom profile
  // they ever added.
  const parsed = readStoredJson<unknown[]>(CUSTOM_KEY, Array.isArray, []);
  return parsed.filter(isValidProfile);
}

function saveCustom(list: PrinterProfile[]): void {
  writeStoredJson(CUSTOM_KEY, list);
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
  // Only an id that still resolves to a real profile counts. A pointer to a
  // profile that was deleted, renamed, or never existed used to be handed
  // straight to `getProfile`, which answered `undefined` — every field the UI
  // reads off the profile then read off nothing.
  const stored = readStored(ACTIVE_KEY);
  if (stored && listProfiles().some((p) => p.id === stored)) return stored;
  return K1_MAX.id;
}

export function getActiveProfile(): PrinterProfile {
  return getProfile(getActiveProfileId()) ?? K1_MAX;
}

export function setActiveProfile(id: string): void {
  if (!getProfile(id)) throw new Error(`Unknown profile: ${id}`);
  writeStored(ACTIVE_KEY, id);
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
    writeStored(ACTIVE_KEY, K1_MAX.id);
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

export interface ProfileFieldsOptions {
  /**
   * Include `motion_report`. It streams live position at Moonraker's full
   * batch cadence, so it is claimed only while something renders it —
   * Control's live-position readout and the Dashboard expert "Live Vel."
   * tile (WP-PERF). Progress comes from `virtual_sdcard`; the old
   * `display_status` subscription had no reader and was dropped outright.
   */
  motion?: boolean;
}

/**
 * Klipper object names a profile cares about — used to build the
 * moonraker subscription field list dynamically.
 */
export function profileFields(
  profile: PrinterProfile,
  opts: ProfileFieldsOptions = {},
): string[] {
  const base = [
    "print_stats",
    "idle_timeout",
    "toolhead",
    "virtual_sdcard",
    "fan",
    "webhooks",
    "gcode_move",
    // MESH ACTIVE tell-tale: profile_name is the only proof a mesh is loaded.
    "bed_mesh",
  ];
  if (opts.motion) base.push("motion_report");
  const heaters = profile.heaters.map((h) => h.klipper);
  const sensors = profile.sensors.map((s) => s.klipper);
  const fans = profile.fans.map((f) => f.klipper);
  // Runout switches ride the same declare-to-subscribe path as heaters and
  // sensors — profiles without them (K1 Max base) add no subscription.
  const filament = (profile.filamentSensors ?? []).map((s) => s.klipper);
  return [...new Set([...base, ...heaters, ...sensors, ...fans, ...filament])];
}
