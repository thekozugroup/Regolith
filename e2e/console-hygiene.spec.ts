/**
 * Console hygiene — the console has to stay empty enough to be useful.
 *
 * A dashboard that logs a handful of harmless errors on every load is a
 * dashboard where nobody notices the one that matters. This walks the whole
 * state matrix (every printer scenario x every route x both experience modes)
 * and fails on any console error, console warning, uncaught page error, or
 * failed request that is not on the allow-list below.
 *
 * The allow-list is deliberately tiny and each entry carries the reason it is
 * unfixable in JS. Anything else is a bug to fix at its source, not to add
 * here.
 */

import { expect, test, type Page } from "@playwright/test";
import { installActiveMock, type ActiveMock } from "./support/active-state-harness";
import { SCENARIOS, scenario } from "./support/printer-scenarios";

const ROUTES = [
  "/",
  "/print",
  "/control",
  "/tune",
  "/timelapses",
  "/console",
  "/settings",
];

/**
 * The only noise permitted, with its justification.
 *
 * A camera that is unplugged refuses the TCP connection. The browser logs
 * that itself, before any JS sees it, and there is no API to silence it —
 * the app's part is to stop retrying and show the designed offline state,
 * which `regolith.spec.ts` already pins. Everything else must be fixed.
 */
const ALLOWED = [/net::ERR_CONNECTION_REFUSED/];

function isAllowed(message: string): boolean {
  return ALLOWED.some((pattern) => pattern.test(message));
}

function watchConsole(page: Page): { noise: string[]; label: (to: string) => void } {
  const noise: string[] = [];
  let where = "boot";
  const note = (message: string) => {
    if (!isAllowed(message)) noise.push(`${where}: ${message}`);
  };
  page.on("console", (message) => {
    const type = message.type();
    if (type === "error" || type === "warning") {
      note(`console.${type} — ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => note(`uncaught — ${error.message}`));
  page.on("requestfailed", (request) =>
    note(`request failed — ${request.url()} ${request.failure()?.errorText ?? ""}`),
  );
  page.on("response", (response) => {
    if (response.status() >= 400) {
      note(`HTTP ${response.status()} — ${response.url()}`);
    }
  });
  return { noise, label: (to: string) => (where = to) };
}

/** Also assert the app's own rejection ring, which production keeps quiet. */
async function unhandled(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const read = (window as unknown as Record<string, unknown>).__regolithErrors;
    return typeof read === "function"
      ? (read as () => { kind: string; message: string }[])().map(
          (e) => `${e.kind}: ${e.message}`,
        )
      : ["reporter missing"];
  });
}

test.describe("Console hygiene", () => {
  for (const mode of ["basic", "expert"] as const) {
    test(`no console noise across every scenario and route (${mode})`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      const watcher = watchConsole(page);
      const mock: ActiveMock = await installActiveMock(page, SCENARIOS[0]);
      await page.addInitScript((value) => {
        localStorage.setItem("forge.experience-mode", value);
      }, mode);

      for (const target of SCENARIOS) {
        mock.use(target);
        for (const route of ROUTES) {
          watcher.label(`${mode} ${target.id} ${route}`);
          await page.goto(route);
          await expect(
            page.getByRole("status", { name: "Loading view…" }),
            `${route} never settled`,
          ).toHaveCount(0, { timeout: 15_000 });
        }
      }

      expect(await unhandled(page), "unhandled rejections").toEqual([]);
      expect(watcher.noise, "unexplained console output").toEqual([]);
      mock.assertSealed();
    });
  }

  test("a job with an embedded preview loads it without probing a guess", async ({
    page,
  }) => {
    const watcher = watchConsole(page);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(".thumbs/")) requests.push(request.url());
    });

    const mock = await installActiveMock(page, {
      ...scenario("printing-midjob"),
      thumbnail: true,
    });
    await page.goto("/");
    await expect(
      page
        .getByRole("region", { name: "Mission Status" })
        .getByRole("img", { name: /\.gcode$/ }),
    ).toBeVisible({ timeout: 15_000 });

    // Exactly one preview request, at the path Moonraker REPORTED — which is
    // directory-relative, not the flat root-level path the old guess used.
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("/server/files/gcodes/calibration/.thumbs/");
    expect(watcher.noise).toEqual([]);
    mock.assertSealed();
  });

  test("a job with NO embedded preview issues no request at all", async ({
    page,
  }) => {
    // The regression this whole change exists for: the panel used to guess a
    // Fluidd path and probe it with an Image(), so every thumbless job logged
    // a 404 on every dashboard load, forever.
    const watcher = watchConsole(page);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(".thumbs/")) requests.push(request.url());
    });

    const mock = await installActiveMock(page, {
      ...scenario("printing-midjob"),
      thumbnail: false,
    });
    await page.goto("/");
    await expect(
      page.locator("main").getByRole("heading", { name: "Camera", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("region", { name: "Mission Status" }),
    ).toContainText("benchy_0.2mm_PLA_K1Max");

    expect(requests, "a doomed thumbnail request was issued").toEqual([]);
    expect(watcher.noise).toEqual([]);
    mock.assertSealed();
  });
});
