import { expect, test } from "@playwright/test";
import { installActiveMock, useExperience } from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";
import { fulfilFileApi, visit } from "./support/sweep-helpers";

/**
 * BED MESH ACCESSIBLE-TABLE LAW.
 *
 * The heat map is colour fills plus numerals drawn with
 * `mix-blend-luminosity`; the <table> beside it is the only readable form of
 * the same data, so it must stay in the accessibility tree — never
 * `display:none`, never unmounted.
 *
 * But it must also cost the page NOTHING geometrically, and that is the part
 * that shipped broken. `sr-only` hides a box by pinning it to 1x1 and
 * clipping the overflow. The table layout algorithm treats `width` as a
 * MINIMUM and expands to min-content regardless, so an `sr-only` <table>
 * laid out at its full natural width — measured 1012px for an 11x11 mesh —
 * stayed in flow and dragged `documentElement.scrollWidth` past the
 * viewport. Invisible ink that still pushes the page sideways: /tune scrolled
 * horizontally by 232px at 800x480 and 764px at 1280 once the heatmap moved
 * into the narrow live-tuning rail.
 *
 * Why every existing no-overflow law was blind to it: the fixture publishes
 * NO bed mesh, so `BedMeshHeatmap` returned null and the table never
 * rendered. The laws were green because the subject did not exist. This spec
 * exists to publish a real probed mesh — the only condition under which the
 * defect is reachable — and is therefore the guard that must never go
 * vacuous. The mesh assertion below is the non-vacuity check: if the table
 * stops rendering, this fails loudly rather than passing on an empty page.
 *
 * The fix is structural, not a magic number: the clip lives on a <div>
 * wrapper, which is not laid out by the table algorithm and so honours the
 * 1x1 clip for real.
 */

const ROWS = 11;
const COLS = 11;

/** A real probed mesh — wide enough that an unclipped table cannot fit. */
const PROBED_MATRIX = Array.from({ length: ROWS }, (_, r) =>
  Array.from({ length: COLS }, (_, c) => +(Math.sin(r / 2) * 0.08 + Math.cos(c / 3) * 0.05).toFixed(4)),
);

const VIEWPORTS = [
  { name: "320x720", width: 320, height: 720 },
  { name: "390x844", width: 390, height: 844 },
  { name: "800x480", width: 800, height: 480 }, // the K1 Max's own panel
  { name: "1280x900", width: 1280, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "2560x1200", width: 2560, height: 1200 },
] as const;

const PROBE = () => {
  const table = document.querySelector("table");
  const box = table?.getBoundingClientRect();
  const clipped = table?.closest(".sr-only");
  return {
    tableFound: table != null,
    // The table must still be readable by assistive tech.
    displayed: table ? getComputedStyle(table).display !== "none" : false,
    inClip: clipped != null,
    clipIsNotTheTable: clipped != null && clipped !== table,
    clipWidth: clipped ? +clipped.getBoundingClientRect().width.toFixed(2) : null,
    tableWidth: box ? +box.width.toFixed(2) : null,
    rowsRendered: table ? table.querySelectorAll("tbody tr").length : 0,
    docOverflow:
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

test.describe("Bed mesh accessible table — readable, and geometrically free", () => {
  test("a real probed mesh never widens the document", async ({ page }) => {
    test.setTimeout(240_000);
    const sc = scenario("printing-midjob");
    await installActiveMock(page, { state: sc.state, camera: "ok", thumbnail: true });
    await fulfilFileApi(page);

    // Registered AFTER the harness so it wins the route match: publish a real
    // mesh, the one condition under which the table exists at all.
    await page.route("**/printer/objects/query?bed_mesh*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            status: {
              bed_mesh: {
                profile_name: "default",
                probed_matrix: PROBED_MATRIX,
                mesh_min: [15, 15],
                mesh_max: [285, 285],
              },
            },
          },
        }),
      });
    });

    await useExperience(page, "expert");

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await visit(page, "/tune");
      await expect(page.locator("table")).toHaveCount(1);
      const r = (await page.evaluate(PROBE)) as ReturnType<typeof PROBE>;
      const at = vp.name;

      // --- NON-VACUITY: the defect is only reachable when the table exists.
      expect(r.tableFound, `${at}: the accessible mesh table must render`).toBe(true);
      expect(r.rowsRendered, `${at}: every probed row is published`).toBe(ROWS);

      // --- STILL ACCESSIBLE ------------------------------------------
      expect(r.displayed, `${at}: the table must stay in the a11y tree`).toBe(true);

      // --- CLIPPED BY A WRAPPER, NOT BY ITSELF -----------------------
      // The structural rule. `sr-only` on the <table> is the bug; the clip
      // must sit on an element the table algorithm does not govern.
      expect(r.inClip, `${at}: the table must live inside an sr-only clip`).toBe(true);
      expect(
        r.clipIsNotTheTable,
        `${at}: the clip must be a WRAPPER — sr-only on a <table> is overridden by table layout`,
      ).toBe(true);
      expect(
        r.clipWidth,
        `${at}: the clip collapses to ~1px however wide the table inside it is`,
      ).toBeLessThanOrEqual(2);

      // --- THE ACTUAL SYMPTOM ----------------------------------------
      expect(
        r.docOverflow,
        `${at}: /tune must not scroll sideways (table laid out ${r.tableWidth}px)`,
      ).toBeLessThanOrEqual(0);
    }
  });
});
