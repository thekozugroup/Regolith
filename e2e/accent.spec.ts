import { expect, test, type Page } from "@playwright/test";

import { PREVIEW_ORIGIN } from "./support/preview-origin";
import { sealPrinterNamespace } from "./support/printer-seal";

const DEFAULT_ACCENT = "#ffb900"; // must equal DEFAULT_ACCENT in src/lib/useTheme.ts — enforced by tests/accentDefault.test.ts
const ACCENT_KEY = "forge.theme.accent";

async function blockPrinterTraffic(page: Page) {
  /** Unmocked printer reads this fixture refused — asserted empty below. */
  const unmocked: string[] = [];
  // page.route() does NOT intercept WebSocket upgrades, and the app's own
  // `/websocket` connect is SAME-ORIGIN — so it sailed straight through the
  // origin check below, into the preview server, and (until vite.config.ts
  // grew an explicit `preview.proxy`) onward toward a real printer. This was
  // the suite's one observed leak. The mute handler answers the socket
  // in-browser: never calling `connectToServer()` means the upgrade never
  // leaves Playwright, whatever the server behind it is wired to.
  await page.routeWebSocket("**/websocket", () => {});
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === PREVIEW_ORIGIN) {
      // Same origin was never the same as safe: `/printer/info` and friends
      // resolve here, and the preview server behind this origin holds a
      // proxy table. Seal first, serve the app's own assets second.
      if (await sealPrinterNamespace(route, url, unmocked)) return;
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
  return unmocked;
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
  const unmocked = await blockPrinterTraffic(page);
  await page.goto("/");

  expect(
    await page.evaluate((key) => localStorage.getItem(key), ACCENT_KEY),
    "test must run against a genuinely fresh profile",
  ).toBeNull();
  expect(await computedAccent(page)).toBe(DEFAULT_ACCENT);
  expect(unmocked, "unmocked printer read reached the catch-all").toEqual([]);
});

test("a stored non-default accent still wins over the default", async ({ page }) => {
  const unmocked = await blockPrinterTraffic(page);
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [ACCENT_KEY, "#3b82f6"] as const,
  );
  await page.goto("/");

  expect(await computedAccent(page)).toBe("#3b82f6");
  expect(unmocked, "unmocked printer read reached the catch-all").toEqual([]);
});
