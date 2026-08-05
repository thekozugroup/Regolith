import { expect, test } from "@playwright/test";
import { installActiveMock, useExperience } from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";
import { visit } from "./support/sweep-helpers";

/**
 * TELEMETRY ROW LAW. Within any one row of `.telemetry-grid` (a row being
 * the set of tiles sharing a rounded rect.top):
 *
 *   1. every `.instrument-label`'s bounding-box top is equal within 1px;
 *   2. every `.instrument-value`'s bounding-box top is equal within 1px;
 *   3. every segment bar (`svg` inside a tile) present in the row has an
 *      equal top within 1px;
 *   4. each of (1)–(3) holds REGARDLESS of how many tiles in that row carry
 *      a bar — a tile's internal layout must not depend on its neighbours'
 *      content.
 *
 * Clause 4 is what makes the guard permanent: it fails if anyone
 * reintroduces vertical centring inside a tile, or makes the bar conditional
 * on printer state. (The 2026-08 defect was exactly that: the grid stretched
 * both tile types to the same 49.5px row, but each tile centred its own
 * content, so a bar-less tile's label sat 15.0px below its bar-bearing
 * neighbour's — at every multi-column viewport, in every printer state.)
 *
 * Right-alignment of values is a separate, existing rule (justify-between);
 * this law governs the shared baseline only.
 *
 * Selector strategy — chosen to survive the flatten pass: `.telemetry-grid`
 * is a layout contract class; tiles are its direct children (blind to tile
 * type and to span rules); rows are clustered by rounded rect.top (grid row
 * placement, not DOM order); `.instrument-label` / `.instrument-value` are
 * the typography classes other specs already assert, so a rename fails
 * loudly instead of silently skipping this test.
 */

const ROW_VIEWPORTS = [
  { name: "390", width: 390, height: 844 }, // 1-col
  { name: "800x480", width: 800, height: 480 }, // the K1 Max's own panel
  { name: "1280", width: 1280, height: 900 }, // 2-col
  { name: "2560", width: 2560, height: 1440 }, // 3-col
] as const;

/** Rows are grid rows, not DOM order. Runs in the page — self-contained. */
const TELEMETRY_ROW_PROBE = () => {
  const grid = document.querySelector(".telemetry-grid");
  if (!grid) return null;
  const rows = new Map<
    number,
    { label: number | null; value: number | null; bar: number | null; name: string }[]
  >();
  for (const el of Array.from(grid.children)) {
    const tile = el as HTMLElement;
    if (tile.getClientRects().length === 0) continue;
    const key = Math.round(tile.getBoundingClientRect().top);
    const top = (sel: string) => {
      const n = tile.querySelector(sel);
      return n ? n.getBoundingClientRect().top : null;
    };
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key)!.push({
      name: tile.querySelector(".instrument-label")?.textContent?.trim() ?? "?",
      label: top(".instrument-label"),
      value: top(".instrument-value"),
      bar: top("svg"),
    });
  }
  return [...rows.entries()].map(([top, tiles]) => ({ top, tiles }));
};

const spread = (xs: number[]) => (xs.length < 2 ? 0 : Math.max(...xs) - Math.min(...xs));

test.describe("Telemetry row law — one baseline per grid row", () => {
  for (const vp of ROW_VIEWPORTS) {
    for (const stateId of ["printing-midjob", "cooling-after-job"] as const) {
      for (const mode of ["basic", "expert"] as const) {
        test(`telemetry rows share one baseline @ ${vp.name} / ${stateId} / ${mode}`, async ({
          page,
        }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await useExperience(page, mode);
          const sc = scenario(stateId);
          const mock = await installActiveMock(page, {
            state: sc.state,
            camera: "ok",
            thumbnail: sc.thumbnail,
          });
          await visit(page, "/");

          const rows = await page.evaluate(TELEMETRY_ROW_PROBE);
          expect(rows, "telemetry grid must render").not.toBeNull();

          // --- NON-VACUITY ---------------------------------------------
          // Calibrated on main 2026-08-04: expert = 13 tiles (12 without a
          // chamber sensor), basic = 6 (5 without) — floors 12 / 5.
          const tileCount = rows!.reduce((n, r) => n + r.tiles.length, 0);
          expect(tileCount, `${vp.name}/${mode}: tiles seen`).toBeGreaterThanOrEqual(
            mode === "expert" ? 12 : 5,
          );
          // The defect ONLY exists in a row that mixes a bar-bearing tile
          // with a bar-less one. Multi-column chrome must contain at least
          // one such row, or this test passes without ever exercising the
          // regression. (Calibrated: 1 mixed row at 1280/1440/1920 2-col,
          // 2 at 2560 3-col, 0 in 1-col chrome.)
          const mixed = rows!.filter(
            (r) => r.tiles.some((t) => t.bar !== null) && r.tiles.some((t) => t.bar === null),
          );
          if (vp.width >= 1280 && mode === "expert") {
            expect(
              mixed.length,
              `${vp.name}: at least one mixed row`,
            ).toBeGreaterThanOrEqual(1);
          }

          // --- THE INVARIANT -------------------------------------------
          for (const row of rows!) {
            const where =
              `${vp.name}/${stateId}/${mode} row@${row.top} ` +
              `[${row.tiles.map((t) => t.name).join(", ")}]`;
            expect(
              spread(row.tiles.map((t) => t.label!).filter(Number.isFinite)),
              `${where}: labels share a baseline`,
            ).toBeLessThanOrEqual(1);
            expect(
              spread(row.tiles.map((t) => t.value!).filter(Number.isFinite)),
              `${where}: values share a baseline`,
            ).toBeLessThanOrEqual(1);
            expect(
              spread(row.tiles.map((t) => t.bar!).filter((v): v is number => v !== null)),
              `${where}: bars share a top edge`,
            ).toBeLessThanOrEqual(1);
          }
          mock.assertSealed();
        });
      }
    }
  }
});
