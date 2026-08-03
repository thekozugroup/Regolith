import { expect, test, type Page } from "@playwright/test";

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";
const DEFAULT_ACCENT = "#f7a224"; // must equal DEFAULT_ACCENT in src/lib/useTheme.ts
const ACCENT_KEY = "forge.theme.accent";

async function blockPrinterTraffic(page: Page) {
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === PREVIEW_ORIGIN) {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
}

function computedAccent(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-accent")
      .trim()
      .toLowerCase(),
  );
}

// Regression guard for the initial-load accent bug: a fresh profile (no
// localStorage) used to boot with a legacy #f97316 fallback written as an
// inline style on <html>, permanently overriding the designed CSS default.
test("fresh profile boots with the designed default accent", async ({ page }) => {
  await blockPrinterTraffic(page);
  await page.goto("/");

  expect(
    await page.evaluate((key) => localStorage.getItem(key), ACCENT_KEY),
    "test must run against a genuinely fresh profile",
  ).toBeNull();
  expect(await computedAccent(page)).toBe(DEFAULT_ACCENT);
});

test("a stored non-default accent still wins over the default", async ({ page }) => {
  await blockPrinterTraffic(page);
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [ACCENT_KEY, "#3b82f6"] as const,
  );
  await page.goto("/");

  expect(await computedAccent(page)).toBe("#3b82f6");
});
