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
  type ActiveMock,
  type ActiveMockOptions,
} from "./support/active-state-harness";
import { SCENARIOS, scenario } from "./support/printer-scenarios";

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
};

async function openDashboard(page: Page): Promise<ActiveMock> {
  const mock = await installActiveMock(page, SCENARIOS[0]);
  await page.goto("/");
  return mock;
}

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
    await expect(
      page.locator("main").getByRole("heading", { name: "Camera", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
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

test.describe("Chrome error containment", () => {
  test("a throwing chrome panel is contained — the rest of the shell survives", async ({
    page,
  }) => {
    const mock = await openDashboard(page);
    // Fault injection through CrashSeam, armed only by this hand-set key.
    // MissionBar sits OUTSIDE <main>, above the route boundary; before
    // ChromeErrorBoundary its first render throw took the whole document.
    await page.evaluate(() => {
      window.localStorage.setItem("forge.debug.crash", "mission-bar");
    });
    await page.reload();

    // The route still rendered, navigation still works, and the failure is
    // named rather than silent.
    await expect(
      page.locator("main").getByRole("heading", { name: "Camera", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("navigation").first()).toBeVisible();
    await expect(page.getByText("Status bar unavailable")).toBeVisible();
    mock.assertSealed();
  });

  test("a throwing route is contained — the chrome around it survives", async ({
    page,
  }) => {
    const mock = await openDashboard(page);
    await page.evaluate(() => {
      window.localStorage.setItem("forge.debug.crash", "route");
    });
    await page.reload();

    await expect(page.getByRole("heading", { name: "View could not load" })).toBeVisible();
    // Chrome the owner needs in order to get OUT of the broken view.
    await expect(page.getByRole("region", { name: "Printer status" })).toBeVisible();
    await expect(page.getByRole("navigation").first()).toBeVisible();
    mock.assertSealed();
  });
});

test.describe("Unhandled rejections", () => {
  test("walking every route leaves no unhandled rejection behind", async ({
    page,
  }) => {
    const log = collectConsole(page);
    const mock = await installActiveMock(page, SCENARIOS[0]);
    await page.addInitScript(() => {
      localStorage.setItem("forge.experience-mode", "expert");
    });

    for (const path of [
      "/",
      "/print",
      "/control",
      "/tune",
      "/timelapses",
      "/console",
      "/settings",
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole("status", { name: "Loading view…" }),
        `${path} never settled`,
      ).toHaveCount(0, { timeout: 15_000 });
    }

    // Read the app's own reporter rather than the console: the e2e build is
    // production, where the reporter stays quiet, so the console alone would
    // prove nothing about the artifact that actually ships.
    const unhandled = await page.evaluate(() => {
      const read = (window as unknown as Record<string, unknown>).__regolithErrors;
      return typeof read === "function"
        ? (read as () => { kind: string; message: string }[])()
        : null;
    });
    expect(unhandled, "the error reporter was not installed").not.toBeNull();
    expect(unhandled, "unhandled rejections while walking the app").toEqual([]);
    expect(log.errors, "console errors while walking the app").toEqual([]);
    mock.assertSealed();
  });
});

test.describe("Sleep, wake and stale links", () => {
  /**
   * Time is Playwright's fake clock throughout: twenty silent seconds cost
   * the suite nothing and cannot flake on a loaded machine.
   */
  async function open(page: Page, options: ActiveMockOptions) {
    await page.setViewportSize({ width: 800, height: 480 });
    await page.clock.install();
    const mock = await installActiveMock(page, options);
    await page.goto("/");
    await expect(
      page.locator("main").getByRole("heading", { name: "Camera", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    return mock;
  }

  /**
   * A finished job on a printer that has fully cooled. The hot-heater
   * watchdog is deliberately silent here, which is exactly the gap this
   * alert covers: nothing is dangerous, the screen is merely WRONG.
   */
  function coldIdle(): ActiveMockOptions {
    const base = scenario("cancelled");
    return {
      ...base,
      state: {
        ...base.state,
        extruder: { temperature: 24.2, target: 0, power: 0 },
        heater_bed: { temperature: 23.6, target: 0, power: 0 },
      },
    };
  }

  const staleLink = (page: Page) => page.locator('[data-alert-id="link-stale"]');

  test("a feed that goes quiet stops looking live", async ({ page }) => {
    const mock = await open(page, coldIdle());
    // One real push: until the server has spoken unprompted, silence proves
    // nothing and the alert must stay closed.
    mock.push({ virtual_sdcard: { progress: 0.072 } });
    await expect(staleLink(page)).toHaveCount(0);

    await page.clock.fastForward(21_000);
    await expect(staleLink(page)).toBeVisible();
    await expect(staleLink(page)).toContainText("No printer data for");
    // A frozen dashboard is not a thermal emergency; it must not borrow the
    // runaway alert's voice.
    await expect(page.locator('[data-alert-id="thermal"]')).toHaveCount(0);

    // The feed coming back retires the warning without a reload.
    mock.push({ virtual_sdcard: { progress: 0.072 } });
    await expect(staleLink(page)).toHaveCount(0);
    mock.assertSealed();
  });

  test("a hot machine gets the sharper warning, not both", async ({ page }) => {
    const mock = await open(page, scenario("printing-midjob"));
    mock.push({ virtual_sdcard: { progress: 0.4 } });
    await page.clock.fastForward(21_000);
    // Hot heaters flying blind is an emergency and says so; the general
    // staleness note would only dilute it.
    await expect(page.locator('[data-alert-id="stale-data"]')).toBeVisible();
    await expect(staleLink(page)).toHaveCount(0);
    mock.assertSealed();
  });

  test("a server that never pushes is never accused of going quiet", async ({
    page,
  }) => {
    // The strict fixture answers the subscribe and says nothing more, which
    // is exactly the shape of a server that is quiet BY DESIGN.
    const mock = await open(page, coldIdle());
    await page.clock.fastForward(60_000);
    await expect(staleLink(page)).toHaveCount(0);
    mock.assertSealed();
  });

  test("a tab coming back from sleep re-establishes the link", async ({ page }) => {
    const mock = await open(page, scenario("printing-midjob"));
    await expect(page.getByRole("region", { name: "Printer status" })).toContainText(
      "Link Ready",
    );

    // The lid closes: the socket dies without the app being told anything
    // useful, and the dashboard freezes on its last values.
    mock.dropLink();
    await expect(
      page.getByRole("region", { name: "Printer status" }),
    ).toContainText("Link Connecting");

    // The lid opens. visibilitychange must drive a reconnect NOW rather than
    // serving out a backoff that was scheduled before the machine slept.
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    await expect(
      page.getByRole("region", { name: "Printer status" }),
    ).toContainText("Link Ready");
    mock.assertSealed();
  });
});
