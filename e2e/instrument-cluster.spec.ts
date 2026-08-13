import { expect, test, type Page } from "@playwright/test";
import {
  assertNoBrokenReadouts,
  installActiveMock,
  useExperience,
  type MockPrinterState,
} from "./support/active-state-harness";

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

async function assertInstrumentShell(page: Page, experienceMode: ExperienceMode) {
  const pathname = new URL(page.url()).pathname;
  const heading = routeReadyHeadings[pathname]?.[experienceMode];
  expect(heading, `No lazy-route readiness marker for ${pathname}`).toBeTruthy();
  await expect(page.locator("main").getByRole("heading", { name: heading, exact: true }), `Lazy route ${pathname} did not settle to ${heading}`).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading view…" })).toHaveCount(0);
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
  await assertHonestDials(page);
}

/**
 * Dials must be honest instruments: never rendered below the 148px floor
 * (the bar renderer takes over via container query), and never carrying SVG
 * <text> — SVG text scales with the viewBox and would silently slip under
 * the 11px legibility gate, which excludes SVG geometry. The same <text>
 * gate applies to every segment strip: SegmentGauge's SVG is geometry only,
 * all readouts are HTML.
 */
async function assertHonestDials(page: Page) {
  const dishonest = await page.locator(".gauge-dial, .segment-gauge").evaluateAll((items) =>
    items.flatMap((item) => {
      const issues: string[] = [];
      const isDial = item.classList.contains("gauge-dial");
      const svgText = item.querySelectorAll("text").length;
      if (svgText > 0) issues.push(`${isDial ? "dial" : "segment gauge"} contains ${svgText} SVG <text> node(s)`);
      if (!isDial) return issues;
      const box = item.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && box.width < 148) {
        issues.push(`dial rendered at ${box.width.toFixed(1)}px — below the 148px floor instead of falling back to the bar renderer`);
      }
      return issues;
    }),
  );
  expect(dishonest).toEqual([]);
}

async function resetTopState(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function assertTopStateAudit(page: Page, experienceMode: ExperienceMode) {
  await resetTopState(page);
  await assertInstrumentShell(page, experienceMode);
  const clipped = await page.locator("main h2, main h3, main p, main button, main label, main output, main .instrument-label").evaluateAll((items) =>
    items.filter((item) => {
      const style = getComputedStyle(item);
      const box = item.getBoundingClientRect();
      return style.visibility !== "hidden" && box.width > 0 && box.height > 0 && (box.left < -1 || box.right > innerWidth + 1);
    }).map((item) => item.textContent?.trim() || item.getAttribute("aria-label") || item.tagName),
  );
  expect(clipped).toEqual([]);
}

async function assertMinimumVisibleText(page: Page) {
  const undersized = await page.locator("body *").evaluateAll((items) => items.flatMap((item) => {
    if (item.closest("svg") || item.getAttribute("aria-hidden") === "true") return [];
    const style = getComputedStyle(item);
    const box = item.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || box.width === 0 || box.height === 0) return [];

    const directText = Array.from(item.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    const controlText = item instanceof HTMLInputElement || item instanceof HTMLTextAreaElement || item instanceof HTMLSelectElement
      ? item.value || item.getAttribute("placeholder") || ""
      : "";
    const text = directText || controlText;
    const fontSize = Number.parseFloat(style.fontSize);
    if (!text || fontSize >= 11) return [];

    return [{
      tag: item.tagName.toLowerCase(),
      text: text.slice(0, 80),
      fontSize: style.fontSize,
      className: item.className,
    }];
  }));
  expect(undersized, `Visible text below 11px:\n${undersized.map((item) => `<${item.tag} class="${item.className}"> ${item.text} (${item.fontSize})`).join("\n")}`).toEqual([]);
}

async function assertFinalControlReachability(page: Page) {
  const lastControl = page.locator("main button:visible, main a:visible, main input:visible, main select:visible").last();
  if (await lastControl.count()) {
    await lastControl.scrollIntoViewIfNeeded();
    const hiddenByChrome = await lastControl.evaluate((item) => {
      // The fold is the top of whatever bottom chrome exists: the mission
      // bar everywhere, plus the bottom nav on touch layouts. Key off the
      // real elements, not a width media query: the K1 Max's 800x480 panel
      // is wider than 768px yet keeps the touch chrome.
      const tops: number[] = [];
      for (const selector of ['section[aria-label="Printer status"]', 'nav[aria-label="Mobile primary"]']) {
        const chrome = document.querySelector(selector);
        if (chrome && getComputedStyle(chrome).display !== "none") {
          tops.push(chrome.getBoundingClientRect().top);
        }
      }
      if (tops.length === 0) return false;
      const box = item.getBoundingClientRect();
      return box.bottom > Math.min(...tops) + 0.5;
    });
    expect(hiddenByChrome).toBe(false);
  }
}

test.describe("Regolith Instrument Cluster — strict local mock", () => {
  test("Basic routes are coherent at 320px and never escape mocked networking", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 720 });
    const audit = await installStrictMock(page);
    await page.addInitScript(() => localStorage.setItem("forge.experience-mode", "basic"));
    for (const route of ["/", "/print", "/control", "/timelapses", "/settings", "/tune", "/console"]) {
      await page.goto(route);
      await assertInstrumentShell(page, "basic");
      if (route === "/") await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);
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
      await assertInstrumentShell(page, "expert");
      if (route === "/") await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);
      await page.screenshot({ path: testInfo.outputPath(`expert-1280-${route === "/" ? "home" : route.slice(1)}.png`), fullPage: true, animations: "disabled" });
    }
    expect(audit.escaped).toEqual([]);
    expect(audit.writes).toEqual([]);
    expect(audit.subscriptions.length).toBeGreaterThan(0);
  });

  test("dials never silently degrade across lane transitions, panel, or ultrawide widths", async ({ page }, testInfo) => {
    const audit = await installStrictMock(page);
    // 1024/1100/1200 are the widths where lg:grid-cols-2 used to leave each
    // gauge 111-147px wide, silently swapping BOTH dials for bar renderers.
    // 800x480 is the K1 Max's own touchscreen; 1920/2560 are the ultrawide
    // space-utilization targets.
    const viewports = [
      { width: 800, height: 480 },
      { width: 1024, height: 768 },
      { width: 1100, height: 800 },
      { width: 1200, height: 900 },
      { width: 1920, height: 1080 },
      { width: 2560, height: 1200 },
    ];
    for (const experienceMode of ["basic", "expert"] as const) {
      await page.goto("/");
      await page.evaluate((mode) => {
        localStorage.setItem("forge.experience-mode", mode);
        window.dispatchEvent(new Event("forge:experience-mode-changed"));
      }, experienceMode);
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.goto("/");
        await assertTopStateAudit(page, experienceMode);
        await assertMinimumVisibleText(page);
        await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);
        await assertFinalControlReachability(page);
        await page.screenshot({ path: testInfo.outputPath(`lanes-${viewport.width}x${viewport.height}-${experienceMode}.png`), fullPage: false, animations: "disabled" });
      }
    }
    expect(audit.escaped).toEqual([]);
    expect(audit.writes).toEqual([]);
  });

  test("the 800x480 K1 Max panel keeps the touch chrome, not the desktop sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const audit = await installStrictMock(page);
    await page.goto("/");
    await assertInstrumentShell(page, "basic");
    // Wider than the md breakpoint but only 480px tall: the desktop sidebar
    // must stay hidden and the bottom nav must serve this touchscreen.
    await expect(page.locator("aside")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Mobile primary" })).toBeVisible();
    await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);

    // A conventional laptop viewport still gets the desktop chrome.
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    await expect(page.locator("aside")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Mobile primary" })).toBeHidden();
    expect(audit.escaped).toEqual([]);
    expect(audit.writes).toEqual([]);
  });

  test("both dials sit fully above the fold on the 800x480 K1 Max panel", async ({ page }) => {
    // Playwright's `:visible` means "participates in layout", not "inside the
    // viewport" — the dial-count assertions elsewhere pass even with the Bed
    // dial a full screen below the fold. Measure real geometry against the
    // MISSION BAR's top edge — the bar stacks above the bottom nav, so it is
    // the actual fold on the printer's own 480px-tall panel — in both
    // experience modes.
    await page.setViewportSize({ width: 800, height: 480 });
    const audit = await installStrictMock(page);
    await page.goto("/");
    for (const experienceMode of ["basic", "expert"] as const) {
      await page.evaluate((mode) => {
        localStorage.setItem("forge.experience-mode", mode);
        window.dispatchEvent(new Event("forge:experience-mode-changed"));
      }, experienceMode);
      await page.goto("/");
      await assertInstrumentShell(page, experienceMode);
      const foldTop = await page
        .locator('section[aria-label="Printer status"]')
        .evaluate((bar) => bar.getBoundingClientRect().top);
      const dials = await page.locator(".gauge-dial").evaluateAll((items) =>
        items.map((item) => {
          const box = item.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom };
        }),
      );
      expect(dials, `${experienceMode}: both dials must be in the layout`).toHaveLength(2);
      for (const box of dials) {
        expect(box.top, `${experienceMode}: dial clipped by the top of the viewport`).toBeGreaterThanOrEqual(0);
        expect(box.bottom, `${experienceMode}: dial at/under the fold (mission-bar top ${foldTop})`).toBeLessThanOrEqual(foldTop);
      }
    }
    expect(audit.escaped).toEqual([]);
    expect(audit.writes).toEqual([]);
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
        await assertTopStateAudit(page, "basic");
        await assertMinimumVisibleText(page);
        await page.screenshot({ path: testInfo.outputPath(`top-${viewport.width}-basic-${route === "/" ? "home" : route.slice(1)}.png`), fullPage: false, animations: "disabled" });
        await assertFinalControlReachability(page);
      }
      await page.goto("/");
      await page.evaluate(() => {
        localStorage.setItem("forge.experience-mode", "expert");
        window.dispatchEvent(new Event("forge:experience-mode-changed"));
      });
      for (const route of routes) {
        await page.goto(route);
        await assertTopStateAudit(page, "expert");
        await assertMinimumVisibleText(page);
        await page.screenshot({ path: testInfo.outputPath(`top-${viewport.width}-expert-${route === "/" ? "home" : route.slice(1)}.png`), fullPage: false, animations: "disabled" });
        await assertFinalControlReachability(page);
      }
    }
    expect(audit.escaped).toEqual([]);
    expect(audit.writes).toEqual([]);
  });

  test("segment gauges stay legible and honest at 320, the K1 panel, and 1280", async ({ page }) => {
    const audit = await installStrictMock(page);
    await page.addInitScript(() => localStorage.setItem("forge.experience-mode", "basic"));
    for (const viewport of [
      { width: 320, height: 720 },
      { width: 800, height: 480 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await assertInstrumentShell(page, "basic");
      await assertMinimumVisibleText(page);
      // Chamber, Part Fan, Speed Factor, Flow Factor — the four basic strips.
      await expect(page.locator(".segment-gauge")).toHaveCount(4);
      const gauges = await page.locator(".segment-gauge").evaluateAll((items) =>
        items.map((item) => ({
          label: item.querySelector(".instrument-label")?.textContent?.trim() ?? "",
          value: item.querySelector(".instrument-value")?.textContent?.trim() ?? "",
          lit: Number(item.getAttribute("data-lit")),
          rects: item.querySelectorAll("svg rect").length,
          width: item.getBoundingClientRect().width,
        })),
      );
      for (const gauge of gauges) {
        expect(gauge.value, `${gauge.label}: raw JS placeholder on the glass`).not.toMatch(/NaN|undefined|null|Infinity/);
        expect(gauge.value.length, `${gauge.label}: readout must render`).toBeGreaterThan(0);
        expect(Number.isInteger(gauge.lit), `${gauge.label}: lit count must be a whole segment count`).toBe(true);
        expect(gauge.width, `${gauge.label}: strip must occupy layout at ${viewport.width}px`).toBeGreaterThan(0);
      }
      const byLabel = Object.fromEntries(gauges.map((gauge) => [gauge.label, gauge]));
      // 20 segments each; the factor strips carry the extra center-index rect.
      expect(byLabel["Part Fan"].rects).toBe(20);
      expect(byLabel["Speed Factor"].rects).toBe(21);
      expect(byLabel["Flow Factor"].rects).toBe(21);
      expect(byLabel["Chamber"].rects).toBe(20);
      // Idle fixture truths: fan off, both factors at nominal 100% (the strip
      // midpoint of the 50-150 scale), chamber sensor absent from the mock —
      // an honest em-dash with an unlit strip, never a guessed bar.
      expect(byLabel["Part Fan"].lit).toBe(0);
      expect(byLabel["Speed Factor"].lit).toBe(10);
      expect(byLabel["Flow Factor"].lit).toBe(10);
      expect(byLabel["Chamber"].value).toBe("—");
      expect(byLabel["Chamber"].lit).toBe(0);
    }
    expect(audit.escaped).toEqual([]);
    expect(audit.writes).toEqual([]);
  });

  test("segment gauges track a live print: lit counts, warn states, zone cap, center index", async ({ page }) => {
    const mock = await installActiveMock(page, {
      state: {
        webhooks: { state: "ready", state_message: "Printer is ready" },
        idle_timeout: { state: "Printing" },
        print_stats: {
          state: "printing",
          filename: "calibration/benchy_0.2mm_PLA_K1Max.gcode",
          total_duration: 4_120,
          print_duration: 4_021,
          filament_used: 8_432.5,
          message: "",
          info: { total_layer: 250, current_layer: 118 },
        },
        virtual_sdcard: { progress: 0.4732, is_active: true, file_position: 4_732_000, file_size: 10_000_000 },
        extruder: { temperature: 219.8, target: 220, power: 0.42, pressure_advance: 0.042 },
        heater_bed: { temperature: 60.1, target: 60, power: 0.28 },
        toolhead: {
          position: [96.2, 187.4, 23.6, 0],
          homed_axes: "xyz",
          print_time: 4_021,
          estimated_print_time: 8_040,
          max_velocity: 600,
          max_accel: 20_000,
          axis_minimum: [-2, -2, -10, 0],
          axis_maximum: [306.5, 306, 305, 0],
        },
        display_status: { progress: 0.4732, message: "Printing" },
        fan: { speed: 0.8 },
        gcode_move: {
          position: [96.2, 187.4, 23.6, 0],
          gcode_position: [96.2, 187.4, 23.6, 0],
          speed: 3_000,
          speed_factor: 1.2,
          extrude_factor: 0.95,
          homing_origin: [0, 0, -0.045, 0],
        },
        motion_report: { live_position: [96.2, 187.4, 23.6, 0], live_velocity: 148.3, live_extruder_velocity: 3.1 },
        "temperature_sensor chamber_temp": { temperature: 63.4 },
        "temperature_sensor mcu_temp": { temperature: 44.2 },
        "temperature_fan chamber_fan": { temperature: 38.4, target: 0, speed: 0 },
        "temperature_fan soc_fan": { temperature: 46.1, target: 50, speed: 0.6 },
      },
      thumbnail: true,
    });
    await useExperience(page, "expert");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);
    await assertNoBrokenReadouts(page, "segment gauges mid-print");
    // Expert adds the two PWM heater-power strips plus the two new
    // printer-published ranges (Live Vel. against toolhead.max_velocity,
    // Position Z against the homed axis limits) to the four basic ones.
    await expect(page.locator(".segment-gauge")).toHaveCount(8);
    const gauges = await page.locator(".segment-gauge").evaluateAll((items) =>
      items.map((item) => ({
        label: item.querySelector(".instrument-label")?.textContent?.trim() ?? "",
        value: item.querySelector(".instrument-value")?.textContent?.trim() ?? "",
        valueColor: item.querySelector<HTMLElement>(".instrument-value")?.style.color ?? "",
        lit: Number(item.getAttribute("data-lit")),
        rects: Array.from(item.querySelectorAll("svg rect")).map((rect) => rect.getAttribute("fill") ?? ""),
        svgText: item.querySelectorAll("text").length,
      })),
    );
    const byLabel = Object.fromEntries(gauges.map((gauge) => [gauge.label, gauge]));

    for (const gauge of gauges) {
      expect(gauge.svgText, `${gauge.label}: SVG carries geometry only`).toBe(0);
      // Discrete truth: the first `lit` segments are currentColor, and the
      // strip never lights a fractional segment.
      for (const [index, fill] of gauge.rects.slice(0, 20).entries()) {
        if (index < gauge.lit) expect(fill, `${gauge.label} segment ${index} must be lit`).toBe("currentColor");
        else expect(fill, `${gauge.label} segment ${index} must be unlit`).not.toBe("currentColor");
      }
    }

    // Part fan 80% → 16 of 20, accent-lit (active).
    expect(byLabel["Part Fan"].value).toBe("80%");
    expect(byLabel["Part Fan"].lit).toBe(16);
    // Speed factor 120% on the 50-150 scale → 14 segments, past the center
    // index, warn-colored value (no color-only state: number + index agree).
    expect(byLabel["Speed Factor"].value).toBe("120%");
    expect(byLabel["Speed Factor"].lit).toBe(14);
    expect(byLabel["Speed Factor"].valueColor).toContain("--color-warning");
    expect(byLabel["Speed Factor"].rects).toHaveLength(21);
    // Flow factor 95% → 9 segments, short of the center index, warn value.
    expect(byLabel["Flow Factor"].value).toBe("95%");
    expect(byLabel["Flow Factor"].lit).toBe(9);
    expect(byLabel["Flow Factor"].valueColor).toContain("--color-warning");
    // Chamber 63.4°C is inside the 60-80 warn zone: warning value, and the
    // unlit tail of the strip keeps the permanent zone cap.
    expect(byLabel["Chamber"].value).toBe("63.4°C");
    expect(byLabel["Chamber"].lit).toBe(16);
    expect(byLabel["Chamber"].valueColor).toContain("--color-warning");
    expect(byLabel["Chamber"].rects[19]).toBe("var(--color-segment-zone)");
    // Heater power is a literal PWM duty strip.
    expect(byLabel["Hotend Power"].value).toBe("42%");
    expect(byLabel["Hotend Power"].lit).toBe(8);
    expect(byLabel["Bed Power"].value).toBe("28%");
    expect(byLabel["Bed Power"].lit).toBe(6);
    // Live velocity against the printer's own published ceiling:
    // 148.3 of 600 mm/s → round(4.94) = 5.
    expect(byLabel["Live Vel."].value).toBe("148 mm/s");
    expect(byLabel["Live Vel."].lit).toBe(5);
    // Position Z against the homed axis limits (−10..305):
    // (23.6 + 10) / 315 · 20 → round(2.13) = 2.
    expect(byLabel["Position Z"].value).toBe("23.600");
    expect(byLabel["Position Z"].lit).toBe(2);

    mock.assertSealed();
  });
});

/* ---------------------------------------------------------------------------
 * Tell-tale cluster (SD1 §3) — every lamp reachable through the active-state
 * harness: prove each lamp lights on its trigger and latches/clears per the
 * final table. Time is fake-clocked where a confirmation window or the
 * bulb-test sweep matters.
 * ------------------------------------------------------------------------ */

/** Cold, idle, UNHOMED, no mesh loaded — the all-lamps-dark baseline. */
const coldIdleUnhomed: MockPrinterState = {
  webhooks: { state: "ready", state_message: "Printer is ready" },
  idle_timeout: { state: "Ready" },
  print_stats: { state: "standby", filename: "", total_duration: 0, print_duration: 0, filament_used: 0, message: "" },
  virtual_sdcard: { progress: 0, is_active: false, file_position: 0, file_size: 0 },
  extruder: { temperature: 27.4, target: 0, power: 0, pressure_advance: 0.042 },
  heater_bed: { temperature: 25.9, target: 0, power: 0 },
  toolhead: {
    position: [0, 0, 0, 0],
    homed_axes: "",
    print_time: 0,
    estimated_print_time: 0,
    max_velocity: 600,
    max_accel: 20_000,
    axis_minimum: [-2, -2, -10, 0],
    axis_maximum: [306.5, 306, 305, 0],
  },
  display_status: { progress: 0, message: "" },
  fan: { speed: 0 },
  gcode_move: {
    position: [0, 0, 0, 0],
    gcode_position: [0, 0, 0, 0],
    speed: 0,
    speed_factor: 1,
    extrude_factor: 1,
    homing_origin: [0, 0, 0, 0],
  },
  "temperature_sensor chamber_temp": { temperature: 38.6 },
  "temperature_sensor mcu_temp": { temperature: 44.2 },
  "temperature_fan chamber_fan": { temperature: 38.4, target: 0, speed: 0 },
  "temperature_fan soc_fan": { temperature: 46.1, target: 50, speed: 0.6 },
};

const LAMP_ORDER = [
  "thermal-runaway",
  "heater-fault",
  "firmware",
  "link-lost",
  "fan-fault",
  // HOST LOAD — the printer's computer. Last warning-severity lamp before
  // the escalating MCU HOT (host-health guard §3.1).
  "host-load",
  "mcu-hot",
  "mesh-active",
  "homed",
];

const lamp = (page: Page, id: string) =>
  page.locator(`.telltale-cell[data-lamp="${id}"]`);
const litLamps = (page: Page) => page.locator('.telltale-cell[data-lit="true"]');

async function openSystems(page: Page) {
  await page.goto("/");
  await expect(
    page.locator("main").getByRole("heading", { name: "Systems", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe("Tell-tale cluster — SD1 lamp block", () => {
  test("cold idle unhomed: nine table lamps, severity-ordered, none lit after the bulb test", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, { state: coldIdleUnhomed });
    await openSystems(page);

    // Exactly the lamp table for a K1 Max: no FILAMENT lamp (the profile
    // declares no sensor — an unlit lamp would promise monitoring that is
    // not happening), no MAINTENANCE (deferred, no honest data source).
    // HOST LOAD ships dark until the proc-stat feed proves pressure.
    await expect(page.locator(".telltale-cell")).toHaveCount(9);
    await expect(page.locator('.telltale-cell[data-lamp^="filament-"]')).toHaveCount(0);
    const order = await page
      .locator(".telltale-cell")
      .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-lamp")));
    expect(order).toEqual(LAMP_ORDER);

    // 1s after the mocked subscribe the 700ms bulb test has released and the
    // idle fixture holds zero lit lamps — including HOMED (axes unhomed).
    await expect(litLamps(page)).toHaveCount(0);

    // Labels are the always-visible third channel, 11px floor and up.
    const cells = await page.locator(".telltale-cell").evaluateAll((items) =>
      items.map((cell) => {
        const box = cell.getBoundingClientRect();
        const label = cell.querySelector(".instrument-label");
        return {
          id: cell.getAttribute("data-lamp"),
          height: box.height,
          width: box.width,
          label: label?.textContent?.trim() ?? "",
          labelPx: label ? Number.parseFloat(getComputedStyle(label).fontSize) : 0,
          icons: cell.querySelectorAll("svg").length,
        };
      }),
    );
    for (const cell of cells) {
      expect(cell.height, `${cell.id}: cell below the 44px row module`).toBeGreaterThanOrEqual(44);
      expect(cell.width, `${cell.id}: cell narrower than a finger`).toBeGreaterThanOrEqual(44);
      expect(cell.label.length, `${cell.id}: label must be visible`).toBeGreaterThan(0);
      expect(cell.labelPx, `${cell.id}: label below the 11px floor`).toBeGreaterThanOrEqual(11);
      expect(cell.icons, `${cell.id}: icon channel missing`).toBeGreaterThanOrEqual(1);
    }

    // Engine-light uniformity (owner rule): every system cell is the SAME
    // size — equal grid tracks and 1fr rows, no cell grows past its peers.
    const widths = cells.map((cell) => cell.width);
    const heights = cells.map((cell) => cell.height);
    expect(Math.max(...widths) - Math.min(...widths), "cell widths must be uniform").toBeLessThanOrEqual(1);
    expect(Math.max(...heights) - Math.min(...heights), "cell heights must be uniform").toBeLessThanOrEqual(1);

    // Engine lights on a FLAT panel: the glyph is the lamp. No lamp square,
    // no cell backdrop — and stronger than the old "not inside a well" check
    // (vacuous now that no wells exist anywhere): NOTHING visible inside the
    // Systems panel may paint a background other than the panel's own
    // surface. This pins the flatten itself, not just one mechanism.
    await expect(page.locator(".telltale-grid .telltale-lamp")).toHaveCount(0);
    const paintedInsidePanel = await page
      .locator('section.instrument-panel:has(h2:text-is("Systems"))')
      .evaluate((panel) => {
        const own = getComputedStyle(panel).backgroundColor;
        const offenders: string[] = [];
        for (const el of Array.from(panel.querySelectorAll<HTMLElement>("*"))) {
          if (el.getClientRects().length === 0) continue; // hidden
          const bg = getComputedStyle(el).backgroundColor;
          if (bg !== "rgba(0, 0, 0, 0)" && bg !== own) {
            offenders.push(`${el.tagName.toLowerCase()}.${el.className} → ${bg}`);
          }
        }
        return offenders;
      });
    expect(paintedInsidePanel, "flat cluster: no per-element fills").toEqual([]);

    // Nothing lit ⇒ nothing announced.
    await expect(
      page.locator('section:has(h2:text-is("Systems")) [role="alert"], section:has(h2:text-is("Systems")) [role="status"]'),
    ).toHaveCount(0);

    mock.assertSealed();
  });

  /* ICON CENTRING LAW (owner: "centre the icons above their labels"). The
     cells used to be align-items: flex-start, so every glyph sat hard-left
     at x=0 — 45.7 to 48.2px left of its own cell centre — while the labels
     ran left too, and only THERMAL RUNAWAY happened to fill its track and
     read as centred.
     Centring is an IN-CELL property, so this law is written to fail loudly
     if anyone buys the centring with geometry that costs an invariant:
       1. the glyph's centre matches its cell's centre (the owner's ask);
       2. the label's centre matches it too, so the glyph sits OVER the word;
       3. cell boxes stay one uniform module — this is the clause that fails
          if centring is ever faked with per-cell padding or width;
       4. the 44px module survives on every cell, latched ones included, so
          the ACK button's tap target never shrinks;
       5. nothing new paints — the glyph is still the lamp, with no backdrop,
          no lamp square, no border and no shadow on the icon itself. */
  test("every tell-tale glyph is centred over its label, in a still-uniform cell", async ({
    page,
  }) => {
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, { state: coldIdleUnhomed });

    for (const width of [390, 800, 1280, 1920]) {
      await page.setViewportSize({ width, height: width === 800 ? 480 : 900 });
      await openSystems(page);
      const cells = await page.locator(".telltale-cell").evaluateAll((items) =>
        items
          .filter((cell) => cell.getClientRects().length > 0)
          .map((cell) => {
            const box = cell.getBoundingClientRect();
            const icon = cell.querySelector(".telltale-icon");
            const label = cell.querySelector(".instrument-label");
            const iconStyle = icon ? getComputedStyle(icon) : null;
            const rect = (node: Element | null) =>
              node ? node.getBoundingClientRect() : null;
            const iconBox = rect(icon);
            const labelBox = rect(label);
            return {
              id: cell.getAttribute("data-lamp"),
              centre: box.left + box.width / 2,
              width: box.width,
              height: box.height,
              iconCentre: iconBox ? iconBox.left + iconBox.width / 2 : null,
              labelCentre: labelBox ? labelBox.left + labelBox.width / 2 : null,
              iconBg: iconStyle?.backgroundColor ?? null,
              iconBorder: iconStyle?.borderTopWidth ?? null,
              iconShadow: iconStyle?.boxShadow ?? null,
            };
          }),
      );

      // Non-vacuity: the K1 Max table publishes nine lamps.
      expect(cells.length, `${width}: lamps seen`).toBe(9);

      for (const cell of cells) {
        const at = `${width} · ${cell.id}`;
        // (1) the glyph is centred in its own cell.
        expect(cell.iconCentre, `${at}: glyph must render`).not.toBeNull();
        expect(
          Math.abs(cell.iconCentre! - cell.centre),
          `${at}: glyph centre ${cell.iconCentre} vs cell centre ${cell.centre}`,
        ).toBeLessThanOrEqual(1);
        // (2) the label is centred under it — the glyph sits OVER the word.
        expect(cell.labelCentre, `${at}: label must render`).not.toBeNull();
        expect(
          Math.abs(cell.labelCentre! - cell.centre),
          `${at}: label centre ${cell.labelCentre} vs cell centre ${cell.centre}`,
        ).toBeLessThanOrEqual(1.5);
        // (4) the 44px module is untouched by the alignment change.
        expect(cell.height, `${at}: cell keeps the 44px row module`).toBeGreaterThanOrEqual(
          44,
        );
        expect(cell.width, `${at}: cell narrower than a finger`).toBeGreaterThanOrEqual(44);
        // (5) the glyph IS the lamp — no backdrop, no square, no shadow.
        expect(cell.iconBg, `${at}: glyph must not paint a backdrop`).toBe("rgba(0, 0, 0, 0)");
        expect(cell.iconBorder, `${at}: glyph must not draw a lamp square`).toBe("0px");
        expect(cell.iconShadow, `${at}: glyph must not cast a shadow`).toBe("none");
      }

      // (3) cells stay ONE module — centring must not be bought with
      // per-cell padding or width.
      const widths = cells.map((c) => c.width);
      const heights = cells.map((c) => c.height);
      expect(
        Math.max(...widths) - Math.min(...widths),
        `${width}: cell widths must stay uniform`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.max(...heights) - Math.min(...heights),
        `${width}: cell heights must stay uniform`,
      ).toBeLessThanOrEqual(1);
    }

    mock.assertSealed();
  });

  test("bulb-test sweep: one discrete lit step on first connect, silent to SR, never re-run on reconnect", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    await page.clock.install();
    const mock = await installActiveMock(page, { state: coldIdleUnhomed });
    await openSystems(page);

    // The clock is frozen inside the 700ms window: every cell renders lit in
    // its own severity color — a single simultaneous step, no stagger.
    await expect(litLamps(page)).toHaveCount(9);
    // The sweep must not read as nine simultaneous faults to a screen reader.
    await expect(
      page.locator('section:has(h2:text-is("Systems")) [role="alert"], section:has(h2:text-is("Systems")) [role="status"]'),
    ).toHaveCount(0);

    // Release: all lamps drop to their true (dark) states at once.
    await page.clock.fastForward(1_000);
    await expect(litLamps(page)).toHaveCount(0);

    // Drop the link server-side: LINK LOST is momentary and lights alone.
    mock.dropLink();
    await expect(lamp(page, "link-lost")).toHaveAttribute("data-lit", "true");
    await expect(litLamps(page)).toHaveCount(1);

    // The app's own backoff reconnects; the lamp clears and the ref-guarded
    // bulb test does NOT run a second sweep.
    await page.clock.fastForward(2_500);
    await expect(lamp(page, "link-lost")).toHaveAttribute("data-lit", "false");
    await expect(litLamps(page)).toHaveCount(0);

    mock.assertSealed();
  });

  test("every lamp lights on its trigger and latches or clears per the table", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    await page.clock.install();
    const mock = await installActiveMock(page, { state: coldIdleUnhomed });
    await openSystems(page);
    await page.clock.fastForward(1_000); // bulb test released
    await expect(litLamps(page)).toHaveCount(0);

    // HOMED XYZ — momentary success; the label text carries partial homing.
    mock.push({ toolhead: { homed_axes: "xyz" } });
    await expect(lamp(page, "homed")).toHaveAttribute("data-lit", "true");
    await expect(lamp(page, "homed")).toHaveAttribute("data-severity", "success");
    mock.push({ toolhead: { homed_axes: "xy" } });
    await expect(lamp(page, "homed")).toHaveAttribute("data-lit", "false");
    await expect(lamp(page, "homed").locator(".telltale-axis-unhomed")).toHaveText("Z");
    mock.push({ toolhead: { homed_axes: "" } });
    await expect(lamp(page, "homed").locator(".telltale-axis-unhomed")).toHaveCount(3);

    // MESH ACTIVE — momentary info; a loaded profile name is the only proof.
    mock.push({ bed_mesh: { profile_name: "adaptive" } });
    await expect(lamp(page, "mesh-active")).toHaveAttribute("data-lit", "true");
    await expect(lamp(page, "mesh-active")).toHaveAttribute("data-severity", "info");
    mock.push({ bed_mesh: { profile_name: "" } });
    await expect(lamp(page, "mesh-active")).toHaveAttribute("data-lit", "false");

    // MCU HOT — momentary, escalating warning → error at the 80°C critical.
    // The escalation must never be color-alone: critical adds the CRIT text
    // affix (with the measurement); warning carries no affix.
    mock.push({ "temperature_sensor mcu_temp": { temperature: 72 } });
    await expect(lamp(page, "mcu-hot")).toHaveAttribute("data-lit", "true");
    await expect(lamp(page, "mcu-hot")).toHaveAttribute("data-severity", "warning");
    await expect(lamp(page, "mcu-hot").locator(".telltale-detail")).toHaveCount(0);
    mock.push({ "temperature_sensor mcu_temp": { temperature: 85 } });
    await expect(lamp(page, "mcu-hot")).toHaveAttribute("data-severity", "error");
    await expect(lamp(page, "mcu-hot").locator(".telltale-detail")).toHaveText(/CRIT/);
    mock.push({ "temperature_sensor mcu_temp": { temperature: 44.2 } });
    await expect(lamp(page, "mcu-hot")).toHaveAttribute("data-lit", "false");

    // FAN FAULT — the honest strain proxy, latched until acknowledged.
    mock.push({ "temperature_fan chamber_fan": { temperature: 55, target: 40, speed: 1 } });
    await expect(lamp(page, "fan-fault")).toHaveAttribute("data-lit", "true");
    await expect(lamp(page, "fan-fault")).toHaveAttribute("data-phase", "on");
    mock.push({ "temperature_fan chamber_fan": { temperature: 40.2, target: 40, speed: 0.2 } });
    await expect(lamp(page, "fan-fault")).toHaveAttribute("data-phase", "latched");
    await expect(lamp(page, "fan-fault")).toHaveAttribute("data-lit", "true");
    await expect(lamp(page, "fan-fault").getByText("ACK")).toBeVisible();
    const fanAck = page.getByRole("button", { name: "Acknowledge Fan Fault" });
    expect((await fanAck.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await fanAck.click();
    await expect(lamp(page, "fan-fault")).toHaveAttribute("data-lit", "false");
    await expect(page.getByRole("button", { name: "Acknowledge Fan Fault" })).toHaveCount(0);

    // HEATER FAULT + FIRMWARE — klippy shutdown with heater wording lights
    // both; recovery to ready parks BOTH latched (a mid-print restart must
    // be noticed); each clears on its own acknowledge.
    mock.push({
      webhooks: { state: "shutdown", state_message: "Heater extruder not heating at expected rate" },
    });
    await expect(lamp(page, "heater-fault")).toHaveAttribute("data-lit", "true");
    await expect(lamp(page, "firmware")).toHaveAttribute("data-lit", "true");
    // FIRMWARE carries the first 40 chars of klippy's message as sub-text.
    await expect(lamp(page, "firmware")).toContainText("Heater extruder not heating at expected");
    mock.push({ webhooks: { state: "ready", state_message: "Printer is ready" } });
    await expect(lamp(page, "heater-fault")).toHaveAttribute("data-phase", "latched");
    await expect(lamp(page, "firmware")).toHaveAttribute("data-phase", "latched");
    await page.getByRole("button", { name: "Acknowledge Heater Fault" }).click();
    await expect(lamp(page, "heater-fault")).toHaveAttribute("data-lit", "false");
    await page.getByRole("button", { name: "Acknowledge Firmware" }).click();
    await expect(lamp(page, "firmware")).toHaveAttribute("data-lit", "false");

    // THERMAL RUNAWAY — shared detector, 15s anti-flap window on the
    // watchdog clock, latched until acknowledged.
    mock.push({ extruder: { temperature: 254.2, target: 220, power: 0 } });
    await expect(lamp(page, "thermal-runaway")).toHaveAttribute("data-lit", "false");
    await page.clock.fastForward(16_000);
    await expect(lamp(page, "thermal-runaway")).toHaveAttribute("data-lit", "true");
    await expect(lamp(page, "thermal-runaway")).toHaveAttribute("data-severity", "error");
    // Condition clears — a runaway that "went away" must still be seen.
    mock.push({ extruder: { temperature: 219.9, target: 220, power: 0.4 } });
    await expect(lamp(page, "thermal-runaway")).toHaveAttribute("data-phase", "latched");
    await page.getByRole("button", { name: "Acknowledge Thermal Runaway" }).click();
    await expect(lamp(page, "thermal-runaway")).toHaveAttribute("data-lit", "false");

    await expect(litLamps(page)).toHaveCount(0);
    await assertNoBrokenReadouts(page, "tell-tale matrix end state");
    mock.assertSealed();
  });

  test("unlit lamp glyph clears the 3:1 non-text floor against its backdrop", async ({ page }) => {
    // Regression: the unlit glyph is the shape channel that encodes lamp
    // state, so it is a meaningful non-text element under WCAG 1.4.11 —
    // an engine light that is off must stay DISCOVERABLE (clearly off,
    // never invisible). Cells are transparent now, so the effective
    // backdrop is the first opaque ancestor (the instrument panel).
    // Painted-pixel probe: both colors resolved through a canvas so
    // color-mix/oklch serialization differences cannot skew the math.
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, { state: coldIdleUnhomed });
    await openSystems(page);
    // Past the bulb test: all lamps dark, i.e. hairline-unlit.
    await expect(litLamps(page)).toHaveCount(0);

    const probe = await lamp(page, "homed")
      .locator(".telltale-icon")
      .evaluate((el) => {
        const paint = (color: string): [number, number, number, number] => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
          return [r!, g!, b!, a!];
        };
        const toLinear = (byte: number) => {
          const c = byte / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        const luminance = ([r, g, b]: [number, number, number, number]) =>
          0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
        // The glyph paints stroke: currentColor → the computed color.
        const glyph = luminance(paint(getComputedStyle(el).color));
        // Effective backdrop: walk up to the first opaque background.
        let node: Element | null = el.parentElement;
        let backdropColor: [number, number, number, number] | null = null;
        while (node) {
          const candidate = paint(getComputedStyle(node).backgroundColor);
          if (candidate[3] === 255) {
            backdropColor = candidate;
            break;
          }
          node = node.parentElement;
        }
        if (!backdropColor) return { ratio: 0, backdrop: "none", unlitColor: "" };
        const backdrop = luminance(backdropColor);
        const [hi, lo] = glyph > backdrop ? [glyph, backdrop] : [backdrop, glyph];
        return {
          ratio: (hi + 0.05) / (lo + 0.05),
          backdrop: `rgb(${backdropColor[0]}, ${backdropColor[1]}, ${backdropColor[2]})`,
          unlitColor: getComputedStyle(el).color,
        };
      });
    expect(probe.ratio, `unlit glyph ${probe.unlitColor} vs backdrop ${probe.backdrop}`).toBeGreaterThanOrEqual(3);

    // And unlit must still not read as lit: the dark glyph keeps the
    // hairline stroke — the heavy lit weight may never leak onto it.
    const strokes = await page.locator(".telltale-icon").evaluateAll((items) =>
      items.map((item) => Number.parseFloat(getComputedStyle(item).strokeWidth)),
    );
    for (const stroke of strokes) expect(stroke).toBeLessThanOrEqual(1.6);

    mock.assertSealed();
  });

  test("HOMED renders unknown telemetry as dashes, never as a not-homed claim", async ({ page }) => {
    // Before the first toolhead push there is no homing telemetry at all.
    // The struck-through axis letters are a positive "not homed" assertion,
    // so they may appear only once a real reading says so (same rule as the
    // em-dash temperature readouts).
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    const withoutToolhead: MockPrinterState = { ...coldIdleUnhomed };
    delete withoutToolhead.toolhead;
    const mock = await installActiveMock(page, { state: withoutToolhead });
    await openSystems(page);
    await expect(litLamps(page)).toHaveCount(0); // bulb test released

    // Unknown: unlit, three neutral dashes, zero struck-through letters.
    await expect(lamp(page, "homed")).toHaveAttribute("data-lit", "false");
    await expect(lamp(page, "homed").locator(".telltale-axis-unknown")).toHaveCount(3);
    await expect(lamp(page, "homed").locator(".telltale-axis-unhomed")).toHaveCount(0);

    // First real telemetry that says unhomed — now, and only now, the
    // known-unhomed strike-through treatment appears.
    mock.push({ toolhead: { homed_axes: "" } });
    await expect(lamp(page, "homed").locator(".telltale-axis-unhomed")).toHaveCount(3);
    await expect(lamp(page, "homed").locator(".telltale-axis-unknown")).toHaveCount(0);

    // And a real homed reading lights the lamp as ever.
    mock.push({ toolhead: { homed_axes: "xyz" } });
    await expect(lamp(page, "homed")).toHaveAttribute("data-lit", "true");

    mock.assertSealed();
  });

  test("lamps keep all three channels under forced colors", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    await page.emulateMedia({ forcedColors: "active" });
    const mock = await installActiveMock(page, {
      state: {
        ...coldIdleUnhomed,
        webhooks: { state: "shutdown", state_message: "Emergency stop issued" },
      },
    });
    await openSystems(page);
    await expect(lamp(page, "firmware")).toHaveAttribute("data-lit", "true");
    // Settle past the bulb test so only FIRMWARE holds.
    await expect(litLamps(page)).toHaveCount(1);

    // Scoped to the cluster grid: the Readiness light chip keeps the square
    // lamp grammar (.telltale-lamp) and has its own coverage.
    const channels = await page.locator(".telltale-grid .telltale-icon").evaluateAll((items) => {
      // Resolve what CanvasText actually paints as, same probe technique as
      // the status-lamp forced-colors regression test.
      const probe = document.createElement("span");
      probe.style.color = "CanvasText";
      document.body.appendChild(probe);
      const canvasText = getComputedStyle(probe).color;
      probe.remove();
      return items.map((item) => {
        const style = getComputedStyle(item);
        const box = item.getBoundingClientRect();
        return {
          lit: item.getAttribute("data-lit"),
          color: style.color,
          strokeWidth: Number.parseFloat(style.strokeWidth),
          canvasText,
          sized: box.width > 0 && box.height > 0,
        };
      });
    });
    expect(channels.length).toBe(9);
    for (const entry of channels) {
      // The glyph must keep painting under forced colors: its stroke rides
      // currentColor, which the forced palette rewrites to CanvasText.
      expect(entry.sized).toBe(true);
      expect(entry.color).toBe(entry.canvasText);
      // Weight is the non-color lit channel and survives forced palettes:
      // lit glyphs stay heavy, dark glyphs stay hairline.
      if (entry.lit === "true") {
        expect(entry.strokeWidth).toBeGreaterThanOrEqual(2.4);
      } else {
        expect(entry.strokeWidth).toBeLessThanOrEqual(1.6);
      }
    }

    // The SECOND structural lit channel: under forced colors a lit cell
    // underlines its label. text-decoration is geometry, not color, so the
    // forced palette must paint it — lit/unlit discrimination never rests on
    // stroke weight alone.
    const marks = await page
      .locator(".telltale-grid .telltale-cell")
      .evaluateAll((cells) =>
        cells.map((cell) => {
          const label = cell.querySelector(".instrument-label");
          return {
            lit: cell.getAttribute("data-lit"),
            underlined: label
              ? getComputedStyle(label).textDecorationLine.includes("underline")
              : null,
          };
        }),
      );
    expect(marks.length).toBe(9);
    // Non-vacuous on both sides: this scenario holds exactly one lit lamp
    // (FIRMWARE) among unlit neighbours.
    expect(marks.filter((m) => m.lit === "true").length).toBe(1);
    for (const mark of marks) {
      expect(mark.underlined, `lit=${mark.lit} label underline`).toBe(mark.lit === "true");
    }

    mock.assertSealed();
  });
});
