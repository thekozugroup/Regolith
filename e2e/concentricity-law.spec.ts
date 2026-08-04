import { expect, test, type Page } from "@playwright/test";
import { installActiveMock } from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";
import {
  CONCENTRICITY_PROBE,
  classifyCorner,
  describeViolation,
  isSubjectPair,
  isViolation,
  type ClassifiedCorner,
  type CornerObservation,
} from "./support/concentricity";

/**
 * THE CONCENTRICITY LAW, as a test — the 2026-08 full-app audit sweep ported
 * into the suite. Every visible (element, rounded-ancestor, corner) triple on
 * the glass must obey inner = outer − gap (±1px), with the audit's exemption
 * rules (sharp children, native controls, pills, lamp pips, free-floating and
 * outside-arc corners — see support/concentricity.ts).
 *
 * Coverage: every route, both experience modes, idle AND active-print, at the
 * compact 390px chrome and the 1280px desk chrome, with each overlay a route
 * owns opened and re-measured (more sheet, brand popover, readiness
 * disclosure, file detail + print dialog, timelapse detail + delete confirm,
 * settings disclosures + confirm, control/tune disclosures).
 *
 * This sweep supersedes the four representative placements in
 * button-law.spec.ts (kept as the even-chrome law's home).
 *
 * SELECTOR-ROT GUARD: the final test asserts the sweep still SEES the glass —
 * the subject-pair count must stay above a floor derived from the calibrated
 * count at porting time. A silent zero (probe broken, routes renamed, mock
 * dead) must fail loudly, never pass vacuously.
 */

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "1280x800", width: 1280, height: 800 },
] as const;

const ROUTES = [
  { name: "Dashboard", path: "/" },
  { name: "Files", path: "/print" },
  { name: "Control", path: "/control" },
  { name: "Tune", path: "/tune" },
  { name: "Timelapses", path: "/timelapses" },
  { name: "Console", path: "/console" },
  { name: "Settings", path: "/settings" },
] as const;

const MODES = ["basic", "expert"] as const;

/** Calibrated 2026-08-04: this port measured 286 subject pairs across the
 *  four sweep combinations (69 + 63 + 79 + 75 — post-enforcement, i.e. after
 *  the header slot and nested control groups went lawfully sharp). The floor
 *  is ~80% of that: layout work may legitimately retire some pairs, but a
 *  collapse below this means the sweep went blind. */
const PAIR_FLOOR = 230;

const GCODE_FILE = {
  path: "calibration/benchy_0.2mm_PLA_K1Max.gcode",
  size: 1_234_567,
  modified: 1_700_000_000,
  permissions: "rw",
};

/** Local REST fixtures — registered AFTER the harness so they win. */
async function fulfilFileApi(page: Page) {
  await page.route("**/server/files/list*", async (route) => {
    const root = new URL(route.request().url()).searchParams.get("root");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result:
          root === "timelapse"
            ? [
                { path: "benchy_2024.mp4", size: 9_000_000, modified: 1_700_000_000 },
                { path: "tower_2024.mp4", size: 4_000_000, modified: 1_699_000_000 },
              ]
            : [
                GCODE_FILE,
                { ...GCODE_FILE, path: "tower.gcode" },
                { ...GCODE_FILE, path: "brackets/mount_v3.gcode" },
              ],
      }),
    });
  });
  await page.route("**/server/files/metadata*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          estimated_time: 3_600,
          layer_count: 100,
          layer_height: 0.2,
          object_height: 20,
          filament_total: 3000,
          slicer: "OrcaSlicer",
        },
      }),
    });
  });
  await page.route("**/server/history/list*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          jobs: [
            {
              job_id: "1",
              filename: "tower.gcode",
              status: "completed",
              start_time: 1_699_000_000,
              end_time: 1_699_003_600,
              print_duration: 3600,
              filament_used: 2400,
            },
          ],
        },
      }),
    });
  });
  await page.route("**/server/history/totals", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          job_totals: {
            total_jobs: 12,
            total_time: 86_400,
            total_filament_used: 120_000,
            longest_job: 20_000,
          },
        },
      }),
    });
  });
}

/** Navigate without waiting on the camera stream (its MJPEG-ish <img> keeps
 *  the load event pending) and past the lazy route chunk's fallback. */
async function visit(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page
    .waitForFunction(
      () => {
        const main = document.querySelector("#main-content");
        if (!main) return false;
        if ((main.textContent ?? "").includes("Loading view")) return false;
        return main.querySelectorAll("*").length > 12;
      },
      null,
      { timeout: 8_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(320);
}

/** Try to open an overlay; returns true when it actually opened. */
async function tryOpen(page: Page, open: () => Promise<void>, verify: string): Promise<boolean> {
  try {
    await open();
    await page.waitForTimeout(240);
    return (await page.locator(verify).count()) > 0;
  } catch {
    return false;
  }
}

interface SweepTotals {
  subject: number;
  violations: string[];
}

async function capture(page: Page, where: string, totals: SweepTotals) {
  const rows = (await page.evaluate(CONCENTRICITY_PROBE)) as CornerObservation[];
  const classified: ClassifiedCorner[] = rows.map(classifyCorner);
  totals.subject += classified.filter(isSubjectPair).length;
  for (const row of classified) {
    if (isViolation(row)) totals.violations.push(describeViolation(row, where));
  }
}

async function sweepState(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
  stateKey: "idle" | "active-print",
  totals: SweepTotals,
) {
  for (const mode of MODES) {
    // Written into the live origin and picked up by the next navigation.
    await page.evaluate((m: string) => {
      localStorage.setItem("forge.experience-mode", m);
      localStorage.setItem("forge.sidebar.collapsed", "0");
    }, mode);

    for (const route of ROUTES) {
      const where = `${viewport.name} · ${route.name} · ${stateKey}/${mode}`;
      await visit(page, route.path);
      await capture(page, where, totals);

      // Sidebar "More" sheet (compact chrome only).
      if (
        await tryOpen(
          page,
          async () => {
            const b = page.getByRole("button", { name: "More navigation" });
            if ((await b.count()) && (await b.first().isVisible())) await b.first().click();
          },
          'nav[aria-label="More"]',
        )
      ) {
        await capture(page, `${where} + more-sheet`, totals);
        await page
          .getByRole("button", { name: "Close more navigation" })
          .first()
          .click()
          .catch(() => {});
        await page.waitForTimeout(180);
      }

      // BrandLogo popover (desk chrome's sidebar brand button).
      if (
        await tryOpen(
          page,
          async () => {
            const b = page.getByRole("button", { name: "Change brand icon" });
            if ((await b.count()) && (await b.first().isVisible())) await b.first().click();
          },
          'div[role="dialog"][aria-label="Choose brand icon"]',
        )
      ) {
        await capture(page, `${where} + brand-popover`, totals);
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(180);
      }

      if (route.path === "/") {
        // Readiness disclosure → dialog.
        if (
          await tryOpen(
            page,
            async () => {
              const b = page.locator('button.readiness-module[aria-haspopup="dialog"]');
              if ((await b.count()) && (await b.first().isVisible())) await b.first().click();
            },
            '[role="dialog"]',
          )
        ) {
          await capture(page, `${where} + readiness-dialog`, totals);
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(180);
        }
      }

      if (route.path === "/print") {
        const row = page.getByRole("button", { name: /benchy_0\.2mm_PLA_K1Max\.gcode/ });
        if ((await row.count()) && (await row.first().isVisible())) {
          await row.first().click().catch(() => {});
          await page.waitForTimeout(260);
          await capture(page, `${where} + file-selected`, totals);
        }
        if (
          await tryOpen(
            page,
            async () => {
              const b = page.getByRole("button", { name: /^Print\b|Start print/i });
              if ((await b.count()) && (await b.first().isVisible()) && (await b.first().isEnabled()))
                await b.first().click();
            },
            '[role="dialog"]',
          )
        ) {
          await capture(page, `${where} + print-dialog`, totals);
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(180);
        }
      }

      if (route.path === "/timelapses") {
        const row = page.getByRole("button", { name: /benchy_2024\.mp4/ });
        if ((await row.count()) && (await row.first().isVisible())) {
          await row.first().click().catch(() => {});
          await page.waitForTimeout(260);
          await capture(page, `${where} + timelapse-selected`, totals);
        }
        if (
          await tryOpen(
            page,
            async () => {
              const b = page.getByRole("button", { name: /^Delete$/i });
              if ((await b.count()) && (await b.first().isVisible())) await b.first().click();
            },
            '[role="dialog"], [role="alertdialog"]',
          )
        ) {
          await capture(page, `${where} + confirm-delete`, totals);
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(180);
        }
      }

      if (route.path === "/settings" || route.path === "/control" || route.path === "/tune") {
        // Expand every disclosure, then re-measure. (The machine-action
        // confirm dialog itself is covered via the Timelapses delete flow,
        // which mounts the same ActionConfirmDialog component.)
        const changed = await page.evaluate(() => {
          let n = 0;
          for (const d of Array.from(document.querySelectorAll("details"))) {
            if (!(d as HTMLDetailsElement).open) {
              (d as HTMLDetailsElement).open = true;
              n += 1;
            }
          }
          return n;
        });
        if (changed > 0) {
          await page.waitForTimeout(180);
          await capture(page, `${where} + details-open`, totals);
        }
      }

      if (route.path === "/settings") {
        if (
          await tryOpen(
            page,
            async () => {
              const b = page.getByRole("button", { name: /Reset|Restore|Clear|Delete/i });
              if ((await b.count()) && (await b.first().isVisible())) await b.first().click();
            },
            '[role="dialog"], [role="alertdialog"]',
          )
        ) {
          await capture(page, `${where} + settings-confirm`, totals);
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(180);
        }
      }
    }
  }
}

/** Subject-pair counts survive across the per-combination tests below (one
 *  worker, single file) so the final floor assertion sees the whole sweep. */
const grandTotal = { subject: 0, sweeps: 0 };

test.describe("Concentricity law — full-glass sweep", () => {
  for (const viewport of VIEWPORTS) {
    for (const stateKey of ["idle", "active-print"] as const) {
      test(`every nested corner obeys inner = outer − gap at ${viewport.name}, ${stateKey}`, async ({ page }) => {
        test.setTimeout(360_000);
        page.setDefaultTimeout(4_000);
        page.setDefaultNavigationTimeout(15_000);

        const sc = scenario(stateKey === "idle" ? "at-temperature" : "printing-midjob");
        await installActiveMock(page, {
          state: sc.state,
          camera: "ok",
          thumbnail: true,
        });
        await fulfilFileApi(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        // Establish the origin so localStorage writes have somewhere to land.
        await visit(page, "/");

        const totals: SweepTotals = { subject: 0, violations: [] };
        await sweepState(page, viewport, stateKey, totals);

        expect(
          totals.violations,
          `concentricity law violations at ${viewport.name}/${stateKey}`,
        ).toEqual([]);
        // Each combination alone must have seen a meaningful slice of glass
        // (calibrated 63–79 pairs per combination at porting time).
        expect(totals.subject, "sweep measured no nested corners — probe blind?").toBeGreaterThan(40);

        grandTotal.subject += totals.subject;
        grandTotal.sweeps += 1;
      });
    }
  }

  test("the sweep still sees the glass: subject-pair count holds its floor", () => {
    // Runs after the four sweeps above (single worker, in-file order). If a
    // sweep failed, its pairs are missing — this floor then fails too, which
    // is correct: a partial sweep is not a passing law.
    expect(grandTotal.sweeps, "all four sweep combinations must have run").toBe(4);
    expect(
      grandTotal.subject,
      `subject pairs collapsed below the calibrated floor (${PAIR_FLOOR}) — selector rot or a blind probe`,
    ).toBeGreaterThanOrEqual(PAIR_FLOOR);
  });
});
