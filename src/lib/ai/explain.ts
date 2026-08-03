/**
 * (d-1) Explain a klipper response line or a stopped-job reason, in prose.
 *
 * Structurally incapable of producing a command: the output is rendered as
 * text and nothing reads it back. There is no generate half — turning natural
 * language into G-code was rejected outright, and no code path here places
 * anything in an input field or pre-authorises a confirmation.
 *
 * User-initiated and one-shot. The gcode log is never streamed anywhere; a
 * single line goes out only when the owner presses the button on that line.
 */

import { ask } from "./gateway";

const SYSTEM = [
  "You explain 3D printer firmware messages to a home user of a Creality K1 Max running Klipper.",
  "Answer in at most three short sentences of plain English prose.",
  "Say what the message means and what is worth checking.",
  "Never output G-code, macro names, commands, or code blocks of any kind.",
  "If you are unsure, say so plainly rather than guessing.",
].join(" ");

/** Worth offering an explanation for? Bare acknowledgements are not. */
export function isExplainable(line: string | null | undefined): boolean {
  const text = (line ?? "").trim();
  if (text.length < 3) return false;
  if (/^(ok|ok\b.*)$/i.test(text) && text.length < 8) return false;
  return true;
}

/**
 * Prose gloss for one klipper line, or `null` — feature off, no key, offline,
 * API error, or nothing displayable came back. `null` means render nothing.
 */
export async function explainKlipperLine(
  line: string,
): Promise<string | null> {
  if (!isExplainable(line)) return null;
  return ask({
    feature: "explain",
    system: SYSTEM,
    user: `Explain this message from my 3D printer:\n\n${line.slice(0, 800)}`,
    maxTokens: 220,
  });
}
