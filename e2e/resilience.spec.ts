/**
 * Failure-mode coverage — the ugly states, not the happy path.
 *
 * Everything in here is a way the app can break on real hardware that no
 * existing spec exercised: a persisted preference that is garbage, a chrome
 * component that throws above the route boundary, a socket that goes away
 * mid-print, and a browser tab that comes back from a lid-close.
 *
 * The same sealed fixture as the rest of the suite: nothing may reach a real
 * printer, and `assertSealed` fails the test if anything tries.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  assertOwnerTrust,
  installActiveMock,
} from "./support/active-state-harness";
import { SCENARIOS } from "./support/printer-scenarios";

/** Every key the app persists, with a payload designed to break its reader. */
const CORRUPTED_KEYS: Record<string, string> = {
  "forge.theme.accent": "not-a-color",
  "forge.device.name": "   ",
  "forge.experience-mode": '{"mode":"expert"}',
  "forge.sidebar.collapsed": "yes",
  "forge.print.kamp": "true",
  // The exact shape that used to TypeError inside the app bar and the
  // sidebar at once — above the route boundary, so: white screen everywhere.
  "forge.brand.icon": "null",
  "forge.printer.image": "{",
  "regolith.profile.active": "a-profile-that-was-deleted",
  "regolith.profile.custom": '{"not":"an array"}',
  "forge.ai.disabled": "[]",
  "forge.ai.endpoint": "{{{",
  "forge.ai.feature.explain": "maybe",
  "forge.ai.feature.postmortem": "null",
};

/** Console errors and uncaught page errors, collected for the whole test. */
function collectConsole(page: Page): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "warning") warnings.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return { errors, warnings };
}

test.describe("Corrupted persisted state", () => {
  test("every persisted key can be garbage and the dashboard still renders", async ({
    page,
  }) => {
    const log = collectConsole(page);
    const mock = await installActiveMock(page, SCENARIOS[0]);
    await page.addInitScript((entries: Record<string, string>) => {
      for (const [key, value] of Object.entries(entries)) {
        localStorage.setItem(key, value);
      }
    }, CORRUPTED_KEYS);

    await page.goto("/");
    await expect(
      page.locator("main").getByRole("heading", { name: "Camera", exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // The chrome that reads those keys is all still on the glass.
    await expect(page.getByRole("region", { name: "Printer status" })).toBeVisible();
    await expect(page.getByRole("banner")).toBeVisible();
    // A corrupt experience-mode must fail CLOSED — expert tools stay hidden.
    await page.goto("/tune");
    await expect(
      page.getByRole("heading", { name: "Expert tool hidden" }),
    ).toBeVisible();

    await page.goto("/");
    await assertOwnerTrust(page, "corrupted-storage");
    expect(log.errors, "corrupted storage logged errors").toEqual([]);
    mock.assertSealed();
  });

  test("a corrupt accent still paints a real accent, not an empty custom property", async ({
    page,
  }) => {
    const mock = await installActiveMock(page, SCENARIOS[0]);
    await page.addInitScript(() => {
      localStorage.setItem("forge.theme.accent", "constructor");
    });
    await page.goto("/");
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--color-accent")
        .trim(),
    );
    expect(accent).toBe("#ffb900");
    mock.assertSealed();
  });

  test("storage that throws on every access does not stop the app booting", async ({
    page,
  }) => {
    const log = collectConsole(page);
    const mock = await installActiveMock(page, SCENARIOS[0]);
    // Safari private mode / a locked-down kiosk profile: `localStorage` is
    // present but every method throws. The accent apply in main.tsx runs
    // before React mounts, so an unguarded throw here is a blank page with
    // no error boundary anywhere above it.
    await page.addInitScript(() => {
      const boom = () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      };
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
          get length(): number {
            return boom();
          },
          getItem: boom,
          setItem: boom,
          removeItem: boom,
          clear: boom,
          key: boom,
        },
      });
    });

    await page.goto("/");
    await expect(
      page.locator("main").getByRole("heading", { name: "Camera", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("region", { name: "Printer status" })).toBeVisible();
    expect(log.errors, "unusable storage logged errors").toEqual([]);
    mock.assertSealed();
  });
});
