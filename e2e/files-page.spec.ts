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
  options: {
    files: Array<typeof GCODE_FILE>;
    timelapses?: Array<{ path: string; size: number; modified: number }>;
    /** Metadata payload; defaults to a file with NO embedded thumbnails. */
    metadataResult?: Record<string, unknown>;
  },
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
    // Default: metadata WITHOUT a `thumbnails` list — the signal that the
    // slicer embedded no preview.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: options.metadataResult ?? {
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

    const thumbRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/.thumbs/")) {
        thumbRequests.push(request.url());
      }
    });

    await page.goto("/print");
    const row = page.getByRole("button", { name: /benchy_0\.2mm_PLA\.gcode/ });
    await expect(row).toBeVisible();

    // List row: metadata reports no thumbnails → the designed icon tile
    // renders directly, instead of an invisible hollow square left behind by
    // a broken probe.
    await expect(row.getByTestId("thumb-fallback")).toBeVisible();

    // Detail panel: metadata reports no embedded thumbnails → the designed
    // "no preview" tile renders...
    await row.click();
    await expect(page.getByTestId("preview-fallback")).toBeVisible();
    await expect(page.getByText("No preview in this file")).toBeVisible();

    // ...and NO `.thumbs` request was ever issued — not the 300px detail
    // lookup, and not the per-row 32px probe that used to 404 for every
    // thumbless file on every visit.
    expect(thumbRequests).toEqual([]);

    mock.assertSealed();
  });

  test("a nested file resolves previews under its own directory — never a flat guess", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, {
      ...scenario("at-temperature"),
      thumbnail: true, // the real, directory-relative paths are served
    });
    const nested = {
      path: "calibration/benchy.gcode",
      size: 1_234_567,
      modified: 1_700_000_000,
      permissions: "rw",
    };
    await fulfilFileApi(page, {
      files: [nested],
      metadataResult: {
        estimated_time: 3_600,
        thumbnails: [
          { width: 32, height: 32, size: 1, relative_path: ".thumbs/benchy-32x32.png" },
          { width: 300, height: 300, size: 2, relative_path: ".thumbs/benchy-300x300.png" },
        ],
      },
    });

    const thumbRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/.thumbs/")) {
        thumbRequests.push(new URL(request.url()).pathname);
      }
    });

    await page.goto("/print");
    const row = page.getByRole("button", { name: /calibration\/benchy\.gcode/ });
    await expect(row).toBeVisible();

    // List tile: a real image, resolved under the file's own directory.
    await expect(row.locator("img")).toHaveAttribute(
      "src",
      "/server/files/gcodes/calibration/.thumbs/benchy-32x32.png",
    );

    // Detail panel: the 300px preview, same law.
    await row.click();
    await expect(page.getByAltText(/Preview of/)).toHaveAttribute(
      "src",
      "/server/files/gcodes/calibration/.thumbs/benchy-300x300.png",
    );

    // Every request kept the directory; the old flat guess percent-encoded
    // it into a `.thumbs` basename at the gcode root, which cannot exist.
    expect(thumbRequests.length).toBeGreaterThan(0);
    for (const pathname of thumbRequests) {
      expect(pathname).toContain("/server/files/gcodes/calibration/.thumbs/");
      expect(pathname).not.toContain("%2F");
    }

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

test.describe("Timelapses page — in-app delete confirmation", () => {
  test("delete asks in-app (never window.confirm), focuses Cancel, and Escape backs out", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await fulfilFileApi(page, {
      files: [],
      timelapses: [{ path: "benchy_2024.mp4", size: 8_400_000, modified: 1_700_000_000 }],
    });

    // A surviving window.confirm would block the page invisibly — record it.
    const nativeDialogs: string[] = [];
    page.on("dialog", (dialog) => {
      nativeDialogs.push(`${dialog.type()}: ${dialog.message()}`);
      void dialog.dismiss().catch(() => {});
    });

    await page.goto("/timelapses");
    await page.getByRole("button", { name: /benchy_2024\.mp4/ }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    // The app's own dialog, with the calm copy and focus resting on Cancel
    // so Enter cannot fire the destructive action.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Delete this timelapse?");
    await expect(dialog).toContainText("You can't undo this");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

    // Escape closes every dialog; nothing was ever sent to the printer.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: /benchy_2024\.mp4/ })).toBeVisible();

    expect(nativeDialogs, "the page fell back to a native dialog").toEqual([]);
    mock.assertSealed();
  });
});
