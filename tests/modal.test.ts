import { describe, expect, test } from "bun:test";
import { getFocusLoopIndex } from "../src/lib/modal";
import {
  ACCENT_PRESETS,
  getAccessibleAccentForeground,
} from "../src/lib/useTheme";

describe("modal focus loop", () => {
  test("wraps forward from last item", () => {
    expect(getFocusLoopIndex(2, 3, false)).toBe(0);
  });

  test("wraps backward from first item", () => {
    expect(getFocusLoopIndex(0, 3, true)).toBe(2);
  });

  test("recovers when focus starts outside dialog", () => {
    expect(getFocusLoopIndex(-1, 3, false)).toBe(0);
    expect(getFocusLoopIndex(-1, 3, true)).toBe(2);
  });

  test("handles dialog without interactive controls", () => {
    expect(getFocusLoopIndex(-1, 0, false)).toBeNull();
  });
});

describe("accent action contrast", () => {
  test("uses dark action text on orange", () => {
    expect(getAccessibleAccentForeground(ACCENT_PRESETS.orange)).toBe(
      "#120b07",
    );
  });

  test("uses light action text when accent is dark", () => {
    expect(getAccessibleAccentForeground("#1f2937")).toBe("#fff8f1");
  });
});
