import { expect, test, type Page } from "@playwright/test";
import {
  assertNoBrokenReadouts,
  installActiveMock,
  useExperience,
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
    // Expert adds the two PWM heater-power strips to the four basic ones.
    await expect(page.locator(".segment-gauge")).toHaveCount(6);
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

    mock.assertSealed();
  });
});
