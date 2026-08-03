import { describe, expect, test } from "bun:test";
import { selectionEquals } from "../src/lib/selection";

/**
 * usePrinterSelector's re-render gate. The hook keeps the PREVIOUS selection
 * when selectionEquals says nothing changed, so these cases are exactly the
 * cases where a Moonraker push does or does not commit a component.
 */
describe("selectionEquals", () => {
  test("primitives compare by Object.is", () => {
    expect(selectionEquals(1, 1)).toBe(true);
    expect(selectionEquals("printing", "printing")).toBe(true);
    expect(selectionEquals("printing", "paused")).toBe(false);
    expect(selectionEquals(undefined, undefined)).toBe(true);
    expect(selectionEquals(null, undefined)).toBe(false);
    expect(selectionEquals(NaN, NaN)).toBe(true); // a NaN reading must not re-render forever
    expect(selectionEquals(0, -0)).toBe(false);
  });

  test("flat bags of primitives compare by value", () => {
    expect(
      selectionEquals(
        { printState: "printing", progress: 0.5 },
        { printState: "printing", progress: 0.5 },
      ),
    ).toBe(true);
    expect(
      selectionEquals(
        { printState: "printing", progress: 0.5 },
        { printState: "printing", progress: 0.51 },
      ),
    ).toBe(false);
  });

  test("a state EDGE always reads as a change — printing → error → standby", () => {
    const printing = { printState: "printing" };
    const error = { printState: "error" };
    const standby = { printState: "standby" };
    expect(selectionEquals(printing, error)).toBe(false);
    expect(selectionEquals(error, standby)).toBe(false);
  });

  test("key set changes are changes", () => {
    expect(selectionEquals({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(selectionEquals({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  test("nested objects are NOT deep-compared (selectors must stay flat)", () => {
    expect(selectionEquals({ a: { x: 1 } }, { a: { x: 1 } })).toBe(false);
  });

  test("null and non-object mixes never throw", () => {
    expect(selectionEquals(null, { a: 1 })).toBe(false);
    expect(selectionEquals({ a: 1 }, null)).toBe(false);
    expect(selectionEquals({ a: 1 }, 1)).toBe(false);
  });
});
