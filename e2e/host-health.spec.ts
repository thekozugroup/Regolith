/**
 * Host-health guard — the HOST LOAD tell-tale under mocked pressure.
 *
 * Two prints died on 2026-08-12 to host starvation that surfaced as timer /
 * probe errors. The guard reads `notify_proc_stat_update` — traffic the
 * client already receives ~1 Hz as its link heartbeat — so these tests
 * drive the SAME notification through the sealed fixture and assert the
 * lamp's full lifecycle: dark on an unknown host, lit with the tripping
 * number after sustained pressure, LATCHED once the pressure clears (the
 * spike is over by the time the owner reads the error), and cleared by the
 * standard acknowledge affordance.
 *
 * Time is driven with Playwright's fake clock: the lamp's trigger needs
 * ≥ 40 samples over a 60 s median window, which real time cannot afford in
 * CI and mocked time makes exact.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  installActiveMock,
  useExperience,
  type ActiveMock,
} from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";

const MEM_OK = { memAvailKb: 133_120, memTotalKb: 253_952 };

async function openSystems(page: Page) {
  await page.goto("/");
  await expect(
    page.locator("main").getByRole("heading", { name: "Systems", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
}

/** Push `count` proc-stat samples ~1.5 s apart on the mocked clock. */
async function sustainLoad(
  page: Page,
  mock: ActiveMock,
  cpu: number,
  count: number,
) {
  for (let i = 0; i < count; i += 1) {
    mock.pushProcStat({ cpu, ...MEM_OK });
    // Real-time beat so the socket message lands before the clock jumps.
    await page.waitForTimeout(15);
    await page.clock.fastForward(1_500);
  }
}

const hostLamp = (page: Page) =>
  page.locator('.telltale-cell[data-lamp="host-load"]');

test.describe("HOST LOAD tell-tale", () => {
  test("dark on an unknown host, lit with the tripping number under sustained pressure, latched after it clears, acknowledged by the cell", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    await page.clock.install();
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await openSystems(page);
    await page.clock.fastForward(1_000); // bulb test released

    // Honest-unknown: no proc-stat data has arrived → the lamp exists and
    // is DARK. An unknown host never produces a warning.
    await expect(hostLamp(page)).toHaveAttribute("data-lit", "false");

    // A short burst at 95% is NOT sustained pressure — the median window
    // needs its full sample budget, so the lamp must stay dark.
    await sustainLoad(page, mock, 95, 10);
    await expect(hostLamp(page)).toHaveAttribute("data-lit", "false");

    // Sustained: ~68 s of ≥ 85% median. The lamp lights as a WARNING (a
    // busy host is a risk, not a fault) and the detail line carries the
    // number that tripped it — the non-colour channel.
    await sustainLoad(page, mock, 92, 45);
    await expect(hostLamp(page)).toHaveAttribute("data-lit", "true");
    await expect(hostLamp(page)).toHaveAttribute("data-severity", "warning");
    await expect(hostLamp(page)).toHaveAttribute("data-phase", "on");
    await expect(hostLamp(page).locator(".telltale-detail")).toHaveText(
      "CPU 92% · 60s",
    );

    // Pressure clears. THE POINT OF THE LAMP: the spike that kills a print
    // is over by the time the owner reads the error, so the lamp LATCHES
    // instead of going dark at exactly the moment it matters.
    await sustainLoad(page, mock, 6, 50);
    await expect(hostLamp(page)).toHaveAttribute("data-phase", "latched");
    await expect(hostLamp(page)).toHaveAttribute("data-lit", "true");
    // The latched cell is the acknowledge affordance, labelled as such, and
    // still says WHY it tripped.
    const ack = page.getByRole("button", { name: "Acknowledge Host Load" });
    await expect(ack).toBeVisible();
    await expect(hostLamp(page).locator(".telltale-detail")).toContainText(
      "CPU",
    );

    // Acknowledge with the condition clear → dark.
    await ack.click();
    await expect(hostLamp(page)).toHaveAttribute("data-phase", "off");
    await expect(hostLamp(page)).toHaveAttribute("data-lit", "false");

    mock.assertSealed();
  });

  test("a proc-stat feed with no CPU field stays honest-unknown — never a warning, never a zero", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    await page.clock.install();
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await openSystems(page);
    await page.clock.fastForward(1_000);

    // An older Moonraker shape: memory only, no system_cpu_usage.
    for (let i = 0; i < 45; i += 1) {
      mock.pushProcStat({ ...MEM_OK });
      await page.waitForTimeout(5);
      await page.clock.fastForward(1_500);
    }
    await expect(hostLamp(page)).toHaveAttribute("data-lit", "false");
    await expect(hostLamp(page).locator(".telltale-detail")).toHaveCount(0);

    mock.assertSealed();
  });
});
