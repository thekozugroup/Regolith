import { expect, test } from "@playwright/test";
import { installActiveMock } from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";

/**
 * Guarded actions must confirm through the app's own ActionConfirmDialog,
 * never `window.confirm`: the native dialog BLOCKS the main thread, so
 * HealthAlerts' 1s watchdog stops ticking, stale-telemetry and runaway
 * alerts stop evaluating, and the very state the owner is being asked to
 * confirm against freezes for as long as the dialog sits open.
 *
 * MissionTimeline adopted the in-app dialog first (pinned in
 * e2e/active-states.spec.ts); this spec pins the remaining pages through the
 * shared useActionConfirm hook, with the native primitive booby-trapped so
 * any regression to `window.confirm` fails loudly rather than silently
 * re-freezing the watchdog.
 */

test.describe("Guarded actions confirm in-app — never window.confirm", () => {
  test("Settings emergency stop opens the non-blocking dialog; Cancel sends nothing", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => {
      // A native confirm would freeze the watchdog clocks. If any code path
      // ever reaches for it again, fail the action loudly.
      window.confirm = () => {
        throw new Error("window.confirm is banned: it blocks the health watchdog");
      };
    });
    const mock = await installActiveMock(page, scenario("printing-midjob"));
    await page.goto("/settings");

    // Emergency stop is available in both experience modes, even mid-print.
    const stop = page.getByRole("button", { name: "Emergency stop" });
    await expect(stop).toBeEnabled();
    await stop.click();

    // The in-app dialog appears — the page underneath keeps running.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Emergency stop?" })).toBeVisible();

    // Focus lands on Cancel: Enter must not fire a critical action.
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

    // Cancel closes the dialog and nothing is sent to the printer.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    mock.assertSealed();
  });
});
