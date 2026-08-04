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
  // drifted apart (a legacy #f7a224 vs #f97316), and the JS value — applied
  // as an inline style on <html> — silently won on every fresh profile. These
  // assertions make any future drift a test failure instead of a shipped bug.
  test("CSS --color-accent matches DEFAULT_ACCENT exactly", () => {
    expect(cssToken("--color-accent")).toBe(DEFAULT_ACCENT);
  });

  test("CSS accent-fg / accent-hover match what applyAccent() computes", () => {
    const tokens = computeAccentTokens(DEFAULT_ACCENT);
    expect(cssToken("--color-accent-fg")).toBe(tokens.fg);
    expect(cssToken("--color-accent-hover")).toBe(tokens.hover);
  });

  test("the e2e accent spec pins the same default, not a stale copy", () => {
    // e2e/accent.spec.ts duplicates the literal (it cannot import app code at
    // collection time without coupling Playwright to the Vite graph). That
    // copy is exactly the drift shape this suite exists to prevent, so pin it.
    const spec = readFileSync(
      join(import.meta.dir, "../e2e/accent.spec.ts"),
      "utf8",
    );
    const match = spec.match(/const DEFAULT_ACCENT = "(#[0-9a-f]{6})"/);
    if (!match) throw new Error("DEFAULT_ACCENT literal not found in e2e/accent.spec.ts");
    expect(match[1]).toBe(DEFAULT_ACCENT);
  });

  test("the designed default is reachable as a preset chip", () => {
    expect(ACCENT_PRESETS.amber).toBe(DEFAULT_ACCENT);
  });

  test("no accent surface hardcodes the legacy orange rgba literal", () => {
    // rgba(249,115,22,…) surfaces do not follow the runtime accent; they must
    // use the --color-accent-soft/-faint/-edge tokens instead. The proximity
    // regex also catches the split-numeric form the substring check missed:
    // BedMeshHeatmap once rebuilt 249/115/22 across three arithmetic
    // expressions and shipped the legacy orange anyway.
    const legacyOrange = /\b249\b[\s\S]{0,120}?\b115\b[\s\S]{0,120}?\b22\b/;
    const offenders = walk(SRC_DIR).filter((file) => {
      const text = readFileSync(file, "utf8");
      return text.includes("249,115,22") || legacyOrange.test(text);
    });
    expect(offenders).toEqual([]);
  });

  test("no component builds raw rgb()/rgba() color strings", () => {
    // Every rgb()/rgba() ever found in src was a stale Tailwind v3 literal
    // that ignored both the theme and the runtime accent. Colors must come
    // from tokens (var(--color-*)) or color-mix over tokens — never from
    // hand-assembled channel numbers a grep for hex can't see.
    const offenders = walk(SRC_DIR).filter(
      (file) =>
        /\.tsx?$/.test(file) && /\brgba?\(/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  test("the favicon strokes the designed accent, not the legacy orange", () => {
    // public/ sits outside the src walk above, and the favicon shipped the
    // legacy #f97316 long after the app moved to the amber default. The tab
    // icon is part of the brand surface; pin it to DEFAULT_ACCENT.
    const favicon = readFileSync(
      join(import.meta.dir, "../public/favicon.svg"),
      "utf8",
    );
    expect(favicon).not.toContain("#f97316");
    expect(favicon).toContain(DEFAULT_ACCENT);
  });

  test("every color-mix interpolates in a rectangular space, never oklch", () => {
    // Mixing in a polar space drags hues through arcs they were never meant
    // to cross (see the mixing-law comment on --color-accent-soft in
    // index.css — the law's canonical home now that the glow it corrected is
    // deleted). Raw oklch() literals are fine — it is only INTERPOLATION
    // that must stay oklab.
    const polarMix = /color-mix\(\s*in[_ ]+oklch/i;
    const offenders = walk(SRC_DIR).filter((file) =>
      polarMix.test(readFileSync(file, "utf8")),
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
