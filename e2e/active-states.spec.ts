/**
 * Active-printer coverage.
 *
 * `regolith.spec.ts` and `instrument-cluster.spec.ts` both pin an IDLE
 * printer: print_stats.state = "standby", every heater target 0, progress 0.
 * That means the layout the owner actually stares at — hot nozzle, moving
 * axes, a job with hours left on it — had never been rendered in CI. Green
 * did not mean the printing layout was safe.
 *
 * This suite drives the same strict local mock through every state the
 * machine really passes through, and asserts what the owner has to be able to
 * trust: no raw JS placeholders on the glass, the 148px dial floor, the 11px
 * text floor, 44px controls, zero horizontal overflow, stable DOM task order,
 * and a state word that matches the state.
 *
 * Widths: 320 (smallest phone), 800x480 (the K1 Max's own panel), 1280.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  assertOwnerTrust,
  assertNoBrokenReadouts,
  installActiveMock,
  readPanelText,
  type ActiveMock,
} from "./support/active-state-harness";
import { SCENARIOS, scenario } from "./support/printer-scenarios";

const VIEWPORTS = [
  { name: "320", width: 320, height: 720 },
  { name: "k1-panel", width: 800, height: 480 },
  { name: "1280", width: 1280, height: 900 },
];

const statusRail = (page: Page) => page.getByRole("region", { name: "Printer status" });
const missionCard = (page: Page) => page.getByRole("region", { name: "Mission Status" });
const thermalsCard = (page: Page) => page.getByRole("region", { name: "Thermals" });
const hotendGauge = (page: Page) => page.getByRole("img", { name: /^Hotend temperature/ });
const bedGauge = (page: Page) => page.getByRole("img", { name: /^Bed temperature/ });

/**
 * Fraction of the mission bar's full-width progress strip that is filled,
 * or null when the strip is not rendered at all. Measured rather than read
 * off the inline style so the assertion survives float formatting.
 */
async function missionProgressRatio(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const track = document.querySelector<HTMLElement>("[data-mission-progress]");
    const fill = track?.firstElementChild as HTMLElement | null;
    if (!track || !fill) return null;
    const trackWidth = track.getBoundingClientRect().width;
    if (trackWidth === 0) return null;
    return fill.getBoundingClientRect().width / trackWidth;
  });
}

/** Load a scenario into an installed mock and reload the dashboard onto it. */
async function loadScenario(
  page: Page,
  mock: ActiveMock,
  id: string,
): Promise<ReturnType<typeof scenario>> {
  const target = scenario(id);
  mock.use(target);
  await page.evaluate(
    (mode) => localStorage.setItem("forge.experience-mode", mode),
    target.experience ?? "basic",
  );
  await page.goto("/");
  // Mount marker for the lazy Dashboard chunk. The generous timeout is
  // patience for a loaded CI machine, not a weaker assertion: each test owns
  // a single scenario (see below), so its 30s budget easily absorbs this.
  await expect(
    page.locator("main").getByRole("heading", { name: "Camera", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  return target;
}

/**
 * Bootstrap: the mock has to be installed before the first navigation, and
 * localStorage needs an origin before it can be written, so every test opens
 * on the first scenario and then swaps.
 */
async function openDashboard(page: Page): Promise<ActiveMock> {
  const mock = await installActiveMock(page, SCENARIOS[0]);
  await page.goto("/");
  return mock;
}

test.describe("Regolith — live printer states", () => {
  // One test per (viewport, scenario) pair — NOT one 10-scenario loop per
  // viewport. The loop form shared a single default 30s test budget across
  // ten reloads plus ten whole-DOM owner-trust sweeps; on a loaded machine
  // the aggregate occasionally blew that budget and the gate failed on
  // whichever scenario the clock ran out on. Splitting gives every scenario
  // its own budget and pinpoints failures without weakening any assertion.
  for (const viewport of VIEWPORTS) {
    for (const target of SCENARIOS) {
      test(`${target.id} stays trustworthy at ${viewport.width}x${viewport.height}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const mock = await openDashboard(page);
        await loadScenario(page, mock, target.id);
        const label = `${target.id} @ ${viewport.width}x${viewport.height}`;

        // --- The state word must match the state ---------------------------
        await expect(
          statusRail(page).getByText(target.words.print, { exact: true }),
          `${label}: status rail must say "${target.words.print}"`,
        ).toBeVisible();
        await expect(
          hotendGauge(page).getByText(target.words.hotend, { exact: true }),
          `${label}: hotend must read "${target.words.hotend}"`,
        ).toBeVisible();
        await expect(
          bedGauge(page).getByText(target.words.bed, { exact: true }),
          `${label}: bed must read "${target.words.bed}"`,
        ).toBeVisible();
        // Screen readers must be told the same story as the glass.
        await expect(hotendGauge(page), `${label}: hotend aria-description`).toHaveAttribute(
          "aria-description",
          new RegExp(`${target.words.hotend}\\.$`),
        );
        await expect(bedGauge(page), `${label}: bed aria-description`).toHaveAttribute(
          "aria-description",
          new RegExp(`${target.words.bed}\\.$`),
        );

        // --- The rail readouts the owner glances at -------------------------
        const railText = await readPanelText(statusRail(page));
        expect(railText, `${label}: status rail job`).toContain(target.rail.job);
        // IDLE SHOWS NO DEAD COMPLICATIONS: the Progress/Remaining pair only
        // exists while a job is in flight. An em-dash slot is right for an
        // unknown-but-applicable value (a running job with no trustworthy
        // estimate still owes a "Remaining" label); it is wrong for a
        // quantity that does not exist, so a standby machine renders neither.
        if (target.words.print === "printing" || target.words.print === "paused") {
          expect(railText, `${label}: status rail progress`).toContain(
            `Progress ${target.rail.progress}`,
          );
          expect(railText, `${label}: status rail remaining`).toContain(
            `Remaining ${target.rail.remaining}`,
          );
        } else {
          expect(railText, `${label}: idle rail must carry no dead complications`).not.toContain(
            "Progress",
          );
          expect(railText, `${label}: idle rail must carry no dead complications`).not.toContain(
            "Remaining",
          );
        }
        expect(railText, `${label}: link health`).toContain("Link Ready");

        await assertOwnerTrust(page, label);
        await page.screenshot({
          path: testInfo.outputPath(`${viewport.name}-${target.id}.png`),
          fullPage: false,
          animations: "disabled",
        });

        mock.assertSealed();
      });
    }
  }

  test("an actively printing job shows real, actionable numbers", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "printing-midjob");

    const job = await readPanelText(missionCard(page));
    expect(job).toContain("benchy_0.2mm_PLA_K1Max");
    expect(job).toContain("printing");
    expect(job, "layer N / M must be populated mid-job").toContain("Layer 118 / 250");
    expect(job).toContain("Progress 47.3%");
    // 4021s of printing at 47.32% of the file → ~8497s total, ~4476s left.
    // (It read "1h 6m" while remaining was derived from Klipper's monotonic
    // clock rather than from the job's own progress.)
    expect(job, "remaining time must be a duration, not a placeholder").toContain(
      "Remaining 1h 14m",
    );
    expect(job).toContain("Elapsed 1h 7m");
    expect(job).toContain("Filament used 8.43 m");

    // The gcode thumbnail resolves to the real job, not the generic icon.
    await expect(
      missionCard(page).getByRole("img", { name: "calibration/benchy_0.2mm_PLA_K1Max.gcode" }),
    ).toBeVisible();

    // Both controls a printing owner needs, both finger-sized and enabled.
    const pause = missionCard(page).getByRole("button", { name: "Pause" });
    const cancel = missionCard(page).getByRole("button", { name: "Cancel" });
    await expect(pause).toBeEnabled();
    await expect(cancel).toBeEnabled();
    await expect(missionCard(page).getByRole("button", { name: "Resume" })).toHaveCount(0);

    // Both heaters are live, so both dials must carry a target index.
    await expect(
      page.locator('.gauge-dial line[stroke="var(--color-gauge-target)"]'),
      "a live setpoint must be indexed on the dial",
    ).toHaveCount(2);

    // The mission bar's progress strip is the owner's peripheral-vision
    // readout; it only exists while a job is active and must track the same
    // fraction.
    const ratio = await missionProgressRatio(page);
    expect(ratio, "the mission bar progress strip must render while printing").not.toBeNull();
    expect(ratio ?? 0).toBeGreaterThan(0.46);
    expect(ratio ?? 0).toBeLessThan(0.49);

    await assertOwnerTrust(page, "printing-midjob detail");
    mock.assertSealed();
  });

  test("heating shows a rising delta, a live setpoint, and the correct word", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "heating");

    await expect(page.getByRole("img", { name: "Hotend temperature 48.3 degrees Celsius" })).toBeVisible();
    await expect(hotendGauge(page)).toHaveAttribute(
      "aria-description",
      "Target 220 degrees Celsius. Heating.",
    );

    const hotend = await readPanelText(hotendGauge(page));
    expect(hotend, "the setpoint must be readable, not implied").toContain("Set 220°");
    expect(hotend, "a rising heater must show the ▲ direction mark").toContain("▲");
    expect(hotend, "heater power must be shown as a percentage").toContain("Pwr 100%");
    expect(hotend).not.toContain("▼");

    // Target index + the delta band spanning actual → target.
    await expect(hotendGauge(page).locator('line[stroke="var(--color-gauge-target)"]')).toHaveCount(1);
    await expect(
      hotendGauge(page).locator('path[stroke*="var(--gauge-stroke) 22%"]'),
      "the gap between actual and target must be drawn",
    ).toHaveCount(1);

    const job = await readPanelText(missionCard(page));
    expect(job).toContain("Layer 1 / 180");
    expect(job).toContain("Progress 0.6%");

    await assertOwnerTrust(page, "heating detail");
    mock.assertSealed();
  });

  test("cooling after a job shows a falling delta and offers a repeat", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "cooling-after-job");

    const hotend = await readPanelText(hotendGauge(page));
    expect(hotend).toContain("Set 195°");
    expect(hotend, "a heater coasting down must show the ▼ direction mark").toContain("▼");
    expect(hotend).not.toContain("▲");
    expect(hotend, "over-target is an error condition, not 'Stable'").toContain("Above target");

    // The bed is released: no setpoint, no index, honest placeholder.
    const bed = await readPanelText(bedGauge(page));
    expect(bed).toContain("Standby");
    expect(bed).toContain("Set —");
    await expect(bedGauge(page).locator('line[stroke="var(--color-gauge-target)"]')).toHaveCount(0);

    const job = await readPanelText(missionCard(page));
    expect(job).toContain("complete");
    expect(job).toContain("Progress 100.0%");
    expect(job, "a finished job has no remaining time").toContain("Remaining —");
    expect(job).toContain("Elapsed 1h 30m");
    expect(job).toContain("Filament used 12.00 m");
    await expect(missionCard(page).getByRole("button", { name: "Print again" })).toBeEnabled();
    await expect(missionCard(page).getByRole("button", { name: "Pause" })).toHaveCount(0);

    await assertOwnerTrust(page, "cooling detail");
    mock.assertSealed();
  });

  test("a paused job offers resume, never pause, and holds its numbers", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "paused");

    const job = await readPanelText(missionCard(page));
    expect(job).toContain("paused");
    expect(job).toContain("Layer 33 / 90");
    expect(job).toContain("Progress 36.7%");
    // 1800s at 36.67% → ~4909s total, ~3109s left. A pause does not stop the
    // estimate being derived from the job's own progress.
    expect(job).toContain("Remaining 51m 48s");
    expect(job).toContain("Elapsed 30m 0s");

    await expect(missionCard(page).getByRole("button", { name: "Resume" })).toBeEnabled();
    await expect(missionCard(page).getByRole("button", { name: "Cancel" })).toBeEnabled();
    await expect(missionCard(page).getByRole("button", { name: "Pause" })).toHaveCount(0);

    // Heaters stay held through a pause — both dials keep their index.
    await expect(page.locator('.gauge-dial line[stroke="var(--color-gauge-target)"]')).toHaveCount(2);

    await assertOwnerTrust(page, "paused detail");
    mock.assertSealed();
  });

  test("a cancelled job stops claiming live progress on the rail", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "cancelled");

    const rail = await readPanelText(statusRail(page));
    expect(rail).toContain("cancelled");
    // The pair is DELETED, not dashed: a cancelled job has no progress to
    // report, and a permanently-dead readout on the bottom bar of every
    // route is exactly the dead complication the panel's law forbids. The
    // state word "cancelled" is what answers the question.
    expect(rail, "a cancelled job must not carry a dead Progress slot").not.toContain(
      "Progress",
    );
    expect(rail, "a cancelled job must not carry a dead Remaining slot").not.toContain(
      "Remaining",
    );

    const job = await readPanelText(missionCard(page));
    expect(job).toContain("cancelled");
    expect(job).toContain("Remaining —");
    // No LIVE-job controls survive a cancellation…
    for (const name of ["Pause", "Resume", "Cancel"]) {
      await expect(
        missionCard(page).getByRole("button", { name }),
        `a cancelled job must not offer "${name}"`,
      ).toHaveCount(0);
    }

    // Heaters were released with the job — no dial may claim a setpoint.
    await expect(page.locator('.gauge-dial line[stroke="var(--color-gauge-target)"]')).toHaveCount(0);
    // …and nothing is running, so the progress strip must be gone entirely.
    expect(
      await missionProgressRatio(page),
      "a cancelled job must not leave a progress strip on the mission bar",
    ).toBeNull();

    await assertOwnerTrust(page, "cancelled detail");
    mock.assertSealed();
  });

  /* ---------------------------------------------------------------------
   * Stopped jobs — cancelled and errored.
   *
   * Klipper leaves `print_stats.filename` populated after a job ends. The
   * job panel used to gate its idle branch on `!filename`, so every stopped
   * job fell straight through into the print-active layout: a part-filled
   * accent progress track and a "Progress 7.2%" readout for a machine that
   * had not moved in an hour, with no control of any kind because the action
   * slot only knew about running and completed jobs.
   * ------------------------------------------------------------------ */

  test("a stopped job is presented as stopped, not as live progress", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "cancelled");

    const job = await readPanelText(missionCard(page));
    // The frozen percentage is still reported — but under a label that says
    // the job stopped there, never as a live "Progress" readout.
    expect(job, "a stopped job must not claim live Progress").not.toContain("Progress ");
    expect(job, "the point the job stopped at is still worth knowing").toContain(
      "Stopped at 7.2%",
    );
    // The checkpoint track is the visual claim that a job is advancing.
    await expect(
      missionCard(page).getByText("Done", { exact: true }),
      "a stopped job must not render the live checkpoint timeline",
    ).toHaveCount(0);

    // The affordance that was missing entirely: a stopped job is exactly the
    // one the owner wants to run again.
    await expect(
      missionCard(page).getByRole("button", { name: "Print again" }),
      "a cancelled job must offer a retry",
    ).toBeEnabled();

    await assertNoBrokenReadouts(page, "cancelled job panel");
    await assertOwnerTrust(page, "stopped-not-live");
    mock.assertSealed();
  });

  test("a failed print shows klipper's reason, not just that it stopped", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "print-error");

    // `print_stats.message` had no reader anywhere in the app, so a thermal
    // fault and a user cancellation looked identical: the job just vanished.
    const reason = missionCard(page).locator("[data-job-reason]");
    await expect(reason, "a failed print must surface why it failed").toBeVisible();
    await expect(reason).toContainText("Heater heater_bed not heating at expected rate");

    const job = await readPanelText(missionCard(page));
    expect(job).toContain("error");
    expect(job).toContain("Stopped at 72.8%");
    expect(job, "a failed job has no remaining time").toContain("Remaining —");
    expect(job, "a failed job must not claim live Progress").not.toContain("Progress ");
    expect(job, "layer info survives the failure").toContain("Layer 291 / 400");
    await expect(missionCard(page).getByRole("button", { name: "Print again" })).toBeEnabled();
    for (const name of ["Pause", "Resume", "Cancel"]) {
      await expect(missionCard(page).getByRole("button", { name })).toHaveCount(0);
    }

    // The reason is firmware free-text; it must never be the vehicle that
    // smuggles a JS placeholder onto the glass.
    await assertNoBrokenReadouts(page, "failed print panel");
    await assertOwnerTrust(page, "print-error detail");
    mock.assertSealed();
  });

  test("a cancelled job's reason reaches the owner", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "cancelled");

    await expect(missionCard(page).locator("[data-job-reason]")).toContainText(
      "Print cancelled by user",
    );
    mock.assertSealed();
  });

  test("a running job never carries a stopped-job reason or retry", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "printing-midjob");

    await expect(
      missionCard(page).locator("[data-job-reason]"),
      "a running job has not stopped and has no reason to show",
    ).toHaveCount(0);
    await expect(missionCard(page).getByRole("button", { name: "Print again" })).toHaveCount(0);
    const job = await readPanelText(missionCard(page));
    expect(job, "a running job reports live Progress, not 'Stopped at'").not.toContain(
      "Stopped at",
    );
    mock.assertSealed();
  });

  /* ---------------------------------------------------------------------
   * Remaining time — derived from the job, never from Klipper's clock.
   * ------------------------------------------------------------------ */

  test("remaining time ignores klipper's monotonic clock", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    const target = await loadScenario(page, mock, "monotonic-clock-skew");

    // `toolhead.estimated_print_time` is 40000 here — the host's uptime, not
    // this job's duration. Deriving from it reported "10h 6m" left. The job's
    // own numbers (1h of printing at 50% of the file) say one hour, and one
    // hour is what both readouts must say.
    const job = await readPanelText(missionCard(page));
    expect(job, "remaining must come from the job, not the machine clock").toContain(
      "Remaining 1h 0m",
    );
    expect(job).toContain("Elapsed 1h 0m");
    expect(job).toContain("Progress 50.0%");
    expect(job, "the monotonic clock must not leak into the readout").not.toContain("10h");

    const rail = await readPanelText(statusRail(page));
    expect(rail).toContain(`Remaining ${target.rail.remaining}`);
    expect(rail).not.toContain("11:06");

    await assertOwnerTrust(page, "monotonic-clock-skew detail");
    mock.assertSealed();
  });

  test("an estimate too early to trust is withheld, not guessed", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "heating");

    // 96 seconds into a job at 0.6% of the file: everything burnt so far was
    // heat-up, homing and the purge line. Extrapolating from it produced a
    // confident, precisely-formatted "1:58:24" that was hours out. On a
    // multi-hour print a wrong time is worse than no time — the owner plans
    // around it. Say nothing instead.
    const job = await readPanelText(missionCard(page));
    expect(job, "an untrustworthy estimate must render as a placeholder").toContain(
      "Remaining —",
    );
    expect(job, "the readout must not invent a duration this early").not.toMatch(
      /Remaining \d/,
    );
    // The numbers we DO know are still reported in full.
    expect(job).toContain("Progress 0.6%");
    expect(job).toContain("Elapsed 1m 36s");

    const rail = await readPanelText(statusRail(page));
    expect(rail).toContain("Remaining —");
    expect(rail, "the rail clock must not invent a duration either").not.toMatch(
      /Remaining \d/,
    );

    await assertNoBrokenReadouts(page, "early-print estimate");
    await assertOwnerTrust(page, "heating estimate withheld");
    mock.assertSealed();
  });

  test("the job panel and the mission bar never disagree about time left", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);

    // Both readouts are in the owner's eyeline at once. Two different answers
    // to "how long left?" makes both untrustworthy, so they share one
    // derivation — this pins that they still do.
    for (const id of ["printing-midjob", "paused", "monotonic-clock-skew", "heating"]) {
      const target = await loadScenario(page, mock, id);
      const rail = await readPanelText(statusRail(page));
      expect(rail, `${id}: rail remaining`).toContain(`Remaining ${target.rail.remaining}`);

      const job = await readPanelText(missionCard(page));
      const [, jobRemaining] = job.match(/Remaining (—|\d+[hms][^A-Z]*?)(?= Elapsed)/) ?? [];
      expect(jobRemaining, `${id}: job panel must state a remaining time`).toBeTruthy();
      // "—" on one side means "—" on the other; a duration on one side means a
      // duration on the other. (The two use different formats by design:
      // h:mm:ss on the glanceable bar, "1h 14m" in the detail panel.)
      expect(
        jobRemaining === "—",
        `${id}: job panel says "${jobRemaining}" while the rail says "${target.rail.remaining}"`,
      ).toBe(target.rail.remaining === "—");
    }

    mock.assertSealed();
  });

  /* ---------------------------------------------------------------------
   * Layer info — slicers emit all, some, or none of it.
   * ------------------------------------------------------------------ */

  test("a job with only a current layer shows it without a phantom total", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "current-layer-only");

    const job = await readPanelText(missionCard(page));
    // The row used to be gated on the TOTAL alone, so a slicer that reported
    // only the current layer had that reading silently thrown away.
    expect(job, "a known current layer must be shown").toContain("Layer 42");
    expect(job, "an unknown total must not be invented").not.toContain("42 /");
    expect(job).not.toContain("null");
    expect(job).not.toContain("undefined");
    expect(job).not.toContain("NaN");

    await assertNoBrokenReadouts(page, "current-layer-only job panel");
    await assertOwnerTrust(page, "current-layer-only detail");
    mock.assertSealed();
  });

  test("a job with only a layer total renders a half-known row, not NaN", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "total-layer-only");

    const job = await readPanelText(missionCard(page));
    // The old row interpolated `currentLayer ?? "—"` beside the total, which
    // was right by accident here — but only because the total gated the row.
    // Pin the honest half-known form so neither half can regress to a raw
    // placeholder.
    expect(job, "a known total is worth showing even without a current layer").toContain(
      "Layer — / 300",
    );
    expect(job).not.toContain("null");
    expect(job).not.toContain("undefined");
    expect(job).not.toContain("NaN");

    await assertNoBrokenReadouts(page, "total-layer-only job panel");
    await assertOwnerTrust(page, "total-layer-only detail");
    mock.assertSealed();
  });

  for (const id of ["null-layer-info", "absent-layer-info"]) {
    test(`a job with ${id === "null-layer-info" ? "null" : "missing"} layer info renders no layer row`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 800, height: 480 });
      const mock = await openDashboard(page);
      await loadScenario(page, mock, id);

      const job = await readPanelText(missionCard(page));
      // Many slicers never emit M73 layer totals. The row must vanish, not
      // degrade to "— / —", "null / null", or an empty value.
      expect(job, "layer row must be absent, not empty").not.toContain("Layer");
      // Everything else about the job still has to read correctly.
      expect(job).toContain("printing");
      expect(job).toMatch(/Progress \d+\.\d%/);
      expect(job).toMatch(/Remaining \d+[hms]/);

      await assertNoBrokenReadouts(page, `${id}: job panel`);
      await assertOwnerTrust(page, `${id} detail`);
      mock.assertSealed();
    });
  }

  test("a running calibration macro renders the tuning branch, not a fake job", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "tuning-macro");

    const job = await readPanelText(missionCard(page));
    expect(job).toContain("Calibration · Tuning");
    expect(job).toContain("ACTIVE");
    expect(job, "klipper has said nothing yet — say so, don't invent output").toContain(
      "Waiting for klipper output…",
    );
    expect(job).toContain("State Printing");
    expect(job).toContain("Position 153,149,5.0");
    // No print file exists, so no print-file controls may appear.
    for (const name of ["Pause", "Resume", "Print again"]) {
      await expect(missionCard(page).getByRole("button", { name })).toHaveCount(0);
    }
    await expect(missionCard(page).getByRole("button", { name: "Emergency stop" })).toBeEnabled();

    // The rail still reports the real print_stats state, not the macro.
    const rail = await readPanelText(statusRail(page));
    expect(rail).toContain("standby");
    expect(rail).toContain("No active job");

    await assertOwnerTrust(page, "tuning detail");
    mock.assertSealed();
  });

  test("an absent camera and an absent chamber sensor degrade to placeholders", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "no-camera-no-chamber");

    // The camera is gone; the printing telemetry beside it must be untouched.
    await expect(page.getByText("Camera unavailable. Retrying…")).toBeVisible();
    expect(mock.cameraRequests(), "the camera was never attempted").toBeGreaterThan(0);

    const job = await readPanelText(missionCard(page));
    expect(job).toContain("printing");
    expect(job).toContain("Layer 77 / 140");
    expect(job).toContain("Progress 55.0%");

    // Expert mode lists the profile's aux sensors. The chamber thermistor is
    // simply not reported by this machine: honest dash, never "undefined".
    const auxRow = (label: string) =>
      page.locator(".ruled-row").filter({ has: page.getByText(label, { exact: true }) });
    await expect(auxRow("Chamber")).toContainText("—");
    await expect(auxRow("Chamber Fan")).toContainText("—");
    await expect(auxRow("MCU")).toContainText("44.2°C");

    const thermals = await readPanelText(thermalsCard(page));
    expect(thermals).not.toContain("undefined");
    expect(thermals).not.toContain("NaN");

    await assertOwnerTrust(page, "absent camera + chamber");
    mock.assertSealed();
  });

  test("the printing layout survives reduced motion and forced colors", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "printing-midjob");

    // Geometry, legibility, and the state word must all survive high contrast.
    await expect(statusRail(page).getByText("printing", { exact: true })).toBeVisible();
    await expect(hotendGauge(page).getByText("Stable", { exact: true })).toBeVisible();
    // The dial scale still has to be there to read a value against.
    await expect(
      page.locator('.gauge-dial path[stroke="var(--color-gauge-track)"]'),
      "the dial track must survive forced colors",
    ).toHaveCount(2);
    // De-glow (owner-directed): the dial value arcs are the owner's
    // at-a-glance heat signal and must stay rendered in high-contrast mode —
    // as plain geometry, with no filter anywhere. (A previous rule set
    // `display: none` on the old glow class and blanked all of them; the
    // class is gone, the never-hide-geometry lesson stays. The status lamps
    // that used to be swept alongside them are deleted — see the
    // engine-light test below.)
    const litGeometry = await page
      .locator('.gauge-dial path[stroke="currentColor"]')
      .evaluateAll((items) =>
        items.map((item) => {
          const style = getComputedStyle(item);
          const box = item.getBoundingClientRect();
          return {
            tag: item.tagName.toLowerCase(),
            shown: style.display !== "none" && style.visibility !== "hidden",
            unfiltered: style.filter === "none",
            sized: box.width > 0 && box.height > 0,
          };
        }),
      );
    expect(
      litGeometry.length,
      "a printing machine must draw its value arcs under forced colors",
    ).toBeGreaterThan(0);
    expect(
      litGeometry.filter((part) => !part.shown || !part.sized),
      "every value arc must stay rendered under forced colors",
    ).toEqual([]);
    expect(
      litGeometry.filter((part) => !part.unfiltered),
      "no filter may ride the arcs",
    ).toEqual([]);
    await assertOwnerTrust(page, "printing @ forced-colors + reduced-motion");
    mock.assertSealed();
  });

  test("dials and tell-tales carry no filter in any state", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);

    // De-glow (owner-directed, flatten pass): the phosphor glow is deleted.
    // Glow was never a state channel — arc length/color and the state word
    // carry every bit it rode along with — so nothing may reintroduce a
    // filter on instrument geometry, in any print state.
    for (const id of ["printing-midjob", "print-error", "at-temperature"]) {
      await loadScenario(page, mock, id);
      const filtered = await page
        .locator(".gauge-dial path, .telltale-icon")
        .evaluateAll((items) =>
          items
            .map((item) => ({
              tag: item.tagName.toLowerCase(),
              cls: item.getAttribute("class") ?? "",
              filter: getComputedStyle(item).filter,
            }))
            .filter((part) => part.filter !== "none"),
        );
      expect(filtered, `${id}: no dial or lamp may carry a filter`).toEqual([]);
      await assertNoBrokenReadouts(page, `${id} @ no-filter sweep`);
    }
    mock.assertSealed();
  });

  test("the CRT decoration family is deleted from the stylesheet itself", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "printing-midjob");

    // Not a DOM-count check (an unused class would pass that vacuously): the
    // RULES must be gone from the built CSS, so the decorative-CRT family
    // (.phosphor-glow, .crt-scanlines, .readout-ghost) cannot be quietly
    // re-adopted by a future call site.
    const offenders = await page.evaluate(() => {
      const found: string[] = [];
      const walk = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule) {
            if (/phosphor-glow|crt-scanlines|readout-ghost/.test(rule.selectorText)) {
              found.push(rule.selectorText);
            }
          }
          const nested = (rule as CSSGroupingRule).cssRules as CSSRuleList | undefined;
          if (nested) walk(nested);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          walk(sheet.cssRules);
        } catch {
          // Cross-origin sheets (none shipped) — skip rather than fail.
        }
      }
      return found;
    });
    expect(offenders, "no CRT-decoration selector may survive in CSS").toEqual([]);
    mock.assertSealed();
  });

  test("no lamp chrome survives; the state WORDS carry state under forced colors", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    await page.emulateMedia({ forcedColors: "active" });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "printing-midjob");

    // ENGINE-LIGHT RULE (panel spec §9, now shared by both surfaces): the
    // 6x6 `.status-lamp` pip is deleted everywhere. It was aria-hidden
    // decoration that always duplicated the word beside it, and it was the
    // one element forced colors could not render — a lamp is NOTHING BUT
    // its background, author backgrounds are stripped, and measured
    // lamp-vs-backdrop contrast was 0. Deleting it closes that defect at the
    // source instead of patching a CanvasText repaint on top of it.
    await expect(page.locator(".status-lamp")).toHaveCount(0);
    const lampRule = await page.evaluate(() =>
      Array.from(document.styleSheets).some((sheet) => {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          return false;
        }
        return Array.from(rules).some((rule) => rule.cssText.includes(".status-lamp"));
      }),
    );
    expect(lampRule, "the .status-lamp rule must be gone from the stylesheet too").toBe(
      false,
    );

    // What replaced it has to actually be there: every state the lamps used
    // to sit beside is still legible as TEXT in high contrast.
    await expect(statusRail(page).getByText("printing", { exact: true })).toBeVisible();
    await expect(statusRail(page).getByText("Link Ready", { exact: true })).toBeVisible();
    await expect(hotendGauge(page).getByText("Stable", { exact: true })).toBeVisible();
    mock.assertSealed();
  });

  test("guarded actions confirm through the app's dialog, never window.confirm", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    // `window.confirm` BLOCKS the main thread — telemetry, the alert stack,
    // and the very state being confirmed against all freeze while it sits
    // open. If anything falls back to it, fail loudly.
    await page.addInitScript(() => {
      window.confirm = () => {
        throw new Error("window.confirm must never be used");
      };
    });
    // Cold tuning fixture: the calibration layout with its Emergency stop
    // action, but no stored heat, so the telemetry watchdog cannot overlay
    // an alert mid-click on a slow machine.
    const base = scenario("tuning-macro");
    const mock = await installActiveMock(page, {
      ...base,
      state: {
        ...base.state,
        extruder: { temperature: 27.4, target: 0, power: 0, pressure_advance: 0.042 },
        heater_bed: { temperature: 25.9, target: 0, power: 0 },
      },
    });
    await page.goto("/");
    await expect(
      page.locator("main").getByRole("heading", { name: "Camera", exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /Emergency stop/ }).click();
    const dialog = page.getByRole("dialog", { name: "Emergency stop?" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/immediately disables printer control/),
    ).toBeVisible();

    // Cancel closes the dialog and NO command reaches the printer: the
    // strict mock records any non-subscribe RPC as a write, so assertSealed
    // is the proof the stop was never sent.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    mock.assertSealed();
  });

  test("a live dial draws its value arc and lit lamps in normal colors", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "printing-midjob");

    // The value arc is the thing distinguishing a hot printer from a cold
    // one at a glance. Pin it here in the mode the owner normally runs (the
    // forced-colors test above pins the same parts under high contrast).
    // Selected directly — the glow class that once marked them is deleted.
    const litParts = await page
      .locator('.gauge-dial path[stroke="currentColor"]')
      .evaluateAll((items) =>
        items.map((item) => {
          const style = getComputedStyle(item);
          const box = item.getBoundingClientRect();
          return {
            tag: item.tagName.toLowerCase(),
            shown: style.display !== "none" && style.visibility !== "hidden",
            sized: box.width > 0 && box.height > 0,
          };
        }),
      );
    expect(litParts.length, "a printing machine must draw its value arcs").toBeGreaterThan(0);
    expect(
      litParts.filter((part) => !part.shown || !part.sized),
      "every lit indicator on a hot printer must actually render",
    ).toEqual([]);

    mock.assertSealed();
  });
});
