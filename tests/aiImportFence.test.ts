import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadESLint } from "eslint";

/**
 * S5 hard rule 1, mechanically enforced: nothing under src/lib/ai may reach
 * the printer. Two independent proofs, because either alone has a hole.
 *
 *   1. The ESLint fence actually FIRES. A rule nobody has seen fail is a rule
 *      that might be misconfigured; this lints a violating file through the
 *      real config and asserts the error, with a negative control outside the
 *      fenced directory so a rule that errored everywhere would be caught.
 *   2. The TRANSITIVE import graph is clean. ESLint only sees direct import
 *      specifiers, so an innocent-looking helper that itself imports
 *      moonraker would slip past it. This walks the whole closure.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AI_DIR = join(ROOT, "src/lib/ai");
const FORBIDDEN = ["moonraker", "printerActions", "safety"];
const VIOLATION = 'import { moonraker } from "@/lib/moonraker";\nexport const m = moonraker;\n';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** Every `from "..."` specifier in a source file. */
function importsOf(path: string): string[] {
  const source = readFileSync(path, "utf8");
  return [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]!);
}

/** Resolve an app-local specifier to a file on disk, or null for a package. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(ROOT, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return null; // bare package — react, lucide-react, …

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

describe("AI import fence — the ESLint rule fires", () => {
  it("rejects a printer import inside src/lib/ai", async () => {
    const ESLint = await loadESLint({ useFlatConfig: true });
    const eslint = new ESLint({ cwd: ROOT });
    const [result] = await eslint.lintText(VIOLATION, {
      filePath: join(AI_DIR, "__fence_probe__.ts"),
    });
    const restricted = result!.messages.filter(
      (m) => m.ruleId === "no-restricted-imports",
    );
    expect(restricted.length).toBeGreaterThan(0);
    expect(restricted[0]!.severity, "must be an error, not a warning").toBe(2);
    expect(restricted[0]!.message).toContain("never reach the printer");
  });

  it("does not restrict the same import elsewhere in the app", async () => {
    // Negative control: a rule that errored on every file would pass the
    // assertion above while telling us nothing about the fence.
    const ESLint = await loadESLint({ useFlatConfig: true });
    const eslint = new ESLint({ cwd: ROOT });
    const [result] = await eslint.lintText(VIOLATION, {
      filePath: join(ROOT, "src/lib/__fence_control__.ts"),
    });
    expect(
      result!.messages.filter((m) => m.ruleId === "no-restricted-imports"),
    ).toEqual([]);
  });
});

describe("AI import fence — the transitive graph is clean", () => {
  it("has AI modules to check at all", () => {
    expect(sourceFiles(AI_DIR).length).toBeGreaterThan(0);
  });

  it("never reaches moonraker, printerActions or safety through any hop", () => {
    const seen = new Set<string>();
    const queue = sourceFiles(AI_DIR);
    const trail = new Map<string, string>();

    while (queue.length > 0) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const specifier of importsOf(file)) {
        const resolved = resolveLocal(specifier, file);
        if (!resolved || seen.has(resolved)) continue;
        trail.set(resolved, file);
        queue.push(resolved);
      }
    }

    for (const file of seen) {
      const forbidden = FORBIDDEN.find((name) =>
        file.endsWith(`/src/lib/${name}.ts`),
      );
      expect(
        forbidden,
        `${file} is reachable from src/lib/ai via ${trail.get(file) ?? "itself"}`,
      ).toBeUndefined();
    }
  });

  it("never names a printer-mutating method anywhere in the AI module", () => {
    const mutators = [
      "runGcode",
      "startPrint",
      "emergencyStop",
      "firmwareRestart",
      "runPrinterAction",
      "guardPrinterAction",
    ];
    for (const file of sourceFiles(AI_DIR)) {
      const source = readFileSync(file, "utf8");
      // Comments are where the rule is EXPLAINED, so strip them first.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const mutator of mutators) {
        expect(code, `${file} names ${mutator}`).not.toContain(mutator);
      }
    }
  });
});
