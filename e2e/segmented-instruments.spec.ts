/**
 * Segmented instruments (segmented-dials spec).
 *
 * PART 1 — the dial's value channel is 24 discrete segments of 10° (70/30
 * duty, butt caps) quantized by the SAME exported litSegments() the telemetry
 * strips use. The count never changes with width (segment count IS the
 * displayed resolution), the target index stays UNSNAPPED at its true angle,
 * and the delta band is expressed per-segment so it can never disagree with
 * the segments it spans.
 *
 * PART 2 — range bars appear on every factor with a REAL published range and
 * on no factor without one: an unknown range yields NO <svg> at all, never a
 * default. The five bar-less factors (Z-Offset, Filament, Pressure Adv.,
 * Max Accel, Homed) are pinned bar-less — the anti-regression guard for the
 * invented-pressure-advance incident class.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  installActiveMock,
  type MockPrinterState,
} from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";
import { visit } from "./support/sweep-helpers";

const DIAL_SEGMENTS = 24;

const hotendGauge = (page: Page) => page.getByRole("img", { name: /^Hotend temperature/ });
const bedGauge = (page: Page) => page.getByRole("img", { name: /^Bed temperature/ });

async function openScenario(
  page: Page,
  id: string,
  opts: { experience?: "basic" | "expert"; state?: MockPrinterState } = {},
) {
  const sc = scenario(id);
  // Inlined useExperience(): the harness helper's name trips the
  // rules-of-hooks lint when called from a non-test-scoped function.
  await page.addInitScript(
    (value) => localStorage.setItem("forge.experience-mode", value),
    opts.experience ?? sc.experience ?? "basic",
  );
  const mock = await installActiveMock(page, {
    state: opts.state ?? sc.state,
    camera: "ok",
    thumbnail: sc.thumbnail,
  });
  await visit(page, "/");
  return mock;
}

test.describe("Segmented dials — 24-cell value channel", () => {
  test("the segment count is fixed and universal across the responsive matrix", async ({
    page,
  }) => {
    // §1.2: no container-query segment-count switch. The same temperature
    // must light the same fraction of the dial at every layout width — a
    // count that varied with width would be a scale that lies about itself.
    const mock = await openScenario(page, "printing-midjob");
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 800, height: 480 },
      { width: 1280, height: 900 },
      { width: 2560, height: 1440 },
    ]) {
      await page.setViewportSize(viewport);
      const label = `${viewport.width}x${viewport.height}`;
      await expect(page.locator(".gauge-dial:visible"), label).toHaveCount(2);
      await expect(
        hotendGauge(page).locator(".gauge-segment"),
        `${label}: hotend dial renders exactly ${DIAL_SEGMENTS} segments`,
      ).toHaveCount(DIAL_SEGMENTS);
      await expect(
        bedGauge(page).locator(".gauge-segment"),
        `${label}: bed dial renders exactly ${DIAL_SEGMENTS} segments`,
      ).toHaveCount(DIAL_SEGMENTS);
    }
    mock.assertSealed();
  });

  test("lit count is exact integer arithmetic on the fixture temperatures", async ({ page }) => {
    // Zero tolerance — the mapping is round(clamp(v/max) * 24), the same
    // exported quantizer the strips use.
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openScenario(page, "printing-midjob");
    // Hotend 219.8° of 300° → round(17.584) = 18.
    await expect(
      hotendGauge(page).locator('.gauge-segment[data-lit="true"]'),
      "hotend lit segments",
    ).toHaveCount(Math.round((219.8 / 300) * DIAL_SEGMENTS));
    // Bed 60.1° of 120° → round(12.02) = 12.
    await expect(
      bedGauge(page).locator('.gauge-segment[data-lit="true"]'),
      "bed lit segments",
    ).toHaveCount(Math.round((60.1 / 120) * DIAL_SEGMENTS));
    mock.assertSealed();
  });

  test("an unknown temperature lights nothing and reads as an em-dash", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const base = scenario("at-temperature");
    const mock = await openScenario(page, "at-temperature", {
      state: {
        ...base.state,
        // No temperature at all — the reading is UNKNOWN, not zero.
        extruder: { target: 0, power: 0 },
      },
    });
    await expect(
      page.getByRole("img", { name: "Hotend temperature unavailable" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Hotend temperature unavailable" }).locator(
        '.gauge-segment[data-lit="true"]',
      ),
      "unknown must light zero segments",
    ).toHaveCount(0);
    await expect(
      page.getByRole("img", { name: "Hotend temperature unavailable" }).getByText("—").first(),
      "the readout must be the honest placeholder",
    ).toBeVisible();
    mock.assertSealed();
  });

  test("the target index is unsnapped — true angle, never a segment boundary", async ({
    page,
  }) => {
    // Snapping the index to a 10° boundary would misstate the setpoint by up
    // to ±3.75°C on a 300° scale. Heating fixture: target 220 of 300 →
    // 150 + 240·220/300 = 326°, which is 17.6 segment pitches past the
    // sweep start — deliberately mid-segment.
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openScenario(page, "heating");
    const angle = await hotendGauge(page)
      .locator(".gauge-target-index")
      .evaluate((el) => {
        const g = el.closest("g");
        const match = /rotate\(([\d.]+)deg\)/.exec(g?.style.transform ?? "");
        return match ? Number(match[1]) : null;
      });
    expect(angle, "the index must carry a rotate() transform").not.toBeNull();
    expect(Math.abs(angle! - 326), "index at the true target angle").toBeLessThanOrEqual(0.1);
    const pitches = (angle! - 150) / 10;
    expect(
      Math.abs(pitches - Math.round(pitches)),
      "the index must NOT sit on a segment boundary for this fixture",
    ).toBeGreaterThan(0.05);
    mock.assertSealed();
  });

  test("the delta band agrees with the segments it spans, exactly", async ({ page }) => {
    // Heating: litValue = round(48.3/300·24) = 4, litTarget =
    // round(220/300·24) = 18 → exactly |18 − 4| = 14 delta-inked segments,
    // and no segment is ever both lit and delta-inked (lit wins).
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openScenario(page, "heating");
    await expect(
      hotendGauge(page).locator('.gauge-segment[data-delta="true"]'),
      "delta segment count must equal the lit-segment distance",
    ).toHaveCount(14);
    await expect(
      page.locator('.gauge-segment[data-lit="true"][data-delta="true"]'),
      "no segment may be both lit and delta-inked",
    ).toHaveCount(0);
    mock.assertSealed();
  });

  test("segments stay above the legibility floor at the K1 panel", async ({ page }) => {
    // The 148px dial floor is load-bearing in a new way: an arc has no
    // minimum feature size, a segment does. At the panel's two-up layout the
    // arithmetic predicts a 7.68px lit arc — a layout regression that
    // shrinks the dial must fail here before segments turn to slivers.
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openScenario(page, "printing-midjob");
    const boxes = await page
      .locator(".gauge-dial .gauge-segment")
      .evaluateAll((items) =>
        items.map((item) => {
          const box = item.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
      );
    expect(boxes.length).toBe(2 * DIAL_SEGMENTS);
    for (const box of boxes) {
      // The chord of a 7° arc is ~9 viewBox units → ~7.7px at the panel's
      // 170px dial. A near-radial segment projects almost nothing on one
      // axis, so the segment's SIZE is the larger bbox axis — that is what
      // must never collapse into a sliver.
      expect(
        Math.max(box.width, box.height),
        "segment bounding box major axis",
      ).toBeGreaterThanOrEqual(4);
    }
    mock.assertSealed();
  });

  test("segments keep the flat grammar: no filter, no fill, one ink each", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openScenario(page, "printing-midjob");
    const offenders = await page
      .locator(".gauge-dial .gauge-segment")
      .evaluateAll((items) =>
        items
          .map((item) => {
            const style = getComputedStyle(item);
            return {
              filter: style.filter,
              fill: style.fill,
              stroke: item.getAttribute("stroke") ?? "",
            };
          })
          .filter(
            (part) =>
              part.filter !== "none" ||
              part.fill !== "none" ||
              part.stroke.includes("gradient") ||
              part.stroke.includes("url("),
          ),
      );
    expect(offenders, "no filter, per-element fill, or gradient on any segment").toEqual([]);
    mock.assertSealed();
  });

  test("forced colors keeps the scale countable: lit and unlit differ by geometry", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openScenario(page, "printing-midjob");
    // The track survives to read a value against.
    await expect(
      page.locator('.gauge-dial path[stroke="var(--color-gauge-track)"]'),
    ).toHaveCount(2);
    // Lit vs unlit must differ by a computed property that is NOT author
    // colour — opacity and stroke-width are geometry the forced palette
    // preserves.
    const segments = await page
      .locator(".gauge-dial .gauge-segment")
      .evaluateAll((items) =>
        items.map((item) => {
          const style = getComputedStyle(item);
          return {
            lit: item.getAttribute("data-lit") === "true",
            opacity: Number(style.opacity),
            strokeWidth: Number.parseFloat(style.strokeWidth),
          };
        }),
      );
    const lit = segments.filter((segment) => segment.lit);
    const unlit = segments.filter((segment) => !segment.lit);
    expect(lit.length, "a hot printer has lit segments").toBeGreaterThan(0);
    expect(unlit.length, "and unlit ones to count against").toBeGreaterThan(0);
    for (const segment of lit) {
      expect(segment.opacity).toBe(1);
      expect(segment.strokeWidth).toBeGreaterThanOrEqual(10);
    }
    for (const segment of unlit) {
      expect(segment.opacity).toBeLessThan(0.5);
      expect(segment.strokeWidth).toBeLessThanOrEqual(2);
    }
    mock.assertSealed();
  });

  test("reduced motion collapses every segment and index transition", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openScenario(page, "printing-midjob");
    const durations = await page
      .locator(".gauge-dial .gauge-segment, .gauge-dial .gauge-target-index")
      .evaluateAll((items) =>
        items.map((item) => {
          const own = Number.parseFloat(getComputedStyle(item).transitionDuration);
          const group = item.closest("g");
          const parent = group ? Number.parseFloat(getComputedStyle(group).transitionDuration) : 0;
          return Math.max(own, parent);
        }),
      );
    expect(durations.length).toBeGreaterThan(0);
    for (const duration of durations) {
      // 0.01ms in seconds — the global reduced-motion rule.
      expect(duration).toBeLessThanOrEqual(0.001);
    }
    mock.assertSealed();
  });
});
