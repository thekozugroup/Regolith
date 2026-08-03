import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  computeAccentTokens,
} from "../src/lib/useTheme";

const SRC_DIR = join(import.meta.dir, "../src");
const css = readFileSync(join(SRC_DIR, "index.css"), "utf8");

function cssToken(name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`${name} not found in src/index.css`);
  return match[1].trim();
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(tsx?|css)$/.test(entry) ? [full] : [];
  });
}

describe("default accent single source of truth", () => {
  // The initial-load bug: the CSS design default and the JS boot fallback
  // drifted apart (#f7a224 vs #f97316), and the JS value — applied as an
  // inline style on <html> — silently won on every fresh profile. These
  // assertions make any future drift a test failure instead of a shipped bug.
  test("CSS --color-accent matches DEFAULT_ACCENT exactly", () => {
    expect(cssToken("--color-accent")).toBe(DEFAULT_ACCENT);
  });

  test("CSS accent-fg / accent-hover match what applyAccent() computes", () => {
    const tokens = computeAccentTokens(DEFAULT_ACCENT);
    expect(cssToken("--color-accent-fg")).toBe(tokens.fg);
    expect(cssToken("--color-accent-hover")).toBe(tokens.hover);
  });

  test("the designed default is reachable as a preset chip", () => {
    expect(ACCENT_PRESETS.amber).toBe(DEFAULT_ACCENT);
  });

  test("no accent surface hardcodes the legacy orange rgba literal", () => {
    // rgba(249,115,22,…) surfaces do not follow the runtime accent; they must
    // use the --color-accent-soft/-faint/-edge tokens instead.
    const offenders = walk(SRC_DIR).filter((file) =>
      readFileSync(file, "utf8").includes("249,115,22"),
    );
    expect(offenders).toEqual([]);
  });

  test("accent-derived surface tokens exist and derive from the live accent", () => {
    for (const name of [
      "--color-accent-soft",
      "--color-accent-faint",
      "--color-accent-edge",
    ]) {
      expect(cssToken(name)).toContain("var(--color-accent)");
    }
  });
});
