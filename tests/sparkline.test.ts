import { describe, expect, test } from "bun:test";
import { buildSparklineGeometry } from "../src/lib/sparkline";

describe("native sparkline geometry", () => {
  test("returns bounded points for a changing series", () => {
    const geometry = buildSparklineGeometry([20, 22, 21], 100, 28);
    expect(geometry).not.toBeNull();
    expect(geometry?.points).toBe("2.00,26.00 50.00,2.00 98.00,14.00");
    expect(geometry?.min).toBe(20);
    expect(geometry?.max).toBe(22);
  });

  test("centers a flat series without dividing by zero", () => {
    expect(buildSparklineGeometry([25, 25], 100, 28)?.points).toBe(
      "2.00,14.00 98.00,14.00",
    );
  });

  test("ignores non-finite samples and rejects insufficient geometry", () => {
    expect(buildSparklineGeometry([20, Number.NaN, 21])?.points).toBe(
      "2.00,20.00 98.00,8.00",
    );
    expect(buildSparklineGeometry([20])).toBeNull();
    expect(buildSparklineGeometry([20, 21], 4, 28, 2)).toBeNull();
  });
});
