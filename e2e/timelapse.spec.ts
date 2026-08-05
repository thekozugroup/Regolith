/**
 * Per-print timelapse — the toggle, the write it produces, and the honesty of
 * everything that reports on it.
 *
 * The failure this suite exists to prevent is specific: moonraker-timelapse
 * can be installed, enabled, healthy, and still record NOTHING, because in
 * `layermacro` mode frames are taken only where the sliced file itself calls
 * TIMELAPSE_TAKE_FRAME. A toggle that looks like it worked and produces an
 * empty folder is the worst possible outcome, so:
 *
 *   - enabling writes the capture mode alongside the flag,
 *   - a deliberately pinned `layermacro` is respected AND warned about,
 *   - the write goes out on every start, in both directions,
 *   - a write that fails cannot stop the print, and must be reported,
 *   - RECORDING lights on FRAMES ARRIVING, never on `enabled: true`.
 *
 * The harness stays sealed: the print RPCs and the settings POST are
 * recorded and answered locally, never forwarded.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  assertNoBrokenReadouts,
  installActiveMock,
  type ActiveMock,
  type ActiveMockOptions,
} from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";

const GCODE_FILE = {
  path: "benchy_0.2mm_PLA.gcode",
  size: 1_234_567,
  modified: 1_700_000_000,
  permissions: "rw",
};

const TIMELAPSE_FILE = {
  path: "benchy_2026.mp4",
  size: 8_400_000,
  modified: 1_700_000_000,
};

/** File/history endpoints, registered after the harness so they win. */
async function fulfilFileApi(
  page: Page,
  options: { timelapses?: Array<typeof TIMELAPSE_FILE> } = {},
) {
  let timelapses = options.timelapses ?? [];
  await page.route("**/server/files/list*", async (route) => {
    const root = new URL(route.request().url()).searchParams.get("root");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: root === "timelapse" ? timelapses : [GCODE_FILE],
      }),
    });
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
          job_totals: { total_jobs: 0, total_time: 0, total_filament_used: 0, longest_job: 0 },
        },
      }),
    });
  });
  return {
    /** Simulate the render landing a new file on the printer. */
    addTimelapse: (file: typeof TIMELAPSE_FILE) => {
      timelapses = [file, ...timelapses];
    },
  };
}

/**
 * Wait until the websocket is actually carrying data before pushing plugin
 * events at it — a push into a socket that has not opened yet is dropped, and
 * would read as a broken feature rather than a race in the fixture.
 */
async function awaitLink(page: Page) {
  await expect(
    page.getByRole("region", { name: "Printer status" }),
  ).toContainText("Link Ready");
}

/** Open the print confirmation for the one fixture file. */
async function openPrintDialog(page: Page) {
  await page.goto("/print");
  await page.getByRole("button", { name: /benchy_0\.2mm_PLA\.gcode/ }).click();
  await page.getByRole("button", { name: "Start print" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function startPrintFrom(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  await dialog
    .getByRole("checkbox", { name: /build plate is seated/ })
    .click();
  await dialog.getByRole("button", { name: "Start print" }).click();
}

const PRINT_READY: ActiveMockOptions = {
  ...scenario("at-temperature"),
  permit: { printStart: true, timelapseWrite: "ok" },
};

test.describe("Per-print timelapse — the write the toggle produces", () => {
  test("the toggle carries into the start, and off is asserted just as loudly", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock: ActiveMock = await installActiveMock(page, PRINT_READY);
    await fulfilFileApi(page);

    // Default is OFF — recording costs printer storage and a host-side
    // encode, so it is never assumed.
    let dialog = await openPrintDialog(page);
    const toggle = dialog.getByTestId("timelapse-toggle");
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    // ...and even an OFF print writes, because the flag is one global value
    // shared with Fluidd and the stock touchscreen.
    await startPrintFrom(page, dialog);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(mock.timelapseWrites()).toEqual([{ enabled: false }]);
    expect(mock.rpcCalls()).toContain("printer.print.start");

    // Turning it on sticks across a reload and rides along with the mode
    // that actually captures with existing files.
    dialog = await openPrintDialog(page);
    await dialog.getByTestId("timelapse-toggle").click();
    await expect(dialog.getByTestId("timelapse-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.reload();
    dialog = await openPrintDialog(page);
    await expect(dialog.getByTestId("timelapse-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await startPrintFrom(page, dialog);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(mock.timelapseWrites().at(-1)).toEqual({
      enabled: true,
      mode: "hyperlapse",
    });

    await assertNoBrokenReadouts(page, "timelapse toggle");
    mock.assertSealed();
  });

  test("a deliberately pinned layermacro is honoured — and warned about", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, PRINT_READY);
    await fulfilFileApi(page);
    await page.addInitScript(() => {
      localStorage.setItem("forge.print.timelapse", "1");
      localStorage.setItem("forge.timelapse.mode", "layermacro");
    });

    const dialog = await openPrintDialog(page);
    // The warning is the whole point: this file will almost certainly record
    // nothing, and the owner must be told BEFORE the print starts.
    const warning = dialog.getByTestId("timelapse-mode-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("TIMELAPSE_TAKE_FRAME");
    await expect(warning).toContainText("records nothing");

    await startPrintFrom(page, dialog);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Honoured, not silently overridden.
    expect(mock.timelapseWrites()).toEqual([
      { enabled: true, mode: "layermacro" },
    ]);

    mock.assertSealed();
  });

  test("a rejected settings write still starts the print, and says so", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, {
      ...scenario("at-temperature"),
      permit: { printStart: true, timelapseWrite: "fail" },
    });
    await fulfilFileApi(page);
    await page.addInitScript(() => {
      localStorage.setItem("forge.print.timelapse", "1");
    });

    const dialog = await openPrintDialog(page);
    await startPrintFrom(page, dialog);

    // THE LAW: the print started. The failed optional step is a notice.
    const notice = dialog.getByTestId("print-setup-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Print started");
    await expect(notice).toContainText("not being recorded");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    expect(mock.rpcCalls()).toContain("printer.print.start");

    await assertNoBrokenReadouts(page, "timelapse write failure");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    mock.assertSealed();
  });
});

test.describe("Per-print timelapse — RECORDING honesty", () => {
  test("enabled is not recording; frames are", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // The trap state: the plugin says enabled, in a mode that never fires.
    const mock = await installActiveMock(page, {
      ...scenario("printing-midjob"),
      timelapseSettings: { enabled: true, mode: "layermacro" },
    });
    await fulfilFileApi(page);

    await page.goto("/");
    await awaitLink(page);
    const mission = page.getByRole("region", { name: "Mission Status" });
    await expect(mission).toBeVisible();
    // Nothing has been captured, so nothing claims to be recording.
    await expect(mission).not.toContainText("Recording");

    mock.pushTimelapse({ action: "newframe", frame: 12 });
    await expect(mission).toContainText("Recording");
    await expect(mission).toContainText("12 frames");

    // Rendering means capture stopped — the lamp goes dark on that edge, not
    // on a timeout.
    mock.pushTimelapse({ action: "render", status: "running", progress: 40 });
    await expect(mission).not.toContainText("Recording");
    await expect(mission).toContainText("Rendering 40%");

    mock.pushTimelapse({
      action: "render",
      status: "success",
      filename: "benchy_2026.mp4",
    });
    await expect(mission).toContainText("Video ready");

    await assertNoBrokenReadouts(page, "recording state");
    mock.assertSealed();
  });

  test("a payload this build cannot parse never resets the readout", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, scenario("printing-midjob"));
    await fulfilFileApi(page);

    await page.goto("/");
    await awaitLink(page);
    const mission = page.getByRole("region", { name: "Mission Status" });
    mock.pushTimelapse({ action: "newframe", frame: 5 });
    await expect(mission).toContainText("5 frames");

    for (const event of [
      {},
      { action: "newframe" },
      { action: "newframe", frame: "banana" },
      { action: "render", status: "who knows" },
    ]) {
      mock.pushTimelapse(event);
    }
    await expect(mission).toContainText("5 frames");

    await assertNoBrokenReadouts(page, "unparseable timelapse events");
    mock.assertSealed();
  });
});

test.describe("Timelapses page — live render progress and arrival", () => {
  test("render progress renders, and the finished video arrives without a manual refresh", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, scenario("printing-midjob"));
    const files = await fulfilFileApi(page, { timelapses: [] });

    await page.goto("/timelapses");
    await awaitLink(page);
    // The empty state no longer points at a control that never existed.
    const empty = page.getByText("No timelapses yet");
    await expect(empty).toBeVisible();
    await expect(page.locator("main")).toContainText("Record timelapse");
    await expect(page.locator("main")).not.toContainText("Files page");

    // No dead complication while nothing is happening.
    await expect(page.getByTestId("timelapse-activity")).toHaveCount(0);

    mock.pushTimelapse({ action: "newframe", frame: 4 });
    const activity = page.getByTestId("timelapse-activity");
    await expect(activity).toContainText("Recording");
    await expect(activity).toContainText("4 frames");

    mock.pushTimelapse({ action: "render", status: "running", progress: 62.4 });
    await expect(activity).toContainText("Rendering video");
    await expect(activity).toContainText("62%");
    await expect(page.getByTestId("timelapse-render-bar")).toBeAttached();

    // The render finishing means a NEW file exists — the list refetches on
    // that edge instead of leaving the owner staring at a stale library.
    files.addTimelapse(TIMELAPSE_FILE);
    mock.pushTimelapse({
      action: "render",
      status: "success",
      filename: TIMELAPSE_FILE.path,
    });
    await expect(activity).toContainText("Video ready");
    await expect(
      page.getByRole("button", { name: /benchy_2026\.mp4/ }),
    ).toBeVisible();

    await assertNoBrokenReadouts(page, "timelapse render progress");
    mock.assertSealed();
  });

  test("a skipped render says so rather than claiming a video", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, scenario("printing-midjob"));
    await fulfilFileApi(page, { timelapses: [] });

    await page.goto("/timelapses");
    await awaitLink(page);
    mock.pushTimelapse({
      action: "render",
      status: "skipped",
      msg: "no frames captured",
    });
    const activity = page.getByTestId("timelapse-activity");
    await expect(activity).toContainText("Render skipped");
    await expect(activity).toContainText("no frames captured");

    await assertNoBrokenReadouts(page, "skipped render");
    mock.assertSealed();
  });
});

test.describe("Timelapse settings — the mode, stated honestly", () => {
  test("both modes carry their tradeoff, and the printer's own value is shown", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, {
      ...scenario("at-temperature"),
      timelapseSettings: { enabled: true, mode: "layermacro" },
    });
    await fulfilFileApi(page);

    await page.goto("/settings");
    const card = page.getByRole("region", { name: "Timelapse" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Works with any g-code file");
    await expect(card).toContainText("TIMELAPSE_TAKE_FRAME");
    await expect(card).toContainText("record nothing");

    // The setting is global and shared, so what the PRINTER currently holds
    // is reported rather than assumed from the local preference.
    await expect(card.getByTestId("timelapse-live-state")).toContainText(
      "Printer setting: layermacro, recording on.",
    );

    // Choosing a mode is a preference; it is written at print start, so
    // nothing is sent from this screen.
    await card.getByTestId("timelapse-mode-layermacro").click();
    await expect(card.getByTestId("timelapse-mode-layermacro")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(mock.timelapseWrites()).toEqual([]);

    await assertNoBrokenReadouts(page, "timelapse settings");
    mock.assertSealed();
  });

  test("a host without the timelapse component says so instead of guessing", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, {
      ...scenario("at-temperature"),
      timelapseSettings: "absent",
    });
    await fulfilFileApi(page);

    await page.goto("/settings");
    await expect(
      page.getByRole("region", { name: "Timelapse" }).getByTestId("timelapse-live-state"),
    ).toContainText("unavailable");

    await assertNoBrokenReadouts(page, "timelapse component absent");
    mock.assertSealed();
  });
});
