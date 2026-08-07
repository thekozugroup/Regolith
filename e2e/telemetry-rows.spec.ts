import { expect, test } from "@playwright/test";
import { installActiveMock, useExperience } from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";
import { visit } from "./support/sweep-helpers";

/**
 * TELEMETRY ROW LAW. Within any one row of a `.telemetry-zone` (a row being
 * the set of tiles sharing a rounded rect.top):
 *
 *   1. every `.instrument-label`'s bounding-box top is equal within 1px;
 *   2. every `.instrument-value`'s bounding-box top is equal within 1px;
 *   3. every mark (`svg` inside a tile) present in the row has an equal top
 *      within 1px;
 *   4. every tile ON THE PAGE — whichever zone it sits in, whatever its box
 *      height, with a track, with a trend line, or with neither — places its
 *      label and value at the SAME offset from its own top edge, within 1px.
 *
 * Clause 4 is what makes the guard permanent, and it is deliberately NOT
 * row-local. The 2026-08 defect was vertical centring: the grid stretched
 * both tile types to the same 49.5px row, but each tile centred its own
 * content, so a bar-less tile's label sat 15.0px below its bar-bearing
 * neighbour's — at every multi-column viewport, in every printer state. The
 * old clause caught that by requiring a row that MIXED the two tile types.
 * The density pass split the tile types into separate zones, which would
 * have left no mixed row anywhere and quietly retired the guard.
 *
 * Stating it as "offset from the tile's own top" restores the teeth and
 * widens them: a centred tile's offset grows with its own box height, so the
 * clause fails on re-introduced centring in EVERY tile rather than only in
 * the ones that happened to share a row with a taller neighbour. A vacuity
 * check keeps it honest — the sample must still span a real spread of
 * content heights, which is the condition the defect needs to exist at all.
 *
 * Right-alignment of values is a separate, existing rule (justify-between);
 * this law governs the shared baseline only.
 *
 * Selector strategy — chosen to survive the flatten and density passes:
 * `.telemetry-zone` is a layout contract class; tiles are its direct
 * children (blind to tile type and to span rules); rows are clustered by
 * rounded rect.top (grid row placement, not DOM order); `.instrument-label`
 * / `.instrument-value` are the typography classes other specs already
 * assert, so a rename fails loudly instead of silently skipping this test.
 */

const ROW_VIEWPORTS = [
  { name: "390", width: 390, height: 844 }, // 1-col
  { name: "800x480", width: 800, height: 480 }, // the K1 Max's own panel
  { name: "1280", width: 1280, height: 900 }, // 2-col
  { name: "2560", width: 2560, height: 1440 }, // 3-col
] as const;

/** Rows are grid rows, not DOM order. Runs in the page — self-contained. */
const TELEMETRY_ROW_PROBE = () => {
  const zones = Array.from(document.querySelectorAll(".telemetry-zone"));
  if (zones.length === 0) return null;
  type Tile = {
    name: string;
    zone: string;
    label: number | null;
    value: number | null;
    bar: number | null;
    /** Offsets from the tile's OWN top edge — clause 4's subject. */
    labelInset: number | null;
    valueInset: number | null;
    height: number;
    contentHeight: number;
  };
  const rows = new Map<string, Tile[]>();
  const all: Tile[] = [];
  for (const zone of zones) {
    const zoneName = zone.getAttribute("data-zone") ?? "?";
    for (const el of Array.from(zone.children)) {
      const tile = el as HTMLElement;
      if (tile.getClientRects().length === 0) continue;
      const box = tile.getBoundingClientRect();
      const key = `${zoneName}@${Math.round(box.top)}`;
      const top = (sel: string) => {
        const n = tile.querySelector(sel);
        return n ? n.getBoundingClientRect().top : null;
      };
      let contentBottom = box.top;
      for (const child of Array.from(tile.children)) {
        const childBox = child.getBoundingClientRect();
        if (childBox.height > 0) contentBottom = Math.max(contentBottom, childBox.bottom);
      }
      const labelTop = top(".instrument-label");
      const valueTop = top(".instrument-value");
      const entry: Tile = {
        name: tile.querySelector(".instrument-label")?.textContent?.trim() ?? "?",
        zone: zoneName,
        label: labelTop,
        value: valueTop,
        bar: top("svg"),
        labelInset: labelTop == null ? null : labelTop - box.top,
        valueInset: valueTop == null ? null : valueTop - box.top,
        height: box.height,
        contentHeight: contentBottom - box.top,
      };
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key)!.push(entry);
      all.push(entry);
    }
  }
  return {
    zones: zones.length,
    all,
    rows: [...rows.entries()].map(([key, tiles]) => ({ top: key, tiles })),
  };
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

          const probe = await page.evaluate(TELEMETRY_ROW_PROBE);
          expect(probe, "telemetry zones must render").not.toBeNull();
          const rows = probe!.rows;

          // --- NON-VACUITY ---------------------------------------------
          // Calibrated on main 2026-08-04: expert = 13 tiles (12 without a
          // chamber sensor), basic = 6 (5 without) — floors 12 / 5. Zoning
          // must never swallow a tile: the count is taken across zones.
          const tileCount = probe!.all.length;
          expect(tileCount, `${vp.name}/${mode}: tiles seen`).toBeGreaterThanOrEqual(
            mode === "expert" ? 12 : 5,
          );
          expect(
            probe!.zones,
            `${vp.name}/${mode}: both telemetry zones must render`,
          ).toBeGreaterThanOrEqual(2);
          // Clause 4 needs a real spread of content heights to have anything
          // to catch — a page of identical tiles could not expose centring.
          // Calibrated: a 24px segment strip vs a bare label/value pair.
          const contentHeights = probe!.all.map((t) => t.contentHeight);
          expect(
            Math.max(...contentHeights) - Math.min(...contentHeights),
            `${vp.name}/${mode}: the tile mix must span real content heights`,
          ).toBeGreaterThan(8);

          // --- THE INVARIANT -------------------------------------------
          for (const row of rows) {
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

          // --- CLAUSE 4, PAGE-WIDE -------------------------------------
          // Every tile places its content at the same offset from its OWN
          // top edge, whatever zone it is in and whatever its box height.
          // Vertical centring cannot satisfy this: a centred tile's offset
          // is (boxHeight − contentHeight)/2, which differs the moment the
          // heights do — and the vacuity check above guarantees they do.
          const insetWhere = `${vp.name}/${stateId}/${mode}`;
          const labelInsets = probe!.all
            .map((t) => t.labelInset!)
            .filter(Number.isFinite);
          const valueInsets = probe!.all
            .map((t) => t.valueInset!)
            .filter(Number.isFinite);
          expect(
            spread(labelInsets),
            `${insetWhere}: every tile must top-align its label, not centre it ` +
              `(insets ${labelInsets.map((n) => n.toFixed(1)).join(", ")})`,
          ).toBeLessThanOrEqual(1);
          expect(
            spread(valueInsets),
            `${insetWhere}: every tile must top-align its value, not centre it ` +
              `(insets ${valueInsets.map((n) => n.toFixed(1)).join(", ")})`,
          ).toBeLessThanOrEqual(1);

          mock.assertSealed();
        });
      }
    }
  }
});
