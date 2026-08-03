/**
 * HealthAlerts watchdog — the alarms must not depend on data arriving.
 *
 * The original thermal-runaway alert only re-evaluated when WebSocket data
 * arrived. Its whole reason to exist — heaters hot, feed dead — is the one
 * scenario where no data arrives, so the alarm could never fire. These tests
 * pin the timer-driven behavior: the strict mock answers the subscribe once
 * and then goes silent forever (exactly a dropped feed), and ONLY the
 * watchdog clock can raise the alerts.
 *
 * Time is driven by Playwright's fake clock so ten silent seconds cost the
 * suite nothing and cannot flake on a loaded CI machine.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  installActiveMock,
  type ActiveMockOptions,
} from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";

// The visible alert cards. (Plain text queries also match the sr-only live
// region that announces each alert, so target the card's stable hook.)
const staleAlert = (page: Page) => page.locator('[data-alert-id="stale-data"]');
const runawayAlert = (page: Page) => page.locator('[data-alert-id="thermal"]');

async function openWith(page: Page, options: ActiveMockOptions) {
  await page.setViewportSize({ width: 800, height: 480 });
  await page.clock.install();
  const mock = await installActiveMock(page, options);
  await page.goto("/");
  await expect(
    page.locator("main").getByRole("heading", { name: "Camera", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  return mock;
}

test.describe("HealthAlerts — telemetry watchdog", () => {
  test("a dead feed while heaters are hot raises the stale-telemetry alert", async ({
    page,
  }) => {
    const mock = await openWith(page, scenario("printing-midjob"));

    // Data just arrived — a healthy cockpit must not alarm on load.
    await expect(staleAlert(page)).toHaveCount(0);

    // Nothing else will ever arrive. Ten-plus silent seconds with the
    // nozzle at 220°C: the timer alone must raise the alarm.
    await page.clock.fastForward(11_000);
    await expect(staleAlert(page)).toBeVisible();

    mock.assertSealed();
  });

  test("thermal runaway fires on the watchdog timer even when the feed is dead", async ({
    page,
  }) => {
    const base = scenario("printing-midjob");
    const mock = await openWith(page, {
      ...base,
      state: {
        ...base.state,
        // 34°C above target — well past the ±15°C runaway threshold. The
        // single status snapshot starts the divergence timer; no further
        // data ever arrives to re-trigger the old data-driven evaluation.
        extruder: { temperature: 254.2, target: 220, power: 0, pressure_advance: 0.042 },
      },
    });

    // Divergence must persist >15s before alarming (anti-flap).
    await expect(runawayAlert(page)).toHaveCount(0);

    await page.clock.fastForward(16_000);
    await expect(runawayAlert(page)).toBeVisible();

    mock.assertSealed();
  });

  test("a cold idle machine stays quiet when the feed goes silent", async ({
    page,
  }) => {
    const base = scenario("at-temperature");
    const mock = await openWith(page, {
      ...base,
      state: {
        ...base.state,
        extruder: { temperature: 27.4, target: 0, power: 0, pressure_advance: 0.042 },
        heater_bed: { temperature: 25.9, target: 0, power: 0 },
      },
    });

    // Cold heaters hold no dangerous energy: a silent feed is a network
    // story (the Link lamp's job), not a thermal emergency.
    await page.clock.fastForward(30_000);
    await expect(staleAlert(page)).toHaveCount(0);
    await expect(runawayAlert(page)).toHaveCount(0);

    mock.assertSealed();
  });
});
