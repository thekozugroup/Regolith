import { expect, test, type Page } from "@playwright/test";
import {
  assertDashboardTaskOrder,
  assertDialFloor,
  assertMissionBarPlacement,
  assertNoHorizontalOverflow,
  assertTextFloor,
  assertTouchTargets,
  installActiveMock,
  useExperience,
  type MockPrinterState,
} from "./support/active-state-harness";

/**
 * Swiss modular grid + Readiness module (owner spec).
 *
 *   - Readiness is the TOP-LEFT module on multi-column classes, and shows
 *     ONLY the persistent layer: ready lamp + word, silhouette, status
 *     line, light chip. Every detail lives in the disclosure.
 *   - The disclosure is a real dialog: focus moves in, Escape closes,
 *     focus restores to the trigger.
 *   - Card left edges snap to column starts (the shared alignment lines).
 *   - Dials keep their digital dashboard squares.
 *   - The measured floors hold at 320, the 800x480 K1 panel, 1280, 2560.
 */

const idleState: MockPrinterState = {
  webhooks: { state: "ready", state_message: "Printer is ready" },
  idle_timeout: { state: "Idle" },
  print_stats: {
    state: "standby",
    filename: "",
    total_duration: 0,
    print_duration: 0,
    filament_used: 0,
    message: "",
  },
  extruder: { temperature: 27.4, target: 0, power: 0, pressure_advance: 0.04 },
  heater_bed: { temperature: 25.9, target: 0, power: 0 },
  toolhead: {
    position: [150, 150, 10, 0],
    homed_axes: "xyz",
    print_time: 0,
    estimated_print_time: 0,
    axis_minimum: [0, 0, 0, 0],
    axis_maximum: [300, 300, 300, 0],
  },
  virtual_sdcard: { progress: 0, is_active: false, file_position: 0, file_size: 0 },
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

async function openDashboard(page: Page) {
  await page.goto("/");
  await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);
}

test.describe("Swiss grid — readiness module", () => {
  test("readiness sits top-left and shows only the persistent layer", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, { state: idleState });
    await openDashboard(page);

    const geo = await page.evaluate(() => {
      const grid = document.querySelector(".dashboard-grid")!.getBoundingClientRect();
      const rdy = document.querySelector(".z-readiness")!.getBoundingClientRect();
      return { gridLeft: grid.left, gridTop: grid.top, left: rdy.left, top: rdy.top };
    });
    expect(Math.abs(geo.left - geo.gridLeft), "readiness left edge = column 1").toBeLessThanOrEqual(1);
    expect(Math.abs(geo.top - geo.gridTop), "readiness top edge = row 1").toBeLessThanOrEqual(1);

    // Persistent layer only — the moved detail must be ABSENT until opened.
    const readiness = page.locator(".z-readiness");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    for (const detail of ["Hostname", "Klipper", "Network", "Homed"]) {
      await expect(readiness.getByText(detail, { exact: true })).toHaveCount(0);
    }
    await expect(readiness.locator(".readiness-status")).toHaveText("ready · standby");
    await expect(readiness.locator(".readiness-ready")).toContainText(/ready/i);
    await expect(readiness.locator(".readiness-light")).toContainText("LIGHT");
    await expect(readiness.locator(".k1-silhouette")).toBeVisible();
    // The drawing is decoration; HTML text is the accessible truth.
    await expect(readiness.locator(".k1-silhouette")).toHaveAttribute("aria-hidden", "true");
    expect(await readiness.locator(".k1-silhouette text").count(), "no SVG <text> in the silhouette").toBe(0);
    mock.assertSealed();
  });

  test("light chip is honest: dash before telemetry, then ON/OFF from output_pin LED", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, { state: idleState });
    await openDashboard(page);

    const light = page.locator(".readiness-light");
    const lamp = light.locator(".telltale-lamp");
    const rays = page.locator(".k1-silhouette [data-accent] path");

    // No output_pin telemetry in the fixture: an honest dash, never OFF.
    await expect(light).toContainText("LIGHT —");
    await expect(lamp).toHaveAttribute("data-lit", "false");
    await expect(rays).toHaveCount(0);

    mock.push({ "output_pin LED": { value: 1 } });
    await expect(light).toContainText("LIGHT ON");
    await expect(lamp).toHaveAttribute("data-lit", "true");
    // The three chamber-light rays render only while the LED reads ON.
    await expect(rays).toHaveCount(3);

    mock.push({ "output_pin LED": { value: 0 } });
    await expect(light).toContainText("LIGHT OFF");
    await expect(lamp).toHaveAttribute("data-lit", "false");
    await expect(rays).toHaveCount(0);

    // The chip is display-only: it must not be a nested control.
    await expect(light.locator("button")).toHaveCount(0);
    mock.assertSealed();
  });

  test("disclosure opens as a dialog, holds focus, and Escape restores the trigger", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, { state: idleState });
    await openDashboard(page);

    const module = page.locator(".readiness-module");
    await expect(module).toHaveAttribute("aria-haspopup", "dialog");
    await expect(module).toHaveAttribute("aria-expanded", "false");

    await module.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(module).toHaveAttribute("aria-expanded", "true");

    // The moved detail renders from the first-open fetches.
    await expect(dialog.getByRole("heading", { name: "forge" })).toBeVisible();
    await expect(dialog.getByText("Buildroot 2023.02")).toBeVisible();
    await expect(dialog.getByText("Hostname", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Homed", { exact: true })).toBeVisible();

    // Focus moved into the dialog.
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false,
        ),
      )
      .toBe(true);

    // Escape closes and hands focus back to the module trigger.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(module).toHaveAttribute("aria-expanded", "false");
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.classList.contains("readiness-module") ?? false),
      )
      .toBe(true);

    // The explicit close affordance works too, and it is finger-sized.
    await module.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const close = page.getByRole("button", { name: "Close printer detail" });
    const box = (await close.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await close.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    mock.assertSealed();
  });
});

test.describe("Swiss grid — alignment and floors", () => {
  test("card left edges snap to the column starts at 1280 (8-column class)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, { state: idleState });
    await openDashboard(page);

    const edges = await page.evaluate(() => {
      const rect = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top };
      };
      return {
        grid: rect(".dashboard-grid"),
        rdy: rect(".z-readiness"),
        msn: rect(".z-mission"),
        thm: rect(".z-thermals"),
        cam: rect(".z-camera"),
        tel: rect(".z-telemetry"),
        tt: rect(".z-telltales"),
        gap: parseFloat(
          getComputedStyle(document.querySelector(".dashboard-grid")!).columnGap,
        ),
      };
    });
    const { gap, ...zoneEdges } = edges;
    for (const [name, zone] of Object.entries(zoneEdges)) {
      expect(zone, `${name} zone must exist`).not.toBeNull();
    }
    const { grid, rdy, msn, thm, cam, tel, tt } = zoneEdges as Record<
      string,
      { left: number; right: number; top: number }
    >;

    // Column-1 starts: readiness, thermals, telemetry share the left line.
    for (const zone of [rdy, thm, tel]) {
      expect(Math.abs(zone.left - grid.left)).toBeLessThanOrEqual(1);
    }
    // Column-5 starts: mission, camera, tell-tales share the halves line.
    expect(Math.abs(msn.left - cam.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(msn.left - tt.left)).toBeLessThanOrEqual(1);
    // The halves line really is the middle of the grid. In an 8-column grid
    // with gap g, column 5 starts exactly g/2 past the geometric middle —
    // derive the tolerance from the live gap (the rhythm token is fluid
    // since the flatten pass) instead of hardcoding half of a fixed gap.
    const mid = grid.left + (grid.right - grid.left) / 2;
    expect(Math.abs(msn.left - mid)).toBeLessThanOrEqual(gap / 2 + 1);
    // Row tops align by construction.
    expect(Math.abs(rdy.top - msn.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(thm.top - cam.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(tel.top - tt.top)).toBeLessThanOrEqual(1);
    mock.assertSealed();
  });

  test("dial modules stay square within 2%, and the dial art is never distorted", async ({ page }) => {
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, { state: idleState });
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 2560, height: 1200 },
    ]) {
      await page.setViewportSize(viewport);
      await openDashboard(page);
      // The "digital dashboard squares" are the thermal instrument tiles.
      const tiles = await page
        .locator(".thermal-instrument:visible")
        .evaluateAll((items) =>
          items.map((tile) => {
            const box = tile.getBoundingClientRect();
            return { width: box.width, height: box.height };
          }),
        );
      expect(tiles.length).toBe(2);
      for (const tile of tiles) {
        expect(
          Math.abs(tile.width - tile.height) / tile.width,
          `tile ${tile.width}x${tile.height} must stay square at ${viewport.width}`,
        ).toBeLessThanOrEqual(0.02);
      }
      // The dial svg keeps its authored 200:172 viewBox ratio — squares may
      // never be bought by stretching the instrument art.
      const dials = await page
        .locator(".gauge-dial:visible")
        .evaluateAll((items) =>
          items.map((dial) => {
            const box = dial.getBoundingClientRect();
            return box.width / box.height;
          }),
        );
      expect(dials.length).toBe(2);
      for (const ratio of dials) {
        expect(
          Math.abs(ratio - 200 / 172) / (200 / 172),
          `dial render ratio ${ratio.toFixed(3)} must match the authored viewBox at ${viewport.width}`,
        ).toBeLessThanOrEqual(0.02);
      }
    }
    mock.assertSealed();
  });

  test("every floor holds at 320, the K1 panel, 1280 and 2560", async ({ page }) => {
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, { state: idleState });
    for (const viewport of [
      { width: 320, height: 700 },
      { width: 800, height: 480 },
      { width: 1280, height: 900 },
      { width: 2560, height: 1200 },
    ]) {
      const label = `${viewport.width}x${viewport.height}`;
      await page.setViewportSize(viewport);
      await openDashboard(page);
      await assertNoHorizontalOverflow(page, label);
      await assertTextFloor(page, label);
      await assertTouchTargets(page, label);
      await assertDialFloor(page, label);
      await assertDashboardTaskOrder(page, label);
      await assertMissionBarPlacement(page, label);
    }
    mock.assertSealed();
  });

  test("instrument tiles are flat: fills belong to the panel, separation is space", async ({ page }) => {
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, { state: idleState });
    for (const viewport of [
      { width: 800, height: 480 },
      { width: 1280, height: 900 },
    ]) {
      const label = `${viewport.width}x${viewport.height}`;
      await page.setViewportSize(viewport);
      await openDashboard(page);

      // Owner: "remove the backgrounds on each element so it is cleaner".
      // Every instrument tile sits directly on the panel surface — the
      // computed background of each tile is fully transparent.
      const tiles = await page
        .locator(".thermal-instrument, .segment-gauge, .telltale-cell")
        .evaluateAll((items) =>
          items
            .filter((tile) => tile.getClientRects().length > 0)
            .map((tile) => ({
              cls: tile.getAttribute("class") ?? "",
              bg: getComputedStyle(tile).backgroundColor,
            })),
        );
      expect(tiles.length, `${label}: tiles rendered`).toBeGreaterThan(0);
      for (const tile of tiles) {
        expect(tile.bg, `${label}: ${tile.cls} must carry no fill`).toBe("rgba(0, 0, 0, 0)");
      }

      // Stronger, mechanism-agnostic pin: inside the three instrument
      // panels the owner named, NOTHING visible paints a background other
      // than the panel's own surface. The only allowed exception is the
      // functional .status-lamp chip (outline/fill IS its state — spec
      // A.1.6 keeps gauge tracks and lamps, but those live in SVG fills,
      // not CSS backgrounds).
      for (const title of ["Thermals", "Telemetry", "Systems"]) {
        const offenders = await page
          .locator(`section.instrument-panel:has(h2:text-is("${title}"))`)
          .evaluate((panel) => {
            const own = getComputedStyle(panel).backgroundColor;
            const found: string[] = [];
            for (const el of Array.from(panel.querySelectorAll<HTMLElement>("*"))) {
              if (el.getClientRects().length === 0) continue;
              if (el.classList.contains("status-lamp")) continue;
              const bg = getComputedStyle(el).backgroundColor;
              if (bg !== "rgba(0, 0, 0, 0)" && bg !== own) {
                found.push(`${el.tagName.toLowerCase()}.${el.className} → ${bg}`);
              }
            }
            return found;
          });
        expect(offenders, `${label} ${title}: per-element fills must be gone`).toEqual([]);
      }
    }
    mock.assertSealed();
  });

  test("one page rhythm: equal insets on all four sides at 390, the K1 panel and 1280", async ({ page }) => {
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, { state: idleState });
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 800, height: 480 },
      { width: 1280, height: 800 },
    ]) {
      const label = `${viewport.width}x${viewport.height}`;
      await page.setViewportSize(viewport);
      await openDashboard(page);

      // Insets are measured to the CHROME edges (app bar, mission bar,
      // sidebar rail), not the glass: content's neighbours are the fixed
      // chrome surfaces. The owner's rule — even spacing from the sides
      // left, right, top AND bottom — must hold as one number. The bottom
      // inset is only observable at full scroll (content may be taller
      // than the glass; the K1 panel and phone always are).
      const insets = await page.evaluate(() => {
        window.scrollTo(0, 0);
        const grid = document.querySelector(".dashboard-grid")!;
        const appbar = document.querySelector("header.app-chrome")!;
        const top = grid.getBoundingClientRect().top - appbar.getBoundingClientRect().bottom;
        // Compact chrome translates the sidebar off-canvas rather than
        // unmounting it — clamp at 0 so an off-screen rail contributes no
        // left-chrome edge.
        const aside = document.querySelector("aside");
        const asideRight = aside ? Math.max(0, aside.getBoundingClientRect().right) : 0;
        const left = grid.getBoundingClientRect().left - asideRight;
        const right = document.documentElement.clientWidth - grid.getBoundingClientRect().right;
        window.scrollTo(0, document.documentElement.scrollHeight);
        const mission = document.querySelector(".mission-bar")!;
        const bottom =
          mission.getBoundingClientRect().top - grid.getBoundingClientRect().bottom;
        window.scrollTo(0, 0);
        const gaps = getComputedStyle(document.querySelector(".dashboard-grid")!);
        return { top, left, right, bottom, rowGap: parseFloat(gaps.rowGap) };
      });

      const sides = [insets.top, insets.left, insets.right, insets.bottom];
      for (const side of sides) {
        expect(side, `${label}: inset must be positive (${JSON.stringify(insets)})`).toBeGreaterThan(0);
      }
      const spread = Math.max(...sides) - Math.min(...sides);
      expect(
        spread,
        `${label}: all four insets must be even within 1px (${JSON.stringify(insets)})`,
      ).toBeLessThanOrEqual(1);
      // And the inter-module gap is the SAME number as the edge inset —
      // one rhythm, not two.
      expect(
        Math.abs(insets.rowGap - insets.top),
        `${label}: module gap must equal the edge inset (${JSON.stringify(insets)})`,
      ).toBeLessThanOrEqual(1);
    }
    mock.assertSealed();
  });
});
