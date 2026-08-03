/**
 * The single external-touching client. Every AI call in this app goes
 * through `ask()`; there is no second place that dials out.
 *
 * Contracts this module holds, in order of importance:
 *
 * 1. IT NEVER RETURNS EXECUTABLE OUTPUT. What comes back is prose for a human
 *    to read. `toDisplayProse` strips fenced code and drops anything shaped
 *    like a G-code line or a klipper macro call before the string is handed
 *    on. This is defence in depth, not the primary control — the primary
 *    control is that no caller parses, submits, or executes the return value,
 *    and that the ESLint fence in eslint.config.js makes it a BUILD FAILURE
 *    for anything under src/lib/ai/** to import moonraker or printerActions.
 *
 * 2. IT FAILS SILENTLY. No key, no endpoint, kill switch on, offline, HTTP
 *    error, timeout, rate limit, malformed body, empty answer — every one of
 *    them returns `null` and the caller renders nothing. No toast, no banner,
 *    no "AI unavailable" placeholder, no retry storm. The panel must look and
 *    behave exactly as it does with the feature switched off.
 *
 * 3. IT IS NEVER IN THE PRINT-CRITICAL PATH. Nothing about starting, running,
 *    pausing, or finishing a print may await one of these calls. Callers are
 *    user-initiated, one-shot, and after the fact.
 *
 * 4. ONE REQUEST IN FLIGHT. A second concurrent ask is refused rather than
 *    queued — a user hammering an explain button cannot become a fan-out.
 */

import { gatewayCredentials, type AiFeature } from "./flags";

/** Hard ceiling on a single call. A hung endpoint must not hang a panel. */
export const REQUEST_TIMEOUT_MS = 20_000;
/** Displayed prose is a paragraph, not a document. */
export const MAX_PROSE_CHARS = 900;

let inFlight = false;

export interface GatewayAsk {
  feature: AiFeature;
  system: string;
  user: string;
  maxTokens?: number;
}

/**
 * A line that could be pasted into a terminal and do something. Deliberately
 * broad: `G28`, `M104 S200`, `SET_PIN PIN=x VALUE=1`, `BED_MESH_CALIBRATE`.
 * False positives here cost a dropped sentence; false negatives cost the
 * whole point of the contract.
 */
function looksExecutable(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  if (/^[GMT]-?\d+\b/.test(text)) return true;
  if (/[.?!,:;]/.test(text)) return false; // it is a sentence, not a command
  return /^[A-Z][A-Z0-9_]*(?:[ \t]+[A-Z0-9_]+(?:=\S+)?)*$/.test(text);
}

/**
 * Reduce any model response to displayable prose, or `null` when nothing
 * displayable survives. Exported for direct unit testing — this function is
 * the written form of contract 1.
 */
export function toDisplayProse(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const withoutFences = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/```[\s\S]*$/, " ") // an unterminated fence: drop the tail too
    .replace(/`([^`]*)`/g, "$1");
  const kept = withoutFences
    .split("\n")
    .filter((line) => !looksExecutable(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!kept) return null;
  return kept.length > MAX_PROSE_CHARS
    ? `${kept.slice(0, MAX_PROSE_CHARS).trimEnd()}…`
    : kept;
}

/** Pull the assistant text out of either common response shape. */
function extractText(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;

  // OpenAI-compatible: { choices: [{ message: { content } }] }
  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const message = (choices[0] as Record<string, unknown> | undefined)?.message;
    const content = (message as Record<string, unknown> | undefined)?.content;
    if (typeof content === "string") return content;
  }

  // Anthropic-compatible: { content: [{ type: "text", text }] }
  const content = record.content;
  if (Array.isArray(content)) {
    const text = content
      .filter(
        (block): block is { text: string } =>
          typeof (block as { text?: unknown })?.text === "string",
      )
      .map((block) => block.text)
      .join("\n");
    if (text) return text;
  }

  return null;
}

/**
 * One prose answer, or `null`. See the four contracts above — in particular,
 * every failure mode is `null`, and callers must render nothing for it.
 */
export async function ask({
  feature,
  system,
  user,
  maxTokens = 400,
}: GatewayAsk): Promise<string | null> {
  const credentials = gatewayCredentials(feature);
  if (!credentials) return null;
  if (inFlight) return null;

  inFlight = true;
  try {
    const response = await fetch(credentials.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // The owner's own key, from their own browser, to their own endpoint.
        // It is never sent to the printer and never stored server-side.
        authorization: `Bearer ${credentials.key}`,
      },
      body: JSON.stringify({
        model: credentials.model || undefined,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return toDisplayProse(extractText(await response.json()));
  } catch {
    return null;
  } finally {
    inFlight = false;
  }
}
