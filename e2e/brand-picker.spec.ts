import { expect, test, type Page } from "@playwright/test";
import { installActiveMock } from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";

const picker = (page: Page) =>
  page.locator('div[role="dialog"][aria-label="Choose brand icon"]');
const trigger = (page: Page) =>
  page.getByRole("button", { name: "Change brand icon" }).first();

async function openPicker(page: Page) {
  const button = trigger(page);
  await expect(button).toBeVisible();
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(picker(page)).toBeVisible();
  return button;
}

async function openDashboard(page: Page) {
  await page.goto("/");
  await expect(
    page.locator("main").getByRole("heading", { name: "Camera", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe("Brand icon picker", () => {
  test("keeps a clear keyboard focus lifecycle without a focus trap", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await openDashboard(page);

    const button = await openPicker(page);
    const dialog = picker(page);
    await expect(button).toHaveAttribute("aria-haspopup", "dialog");
    const dialogId = await dialog.getAttribute("id");
    expect(dialogId).not.toBeNull();
    await expect(button).toHaveAttribute("aria-controls", dialogId!);
    await expect(dialog.getByRole("button", { name: "hammer brand icon" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();

    await openPicker(page);
    await dialog.getByRole("button", { name: "star brand icon" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();

    await openPicker(page);
    await dialog.getByRole("button", { name: "Close brand icon picker" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();

    await openPicker(page);
    await dialog.getByRole("button", { name: "Close brand icon picker" }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();

    await openPicker(page);
    await dialog.getByRole("button", { name: "Reset to default" }).focus();
    await page.keyboard.press("Tab");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Home", exact: true })).toBeFocused();
    mock.assertSealed();
  });

  test("outside pointer dismisses without taking focus from its clicked control", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await openDashboard(page);
    await openPicker(page);
    await page.evaluate(() => {
      const outside = document.createElement("button");
      outside.type = "button";
      outside.textContent = "Picker outside control";
      outside.setAttribute("data-brand-picker-outside", "true");
      outside.style.cssText = "position:fixed;right:8px;top:8px;z-index:200";
      document.body.append(outside);
    });

    const outside = page.locator("[data-brand-picker-outside]");
    await outside.click();
    await expect(picker(page)).toHaveCount(0);
    await expect(outside).toBeFocused();
    mock.assertSealed();
  });

  test("keeps the picker alive through local image selection and restores the trigger", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await openDashboard(page);
    const button = await openPicker(page);
    const dialog = picker(page);

    const chooserPromise = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: "Upload image…" }).click();
    const chooser = await chooserPromise;
    await expect(dialog).toBeVisible();
    await chooser.setFiles("docs/screenshot.png");

    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button.locator('img[alt="Forge"]')).toBeVisible();
    mock.assertSealed();
  });

  for (const viewport of [
    { width: 800, height: 600 },
    { width: 768, height: 600 },
    { width: 1280, height: 600 },
    { width: 320, height: 720 },
    // K1 Max touch chrome may intentionally omit the desktop picker. When it
    // is present, it still has to be fully reachable rather than clipped.
    { width: 800, height: 480 },
  ]) {
    test(`stays inside ${viewport.width}x${viewport.height} when offered`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const mock = await installActiveMock(page, scenario("at-temperature"));
      await openDashboard(page);
      const button = trigger(page);

      if (viewport.width >= 768 && viewport.height >= 600) {
        await expect(button).toBeVisible();
      } else if (!(await button.isVisible())) {
        mock.assertSealed();
        return;
      }

      await button.click();
      const dialog = picker(page);
      await expect(dialog).toBeVisible();
      const bounds = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          scrollable: element.scrollHeight > element.clientHeight,
        };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(7);
      expect(bounds.top).toBeGreaterThanOrEqual(7);
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth - 7);
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight - 7);
      const reset = dialog.getByRole("button", { name: "Reset to default" });
      await reset.scrollIntoViewIfNeeded();
      await expect(reset).toBeVisible();
      if (viewport.width === 800 && viewport.height === 600) {
        await page.screenshot({
          path: testInfo.outputPath("brand-picker-800x600.png"),
          fullPage: false,
          animations: "disabled",
        });
      }
      mock.assertSealed();
    });
  }

  test("dismisses if resizing removes the desktop trigger", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await openDashboard(page);
    await expect(trigger(page)).toBeVisible();
    await trigger(page).click();
    await expect(picker(page)).toBeVisible();

    await page.setViewportSize({ width: 800, height: 480 });
    await expect(picker(page)).toHaveCount(0);
    mock.assertSealed();
  });
});
