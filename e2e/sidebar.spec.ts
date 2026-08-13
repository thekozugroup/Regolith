import { expect, test, type Page } from "@playwright/test";
import { isPreviewUrl } from "./support/preview-origin";
import { sealPrinterNamespace } from "./support/printer-seal";

/**
 * Collapsible sidebar (owner request): the desk sidebar collapses to an ICON
 * RAIL — never fully hidden, navigation stays one tap away — with 44px
 * targets, a persisted preference, and a width the content column actually
 * reclaims (the dashboard grid is container-query driven, so the dials must
 * measurably grow). The K1's 800x480 panel keeps the touch chrome: the
 * height gate outranks the preference.
 */

const EXPANDED_W = 224; /* 14rem */
const RAIL_W = 64; /* 4rem */

const printerState = {
  webhooks: { state: "ready", state_message: "Ready" },
  idle_timeout: { state: "Ready" },
  print_stats: { state: "standby", filename: "", print_duration: 0 },
  extruder: { temperature: 25.2, target: 0, power: 0 },
  heater_bed: { temperature: 24.4, target: 0, power: 0 },
  toolhead: { position: [150, 150, 12, 0], homed_axes: "xyz", print_time: 0, estimated_print_time: 0 },
  virtual_sdcard: { progress: 0, is_active: false, file_position: 0, file_size: 0 },
  display_status: { progress: 0, message: "Ready" },
  fan: { speed: 0 },
  gcode_move: { position: [150, 150, 12, 0], gcode_position: [150, 150, 12, 0], speed: 0, speed_factor: 1, extrude_factor: 1 },
};

const mockCameraFrame = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#14191f"/></svg>`;

async function installLocalMock(page: Page): Promise<{ escaped: string[]; writes: string[] }> {
  const audit = { escaped: [] as string[], writes: [] as string[] };
  await page.routeWebSocket("**/websocket", (socket) => {
    socket.onMessage((payload) => {
      const request = JSON.parse(String(payload)) as { id?: number; method?: string };
      if (request.method !== "printer.objects.subscribe") {
        audit.writes.push(`rpc:${request.method ?? "unknown"}`);
        return;
      }
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { status: printerState } }));
    });
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" && request.method() !== "HEAD") {
      audit.writes.push(`${request.method()} ${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    if (url.pathname === "/printer/info") {
      // The brand area shows the printer's own name (hostname), not a
      // static tagline — give the probe the owner's machine to assert on.
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: { hostname: "forge", state: "ready", state_message: "Printer is ready", software_version: "test" },
        }),
      });
      return;
    }
    if (isPreviewUrl(url)) {
      // Same origin, but the server behind it proxies the printer
      // namespaces — seal them here rather than handing them down.
      // Refusals land in `audit.escaped`, which the tests assert empty.
      if (await sealPrinterNamespace(route, url, audit.escaped)) return;
      await route.continue();
      return;
    }
    if (url.port === "8080") {
      await route.fulfill({ status: 200, contentType: "image/svg+xml", body: mockCameraFrame });
      return;
    }
    audit.escaped.push(request.url());
    await route.abort("blockedbyclient");
  });
  return audit;
}

const asideWidth = (page: Page) =>
  page.locator("aside").evaluate((el) => el.getBoundingClientRect().width);

async function assertNoTouchTargetOrOverflowRegressions(page: Page) {
  const audit = await page.evaluate(() => {
    const undersized = [...document.querySelectorAll<HTMLElement>("button, a, input, select")]
      .filter((el) => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
      })
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width < 44 || box.height < 44;
      })
      .map((el) => el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName);
    return {
      undersized,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(audit.undersized, "44px targets must survive the rail").toEqual([]);
  expect(audit.overflow, "horizontal overflow").toBeLessThanOrEqual(1);
}

test.describe("Collapsible sidebar — icon rail", () => {
  test("collapses to a 64px rail via keyboard, keeps navigation, and the dials grow into the freed width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const audit = await installLocalMock(page);
    await page.goto("/");
    await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);

    // Brand area: the line under "Regolith" is the printer's own name
    // (hostname from /printer/info), not the old "Instrument panel" tagline.
    // CSS uppercases it; the DOM keeps the raw reported name.
    await expect(page.locator("aside")).toContainText("forge");
    await expect(page.locator("aside")).not.toContainText("Instrument panel");

    // Expanded geometry: sidebar at its full width, app bar and content
    // offset by exactly that width.
    expect(await asideWidth(page)).toBeCloseTo(EXPANDED_W, 0);
    const expandedMainLeft = await page.locator("main").evaluate((el) => el.getBoundingClientRect().left);
    expect(expandedMainLeft).toBeCloseTo(EXPANDED_W, 0);
    const expandedDial = await page.locator(".gauge-dial").first().evaluate((el) => el.getBoundingClientRect().width);

    // Toggle is keyboard-operable and announces its state.
    const toggle = page.getByRole("button", { name: "Collapse sidebar" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.focus();
    await page.keyboard.press("Enter");

    // Collapsed geometry: a rail, not a disappearance.
    await expect.poll(() => asideWidth(page)).toBeCloseTo(RAIL_W, 0);
    await expect(page.locator("aside")).toBeVisible();
    const collapsedToggle = page.getByRole("button", { name: "Expand sidebar" });
    await expect(collapsedToggle).toHaveAttribute("aria-expanded", "false");

    // Every route stays one tap away with its accessible name intact, on a
    // 44px target.
    for (const label of ["Home", "Files", "Control", "Timelapses", "Settings"]) {
      const link = page.locator("aside").getByRole("link", { name: label });
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box, `${label} link box`).not.toBeNull();
      expect(box!.width, `${label} rail target width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${label} rail target height`).toBeGreaterThanOrEqual(44);
    }
    await assertNoTouchTargetOrOverflowRegressions(page);

    // The content column claims the freed width and the container-query
    // grid passes it to the instruments: the dials must actually grow.
    await expect
      .poll(() => page.locator("main").evaluate((el) => el.getBoundingClientRect().left))
      .toBeCloseTo(RAIL_W, 0);
    await expect
      .poll(() => page.locator(".gauge-dial").first().evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(expandedDial + 10);
    await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);

    // Navigation still works from the rail.
    await page.locator("aside").getByRole("link", { name: "Settings" }).click();
    await expect(page.locator("main").getByRole("heading", { name: "Experience", exact: true })).toBeVisible();

    expect(audit.escaped).toEqual([]);
    expect(audit.writes).toEqual([]);
  });

  test("above the 2200px shell cap the freed rail width goes to margins by design", async ({ page }) => {
    // Accepted trade, measured in the SD1 fit pass (2026-08-03): the
    // dashboard shell is deliberately capped at 2200px for readability
    // (Dashboard.tsx `max-w-[min(100%,2200px)]`). Above ~2424px viewport
    // (cap + expanded rail) the shell is already at its cap, so collapsing
    // the rail widens the centring margins — the dials must NOT be expected
    // to grow there, and the cap must not silently move. This pins the
    // decision so future spacing work re-litigates it deliberately.
    await page.setViewportSize({ width: 2560, height: 1440 });
    const audit = await installLocalMock(page);
    await page.goto("/");
    await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);

    const shellWidth = () =>
      page.locator(".dashboard-shell").evaluate((el) => el.getBoundingClientRect().width);
    expect(await shellWidth()).toBeCloseTo(2200, 0);
    const expandedDial = await page
      .locator(".gauge-dial")
      .first()
      .evaluate((el) => el.getBoundingClientRect().width);

    const toggle = page.getByRole("button", { name: "Collapse sidebar" });
    await toggle.click();
    await expect.poll(() => asideWidth(page)).toBeCloseTo(RAIL_W, 0);

    // The shell stays at its readability cap; the dial width is unchanged.
    expect(await shellWidth()).toBeCloseTo(2200, 0);
    const collapsedDial = await page
      .locator(".gauge-dial")
      .first()
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(Math.abs(collapsedDial - expandedDial)).toBeLessThanOrEqual(1);
    await assertNoTouchTargetOrOverflowRegressions(page);

    expect(audit.escaped).toEqual([]);
    expect(audit.writes).toEqual([]);
  });

  test("brand icon popover keeps the derived-radius law at its 8px pad", async ({ page }) => {
    // Regression: the popover is a .modal-panel padded p-2 (8px), not the
    // modal default 16px. The pad token is overridden on the element so the
    // cascade derives --radius-inner from the REAL pad; corner children must
    // sit concentric (outer = pad + inner, ±1px border tolerance).
    await page.setViewportSize({ width: 1280, height: 900 });
    const audit = await installLocalMock(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Change brand icon" }).click();

    const popover = page.getByRole("dialog", { name: "Choose brand icon" });
    await expect(popover).toBeVisible();
    const law = await popover.evaluate((el) => {
      const outer = parseFloat(getComputedStyle(el).borderBottomLeftRadius);
      const child = [...el.querySelectorAll<HTMLElement>("button")].at(-1)!;
      const inner = parseFloat(getComputedStyle(child).borderBottomLeftRadius);
      const host = el.getBoundingClientRect();
      const box = child.getBoundingClientRect();
      const inset = Math.min(box.left - host.left, host.bottom - box.bottom);
      return { outer, inner, inset };
    });
    // Padding-box concentricity: outer − (pad + border) − inner = −1 ± 1.
    expect(Math.abs(law.outer - (law.inset + law.inner))).toBeLessThanOrEqual(1.5);
    // And the pad the cascade derives from is the markup's real 8px pad.
    expect(law.inset).toBeGreaterThanOrEqual(8);
    expect(law.inset).toBeLessThanOrEqual(10);

    expect(audit.escaped).toEqual([]);
    expect(audit.writes).toEqual([]);
  });

  test("the collapse preference persists across reload, in both directions", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const audit = await installLocalMock(page);
    await page.goto("/");
    await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    // Reduced motion: the width change is effectively instant, no 200ms wait.
    await expect.poll(() => asideWidth(page)).toBeCloseTo(RAIL_W, 0);

    await page.reload();
    await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);
    expect(await asideWidth(page)).toBeCloseTo(RAIL_W, 0);
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");

    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect.poll(() => asideWidth(page)).toBeCloseTo(EXPANDED_W, 0);
    await page.reload();
    await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);
    expect(await asideWidth(page)).toBeCloseTo(EXPANDED_W, 0);
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute("aria-expanded", "true");

    expect(audit.escaped).toEqual([]);
    expect(audit.writes).toEqual([]);
  });

  test("the rail never overlaps the mission bar, and the K1 panel height gate outranks the preference", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const audit = await installLocalMock(page);
    await page.addInitScript(() => localStorage.setItem("forge.sidebar.collapsed", "1"));
    await page.goto("/");
    await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);
    expect(await asideWidth(page)).toBeCloseTo(RAIL_W, 0);

    // The sidebar ends exactly where the mission bar begins — same contract
    // as the expanded sidebar (MissionBar stays full-bleed underneath is a
    // NON-goal: the bar owns the full viewport width, the rail must stop
    // above it).
    const geometry = await page.evaluate(() => {
      const aside = document.querySelector("aside")!.getBoundingClientRect();
      const bar = document
        .querySelector('section[aria-label="Printer status"]')!
        .getBoundingClientRect();
      const appBar = document.querySelector("header")!.getBoundingClientRect();
      const main = document.querySelector("main")!.getBoundingClientRect();
      return {
        asideBottom: aside.bottom,
        barTop: bar.top,
        barLeft: bar.left,
        appBarLeft: appBar.left,
        asideRight: aside.right,
        mainLeft: main.left,
      };
    });
    expect(geometry.asideBottom, "rail must stop at the mission bar").toBeLessThanOrEqual(geometry.barTop + 0.5);
    expect(geometry.barLeft, "mission bar stays full-bleed").toBe(0);
    expect(geometry.appBarLeft, "app bar starts at the rail edge").toBeCloseTo(geometry.asideRight, 0);
    expect(geometry.mainLeft, "content starts at the rail edge").toBeGreaterThanOrEqual(geometry.asideRight - 0.5);

    // The K1 Max's own 800x480 panel: the height gate hides the desk
    // sidebar entirely — a stored collapse preference must not resurrect it.
    await page.setViewportSize({ width: 800, height: 480 });
    await page.goto("/");
    await expect(page.locator("aside")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Mobile primary" })).toBeVisible();
    await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);

    expect(audit.escaped).toEqual([]);
    expect(audit.writes).toEqual([]);
  });
});
