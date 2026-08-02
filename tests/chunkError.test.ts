import { describe, expect, test } from "bun:test";
import { isChunkLoadError } from "../src/lib/chunkError";

describe("route update recovery classification", () => {
  test("recognizes browser dynamic-import failures", () => {
    expect(
      isChunkLoadError(
        new TypeError("Failed to fetch dynamically imported module: /assets/Control-old.js"),
      ),
    ).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 8 failed"))).toBe(true);
    expect(
      isChunkLoadError("Expected a JavaScript module script but the server responded with text/html"),
    ).toBe(true);
  });

  test("keeps general render failures distinct", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});
