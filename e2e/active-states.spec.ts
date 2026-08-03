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
 * Fraction of the app-bar progress strip that is filled, or null when the
 * strip is not rendered at all. Measured rather than read off the inline
 * style so the assertion survives float formatting.
 */
async function appBarProgressRatio(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const track = document.querySelector<HTMLElement>('header [class*="h-0.5"]');
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
  await expect(page.locator("main").getByRole("heading", { name: "Camera", exact: true })).toBeVisible();
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
  for (const viewport of VIEWPORTS) {
    test(`every live printer state stays trustworthy at ${viewport.width}x${viewport.height}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const mock = await openDashboard(page);

      for (const target of SCENARIOS) {
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
        expect(railText, `${label}: status rail progress`).toContain(
          `Progress ${target.rail.progress}`,
        );
        expect(railText, `${label}: status rail remaining`).toContain(
          `Remaining ${target.rail.remaining}`,
        );
        expect(railText, `${label}: link health`).toContain("Link Ready");

        await assertOwnerTrust(page, label);
        await page.screenshot({
          path: testInfo.outputPath(`${viewport.name}-${target.id}.png`),
          fullPage: false,
          animations: "disabled",
        });
      }

      mock.assertSealed();
    });
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
    expect(job, "remaining time must be a duration, not a placeholder").toContain(
      "Remaining 1h 6m",
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

    // The app-bar progress strip is the owner's peripheral-vision readout;
    // it only exists while a job is active and must track the same fraction.
    const ratio = await appBarProgressRatio(page);
    expect(ratio, "the app-bar progress strip must render while printing").not.toBeNull();
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
    expect(job).toContain("Remaining 51m 40s");
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
    expect(rail, "a cancelled job is not making progress").toContain("Progress —");
    expect(rail, "a cancelled job has no remaining time").toContain("Remaining —");

    const job = await readPanelText(missionCard(page));
    expect(job).toContain("cancelled");
    expect(job).toContain("Remaining —");
    // No live-job controls survive a cancellation.
    for (const name of ["Pause", "Resume", "Cancel", "Print again"]) {
      await expect(
        missionCard(page).getByRole("button", { name }),
        `a cancelled job must not offer "${name}"`,
      ).toHaveCount(0);
    }

    // Heaters were released with the job — no dial may claim a setpoint.
    await expect(page.locator('.gauge-dial line[stroke="var(--color-gauge-target)"]')).toHaveCount(0);
    // …and nothing is running, so the app-bar strip must be gone entirely.
    expect(
      await appBarProgressRatio(page),
      "a cancelled job must not leave a progress strip on the app bar",
    ).toBeNull();

    await assertOwnerTrust(page, "cancelled detail");
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
    // KNOWN GAP — deliberately not asserted here: the forced-colors rule in
    // src/index.css sets `display: none` on `.phosphor-glow` as well as on
    // `.crt-scanlines::after`, which erases the dial VALUE ARC and every lit
    // status lamp in high-contrast mode. Only `filter: none` was intended.
    // The normal-colors guard below is what currently protects those parts;
    // once the CSS is fixed, move that assertion in here too.
    await assertOwnerTrust(page, "printing @ forced-colors + reduced-motion");
    mock.assertSealed();
  });

  test("a live dial draws its value arc and lit lamps in normal colors", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openDashboard(page);
    await loadScenario(page, mock, "printing-midjob");

    // The value arc and the "active" lamps are the only things distinguishing
    // a hot printer from a cold one at a glance. They carry `.phosphor-glow`,
    // which a forced-colors rule turns off entirely (see index.css) — so pin
    // them here, in the mode the owner normally runs.
    const litParts = await page.locator(".phosphor-glow").evaluateAll((items) =>
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
    expect(litParts.length, "a printing machine must light something up").toBeGreaterThan(0);
    expect(
      litParts.filter((part) => !part.shown || !part.sized),
      "every lit indicator on a hot printer must actually render",
    ).toEqual([]);

    mock.assertSealed();
  });
});
