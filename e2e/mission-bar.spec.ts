/**
 * Mission bar — the cockpit's bottom status strip.
 *
 * The owner's spec: mission status lives in a full-width bar pinned at the
 * BOTTOM of the glass (progress strip + state word + file + progress % +
 * remaining), and on compact chrome it stacks DIRECTLY ABOVE the bottom nav —
 * both pinned, no overlap, nav still reachable. These tests pin that
 * contract at every real viewport, including the K1 Max's own 800x480 panel,
 * with the same strict never-touch-a-real-printer mocking as the rest of the
 * suite.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  assertMissionBarPlacement,
  installActiveMock,
  readPanelText,
} from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";

const VIEWPORTS: Array<{ width: number; height: number }> = [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 800, height: 480 }, // the K1 Max's own panel — the most cramped real viewport
  { width: 1024, height: 768 },
  { width: 1100, height: 800 },
  { width: 1200, height: 900 },
  { width: 1280, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

const missionBar = (page: Page) => page.getByRole("region", { name: "Printer status" });

async function openPrinting(page: Page) {
  const mock = await installActiveMock(page, scenario("printing-midjob"));
  await page.goto("/");
  await expect(
    page.locator("main").getByRole("heading", { name: "Camera", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  return mock;
}

/** Fill fraction of the bar's progress strip, or null when absent. */
async function stripRatio(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const track = document.querySelector<HTMLElement>("[data-mission-progress]");
    const fill = track?.firstElementChild as HTMLElement | null;
    if (!track || !fill) return null;
    const trackWidth = track.getBoundingClientRect().width;
    if (trackWidth === 0) return null;
    return fill.getBoundingClientRect().width / trackWidth;
  });
}

test.describe("Mission bar — pinned bottom cockpit strip", () => {
  for (const viewport of VIEWPORTS) {
    test(`pinned, full-width, and clear of the nav at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const mock = await openPrinting(page);
      const label = `mission bar @ ${viewport.width}x${viewport.height}`;

      await expect(missionBar(page), `${label}: bar must be visible`).toBeVisible();
      await assertMissionBarPlacement(page, label);

      // The strip is full-width too: it spans the bar, the bar spans the glass.
      const stripFullWidth = await page.evaluate(() => {
        const track = document.querySelector<HTMLElement>("[data-mission-progress]");
        if (!track) return null;
        const box = track.getBoundingClientRect();
        return box.left <= 0.5 && box.right >= document.documentElement.clientWidth - 0.5;
      });
      expect(stripFullWidth, `${label}: progress strip must span the full width`).toBe(true);
      const ratio = await stripRatio(page);
      expect(ratio, `${label}: strip must track the job`).not.toBeNull();
      expect(ratio ?? 0).toBeGreaterThan(0.46);
      expect(ratio ?? 0).toBeLessThan(0.49);

      // The bar's readouts stay legible — never hidden to make the bar fit.
      const text = await readPanelText(missionBar(page));
      expect(text, `${label}: state word`).toContain("printing");
      expect(text, `${label}: progress readout`).toContain("Progress 47.3%");
      expect(text, `${label}: remaining readout`).toContain("Remaining");

      // Scrolled to the end, no main content is trapped under the bar: the
      // shell's clearance must cover the bar (and the nav beneath it).
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const clearance = await page.evaluate(() => {
        const bar = document.querySelector('section[aria-label="Printer status"]')!;
        const barTop = bar.getBoundingClientRect().top;
        let maxBottom = -Infinity;
        for (const el of document.querySelectorAll<HTMLElement>("main *")) {
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") continue;
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          if (box.bottom > maxBottom) maxBottom = box.bottom;
        }
        return { barTop, maxBottom };
      });
      expect(
        clearance.maxBottom,
        `${label}: content must not end underneath the mission bar`,
      ).toBeLessThanOrEqual(clearance.barTop + 0.5);

      mock.assertSealed();
    });
  }

  test("stays visible while a print is active, on every route", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openPrinting(page);

    for (const route of ["/", "/settings"]) {
      await page.goto(route);
      await expect(missionBar(page), `${route}: mission bar must persist`).toBeVisible();
      await expect(
        missionBar(page).getByText("printing", { exact: true }),
        `${route}: the state word rides along`,
      ).toBeVisible();
      const ratio = await stripRatio(page);
      expect(ratio, `${route}: the progress strip rides along`).not.toBeNull();
      await assertMissionBarPlacement(page, `mission bar on ${route}`);
    }
    mock.assertSealed();
  });

  test("a leftover filename is cleared once the state returns to standby", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const base = scenario("at-temperature");
    const mock = await installActiveMock(page, {
      ...base,
      state: {
        ...base.state,
        // Klipper keeps print_stats.filename populated long after a job
        // ends — seen live on the K1 Max once the state fell back to plain
        // standby. The bar then read "standby · <old file>", which looks
        // exactly like a queued job that never existed.
        print_stats: {
          state: "standby",
          filename: "finished/lunar_lander_v4.gcode",
          total_duration: 5_480,
          print_duration: 5_412,
          filament_used: 12_004,
          message: "",
        },
      },
    });
    await page.goto("/");
    await expect(
      page.locator("main").getByRole("heading", { name: "Camera", exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    const text = await readPanelText(missionBar(page));
    expect(text).toContain("standby");
    expect(text, "a stale filename must not read as a queued job").not.toContain(
      "lunar_lander_v4",
    );
    expect(text).toContain("No active job");
    mock.assertSealed();
  });

  test("an ended job's filename is contextualized, never presented as live", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await installActiveMock(page, scenario("cooling-after-job"));
    await page.goto("/");
    await expect(
      page.locator("main").getByRole("heading", { name: "Camera", exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // While the ended state still explains the filename, keep it — labelled
    // as history ("Last:"), not as a job the machine is running.
    const text = await readPanelText(missionBar(page));
    expect(text).toContain("complete");
    expect(text).toContain("Last: lunar_lander_v4");
    mock.assertSealed();
  });

  test("an idle machine keeps the bar but not the progress strip", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await installActiveMock(page, scenario("tuning-macro"));
    await page.goto("/");
    await expect(
      page.locator("main").getByRole("heading", { name: "Camera", exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    await expect(missionBar(page)).toBeVisible();
    await expect(missionBar(page).getByText("standby", { exact: true })).toBeVisible();
    expect(
      await stripRatio(page),
      "no active print file — the strip must not render",
    ).toBeNull();
    await assertMissionBarPlacement(page, "mission bar while idle");
    mock.assertSealed();
  });
});
