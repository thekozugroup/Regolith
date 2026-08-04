/**
 * Files & Timelapses pages — designed states instead of accidental ones.
 *
 * Slicers are not required to embed gcode thumbnails, so a missing preview
 * is an EXPECTED state: it must render a designed placeholder tile, never a
 * hollow square left behind by a hidden broken <img>. The detail panel goes
 * further — Moonraker's metadata already says whether a thumbnail exists, so
 * a thumbless file must not even issue the doomed 300px request that used to
 * 404 into the console.
 *
 * Same discipline as the rest of the suite: the strict active-state harness
 * seals the page, and the file/history endpoints are fulfilled locally.
 */

import { expect, test, type Page } from "@playwright/test";
import { installActiveMock } from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";

const GCODE_FILE = {
  path: "benchy_0.2mm_PLA.gcode",
  size: 1_234_567,
  modified: 1_700_000_000,
  permissions: "rw",
};

/** Local REST fixtures for the file/history endpoints the Files page reads.
 *  Registered AFTER the harness so they take precedence over its catch-all. */
async function fulfilFileApi(
  page: Page,
  options: { files: Array<typeof GCODE_FILE>; timelapses?: Array<{ path: string; size: number; modified: number }> },
) {
  await page.route("**/server/files/list*", async (route) => {
    const root = new URL(route.request().url()).searchParams.get("root");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: root === "timelapse" ? (options.timelapses ?? []) : options.files,
      }),
    });
  });
  await page.route("**/server/files/metadata*", async (route) => {
    // Metadata WITHOUT a `thumbnails` list — the signal that the slicer
    // embedded no preview.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          estimated_time: 3_600,
          layer_count: 100,
          layer_height: 0.2,
          slicer: "OrcaSlicer",
        },
      }),
    });
  });
  await page.route("**/server/history/list*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: { jobs: [] } }),
    });
  });
  await page.route("**/server/history/totals", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          job_totals: { total_jobs: 0, total_time: 0, total_filament_used: 0, longest_job: 0 },
        },
      }),
    });
  });
}

test.describe("Files page — thumbnail placeholders and designed states", () => {
  test("a file sliced without a thumbnail renders designed placeholder tiles", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, {
      ...scenario("at-temperature"),
      thumbnail: false, // every .thumbs lookup 404s, as on a real thumbless file
    });
    await fulfilFileApi(page, { files: [GCODE_FILE] });

    const bigThumbRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/.thumbs/") && request.url().includes("300x300")) {
        bigThumbRequests.push(request.url());
      }
    });

    await page.goto("/print");
    const row = page.getByRole("button", { name: /benchy_0\.2mm_PLA\.gcode/ });
    await expect(row).toBeVisible();

    // List row: the 32px lookup 404s → the designed icon tile replaces the
    // broken image instead of an invisible hollow square.
    await expect(row.getByTestId("thumb-fallback")).toBeVisible();

    // Detail panel: metadata reports no embedded thumbnails → the designed
    // "no preview" tile renders...
    await row.click();
    await expect(page.getByTestId("preview-fallback")).toBeVisible();
    await expect(page.getByText("No preview in this file")).toBeVisible();

    // ...and the doomed 300px request was never issued.
    expect(bigThumbRequests).toEqual([]);

    mock.assertSealed();
  });

  test("an empty file list renders the designed empty state, not blank glass", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await fulfilFileApi(page, { files: [] });

    await page.goto("/print");
    const empty = page.getByTestId("files-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("No print files yet");
    await expect(empty).toContainText("Upload gcode from your slicer");

    mock.assertSealed();
  });
});
