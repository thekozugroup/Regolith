import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";

import { PREVIEW_ORIGIN } from "./support/preview-origin";
import { isPrinterNamespace } from "./support/printer-egress";

const CAMERA_ORIGIN = "http://127.0.0.1:8080";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const IDLE_STATE = {
  print_stats: {
    state: "standby",
    filename: "",
    total_duration: 0,
    print_duration: 0,
    filament_used: 0,
    message: "",
  },
  idle_timeout: { state: "Idle" },
  virtual_sdcard: {
    progress: 0,
    is_active: false,
    file_position: 0,
    file_size: 0,
  },
  webhooks: { state: "ready", state_message: "Printer is ready" },
  extruder: { temperature: 28.1, target: 0, power: 0, pressure_advance: 0.04 },
  heater_bed: { temperature: 26.4, target: 0, power: 0 },
  toolhead: {
    position: [150, 150, 10, 0],
    homed_axes: "xyz",
    print_time: 0,
    estimated_print_time: 0,
    max_velocity: 600,
    max_accel: 20_000,
    axis_minimum: [0, 0, 0, 0],
    axis_maximum: [300, 300, 300, 0],
  },
  display_status: { progress: 0, message: "" },
  fan: { speed: 0 },
  gcode_move: {
    position: [150, 150, 10, 0],
    gcode_position: [150, 150, 10, 0],
    speed: 0,
    speed_factor: 1,
    extrude_factor: 1,
    homing_origin: [0, 0, 0, 0],
  },
};

type ExperienceMode = "basic" | "expert";

const routeReadyHeadings: Record<string, Record<ExperienceMode, string>> = {
  "/": { basic: "Camera", expert: "Camera" },
  "/print": { basic: "Files", expert: "Files" },
  "/control": { basic: "Toolhead", expert: "Toolhead" },
  "/tune": { basic: "Expert tool hidden", expert: "Calibration & maintenance" },
  "/timelapses": { basic: "Timelapses", expert: "Timelapses" },
  "/console": { basic: "Expert tool hidden", expert: "Console" },
  "/settings": { basic: "Experience", expert: "Experience" },
};

interface Isolation {
  cameraRequests: () => number;
  failControlChunk: (value: boolean) => void;
  assertSafe: () => void;
}

async function isolateFromPrinter(
  page: Page,
  options: { cameraMode?: "ok" | "error"; subscriptionDelayMs?: number } = {},
): Promise<Isolation> {
  const escaped: string[] = [];
  const writes: string[] = [];
  const rpcMethods: string[] = [];
  let cameraRequestCount = 0;
  let shouldFailControlChunk = false;

  await page.routeWebSocket("**/websocket", (socket) => {
    socket.onMessage((message) => {
      const request = JSON.parse(String(message)) as {
        id?: number;
        method?: string;
      };
      if (request.method) rpcMethods.push(request.method);
      if (request.id != null) {
        const reply = () => {
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              result:
                request.method === "printer.objects.subscribe"
                  ? { status: IDLE_STATE }
                  : {},
            }),
          );
        };
        if (
          request.method === "printer.objects.subscribe" &&
          options.subscriptionDelayMs
        ) {
          setTimeout(reply, options.subscriptionDelayMs);
        } else {
          reply();
        }
      }
    });
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (
      shouldFailControlChunk &&
      url.origin === PREVIEW_ORIGIN &&
      /\/assets\/Control-[^/]+\.js$/.test(url.pathname)
    ) {
      await route.fulfill({ status: 404, body: "simulated stale route chunk" });
      return;
    }

    if (
      url.origin === CAMERA_ORIGIN &&
      url.pathname === "/" &&
      url.searchParams.get("action") === "stream"
    ) {
      cameraRequestCount += 1;
      if (options.cameraMode === "error") {
        await route.fulfill({ status: 503, body: "camera fixture offline" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: PNG,
      });
      return;
    }

    // The namespace list is not restated here on purpose: it comes from the
    // same module the Vite proxy tables are built from, so this fixture
    // cannot end up narrower than the set of paths the preview server would
    // forward. A private copy that drifts by one prefix is exactly how a
    // same-origin read reaches a printer.
    if (url.origin === PREVIEW_ORIGIN && isPrinterNamespace(url.pathname)) {
      if (!(["GET", "HEAD"] as string[]).includes(request.method())) {
        writes.push(`${request.method()} ${url.pathname}`);
      }
      const isImage = request.resourceType() === "image";
      if (isImage) {
        await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
        return;
      }

      let result: unknown = {};
      if (url.pathname === "/printer/info") {
        result = { state: "ready", state_message: "Printer is ready", software_version: "test" };
      } else if (url.pathname === "/machine/system_info") {
        result = {
          system_info: { distribution: {}, cpu_info: { cpu_desc: "K1 Max test fixture" } },
          cpu_info: { cpu_desc: "K1 Max test fixture" },
        };
      } else if (url.pathname === "/machine/proc_stats") {
        result = {
          system_memory: { total: 1024, available: 768 },
          system_uptime: 3600,
          // No system_load_avg: Moonraker's /machine/proc_stats does not
          // return one. The fixture used to supply it, which let a page that
          // rendered `?? [0, 0, 0]` look correct in CI while showing a
          // fabricated "0.00 · 0.00 · 0.00" on a real printer.
        };
      } else if (url.pathname === "/server/info") {
        result = { moonraker_version: "test" };
      } else if (url.pathname === "/server/files/list") {
        result = [];
      } else if (url.pathname === "/server/history/list") {
        result = { jobs: [] };
      } else if (url.pathname === "/server/history/totals") {
        result = {
          job_totals: {
            total_jobs: 0,
            total_time: 0,
            total_filament_used: 0,
            longest_job: 0,
          },
        };
      } else if (url.pathname === "/printer/objects/query") {
        result = { status: { bed_mesh: {} } };
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result }),
      });
      return;
    }

    if (url.origin === PREVIEW_ORIGIN) {
      await route.continue();
      return;
    }

    escaped.push(request.url());
    await route.abort("blockedbyclient");
  });

  return {
    cameraRequests: () => cameraRequestCount,
    failControlChunk: (value) => {
      shouldFailControlChunk = value;
    },
    assertSafe: () => {
      expect(escaped, "browser traffic escaped the local fixture").toEqual([]);
      expect(writes, "browser test attempted a printer HTTP write").toEqual([]);
      expect(
        rpcMethods.filter((method) => method !== "printer.objects.subscribe"),
        "browser test attempted a printer RPC action",
      ).toEqual([]);
    },
  };
}

async function expectLayoutIntegrity(page: Page, experienceMode: ExperienceMode) {
  const pathname = new URL(page.url()).pathname;
  const heading = routeReadyHeadings[pathname]?.[experienceMode];
  expect(heading, `No lazy-route readiness marker for ${pathname}`).toBeTruthy();
  await expect(page.locator("main").getByRole("heading", { name: heading, exact: true }), `Lazy route ${pathname} did not settle to ${heading}`).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading view…" })).toHaveCount(0);
  await expect(page.locator("h1")).toHaveCount(1);
  const audit = await page.evaluate(() => {
    const visible = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const undersized = [...document.querySelectorAll<HTMLElement>("button, a, input, select, textarea")]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName, width: rect.width, height: rect.height };
      })
      .filter(({ width, height }) => width < 44 || height < 44);
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      undersized,
    };
  });
  expect(audit.overflow, "page has horizontal overflow").toBeLessThanOrEqual(1);
  expect(audit.undersized, "visible controls must meet the 44px touch target").toEqual([]);
}

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
]) {
  test(`${viewport.name} Basic and Expert routes remain coherent and safe`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const isolation = await isolateFromPrinter(page);
    await page.goto("/");
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("basic-home.png"), fullPage: true });

    for (const path of ["/", "/print", "/control", "/tune", "/timelapses", "/console", "/settings"]) {
      await page.goto(path);
      await expectLayoutIntegrity(page, "basic");
      await page.screenshot({
        path: testInfo.outputPath(`basic-${path === "/" ? "home" : path.slice(1)}.png`),
        fullPage: true,
      });
    }
    await page.goto("/console");
    await expect(page.getByRole("heading", { name: "Expert tool hidden" })).toBeVisible();

    await page.goto("/settings");
    // Expert-only panels (Profile/Backup) are absent in Basic and appear
    // once Expert is switched on.
    await expect(page.getByRole("heading", { name: "Experience", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Backup & Restore" })).toHaveCount(0);
    await page.getByRole("button", { name: /Expert Adds calibration/ }).click();
    await expect(page.getByRole("button", { name: /Expert Adds calibration/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Backup & Restore" })).toBeVisible();

    await page.goto("/");
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("expert-home.png"), fullPage: true });

    for (const path of ["/", "/print", "/control", "/tune", "/timelapses", "/console", "/settings"]) {
      await page.goto(path);
      await expectLayoutIntegrity(page, "expert");
      await page.screenshot({
        path: testInfo.outputPath(`expert-${path === "/" ? "home" : path.slice(1)}.png`),
        fullPage: true,
      });
    }
    isolation.assertSafe();
  });
}

test("healthy camera remains live without forced reconnect churn", async ({ page }) => {
  const isolation = await isolateFromPrinter(page);
  await page.goto("/");
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  expect(isolation.cameraRequests()).toBe(1);
  await page.waitForTimeout(6_500);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  expect(isolation.cameraRequests(), "a healthy MJPEG stream was restarted").toBe(1);

  await page.getByRole("button", { name: "Refresh camera stream" }).click();
  await expect.poll(isolation.cameraRequests).toBe(2);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  isolation.assertSafe();
});

test("unknown telemetry stays neutral while the printer connects", async ({ page }) => {
  const isolation = await isolateFromPrinter(page, { subscriptionDelayMs: 1_500 });
  await page.goto("/");
  await expect(page.getByText("Connecting to printer…")).toBeVisible();
  await expect(page.getByRole("img", { name: "Hotend temperature unavailable" })).toBeVisible();
  await expect(page.getByText(/Klipper \?/)).toHaveCount(0);
  await expect(page.getByText("ready · standby", { exact: true })).toBeVisible();
  isolation.assertSafe();
});

test("offline camera stops retrying and waits for the user", async ({ page }) => {
  const clockStart = new Date("2026-08-02T12:00:00Z");
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(clockStart);
  const isolation = await isolateFromPrinter(page, { cameraMode: "error" });
  await page.goto("/");
  await expect.poll(isolation.cameraRequests).toBe(1);
  await expect(page.getByText("Camera unavailable. Retrying…")).toBeVisible();

  for (const [index, delay] of [1_500, 3_000, 6_000, 12_000, 24_000].entries()) {
    await page.clock.fastForward(delay + 50);
    await expect.poll(isolation.cameraRequests).toBe(index + 2);
  }

  await expect(page.getByText("Camera is offline. Printing controls are unaffected.")).toBeVisible();
  await page.clock.fastForward(120_000);
  expect(isolation.cameraRequests(), "offline camera continued background churn").toBe(6);

  await page.getByRole("button", { name: "Try camera again" }).click();
  await expect.poll(isolation.cameraRequests).toBe(7);
  await expect(page.getByText("Camera unavailable. Retrying…")).toBeVisible();
  isolation.assertSafe();
});

test("stale route chunk offers one safe reload and recovers", async ({ page }) => {
  const isolation = await isolateFromPrinter(page);
  isolation.failControlChunk(true);
  await page.goto("/control");
  await expect(page.getByRole("heading", { name: "Update ready" })).toBeVisible();
  await expect(page.getByText("Reloading the UI does not change printer state.")).toBeVisible();

  isolation.failControlChunk(false);
  await page.getByRole("button", { name: "Reload Regolith" }).click();
  await expect(page.getByRole("heading", { name: "Toolhead" })).toBeVisible();
  await expectLayoutIntegrity(page, "basic");
  isolation.assertSafe();
});
