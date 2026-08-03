import { useState } from "react";
import { Check, ShieldAlert, Sparkles } from "lucide-react";
import { Card } from "./Card";
import { Button } from "./Button";
import {
  AI_FEATURES,
  isCallableEndpoint,
  setAiEndpoint,
  setAiFeatureEnabled,
  setAiKey,
  setAiKilled,
  setAiModel,
  useAiSettings,
  type AiFeature,
} from "@/lib/ai/flags";
import { cn } from "@/lib/utils";

const DESCRIPTIONS: Record<AiFeature, { title: string; description: string }> = {
  explain: {
    title: "Explain messages",
    description:
      "Adds a button that sends one console line or stop reason for a plain-English explanation.",
  },
  postmortem: {
    title: "Failure post-mortem",
    description:
      "After a failed print, shows you an excerpt of klippy.log and lets you send it for a read-back.",
  },
};

/**
 * Opt-in panel for the assistant features. Everything here is OFF until the
 * owner fills in their own endpoint and key, because these are the only
 * features in the app that send anything outside the local network.
 *
 * The copy states plainly what leaves the LAN, and states just as plainly
 * that the calibrated time estimate and the thermal warnings are NOT part of
 * this — they are arithmetic on the printer's own telemetry, they run on the
 * client, and no toggle here affects them. Calling them AI would be marketing.
 */
export function AiSettings() {
  const settings = useAiSettings();
  const [endpoint, setEndpointDraft] = useState(settings.endpoint);
  const [model, setModelDraft] = useState(settings.model);
  const [key, setKeyDraft] = useState("");
  const [saved, setSaved] = useState(false);

  const endpointValid = endpoint.trim() === "" || isCallableEndpoint(endpoint.trim());
  const configured = settings.hasKey && isCallableEndpoint(settings.endpoint);

  const save = () => {
    setAiEndpoint(endpoint);
    setAiModel(model);
    if (key.trim()) setAiKey(key);
    setKeyDraft("");
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2_000);
  };

  return (
    <Card title="Assistant" icon={<Sparkles />} className="lg:col-span-2">
      <p className="text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
        Optional, off by default, and the only part of Regolith that sends
        anything off your network. It needs your own API endpoint and key,
        both stored in this browser only and never sent to the printer. Output
        is text you read — it can never move, heat, or command the machine.
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-fg-subtle)]">
        The calibrated time remaining and the thermal warnings are not part of
        this. They are arithmetic on your printer's own data, they run here in
        the browser, and they stay on whatever you choose below.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-[var(--color-fg-muted)]">
            API endpoint
          </span>
          <input
            type="url"
            inputMode="url"
            value={endpoint}
            onChange={(event) => setEndpointDraft(event.target.value)}
            placeholder="https://…/v1/chat/completions"
            spellCheck={false}
            className={cn(
              "min-h-11 rounded-inner border bg-[var(--color-elevated)] px-3 text-[13px] font-mono focus:border-[var(--color-accent)] focus:outline-none",
              endpointValid
                ? "border-[var(--color-border)]"
                : "border-[var(--color-error)]",
            )}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-[var(--color-fg-muted)]">
            Model
          </span>
          <input
            type="text"
            value={model}
            onChange={(event) => setModelDraft(event.target.value)}
            placeholder="optional"
            spellCheck={false}
            className="min-h-11 rounded-inner border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 text-[13px] font-mono focus:border-[var(--color-accent)] focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-[var(--color-fg-muted)]">
            API key {settings.hasKey && "(stored — type to replace)"}
          </span>
          <input
            type="password"
            value={key}
            onChange={(event) => setKeyDraft(event.target.value)}
            placeholder={settings.hasKey ? "••••••••" : "your key"}
            autoComplete="off"
            spellCheck={false}
            className="min-h-11 rounded-inner border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 text-[13px] font-mono focus:border-[var(--color-accent)] focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="md" variant="primary" disabled={!endpointValid} onClick={save}>
          Save
        </Button>
        {saved && (
          <span role="status" className="text-[11px] text-[var(--color-success)]">
            Saved.
          </span>
        )}
        {!endpointValid && (
          <span className="text-[11px] text-[var(--color-error)]">
            Endpoint must be a full http or https URL.
          </span>
        )}
      </div>

      <fieldset className="mt-3" disabled={!configured}>
        <legend className="sr-only">Assistant features</legend>
        <div className={cn("grid gap-2 sm:grid-cols-2", !configured && "opacity-60")}>
          {AI_FEATURES.map((feature) => {
            const on = settings.enabled[feature] && !settings.killed;
            return (
              <button
                key={feature}
                type="button"
                aria-pressed={on}
                onClick={() => setAiFeatureEnabled(feature, !settings.enabled[feature])}
                className={cn(
                  "min-h-20 rounded-inner border p-3 text-left transition-[background,border-color,color]",
                  on
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                    : "border-[var(--color-border)] bg-[var(--color-elevated)]/35 hover:border-[var(--color-border-strong)]",
                )}
              >
                <span className="flex items-center gap-2 text-[13px] font-semibold">
                  <span
                    className={cn(
                      "inline-flex h-5 w-5 items-center justify-center rounded-full border",
                      on
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                        : "border-[var(--color-border-strong)]",
                    )}
                  >
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  {DESCRIPTIONS[feature].title}
                  <span className="ml-auto text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
                    {on ? "On" : "Off"}
                  </span>
                </span>
                <span className="mt-1.5 block text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
                  {DESCRIPTIONS[feature].description}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-3 flex flex-wrap items-start gap-2 text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
        <ShieldAlert
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0",
            settings.killed
              ? "text-[var(--color-error)]"
              : "text-[var(--color-success)]",
          )}
        />
        <span className="min-w-0 flex-1">
          {settings.killed
            ? "Everything is switched off. No request can leave this browser until you turn it back on."
            : "Camera images are never sent anywhere. There is no code path in Regolith that uploads a frame."}
        </span>
        <Button
          size="sm"
          variant={settings.killed ? "default" : "danger"}
          onClick={() => setAiKilled(!settings.killed)}
        >
          {settings.killed ? "Re-enable" : "Turn everything off"}
        </Button>
      </div>
    </Card>
  );
}
