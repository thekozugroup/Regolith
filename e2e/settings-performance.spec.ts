import { expect, test } from "@playwright/test";
import { installActiveMock, useExperience } from "./support/active-state-harness";

const READY_STATE = {
  webhooks: { state: "ready", state_message: "Printer is ready" },
  idle_timeout: { state: "Ready" },
  print_stats: { state: "standby", filename: "" },
  heater_bed: { temperature: 25, target: 0, power: 0 },
};

test.describe("Settings host-data performance", () => {
  test("fetches stable details once and uses live proc-stat pushes", async ({ page }) => {
    const counts = new Map<string, number>();
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (["/machine/system_info", "/printer/info", "/server/info", "/machine/proc_stats"].includes(pathname)) {
        counts.set(pathname, (counts.get(pathname) ?? 0) + 1);
      }
    });
    await useExperience(page, "expert");
    const mock = await installActiveMock(page, { state: READY_STATE });
    await page.goto("/settings");
    await expect(page.locator("main").getByRole("heading", { name: "System" })).toBeVisible();
    await expect(page.getByText("K1 Max test fixture")).toBeVisible();
    await expect(page.getByText("v0.12.0-345-g1a2b3c4")).toBeVisible();
    await expect(page.getByText("v0.8.0-test")).toBeVisible();
    const startupCounts = new Map(counts);

    mock.pushProcStat({ cpu: 15, memTotalKb: 256_000, memAvailKb: 96_000, uptimeS: 3_600 });
    await expect(page.getByText("156 MB / 250 MB")).toBeVisible();
    await expect(page.getByText("1h 0m", { exact: true })).toBeVisible();
    await expect(page.getByTestId("host-data-freshness")).toContainText("Memory live");
    await page.waitForTimeout(5_500);

    for (const path of ["/machine/system_info", "/printer/info", "/server/info"]) {
      expect(counts.get(path)).toBe(startupCounts.get(path));
      expect(counts.get(path)).toBeLessThanOrEqual(2);
    }
    expect(counts.get("/machine/proc_stats") ?? 0).toBe(0);
    mock.assertSealed();
  });

  test("refreshes stable host details after a reconnect", async ({ page }) => {
    const counts = new Map<string, number>();
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/machine/system_info") counts.set(pathname, (counts.get(pathname) ?? 0) + 1);
    });
    await useExperience(page, "expert");
    const mock = await installActiveMock(page, { state: READY_STATE });
    await page.goto("/settings");
    await expect(page.getByText("K1 Max test fixture")).toBeVisible();
    const initialReads = counts.get("/machine/system_info") ?? 0;
    expect(initialReads).toBeGreaterThan(0);
    expect(initialReads).toBeLessThanOrEqual(2);
    mock.dropLink();
    await expect.poll(() => counts.get("/machine/system_info") ?? 0, { timeout: 15_000 }).toBe(initialReads + 1);
    mock.assertSealed();
  });

  test("preserves stable-read errors through live pushes and retries to fresh CPU/version data", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-09T12:00:00Z") });
    await useExperience(page, "expert");
    const mock = await installActiveMock(page, { state: READY_STATE });
    let attempts = 0;
    await page.route("**/machine/system_info", async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ result: null }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: { cpu_info: { processor: "Legacy CPU shape" } } }),
      });
    });
    await page.goto("/settings");
    await expect(page.getByText(/system information response was malformed/)).toBeVisible();
    mock.pushProcStat({ cpu: 14, memTotalKb: 200_000, memAvailKb: 100_000, uptimeS: 700 });
    await expect(page.getByText(/system information response was malformed/)).toBeVisible();
    await page.clock.fastForward(5_000);
    await expect(page.getByText("Legacy CPU shape")).toBeVisible();
    await expect(page.getByText("v0.12.0-345-g1a2b3c4")).toBeVisible();
    await expect(page.getByText(/system information response was malformed/)).toHaveCount(0);
    expect(attempts).toBe(2);
    mock.assertSealed();
  });

  test("fills missing pushed uptime through a bounded fallback while keeping pushed memory", async ({ page }) => {
    let procStatsReads = 0;
    await page.clock.install({ time: new Date("2026-10-09T12:00:00Z") });
    await useExperience(page, "expert");
    const mock = await installActiveMock(page, { state: READY_STATE });
    await page.route("**/machine/proc_stats", async (route) => {
      procStatsReads += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: { system_uptime: 3_600 } }),
      });
    });
    await page.goto("/settings");
    await expect(page.getByText("K1 Max test fixture")).toBeVisible();
    mock.pushProcStat({ memTotalKb: 256_000, memAvailKb: 96_000 });
    await expect(page.getByText("156 MB / 250 MB")).toBeVisible();
    await page.clock.fastForward(2_000);
    await expect.poll(() => procStatsReads).toBe(1);
    await expect(page.getByText("1h 0m", { exact: true })).toBeVisible();
    await expect(page.getByText("156 MB / 250 MB")).toBeVisible();
    expect(procStatsReads).toBe(1);
    mock.assertSealed();
  });

  test("shows last-known telemetry and advancing age after disconnect", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-09T12:00:00Z") });
    await useExperience(page, "expert");
    const mock = await installActiveMock(page, { state: READY_STATE });
    await page.goto("/settings");
    await expect(page.getByText("K1 Max test fixture")).toBeVisible();
    mock.pushProcStat({ memTotalKb: 256_000, memAvailKb: 96_000, uptimeS: 3_600 });
    await expect(page.getByTestId("host-data-freshness")).toContainText("Memory live");
    mock.dropLink();
    await expect(page.getByTestId("host-data-freshness")).toContainText("Offline · Last-known host data");
    await page.clock.fastForward(2_000);
    await expect(page.getByTestId("host-data-freshness")).toContainText("memory 2s");
    await expect(page.getByText("1h 0m", { exact: true })).toBeVisible();
    await expect(page.getByText("156 MB / 250 MB")).toBeVisible();
    mock.assertSealed();
  });

  test("a delayed fallback cannot overwrite newer pushed host values", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-09T12:00:00Z") });
    await page.addInitScript(() => {
      type TestWindow = Window & { __procFallbackCount?: number; __releaseProcFallback?: () => void };
      const target = window as TestWindow;
      target.__procFallbackCount = 0;
      const realFetch = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url, location.href);
        if (url.pathname !== "/machine/proc_stats") return realFetch(input, init);
        target.__procFallbackCount = (target.__procFallbackCount ?? 0) + 1;
        return new Promise<Response>((resolve, reject) => {
          target.__releaseProcFallback = () => resolve(new Response(JSON.stringify({ result: {
            system_memory: { total: 999_000, available: 1 }, system_uptime: 500,
          } }), { status: 200, headers: { "Content-Type": "application/json" } }));
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      }) as typeof fetch;
    });
    await useExperience(page, "expert");
    const mock = await installActiveMock(page, { state: READY_STATE });
    await page.goto("/settings");
    await expect(page.getByText("K1 Max test fixture")).toBeVisible();
    await page.clock.fastForward(2_000);
    await expect.poll(() => page.evaluate(() => (window as Window & { __procFallbackCount?: number }).__procFallbackCount ?? 0)).toBe(1);
    mock.pushProcStat({ memTotalKb: 256_000, memAvailKb: 96_000, uptimeS: 3_600 });
    await expect(page.getByText("156 MB / 250 MB")).toBeVisible();
    await page.evaluate(() => (window as Window & { __releaseProcFallback?: () => void }).__releaseProcFallback?.());
    await page.clock.fastForward(1_000);
    await expect(page.getByText("156 MB / 250 MB")).toBeVisible();
    await expect(page.getByText("1h 0m", { exact: true })).toBeVisible();
    mock.assertSealed();
  });

  test("bounds and serializes proc-stat fallback requests when the endpoint hangs", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-09T12:00:00Z") });
    await page.addInitScript(() => {
      type TestWindow = Window & { __procStatsFallbackCount?: number };
      const target = window as TestWindow;
      target.__procStatsFallbackCount = 0;
      const realFetch = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url, location.href);
        if (url.pathname !== "/machine/proc_stats") return realFetch(input, init);
        target.__procStatsFallbackCount = (target.__procStatsFallbackCount ?? 0) + 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      }) as typeof fetch;
    });
    await useExperience(page, "expert");
    const mock = await installActiveMock(page, { state: READY_STATE });
    await page.goto("/settings");
    await expect(page.getByText("K1 Max test fixture")).toBeVisible();
    await page.clock.fastForward(2_000);
    await expect.poll(() => page.evaluate(() => (window as Window & { __procStatsFallbackCount?: number }).__procStatsFallbackCount ?? 0)).toBe(1);
    await page.clock.fastForward(6_000);
    await expect(page.getByText(/stale/i)).toBeVisible();
    expect(await page.evaluate(() => (window as Window & { __procStatsFallbackCount?: number }).__procStatsFallbackCount)).toBe(1);
    await page.clock.fastForward(7_000);
    await expect.poll(() => page.evaluate(() => (window as Window & { __procStatsFallbackCount?: number }).__procStatsFallbackCount ?? 0)).toBe(2);
    mock.assertSealed();
  });
});
