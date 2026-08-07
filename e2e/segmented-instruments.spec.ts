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
    // and no UNDER segment is ever lit (the shortfall is unlit by
    // definition — that direction's ink is the ghost track).
    await page.setViewportSize({ width: 800, height: 480 });
    const mock = await openScenario(page, "heating");
    await expect(
      hotendGauge(page).locator('.gauge-segment[data-delta="under"]'),
      "delta segment count must equal the lit-segment distance",
    ).toHaveCount(14);
    await expect(
      page.locator('.gauge-segment[data-lit="true"][data-delta="under"]'),
      "an under-delta segment is never lit",
    ).toHaveCount(0);
    await expect(
      page.locator('.gauge-segment[data-delta="over"]'),
      "heating below target is not an overshoot",
    ).toHaveCount(0);
    mock.assertSealed();
  });

  /**
   * The delta band used to ink ONLY where the segment was unlit — which
   * silently meant "only when the actual is BELOW target". An overshooting
   * hotend, the case you most want to see, drew zero delta segments: every
   * segment between setpoint and actual was lit, so every one was skipped.
   */
  test("an overshoot inks the delta band too, not nothing", async ({ page }) => {
    // 250 of 300 lights round(250/300·24) = 20; the 200 setpoint lights
    // round(200/300·24) = 16 → exactly 4 segments of overshoot, on integer
    // boundaries so the fixture cannot drift on a rounding edge.
    await page.setViewportSize({ width: 800, height: 480 });
    const sc = scenario("printing-midjob");
    const mock = await openScenario(page, "printing-midjob", {
      state: {
        ...sc.state,
        extruder: {
          ...(sc.state.extruder as Record<string, unknown>),
          temperature: 250,
          target: 200,
        },
      },
    });
    const hotend = hotendGauge(page);
    await expect(
      hotend.locator('.gauge-segment[data-delta="over"]'),
      "an overshoot must ink exactly the segment distance past the setpoint",
    ).toHaveCount(4);
    await expect(
      hotend.locator('.gauge-segment[data-delta="under"]'),
      "an overshoot is not a shortfall",
    ).toHaveCount(0);
    await expect(
      hotend.locator('.gauge-segment[data-delta="over"][data-lit="true"]'),
      "lit still wins the ink — an over-delta segment stays lit",
    ).toHaveCount(4);
    mock.assertSealed();
  });

  test("over and under deltas are told apart without colour", async ({ page }) => {
    // No-colour-only rule: the two directions must differ in a channel that
    // survives a monochrome print. They differ in stroke width — the
    // overshoot narrows to a rail inside the track, the shortfall keeps the
    // full track width and only dims. One fixture carries both: the hotend
    // overshoots (250 over a 200 setpoint → 20 − 16 = 4 segments), the bed
    // falls short (20 under a 100 setpoint on a 120° scale → 20 − 4 = 16).
    await page.setViewportSize({ width: 800, height: 480 });
    const sc = scenario("printing-midjob");
    const mock = await openScenario(page, "printing-midjob", {
      state: {
        ...sc.state,
        extruder: {
          ...(sc.state.extruder as Record<string, unknown>),
          temperature: 250,
          target: 200,
        },
        heater_bed: { temperature: 20, target: 100, power: 1 },
      },
    });
    const read = (locator: ReturnType<typeof hotendGauge>) =>
      locator.locator(".gauge-segment").evaluateAll((items) =>
        items.map((item) => ({
          delta: item.getAttribute("data-delta"),
          lit: item.getAttribute("data-lit"),
          width: Number.parseFloat(getComputedStyle(item).strokeWidth),
        })),
      );
    const hotend = await read(hotendGauge(page));
    const bed = await read(bedGauge(page));
    const over = hotend.filter((s) => s.delta === "over");
    const plainLit = hotend.filter((s) => s.delta == null && s.lit === "true");
    const under = bed.filter((s) => s.delta === "under");
    expect(over.length, "the over case must be genuinely exercised").toBe(4);
    expect(under.length, "the under case must be genuinely exercised").toBe(16);
    expect(plainLit.length, "plain lit segments must exist to compare against").toBeGreaterThan(0);
    for (const segment of over) {
      for (const reference of [...plainLit, ...under]) {
        expect(
          Math.abs(segment.width - reference.width),
          `over-delta stroke ${segment.width} must differ from ${reference.delta ?? "plain lit"} ${reference.width}`,
        ).toBeGreaterThanOrEqual(2);
      }
    }
    mock.assertSealed();
  });

  /**
   * The dial's sweep is a DISPLAY CLAMP, exactly like the factor strips'
   * 50–150% scale: angleFor() and litSegments() both clamp, so 320°C on a
   * 300° gauge lit all 24 segments and pinned the arc identically to a true
   * 300°C. The strips got over/under-range carets; the dials never did, so
   * the same false ceiling stayed on the primary instrument.
   */
  test("a temperature above the gauge maximum is marked, never silently pinned", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const sc = scenario("printing-midjob");
    const atTemperature = (temperature: number) => ({
      ...sc.state,
      extruder: {
        ...(sc.state.extruder as Record<string, unknown>),
        temperature,
        target: 280,
      },
    });
    const mock = await openScenario(page, "printing-midjob", { state: atTemperature(300) });
    const hotend = hotendGauge(page);
    await expect(
      hotend.locator('.gauge-segment[data-lit="true"]'),
      "exactly-max lights the whole scale",
    ).toHaveCount(DIAL_SEGMENTS);
    await expect(
      hotend.locator("[data-over-range]"),
      "exactly-max is not over range",
    ).toHaveCount(0);
    await expect(hotend.getByText("›")).toHaveCount(0);
    await expect(hotend.locator(".readout")).toContainText("300.0");

    mock.use({ state: atTemperature(320), camera: "ok", thumbnail: sc.thumbnail });
    await visit(page, "/");
    const over = hotendGauge(page);
    await expect(
      over.locator('.gauge-segment[data-lit="true"]'),
      "320 pins the same 24 segments — which is exactly why it needs a caret",
    ).toHaveCount(DIAL_SEGMENTS);
    await expect(
      over.locator("[data-over-range]"),
      "a reading past the gauge maximum must draw the over-range caret",
    ).toHaveCount(1);
    await expect(over.getByText("›"), "and carry the › affix on the readout").toBeVisible();
    await expect(over.locator(".readout")).toContainText("320.0");

    // The caret is polar, and the tightest dial is the one it can foul: at
    // the K1 panel's two-up it must stay inside the dial's own box and clear
    // the "Max" scale endpoint rather than being drawn through it.
    await page.setViewportSize({ width: 800, height: 480 });
    await visit(page, "/");
    const boxes = await hotendGauge(page).evaluate((tile) => {
      const rect = (el: Element | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const endpoint = [...tile.querySelectorAll("span")].find((s) => /^Max/.test(s.textContent ?? ""));
      return {
        svg: rect(tile.querySelector(".gauge-dial")),
        caret: rect(tile.querySelector("[data-over-range]")),
        endpoint: rect(endpoint ?? null),
      };
    });
    expect(boxes.caret, "the caret must render at the panel too").not.toBeNull();
    const { svg, caret, endpoint } = boxes;
    expect(caret!.left).toBeGreaterThanOrEqual(svg!.left - 0.5);
    expect(caret!.right).toBeLessThanOrEqual(svg!.right + 0.5);
    expect(caret!.top).toBeGreaterThanOrEqual(svg!.top - 0.5);
    expect(caret!.bottom).toBeLessThanOrEqual(svg!.bottom + 0.5);
    expect(
      caret!.bottom,
      "the over-range caret must clear the Max scale endpoint, not overprint it",
    ).toBeLessThanOrEqual(endpoint!.top);
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

/* ---------------------------------------------------------------------------
 * PART 2 — range bars, honestly.
 * ------------------------------------------------------------------------ */

/**
 * A schema-valid custom profile that publishes NO chamber ceiling and NO
 * bounds — the degradation fixtures. Injected through the app's own custom-
 * profile door (localStorage), exactly as an owner-uploaded profile would be.
 */
const SPARSE_PROFILE = {
  schema: 1,
  id: "sparse-fixture",
  name: "Sparse fixture",
  heaters: [
    { klipper: "extruder", label: "Hotend", maxTemp: 300, controllable: true },
    { klipper: "heater_bed", label: "Bed", maxTemp: 120, controllable: true },
  ],
  sensors: [
    // Deliberately NO maxTemp: the profile publishes no chamber ceiling.
    { klipper: "temperature_sensor chamber_temp", label: "Chamber", warnAbove: 60 },
    { klipper: "temperature_sensor mcu_temp", label: "MCU", maxTemp: 90, warnAbove: 70 },
  ],
  fans: [
    { klipper: "temperature_fan chamber_fan", label: "Chamber Fan", role: "chamber" },
    { klipper: "temperature_fan soc_fan", label: "SoC Fan", role: "controller" },
  ],
  macros: [],
  features: {},
  // Deliberately NO bounds.
};

async function useSparseProfile(page: Page) {
  await page.addInitScript((profile) => {
    localStorage.setItem("regolith.profile.custom", JSON.stringify([profile]));
    localStorage.setItem("regolith.profile.active", "sparse-fixture");
  }, SPARSE_PROFILE);
}

/** A telemetry tile located by its label — blind to tile type. The label is
 *  matched case-insensitively because `.instrument-label` renders through
 *  `text-transform: uppercase` and the text engine matches rendered text. */
const telemetryTile = (page: Page, label: string) =>
  page.locator(".telemetry-zone > *").filter({
    has: page.locator(".instrument-label", {
      hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    }),
  });

const NO_BAR_EVER = ["Z-Offset", "Filament", "Pressure Adv.", "Max Accel", "Homed"];

test.describe("Telemetry range bars — real ranges only", () => {
  test("every rendered strip's fill is exact integer arithmetic on value/range", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await openScenario(page, "printing-midjob", { experience: "expert" });
    // Fixture truths, straight from the scenario state and the K1 Max
    // profile: data-lit === round(clamp((v − min)/(max − min)) · 20), zero
    // tolerance.
    const expected: Array<{ label: string; value: number; min: number; max: number }> = [
      { label: "Chamber", value: 38.6, min: 0, max: 80 },
      { label: "Part Fan", value: 100, min: 0, max: 100 },
      { label: "Speed Factor", value: 100, min: 50, max: 150 },
      { label: "Flow Factor", value: 100, min: 50, max: 150 },
      { label: "Hotend Power", value: 42, min: 0, max: 100 },
      { label: "Bed Power", value: 28, min: 0, max: 100 },
      { label: "Live Vel.", value: 148.3, min: 0, max: 600 },
      { label: "Position Z", value: 23.6, min: -10, max: 305 },
    ];
    await expect(page.locator(".segment-gauge")).toHaveCount(expected.length);
    for (const strip of expected) {
      const lit = Math.round(
        Math.min(1, Math.max(0, (strip.value - strip.min) / (strip.max - strip.min))) * 20,
      );
      await expect(
        telemetryTile(page, strip.label),
        `${strip.label}: data-lit must be ${lit}`,
      ).toHaveAttribute("data-lit", String(lit));
    }
    mock.assertSealed();
  });

  test("a profile without a chamber ceiling gets a number, never a bar", async ({ page }) => {
    // The old `?? 80` fallback drew a fabricated 0–80° scale here. An
    // unknown range yields NO <svg> at all.
    await page.setViewportSize({ width: 1280, height: 900 });
    await useSparseProfile(page);
    const mock = await openScenario(page, "printing-midjob");
    const chamber = telemetryTile(page, "Chamber");
    await expect(chamber.getByText("38.6°C")).toBeVisible();
    await expect(chamber.locator("svg"), "no invented chamber ceiling").toHaveCount(0);
    mock.assertSealed();
  });

  test("an absent max_velocity leaves Live Vel. as a numeric tile", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const sc = scenario("printing-midjob");
    const toolhead = { ...(sc.state.toolhead as Record<string, unknown>) };
    delete toolhead.max_velocity;
    const mock = await openScenario(page, "printing-midjob", {
      experience: "expert",
      state: { ...sc.state, toolhead },
    });
    const tile = telemetryTile(page, "Live Vel.");
    await expect(tile.getByText("148 mm/s")).toBeVisible();
    await expect(tile.locator("svg"), "no guessed velocity ceiling").toHaveCount(0);
    mock.assertSealed();
  });

  test("absent axis limits + a boundless profile leave Position Z bar-less", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useSparseProfile(page);
    const sc = scenario("printing-midjob");
    const toolhead = { ...(sc.state.toolhead as Record<string, unknown>) };
    delete toolhead.axis_minimum;
    delete toolhead.axis_maximum;
    const mock = await openScenario(page, "printing-midjob", {
      experience: "expert",
      state: { ...sc.state, toolhead },
    });
    const tile = telemetryTile(page, "Position Z");
    await expect(tile.getByText("23.600")).toBeVisible();
    await expect(tile.locator("svg"), "no borrowed Z travel").toHaveCount(0);
    // Z IS homed here — the tile must not claim otherwise.
    await expect(tile.getByText("unhomed")).toHaveCount(0);
    mock.assertSealed();
  });

  test("an unhomed Z gets the muted word, not a bar on a meaningless number", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const sc = scenario("printing-midjob");
    const toolhead = { ...(sc.state.toolhead as Record<string, unknown>), homed_axes: "xy" };
    const mock = await openScenario(page, "printing-midjob", {
      experience: "expert",
      state: { ...sc.state, toolhead },
    });
    const tile = telemetryTile(page, "Position Z");
    await expect(tile.locator("svg"), "an unhomed Z has no scale position").toHaveCount(0);
    await expect(tile.getByText("unhomed"), "the absence is explained in words").toBeVisible();
    mock.assertSealed();
  });

  test("the five bar-less factors carry zero proportional track in every state — the PA pin", async ({
    page,
  }) => {
    // Anti-regression pin for the invented-pressure-advance incident class:
    // this must fail loudly if anyone later "fills the gap" with a strip,
    // ghost track, tick rule or endpoint — anything whose geometry encodes a
    // value against a range.
    //
    // The pin is on `[data-range-track]`, not on "an svg". Two of these five
    // now carry an AUTO-SCALED trend line, which draws no axis, no endpoints
    // and no track: it scales to its own samples, so it asserts a shape and
    // never a maximum. Pinning svg-count would have made this law fire on an
    // honest mark and, worse, would have tempted the next author to strip the
    // marker instead of the ceiling. So the law states the real rule, and a
    // second clause keeps it from going soft: EVERY svg in these tiles must
    // declare itself auto-scaled, so nothing can slip in unlabelled.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() =>
      localStorage.setItem("forge.experience-mode", "expert"),
    );
    const mock = await installActiveMock(page, {
      state: scenario("printing-midjob").state,
      camera: "ok",
    });
    for (const id of ["printing-midjob", "tuning-macro", "cancelled"]) {
      mock.use({ state: scenario(id).state, camera: "ok" });
      await visit(page, "/");
      for (const label of NO_BAR_EVER) {
        const tile = telemetryTile(page, label);
        await expect(
          tile,
          `${id}: ${label} must render exactly once`,
        ).toHaveCount(1);
        await expect(
          tile.locator("[data-range-track]"),
          `${id}: ${label} must never carry a proportional track`,
        ).toHaveCount(0);
        await expect(
          tile.locator("[data-lit]"),
          `${id}: ${label} must never publish a segment fill count`,
        ).toHaveCount(0);
        const svgs = await tile.locator("svg").count();
        const autoscaled = await tile.locator("svg[data-autoscale]").count();
        expect(
          autoscaled,
          `${id}: ${label} carries ${svgs} svg but only ${autoscaled} declare ` +
            `themselves auto-scaled — an undeclared mark is an unproven ceiling`,
        ).toBe(svgs);
      }
    }
    mock.assertSealed();
  });

  test("rows share a top edge, and bar-less blank space stays blank", async ({
    page,
  }) => {
    // Grid rows still share a top edge, and a bar-less tile's CONTENT is
    // still strictly shorter than a track-bearing tile's — proving the space
    // it does not use stays empty rather than being padded with a filler
    // rule.
    //
    // The comparison used to be per-row, because bar and bar-less tiles
    // shared rows. The density pass separated them into zones, so the pair
    // is now drawn ACROSS zones: every readings tile against every scaled
    // tile. That is a strictly larger sample than the old one mixed row, so
    // the clause got stronger, not weaker, when it stopped being row-local.
    await page.setViewportSize({ width: 2560, height: 1440 });
    const mock = await openScenario(page, "printing-midjob", { experience: "expert" });
    const tiles = await page.locator(".telemetry-zone > *").evaluateAll((items) =>
      items
        .filter((tile) => tile.getClientRects().length > 0)
        .map((tile) => {
          const box = tile.getBoundingClientRect();
          let contentBottom = box.top;
          for (const child of Array.from(tile.children)) {
            const childBox = child.getBoundingClientRect();
            if (childBox.height > 0) contentBottom = Math.max(contentBottom, childBox.bottom);
          }
          return {
            label: tile.querySelector(".instrument-label")?.textContent?.trim() ?? "?",
            zone: tile.parentElement?.getAttribute("data-zone") ?? "?",
            top: box.top,
            hasBar: tile.querySelector("[data-range-track]") != null,
            contentHeight: contentBottom - box.top,
          };
        }),
    );
    expect(tiles.length).toBeGreaterThanOrEqual(12);
    // Cluster into grid rows by top edge (row heights dwarf the tolerance).
    const rows: Array<typeof tiles> = [];
    for (const tile of [...tiles].sort((a, b) => a.top - b.top)) {
      const row = rows.find((candidate) => Math.abs(candidate[0].top - tile.top) <= 8);
      if (row) row.push(tile);
      else rows.push([tile]);
    }
    for (const row of rows) {
      const tops = row.map((tile) => tile.top);
      expect(
        Math.max(...tops) - Math.min(...tops),
        `row [${row.map((tile) => tile.label).join(", ")}] shares a top edge`,
      ).toBeLessThanOrEqual(1);
    }
    // A tile carries a proportional track only in the scaled zone — the
    // zoning is what the readings zone MEANS, and it must not drift.
    for (const tile of tiles) {
      expect(
        tile.hasBar,
        `${tile.label} sits in the "${tile.zone}" zone`,
      ).toBe(tile.zone === "scaled");
    }
    const barTiles = tiles.filter((tile) => tile.hasBar);
    const bareTiles = tiles.filter((tile) => !tile.hasBar);
    expect(barTiles.length, "track-bearing tiles must exist").toBeGreaterThanOrEqual(1);
    expect(bareTiles.length, "bar-less tiles must exist").toBeGreaterThanOrEqual(1);
    for (const bare of bareTiles) {
      for (const bar of barTiles) {
        expect(
          bare.contentHeight,
          `${bare.label} must be strictly shorter than ${bar.label} — no filler`,
        ).toBeLessThan(bar.contentHeight);
      }
    }
    mock.assertSealed();
  });

  test("a factor beyond its display clamp is marked, never silently pinned", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const sc = scenario("printing-midjob");
    const mock = await openScenario(page, "printing-midjob", {
      state: {
        ...sc.state,
        gcode_move: {
          ...(sc.state.gcode_move as Record<string, unknown>),
          speed_factor: 2.0,
        },
      },
    });
    const speed = telemetryTile(page, "Speed Factor");
    await expect(speed.getByText("200%")).toBeVisible();
    await expect(
      speed.locator("[data-over-range]"),
      "M220 S200 must draw the over-range caret",
    ).toHaveCount(1);
    await expect(speed.getByText("›")).toBeVisible();
    // The strip itself still reads 20/20 — it is pinned, and pinning is the
    // honest thing for a clamped scale to do. What must never happen is that
    // the pinned strip is INDISTINGUISHABLE from a true 150%: the caret and
    // the › affix are the two channels that separate them, and both are
    // asserted above while the strip is at full lit count.
    await expect(
      speed,
      "the strip is pinned at full — the caret is what makes that unambiguous",
    ).toHaveAttribute("data-lit", "20");
    mock.assertSealed();
  });

  test("a nominal factor carries no over-range mark", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await openScenario(page, "printing-midjob");
    const speed = telemetryTile(page, "Speed Factor");
    await expect(speed.getByText("100%")).toBeVisible();
    await expect(speed.locator("[data-over-range]")).toHaveCount(0);
    await expect(speed.locator("[data-under-range]")).toHaveCount(0);
    await expect(speed.getByText("›")).toHaveCount(0);
    mock.assertSealed();
  });

  test("every telemetry tile, bar or not, keeps the 44px floor", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const mock = await openScenario(page, "printing-midjob", { experience: "expert" });
    const heights = await page.locator(".telemetry-zone > *").evaluateAll((items) =>
      items
        .filter((tile) => tile.getClientRects().length > 0)
        .map((tile) => ({
          label: tile.querySelector(".instrument-label")?.textContent?.trim() ?? "?",
          height: tile.getBoundingClientRect().height,
        })),
    );
    expect(heights.length).toBeGreaterThanOrEqual(12);
    for (const tile of heights) {
      expect(tile.height, `${tile.label} keeps min-h-11`).toBeGreaterThanOrEqual(44);
    }
    mock.assertSealed();
  });
});
