/**
 * The print-start guard vs the echo of its own setup.
 *
 * Executing ANY gcode flips klipper's `idle_timeout.state` to "Printing" for
 * about a second (measured ~1.0s on the live K1 Max after a bare `SET_PIN`).
 * Pre-print setup executes gcode — the KAMP pin write, and the macro the
 * timelapse settings write triggers — so the post-setup re-guard used to
 * sample its own echo and refuse every dialog print with "Printer state
 * changed during setup. Macro / calibration in progress."
 *
 * These tests run the FULL dialog path against a harness that emulates the
 * real klipper echo:
 *
 *   - echo settles (the real printer, ~1s): the print must start;
 *   - echo never settles (a genuinely busy printer — someone really did
 *     start a macro or calibration mid-setup): the refusal must stand,
 *     and `printer.print.start` must never be sent.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  installActiveMock,
  type ActiveMockOptions,
} from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";

const GCODE_FILE = {
  path: "benchy_0.2mm_PLA.gcode",
  size: 1_234_567,
  modified: 1_700_000_000,
  permissions: "rw",
};

/** The reads the Print page needs, answered locally — nothing escapes. */
async function fulfilFileApi(page: Page) {
  await page.route("**/server/files/list*", async (route) => {
    const root = new URL(route.request().url()).searchParams.get("root");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: root === "gcodes" || root === null ? [GCODE_FILE] : [],
      }),
    });
  });
  await page.route("**/server/job_queue/status*", async (route) => {
    await route.fulfill({ status: 404, body: "job queue unavailable" });
  });
  await page.route("**/server/files/metadata*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { estimated_time: 3_600, layer_count: 100, layer_height: 0.2 },
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
          job_totals: {
            total_jobs: 0,
            total_time: 0,
            total_filament_used: 0,
            longest_job: 0,
          },
        },
      }),
    });
  });
}

async function openPrintDialog(page: Page) {
  await page.goto("/print");
  await page.getByRole("button", { name: /benchy_0\.2mm_PLA\.gcode/ }).click();
  await page.getByRole("button", { name: "Start print" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function startPrintFrom(
  page: Page,
  dialog: ReturnType<Page["getByRole"]>,
) {
  await dialog.getByRole("checkbox", { name: /build plate is seated/ }).click();
  await dialog.getByRole("button", { name: "Start print" }).click();
}

const READY_WITH_ECHO: ActiveMockOptions = {
  ...scenario("at-temperature"),
  permit: { printStart: true, timelapseWrite: "ok" },
  idleEcho: { settleMs: 1000 },
};

test.describe("Print start vs the guard's own setup echo", () => {
  test("the echo of our own setup settles and the print starts", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, READY_WITH_ECHO);
    await fulfilFileApi(page);

    const dialog = await openPrintDialog(page);
    await startPrintFrom(page, dialog);

    // The dialog closing IS the assertion that the guard forgave the echo:
    // it closes only on an executed print with no notices.
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
    const rpcs = mock.rpcCalls();
    expect(rpcs).toContain("printer.print.start");
    // Setup gcode went out FIRST, the start went out AFTER the echo settled.
    expect(rpcs.indexOf("printer.gcode.script")).toBeGreaterThanOrEqual(0);
    expect(rpcs.indexOf("printer.gcode.script")).toBeLessThan(
      rpcs.lastIndexOf("printer.print.start"),
    );
    mock.assertSealed();
  });

  test("a genuinely busy printer still refuses — the echo that never settles", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, {
      ...READY_WITH_ECHO,
      idleEcho: { settleMs: null },
    });
    await fulfilFileApi(page);

    const dialog = await openPrintDialog(page);
    await startPrintFrom(page, dialog);

    // The refusal takes the whole settle grace before it is spoken — the
    // guard waits out the echo window before deciding the busy is real.
    await expect(dialog.getByRole("alert")).toContainText(
      "Macro / calibration in progress",
      { timeout: 15_000 },
    );
    await expect(dialog.getByRole("alert")).toContainText(
      "state changed during setup",
    );
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(mock.rpcCalls()).not.toContain("printer.print.start");
    mock.assertSealed();
  });
});
