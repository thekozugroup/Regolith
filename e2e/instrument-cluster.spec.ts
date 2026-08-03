import { expect, test, type Page } from "@playwright/test";

const printerState = {
  webhooks: { state: "ready", state_message: "Ready" },
  idle_timeout: { state: "Ready" },
  print_stats: { state: "standby", filename: "", print_duration: 0 },
  extruder: { temperature: 25.2, target: 0, power: 0, pressure_advance: 0.04 },
  heater_bed: { temperature: 24.4, target: 0, power: 0 },
  toolhead: { position: [150, 150, 12, 0], homed_axes: "xyz", print_time: 0, estimated_print_time: 0, axis_minimum: [0, 0, 0, 0], axis_maximum: [300, 300, 300, 0] },
  virtual_sdcard: { progress: 0, is_active: false, file_position: 0, file_size: 0 },
  display_status: { progress: 0, message: "Ready" },
  fan: { speed: 0 },
  gcode_move: { position: [150, 150, 12, 0], gcode_position: [150, 150, 12, 0], speed: 50, speed_factor: 1, extrude_factor: 1 },
};

const mockCameraFrame = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#14191f"/><path d="M0 560h1280M0 360h1280M320 0v720M640 0v720M960 0v720" stroke="#29323c" stroke-width="1"/><rect x="500" y="300" width="280" height="180" fill="#222b34" stroke="#5b6876" stroke-width="2"/><path d="M540 450h200M580 410h120" stroke="#d6a343" stroke-width="4"/></svg>`;

type StrictMock = { writes: string[]; escaped: string[]; subscriptions: string[] };

async function installStrictMock(page: Page): Promise<StrictMock> {
  const audit: StrictMock = { writes: [], escaped: [], subscriptions: [] };

  await page.routeWebSocket("**/websocket", (socket) => {
    socket.onMessage((payload) => {
      const request = JSON.parse(String(payload)) as { id?: number; method?: string };
      if (request.method !== "printer.objects.subscribe") {
        audit.writes.push(`rpc:${request.method ?? "unknown"}`);
        socket.close({ code: 1008, reason: "Strict mock permits subscriptions only" });
        return;
      }
      audit.subscriptions.push(request.method);
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { status: printerState } }));
    });
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const local = url.hostname === "127.0.0.1" && url.port === "4173";
    const method = request.method();
    if (method !== "GET" && method !== "HEAD") {
      audit.writes.push(`${method} ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    if (local) {
      await route.continue();
      return;
    }
    if ((url.hostname === "forge.local" || url.hostname === "127.0.0.1") && url.port === "8080") {
      await route.fulfill({ status: 200, contentType: "image/svg+xml", body: mockCameraFrame });
      return;
    }
    audit.escaped.push(request.url());
    await route.abort("blockedbyclient");
  });
  return audit;
}

async function assertInstrumentShell(page: Page) {
  await page.waitForFunction(() => !document.body.innerText.includes("Loading view…"));
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("main > *").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const undersized = await page.locator("button:visible, a:visible, input:visible, select:visible").evaluateAll((items) =>
    items.filter((item) => {
      const box = item.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
    }).map((item) => item.getAttribute("aria-label") || item.textContent?.trim() || item.tagName),
  );
  expect(undersized).toEqual([]);
}

async function assertRouteAudit(page: Page) {
  await assertInstrumentShell(page);
  const clipped = await page.locator("main h2, main h3, main p, main button, main label, main output, main .instrument-label").evaluateAll((items) =>
    items.filter((item) => {
      const style = getComputedStyle(item);
      const box = item.getBoundingClientRect();
      return style.visibility !== "hidden" && box.width > 0 && box.height > 0 && (box.left < -1 || box.right > innerWidth + 1);
    }).map((item) => item.textContent?.trim() || item.getAttribute("aria-label") || item.tagName),
  );
  expect(clipped).toEqual([]);
  const lastControl = page.locator("main button:visible, main a:visible, main input:visible, main select:visible").last();
  if (await lastControl.count()) {
    await lastControl.scrollIntoViewIfNeeded();
    const hiddenByNav = await lastControl.evaluate((item) => {
      if (!matchMedia("(max-width: 767px)").matches) return false;
      const box = item.getBoundingClientRect();
      return box.bottom > innerHeight - 48;
    });
    expect(hiddenByNav).toBe(false);
  }
}

test.describe("Regolith Instrument Cluster — strict local mock", () => {
  test("Basic routes are coherent at 320px and never escape mocked networking", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 720 });
    const audit = await installStrictMock(page);
    await page.addInitScript(() => localStorage.setItem("forge.experience-mode", "basic"));
    for (const route of ["/", "/print", "/control", "/timelapses", "/settings", "/tune", "/console"]) {
      await page.goto(route);
      await assertInstrumentShell(page);
      await page.screenshot({ path: testInfo.outputPath(`basic-320-${route === "/" ? "home" : route.slice(1)}.png`), fullPage: true, animations: "disabled" });
    }
    expect(audit.escaped).toEqual([]);
    expect(audit.writes).toEqual([]);
    expect(audit.subscriptions.length).toBeGreaterThan(0);
  });

  test("Expert routes reflow at desktop and preserve reduced motion", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const audit = await installStrictMock(page);
    await page.addInitScript(() => localStorage.setItem("forge.experience-mode", "expert"));
    for (const route of ["/", "/print", "/control", "/tune", "/timelapses", "/console", "/settings"]) {
      await page.goto(route);
      await assertInstrumentShell(page);
      await page.screenshot({ path: testInfo.outputPath(`expert-1280-${route === "/" ? "home" : route.slice(1)}.png`), fullPage: true, animations: "disabled" });
    }
    expect(audit.escaped).toEqual([]);
    expect(audit.writes).toEqual([]);
    expect(audit.subscriptions.length).toBeGreaterThan(0);
  });

  test("offline camera is locally intercepted and offers recovery without a printer request", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const audit = await installStrictMock(page);
    await page.route("http://127.0.0.1:8080/**", (route) => route.abort("connectionrefused"));
    await page.goto("/");
    await expect(page.getByText("Camera unavailable. Retrying…")).toBeVisible();
    expect(audit.escaped).toEqual([]);
    expect(audit.writes).toEqual([]);
  });

  test("all routes retain readable geometry from 320px through 1280px", async ({ page }, testInfo) => {
    const audit = await installStrictMock(page);
    const routes = ["/", "/print", "/control", "/tune", "/timelapses", "/console", "/settings"];
    for (const viewport of [
      { width: 320, height: 720 },
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1024, height: 900 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.evaluate(() => {
        localStorage.setItem("forge.experience-mode", "basic");
        window.dispatchEvent(new Event("forge:experience-mode-changed"));
      });
      for (const route of routes) {
        await page.goto(route);
        await assertRouteAudit(page);
        await page.screenshot({ path: testInfo.outputPath(`audit-${viewport.width}-basic-${route === "/" ? "home" : route.slice(1)}.png`), fullPage: true, animations: "disabled" });
      }
      await page.goto("/");
      await page.evaluate(() => {
        localStorage.setItem("forge.experience-mode", "expert");
        window.dispatchEvent(new Event("forge:experience-mode-changed"));
      });
      for (const route of routes) {
        await page.goto(route);
        await assertRouteAudit(page);
        await page.screenshot({ path: testInfo.outputPath(`audit-${viewport.width}-expert-${route === "/" ? "home" : route.slice(1)}.png`), fullPage: true, animations: "disabled" });
      }
    }
    expect(audit.escaped).toEqual([]);
    expect(audit.writes).toEqual([]);
  });
});
