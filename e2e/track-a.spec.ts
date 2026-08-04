/**
 * Track A — the calibrated estimate, and the assistant's default silence.
 *
 * Two properties are pinned here:
 *
 *   1. The calibrated remaining time appears in the early-job window the
 *      measured extrapolation cannot serve, and it NEVER wears the styling of
 *      a measured value: `~` prefix, muted rather than accented, provenance
 *      in text. When the history endpoints are absent — which is the default
 *      in every other fixture in this suite — the panel reads `—` exactly as
 *      it always has.
 *   2. With no assistant key configured, no assistant affordance exists
 *      anywhere in the app. Not disabled, not a placeholder: absent.
 */

import { expect, test, type Page } from "@playwright/test";
import { installActiveMock, useExperience } from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";

/** Mid-job fixture rewound to 45 s in — below both jobProgress trust floors. */
const EARLY_JOB = (() => {
  const base = scenario("printing-midjob");
  return {
    ...base,
    state: {
      ...base.state,
      print_stats: {
        ...base.state.print_stats!,
        total_duration: 96,
        print_duration: 45,
      },
      virtual_sdcard: {
        ...base.state.virtual_sdcard!,
        progress: 0.004,
        file_position: 40_000,
      },
    },
  };
})();

/** Five completed jobs that each ran 20% over their slicer estimate. */
const HISTORY = {
  result: {
    jobs: Array.from({ length: 5 }, (_, i) => ({
      job_id: `0000${i}`,
      status: "completed",
      print_duration: 7_200,
      metadata: { estimated_time: 6_000 },
    })),
  },
};

/**
 * The history routes must be registered AFTER the harness's catch-all —
 * Playwright resolves handlers last-registered-first, so installing them
 * first would let the catch-all swallow them.
 */
async function open(
  page: Page,
  {
    path = "/",
    history = false,
    estimate = null as number | null,
  }: { path?: string; history?: boolean; estimate?: number | null } = {},
) {
  await page.setViewportSize({ width: 1280, height: 900 });
  const mock = await installActiveMock(page, EARLY_JOB);
  if (history) {
    await page.route("**/server/history/list*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(HISTORY),
      }),
    );
    await page.route("**/server/files/metadata*", (route) =>
      route.fulfill({
        status: estimate == null ? 404 : 200,
        contentType: "application/json",
        body: JSON.stringify({ result: { estimated_time: estimate } }),
      }),
    );
  }
  await page.goto(path);
  return mock;
}

const remaining = (page: Page) =>
  page.locator("main").getByText("Remaining", { exact: true }).locator("..");

test.describe("Calibrated remaining time", () => {
  test("fills the early-job window, marked as an estimate and never as telemetry", async ({
    page,
  }) => {
    const mock = await open(page, { history: true, estimate: 6_000 });

    const value = page.locator("main [data-estimate='true']");
    await expect(value).toBeVisible({ timeout: 15_000 });

    // 1.2 × 6000 = 7200s calibrated total, 45s spent → about two hours left.
    const text = (await value.textContent()) ?? "";
    expect(text.trim().startsWith("~"), `got ${text}`).toBe(true);
    expect(text).toMatch(/^~(1h 5\d|2h 0)/);

    // It must not be wearing the accent that measured values wear.
    const color = await value.evaluate((el) => getComputedStyle(el).color);
    const accent = await value.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--color-accent").trim(),
    );
    expect(accent).not.toBe("");
    expect(color).not.toBe(accent);

    // And its provenance travels with it as ALWAYS-VISIBLE text — never a
    // hover-only title: no tooltip exists on the K1's touch panel or a
    // phone. Visible text reaches screen readers too.
    await expect(value).toContainText("completed prints");
    const provenance = value.locator("[data-provenance]");
    await expect(provenance).toContainText("completed prints");
    const provenanceBox = await provenance.boundingBox();
    expect(provenanceBox, "provenance box").not.toBeNull();
    expect(provenanceBox!.height, "provenance must be rendered, not sr-only").toBeGreaterThan(8);
    expect(provenanceBox!.width, "provenance must be rendered, not sr-only").toBeGreaterThan(40);
    const provenanceSize = await provenance.evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    expect(provenanceSize).toBeGreaterThanOrEqual(11);

    // 11px floor still holds on the estimate.
    const size = await value.evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    expect(size).toBeGreaterThanOrEqual(11);

    mock.assertSealed();
  });

  test("says nothing at all when the slicer emitted no estimate", async ({
    page,
  }) => {
    const mock = await open(page, { history: true, estimate: null });
    await expect(
      page.locator("main").getByRole("heading", { name: "Mission Status" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("main [data-estimate='true']")).toHaveCount(0);
    await expect(remaining(page)).toContainText("—");
    mock.assertSealed();
  });

  test("says nothing at all when print history is unavailable", async ({
    page,
  }) => {
    // No route overrides: /server/history/* 404s, exactly as it would on a
    // Moonraker with its history component disabled.
    const mock = await open(page);
    await expect(
      page.locator("main").getByRole("heading", { name: "Mission Status" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("main [data-estimate='true']")).toHaveCount(0);
    await expect(remaining(page)).toContainText("—");
    mock.assertSealed();
  });
});

test.describe("Assistant defaults", () => {
  test("no assistant affordance exists anywhere without a key", async ({
    page,
  }) => {
    const mock = await open(page);
    await expect(
      page.locator("main").getByRole("heading", { name: "Mission Status" }),
    ).toBeVisible({ timeout: 15_000 });

    for (const path of ["/", "/console", "/files", "/tune"]) {
      await page.goto(path);
      await expect(page.locator("[data-ai-gloss]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Explain/i })).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /Review failure log/i }),
      ).toHaveCount(0);
    }

    mock.assertSealed();
  });

  test("the settings panel is opt-in: features are unreachable until configured", async ({
    page,
  }) => {
    // The panel itself is an Expert surface (the API-key/endpoint fields are
    // the app's only egress affordance); Basic-mode absence is pinned in
    // e2e/regolith.spec.ts.
    await useExperience(page, "expert");
    const mock = await open(page, { path: "/settings" });
    const card = page
      .locator("section, article, div")
      .filter({ has: page.getByRole("heading", { name: "Assistant" }) })
      .first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    // The honesty clause: the two default-on statistics are explicitly NOT
    // part of this panel, and the copy must keep saying so.
    await expect(card).toContainText("not part of this");
    await expect(card).toContainText("never sent");

    // Feature toggles are inside a disabled fieldset until endpoint + key.
    const toggle = page.getByRole("button", { name: /Explain messages/i });
    await expect(toggle).toBeDisabled();

    mock.assertSealed();
  });
});
