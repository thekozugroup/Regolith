import type { Page } from "@playwright/test";

/** Shared full-app sweep plumbing. Home of the REST fixtures + navigation
 *  helpers used by the concentricity law (concentricity-law.spec.ts) and the
 *  app-wide reachability law (console-clip.spec.ts) so neither spec imports
 *  the other. */

export const GCODE_FILE = {
  path: "calibration/benchy_0.2mm_PLA_K1Max.gcode",
  size: 1_234_567,
  modified: 1_700_000_000,
  permissions: "rw",
};

/** Local REST fixtures — registered AFTER the harness so they win. */
export async function fulfilFileApi(page: Page) {
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
export async function visit(page: Page, path: string) {
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
export async function tryOpen(
  page: Page,
  open: () => Promise<void>,
  verify: string,
): Promise<boolean> {
  try {
    await open();
    await page.waitForTimeout(240);
    return (await page.locator(verify).count()) > 0;
  } catch {
    return false;
  }
}
