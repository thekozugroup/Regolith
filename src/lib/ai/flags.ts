/**
 * Per-feature opt-in flags for the AI module. DEFAULT OFF, all of them.
 *
 * Same mechanism as src/lib/useExperienceMode.ts — localStorage plus a
 * CustomEvent plus a hook — deliberately, so there is exactly one config
 * pattern in this codebase rather than two.
 *
 * These features need an external API, therefore a user-supplied key,
 * therefore data leaving the LAN. That is a consent decision, not a
 * preference, so nothing here is on until the owner turns it on and supplies
 * their own endpoint and key. The key is held client-side only and is never
 * proxied through the printer.
 *
 * The calibrated remaining-time estimate and the thermal slope warnings are
 * NOT governed by this file and never will be: they are arithmetic over data
 * the printer already sends, they run entirely on the client, and calling
 * them AI would be marketing rather than description.
 */

import { useEffect, useState } from "react";

export type AiFeature = "explain" | "postmortem";

export const AI_FEATURES: readonly AiFeature[] = ["explain", "postmortem"];

const FEATURE_PREFIX = "forge.ai.feature.";
const ENDPOINT_KEY = "forge.ai.endpoint";
const API_KEY_KEY = "forge.ai.key";
const MODEL_KEY = "forge.ai.model";
/** Master kill switch. Set ⇒ every AI path is inert, immediately. */
const KILL_KEY = "forge.ai.disabled";
const CHANGE_EVENT = "forge:ai-settings-changed";

/** localStorage can throw (private mode, disabled storage). Never let it. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value == null || value === "") localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the feature simply stays off */
  }
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* no window (non-DOM context) — nothing to notify */
  }
}

export interface AiSettings {
  /** Master kill switch state. True ⇒ nothing may call out, at all. */
  killed: boolean;
  endpoint: string;
  model: string;
  /** Whether a key is stored. The key itself is never returned to the UI. */
  hasKey: boolean;
  enabled: Record<AiFeature, boolean>;
}

export function readAiSettings(): AiSettings {
  return {
    killed: read(KILL_KEY) === "1",
    endpoint: read(ENDPOINT_KEY) ?? "",
    model: read(MODEL_KEY) ?? "",
    hasKey: (read(API_KEY_KEY) ?? "").length > 0,
    enabled: {
      explain: read(`${FEATURE_PREFIX}explain`) === "1",
      postmortem: read(`${FEATURE_PREFIX}postmortem`) === "1",
    },
  };
}

export function setAiFeatureEnabled(feature: AiFeature, on: boolean): void {
  write(`${FEATURE_PREFIX}${feature}`, on ? "1" : null);
}

export function setAiEndpoint(endpoint: string): void {
  write(ENDPOINT_KEY, endpoint.trim());
}

export function setAiModel(model: string): void {
  write(MODEL_KEY, model.trim());
}

export function setAiKey(key: string): void {
  write(API_KEY_KEY, key.trim());
}

/**
 * Kill switch. Takes effect on the NEXT call rather than on the next
 * interval, because every AI call reads this immediately before dialling.
 */
export function setAiKilled(killed: boolean): void {
  write(KILL_KEY, killed ? "1" : null);
}

export interface GatewayCredentials {
  endpoint: string;
  key: string;
  model: string;
}

/**
 * Everything the gateway needs to make one call, or `null` when any part is
 * missing, malformed, or switched off. `null` is the normal answer: the
 * feature renders nothing and the panel looks exactly as it does today.
 */
export function gatewayCredentials(
  feature: AiFeature,
): GatewayCredentials | null {
  const settings = readAiSettings();
  if (settings.killed) return null;
  if (!settings.enabled[feature]) return null;
  const key = read(API_KEY_KEY) ?? "";
  if (!key || !settings.endpoint) return null;
  if (!isCallableEndpoint(settings.endpoint)) return null;
  return { endpoint: settings.endpoint, key, model: settings.model };
}

/** An endpoint must be an absolute http(s) URL — nothing else is dialled. */
export function isCallableEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** True when `feature` could produce output right now. Cheap; call freely. */
export function aiFeatureReady(feature: AiFeature): boolean {
  return gatewayCredentials(feature) !== null;
}

/** Subscribe to settings changes (storage events included, for other tabs). */
export function onAiSettingsChange(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

/** Live settings snapshot — same shape as the useExperienceMode hook. */
export function useAiSettings(): AiSettings {
  const [settings, setSettings] = useState<AiSettings>(readAiSettings);
  useEffect(() => onAiSettingsChange(() => setSettings(readAiSettings())), []);
  return settings;
}

/**
 * Whether a feature's affordance may be rendered at all. False is the shipped
 * default and means the control does not exist — not a disabled control, not
 * a placeholder, nothing.
 */
export function useAiFeatureReady(feature: AiFeature): boolean {
  const settings = useAiSettings();
  return (
    !settings.killed &&
    settings.enabled[feature] &&
    settings.hasKey &&
    isCallableEndpoint(settings.endpoint)
  );
}
