import { describe, expect, it } from "bun:test";
import { ask, toDisplayProse } from "../src/lib/ai/gateway";
import { isCallableEndpoint } from "../src/lib/ai/flags";
import { isExplainable } from "../src/lib/ai/explain";
import { excerptKlippyLog, EXCERPT_LINES } from "../src/lib/ai/postmortem";

describe("gateway — never returns executable output", () => {
  it("keeps ordinary prose intact", () => {
    const prose =
      "Your hotend stopped gaining heat while the heater was at full power. Check the thermistor wiring.";
    expect(toDisplayProse(prose)).toBe(prose);
  });

  it("strips fenced code blocks entirely", () => {
    const answer = "Home the printer first.\n\n```\nG28\nG1 Z10 F600\n```\n\nThen retry.";
    const prose = toDisplayProse(answer)!;
    expect(prose).toContain("Home the printer first.");
    expect(prose).toContain("Then retry.");
    expect(prose).not.toContain("G28");
    expect(prose).not.toContain("G1 Z10");
  });

  it("strips an unterminated fence rather than leaking its tail", () => {
    const prose = toDisplayProse("Try this:\n```\nBED_MESH_CALIBRATE\nSAVE_CONFIG");
    expect(prose).not.toContain("BED_MESH_CALIBRATE");
    expect(prose).not.toContain("SAVE_CONFIG");
  });

  it("drops bare command lines even outside a fence", () => {
    const prose = toDisplayProse(
      "Run the homing sequence.\nG28\nM104 S200\nSET_PIN PIN=ADAPTIVE_BED_MESH VALUE=1\nThen check the nozzle.",
    )!;
    expect(prose).toContain("Run the homing sequence.");
    expect(prose).toContain("Then check the nozzle.");
    for (const command of ["G28", "M104", "SET_PIN", "ADAPTIVE_BED_MESH"]) {
      expect(prose).not.toContain(command);
    }
  });

  it("does not mangle sentences that merely mention a macro", () => {
    const sentence =
      "Klipper reported that PRINT_START never finished, which usually means the bed never reached its target.";
    expect(toDisplayProse(sentence)).toBe(sentence);
  });

  it("returns null when nothing displayable survives", () => {
    expect(toDisplayProse("```\nG28\n```")).toBeNull();
    expect(toDisplayProse("G28\nM112")).toBeNull();
    expect(toDisplayProse("   \n\n  ")).toBeNull();
    expect(toDisplayProse("")).toBeNull();
  });

  it("returns null for anything that is not a string", () => {
    for (const value of [null, undefined, 42, {}, [], { text: "hi" }, true]) {
      expect(toDisplayProse(value)).toBeNull();
    }
  });

  it("caps runaway output at a paragraph", () => {
    const prose = toDisplayProse("word ".repeat(5_000))!;
    expect(prose.length).toBeLessThanOrEqual(901);
    expect(prose.endsWith("…")).toBe(true);
  });
});

describe("gateway — silent degradation", () => {
  it("returns null with nothing configured, and never throws", async () => {
    // No endpoint, no key, feature off: this is the shipped default state.
    // The contract is null — not an error, not a placeholder, not a retry.
    await expect(
      ask({ feature: "explain", system: "s", user: "u" }),
    ).resolves.toBeNull();
    await expect(
      ask({ feature: "postmortem", system: "s", user: "u" }),
    ).resolves.toBeNull();
  });

  it("refuses to dial anything that is not an absolute http(s) URL", () => {
    for (const bad of [
      "",
      "not a url",
      "/server/files",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "ftp://example.invalid",
    ]) {
      expect(isCallableEndpoint(bad)).toBe(false);
    }
    expect(isCallableEndpoint("https://api.example.invalid/v1/messages")).toBe(true);
    expect(isCallableEndpoint("http://gateway.local:8000/v1/chat")).toBe(true);
  });
});

describe("explain — what is worth offering", () => {
  it("skips bare acknowledgements and empty lines", () => {
    for (const line of ["", "  ", "ok", "OK", "ok\n", null, undefined]) {
      expect(isExplainable(line)).toBe(false);
    }
  });

  it("offers on real klipper output", () => {
    expect(isExplainable("!! Heater extruder not heating at expected rate")).toBe(true);
    expect(isExplainable("// probe at 110.000,110.000 is z=1.234")).toBe(true);
  });
});

describe("post-mortem — bounded excerpt, never the whole file", () => {
  const line = (i: number) => `2026-08-03 12:00:${String(i % 60).padStart(2, "0")} log line ${i}`;
  const log = (count: number, marker?: number) =>
    Array.from({ length: count }, (_, i) =>
      i === marker ? "Transition to shutdown state: Timer too close" : line(i),
    ).join("\n");

  it("windows around the last shutdown marker", () => {
    const excerpt = excerptKlippyLog(log(2_000, 1_500));
    expect(excerpt).toContain("Transition to shutdown state");
    expect(excerpt.split("\n").length).toBeLessThanOrEqual(EXCERPT_LINES);
    // Most of the window is the run-up to the failure, not the teardown.
    expect(excerpt).toContain("log line 1450");
    expect(excerpt, "the start of a long log never travels").not.toContain(
      "log line 10\n",
    );
  });

  it("falls back to the tail when no marker is present", () => {
    const excerpt = excerptKlippyLog(log(2_000));
    expect(excerpt.split("\n").length).toBeLessThanOrEqual(EXCERPT_LINES);
    expect(excerpt).toContain("log line 1999");
    expect(excerpt).not.toContain("log line 100\n");
  });

  it("caps the excerpt by characters as well as by lines", () => {
    const fat = Array.from({ length: 200 }, () => "x".repeat(4_000)).join("\n");
    expect(excerptKlippyLog(fat).length).toBeLessThanOrEqual(12_000);
  });

  it("returns an empty string for nothing, never null-ish text", () => {
    expect(excerptKlippyLog("")).toBe("");
    expect(excerptKlippyLog(null)).toBe("");
    expect(excerptKlippyLog(undefined)).toBe("");
    expect(excerptKlippyLog("   \n  \n")).toBe("");
  });

  it("handles a short log without a marker by returning all of it", () => {
    const short = "line one\nline two\nline three";
    expect(excerptKlippyLog(short)).toBe(short);
  });
});
