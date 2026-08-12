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
  options: {
    timelapses?: Array<typeof TIMELAPSE_FILE>;
    /**
     * Frames sitting in the plugin's working directory. "absent" 404s the
     * root, as a host whose plugin never registered it does — unknown, which
     * the page must not report as zero.
     */
    frames?: number | "absent";
    /** Jobs waiting in Moonraker's queue; "absent" 404s the endpoint. */
    queued?: number | "absent";
  } = {},
) {
  let timelapses = options.timelapses ?? [];
  const frames = options.frames ?? "absent";
  const queued = options.queued ?? "absent";
  await page.route("**/server/files/list*", async (route) => {
    const root = new URL(route.request().url()).searchParams.get("root");
    if (root === "timelapse_frames") {
      if (frames === "absent") {
        await route.fulfill({ status: 404, body: "no such root" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: Array.from({ length: frames }, (_, index) => ({
            path: `frame${String(index).padStart(6, "0")}.jpg`,
            size: 90_000,
            modified: 1_700_000_000,
          })),
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: root === "timelapse" ? timelapses : [GCODE_FILE],
      }),
    });
  });
  await page.route("**/server/job_queue/status*", async (route) => {
    if (queued === "absent") {
      await route.fulfill({ status: 404, body: "job queue unavailable" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          queue_state: "ready",
          queued_jobs: Array.from({ length: queued }, (_, index) => ({
            filename: `queued_${index}.gcode`,
            job_id: `0000000${index}`,
          })),
        },
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

/**
 * What Regolith must put on the wire.
 *
 * `autorender: false` and the thread cap ride along in BOTH directions.
 * Unattended autorender is what hung this printer: ffmpeg over 1873 frames
 * with a hardcoded `-threads 2` on a 2-core SoC drove load to 30 and Klipper
 * shut down with "Rescheduled timer in the past".
 */
const RECORDING_ON = {
  enabled: true,
  mode: "hyperlapse",
  autorender: false,
  extraoutputparams: "-threads 1",
};
const RECORDING_OFF = {
  enabled: false,
  autorender: false,
  extraoutputparams: "-threads 1",
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
    expect(mock.timelapseWrites()).toEqual([RECORDING_OFF]);
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
    expect(mock.timelapseWrites().at(-1)).toEqual(RECORDING_ON);

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
      { ...RECORDING_ON, mode: "layermacro" },
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

  test("a HUNG settings write still starts the print — the deadline is the law", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // "hang" is not an error path: the socket accepts and never answers, so
    // no rejection ever arrives on its own. Only the write's own deadline
    // (TIMELAPSE_WRITE_TIMEOUT_MS) can convert this into the notice path.
    // Before that deadline existed, this scenario held the print hostage
    // indefinitely — every FAILURE was handled, but a non-settling write was
    // the one unbounded step ahead of printer.print.start.
    const mock = await installActiveMock(page, {
      ...scenario("at-temperature"),
      permit: { printStart: true, timelapseWrite: "hang" },
    });
    await fulfilFileApi(page);
    await page.addInitScript(() => {
      localStorage.setItem("forge.print.timelapse", "1");
    });

    const dialog = await openPrintDialog(page);
    await startPrintFrom(page, dialog);

    // THE LAW, hang edition: the print still starts, and the owner is told
    // the recording did not stick. 15s allows the 5s abort plus slack while
    // staying inside the suite's 30s test budget.
    const notice = dialog.getByTestId("print-setup-notice");
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(notice).toContainText("Print started");
    await expect(notice).toContainText("not being recorded");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    expect(mock.rpcCalls()).toContain("printer.print.start");
    // The write was attempted (and recorded) before it hung.
    expect(mock.timelapseWrites()).toEqual([RECORDING_ON]);

    await assertNoBrokenReadouts(page, "timelapse write hang");
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

/**
 * The manual render — the action that replaced unattended autorender.
 *
 * Regolith disarms `autorender` on every print start because an unattended
 * ffmpeg pass over 1873 frames drove this printer's load from 2 to 30 and
 * shut Klipper down 28 seconds later ("Rescheduled timer in the past"). The
 * replacement is an action the owner triggers — which means the gate, the
 * warning, and the progress readout ARE the safety feature.
 */
test.describe("Timelapses page — the owner-triggered render", () => {
  test("blocked while a print is live, and it says why", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, {
      ...scenario("printing-midjob"),
      permit: { timelapseRender: "ok" },
    });
    await fulfilFileApi(page, { frames: 1873 });

    await page.goto("/timelapses");
    await awaitLink(page);

    const render = page.getByTestId("timelapse-render");
    await expect(render).toBeVisible();
    await expect(render).toBeDisabled();
    const blocked = page.getByTestId("timelapse-render-blocked");
    await expect(blocked).toContainText("Printing now");
    await expect(blocked).toContainText("starve Klipper");

    // The backlog is stated honestly rather than hidden: these frames
    // survive a failed render and pile onto the next one.
    await expect(page.getByTestId("timelapse-backlog")).toContainText(
      "1,873 frames waiting on the printer",
    );

    // A disabled control cannot be talked into firing.
    await render.click({ force: true });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(mock.timelapseRenders()).toBe(0);

    // Paused is not idle either — the job is still on the plate. Same
    // filename, because a DIFFERENT one would read as a new job and fire the
    // chamber-light auto-ON, which is a different feature's wire.
    mock.push({
      print_stats: {
        state: "paused",
        filename: "calibration/benchy_0.2mm_PLA_K1Max.gcode",
      },
    });
    await expect(page.getByTestId("timelapse-render-blocked")).toContainText(
      "Paused",
    );
    await expect(page.getByTestId("timelapse-render")).toBeDisabled();

    await assertNoBrokenReadouts(page, "render blocked during print");
    mock.assertSealed();
  });

  test("a queued job blocks it too — it is a print about to start", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, {
      ...scenario("at-temperature"),
      permit: { timelapseRender: "ok" },
    });
    await fulfilFileApi(page, { frames: 12, queued: 1 });

    await page.goto("/timelapses");
    await awaitLink(page);
    await expect(page.getByTestId("timelapse-render")).toBeDisabled();
    await expect(page.getByTestId("timelapse-render-blocked")).toContainText(
      "queued",
    );
    expect(mock.timelapseRenders()).toBe(0);

    await assertNoBrokenReadouts(page, "render blocked by queue");
    mock.assertSealed();
  });

  test("an idle printer renders — warned first, then watched to the end", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, {
      ...scenario("at-temperature"),
      permit: { timelapseRender: "ok" },
    });
    const files = await fulfilFileApi(page, { frames: 1873, queued: 0 });

    await page.goto("/timelapses");
    await awaitLink(page);
    const render = page.getByTestId("timelapse-render");
    await expect(render).toBeEnabled();
    await expect(page.getByTestId("timelapse-render-blocked")).toHaveCount(0);

    // THE WARNING. Nothing starts until the owner reads what it costs.
    await render.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("CPU-heavy");
    await expect(dialog).toContainText("long time");
    await expect(dialog).toContainText("idle");
    expect(mock.timelapseRenders()).toBe(0);

    // Cancelling sends nothing at all.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(mock.timelapseRenders()).toBe(0);

    await render.click();
    await page.getByRole("dialog").getByRole("button", { name: "Render now" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(mock.timelapseRenders()).toBe(1);

    // Asked, not yet answered — and never claiming progress it does not have.
    const activity = page.getByTestId("timelapse-activity");
    await expect(activity).toContainText("Waiting for the printer");
    // ...and it cannot be started twice while it is in flight.
    await expect(page.getByTestId("timelapse-render")).toBeDisabled();

    mock.pushTimelapse({ action: "render", status: "running", progress: 18 });
    await expect(activity).toContainText("Rendering video");
    await expect(activity).toContainText("18%");
    await expect(page.getByTestId("timelapse-render-bar")).toBeAttached();
    await expect(page.getByTestId("timelapse-render")).toBeDisabled();

    // Terminal: the video lands, the list refreshes, the backlog is gone —
    // frames are cleared only by a render that SUCCEEDS.
    files.addTimelapse(TIMELAPSE_FILE);
    await page.route("**/server/files/list*", async (route) => {
      const root = new URL(route.request().url()).searchParams.get("root");
      if (root !== "timelapse_frames") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: [] }),
      });
    });
    mock.pushTimelapse({
      action: "render",
      status: "success",
      filename: TIMELAPSE_FILE.path,
      progress: 100,
    });
    await expect(activity).toContainText("Video ready");
    await expect(
      page.getByRole("button", { name: /benchy_2026\.mp4/ }),
    ).toBeVisible();
    await expect(page.getByTestId("timelapse-backlog")).toContainText(
      "No frames are waiting",
    );
    await expect(page.getByTestId("timelapse-render")).toBeEnabled();

    await assertNoBrokenReadouts(page, "manual render");
    mock.assertSealed();
  });

  test("a render the printer refuses says so, and stays offerable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, {
      ...scenario("at-temperature"),
      permit: { timelapseRender: "fail" },
    });
    await fulfilFileApi(page, { frames: 40, queued: 0 });

    await page.goto("/timelapses");
    await awaitLink(page);
    await page.getByTestId("timelapse-render").click();
    await page.getByRole("dialog").getByRole("button", { name: "Render now" }).click();

    const error = page.getByTestId("timelapse-render-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("did not start the render");
    // A refusal is not a lock-out: the frames are still there to try again.
    await expect(page.getByTestId("timelapse-render")).toBeEnabled();
    await expect(page.getByTestId("timelapse-activity")).toHaveCount(0);

    await assertNoBrokenReadouts(page, "render refused");
    mock.assertSealed();
  });

  test("a failed render leaves the frames queued, and says so", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, {
      ...scenario("at-temperature"),
      permit: { timelapseRender: "ok" },
    });
    await fulfilFileApi(page, { frames: 620, queued: 0 });

    await page.goto("/timelapses");
    await awaitLink(page);
    mock.pushTimelapse({
      action: "render",
      status: "error",
      msg: "ffmpeg exited 1",
    });
    const activity = page.getByTestId("timelapse-activity");
    await expect(activity).toContainText("Render failed");
    await expect(activity).toContainText("ffmpeg exited 1");

    // THE COMPOUNDING. The frames are still on the printer, so the next
    // render is bigger than this one — the page has to say that out loud.
    await expect(page.getByTestId("timelapse-backlog")).toContainText(
      "620 frames waiting on the printer",
    );
    await expect(page.getByTestId("timelapse-backlog")).toContainText(
      "cleared only after a render succeeds",
    );
    await expect(page.getByTestId("timelapse-render")).toBeEnabled();

    await assertNoBrokenReadouts(page, "failed render backlog");
    mock.assertSealed();
  });

  test("a host with no frame directory says nothing it cannot see", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, {
      ...scenario("at-temperature"),
      permit: { timelapseRender: "ok" },
    });
    await fulfilFileApi(page);

    await page.goto("/timelapses");
    await awaitLink(page);
    // Unknown is not zero: with no frame root to read, the only honest
    // number is the one this link has watched arrive.
    mock.pushTimelapse({ action: "newframe", frame: 9 });
    await expect(page.getByTestId("timelapse-backlog")).toContainText(
      "9 frames captured on this link",
    );

    await assertNoBrokenReadouts(page, "frame root absent");
    mock.assertSealed();
  });
});

test.describe("Timelapses page — a host that accepts and never answers", () => {
  test("a stalled list read ends in a stated failure with a way out, not an eternal skeleton", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await installActiveMock(page, {
      ...scenario("at-temperature"),
      permit: { timelapseRender: "ok" },
    });
    await fulfilFileApi(page, { timelapses: [TIMELAPSE_FILE], queued: 0 });

    // The state that is NOT an error path: the socket accepts the request and
    // then goes silent. No HTTP status can model it and no rejection ever
    // arrives on its own — only the read's own deadline can. This printer has
    // been CPU-starved and unresponsive while still accepting connections, so
    // this is a state it has actually been in. Registered after the file API
    // so it wins; everything but the library root falls through untouched.
    let answering = false;
    await page.route("**/server/files/list*", async (route) => {
      const root = new URL(route.request().url()).searchParams.get("root");
      if (root !== "timelapse" || answering) {
        await route.fallback();
        return;
      }
      // Deliberately unanswered.
    });

    await page.goto("/timelapses");
    // Before the deadline the page is honestly still loading. Asserted before
    // the link handshake, because the skeleton only lives for those 5s.
    await expect(page.getByTestId("timelapse-skeleton")).toBeVisible();
    await awaitLink(page);

    // After the deadline the skeleton is GONE and the page says what
    // happened, in words an owner can act on. 15s
    // allows the 5s abort plus slack inside the suite's test budget.
    const failure = page.getByTestId("timelapse-list-error");
    await expect(failure).toBeVisible({ timeout: 15_000 });
    await expect(failure).toContainText("Couldn't reach the printer");
    await expect(failure).toContainText("didn't answer within 5 seconds");
    // Unknown, not empty: the page must not imply the printer holds no videos.
    await expect(failure).toContainText("unknown, not gone");
    await expect(page.getByTestId("timelapse-skeleton")).toHaveCount(0);
    await expect(page.getByText("No timelapses yet")).toHaveCount(0);

    // The way out works: the host comes back, the owner retries, the library
    // arrives. A failure that can only be escaped by reloading the app is not
    // a failure state, it is a dead end.
    answering = true;
    await page.getByTestId("timelapse-list-retry").click();
    await expect(
      page.getByRole("button", { name: /benchy_2026\.mp4/ }),
    ).toBeVisible();
    await expect(page.getByTestId("timelapse-list-error")).toHaveCount(0);

    await assertNoBrokenReadouts(page, "stalled timelapse list");
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
