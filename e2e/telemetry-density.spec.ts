import { expect, test } from "@playwright/test";
import { installActiveMock, useExperience } from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";
import { visit } from "./support/sweep-helpers";

/**
 * TELEMETRY DENSITY LAW (owner: the blank space in the Telemetry card).
 *
 * The hole was bar-shaped: a bar-less tile shared a 49.5px grid row with a
 * segment gauge and left 27–33px of full-width void underneath — which reads
 * as a MISSING bar, the one thing it must never look like. The fix REMOVES
 * the hole rather than filling it (zones), and adds a mark to exactly the two
 * factors whose shape over time is itself a signal.
 *
 * This spec pins the honesty boundary first, because that is the part that
 * could quietly rot:
 *
 *   1. NO INVENTED CEILING. Every mark inside the Telemetry card is either a
 *      declared proportional track (`[data-range-track]`, which only a
 *      SegmentGauge draws, and only against a min/max the printer published)
 *      or a declared auto-scaled trend (`[data-autoscale]`, which scales to
 *      its own samples and draws no axis, no endpoints and no track). There
 *      is no third kind. A tick rule, a ghost track, a scale with endpoints —
 *      each asserts a maximum the app does not know, and each would fail
 *      here, whether it arrived as an svg, a bordered box or a gradient.
 *   2. ZONING MEANS SOMETHING. A proportional track appears in the scaled
 *      zone and nowhere else, so "readings" cannot silently start scaling.
 *   3. TREND SCOPE. Exactly the earning factors carry a trend: Z-Offset (the
 *      babystepping signal) and Max Accel (SET_VELOCITY_LIMIT genuinely steps
 *      it mid-print). Pressure Adv. (flat >99% of the time), Filament
 *      (monotonic — auto-scale renders every rate as the same ramp) and Homed
 *      (a boolean set, not a scalar) must carry NO mark at all. This clause
 *      exists so a later "let's be consistent" pass cannot add noise that
 *      looks like information.
 *   4. THE COMPACTION IS REAL. A readings row is never taller than a gauge
 *      row, and every readings tile still clears the 44px module.
 *   5. NO WRAP. Each readings tile keeps its label and value on ONE line.
 *      A wrapped tile drops its value to a second line while its row-mates
 *      keep theirs on the first, which is the shared baseline broken — this
 *      is the clause that fires if the column floor is ever tuned below the
 *      pair's real width.
 */

const DENSITY_VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "800x480", width: 800, height: 480 }, // the K1 Max's own panel
  { name: "1280x900", width: 1280, height: 900 },
  { name: "2560x1440", width: 2560, height: 1440 },
] as const;

/** Tile label → the quantity its trend must announce to a screen reader. */
const TRENDED: Record<string, string> = {
  "Z-Offset": "Z-offset trend",
  "Max Accel": "Max accel trend",
};
const NEVER_MARKED = ["Filament", "Pressure Adv.", "Homed"];

const DENSITY_PROBE = () => {
  const card = Array.from(
    document.querySelectorAll<HTMLElement>("section.instrument-panel"),
  ).find((panel) => panel.querySelector("h2")?.textContent?.trim() === "Telemetry");
  if (!card) return null;

  // Scoped to the instrument region, not the whole card: the panel header's
  // own icon is chrome, not a mark about a value.
  const marks = Array.from(
    card.querySelectorAll<SVGElement>(".telemetry-grid svg"),
  ).map((svg) => ({
    rangeTrack: svg.hasAttribute("data-range-track"),
    autoscale: svg.hasAttribute("data-autoscale"),
    ariaLabel: svg.getAttribute("aria-label"),
    owner:
      svg.closest(".telemetry-zone > *")?.querySelector(".instrument-label")
        ?.textContent?.trim() ?? "?",
  }));

  const tiles = Array.from(
    card.querySelectorAll<HTMLElement>(".telemetry-zone > *"),
  )
    .filter((tile) => tile.getClientRects().length > 0)
    .map((tile) => {
      const box = tile.getBoundingClientRect();
      const label = tile.querySelector(".instrument-label");
      const value = tile.querySelector(".instrument-value");
      return {
        name: label?.textContent?.trim() ?? "?",
        zone: tile.parentElement?.getAttribute("data-zone") ?? "?",
        height: box.height,
        hasTrack: tile.querySelector("[data-range-track]") != null,
        hasTrend: tile.querySelector("[data-autoscale]") != null,
        trendAria: tile.querySelector("[data-autoscale]")?.getAttribute("aria-label") ?? null,
        marks: tile.querySelectorAll("svg").length,
        labelTop: label ? label.getBoundingClientRect().top : null,
        valueTop: value ? value.getBoundingClientRect().top : null,
      };
    });

  return { marks, tiles, zones: card.querySelectorAll(".telemetry-zone").length };
};

test.describe("Telemetry density law — no hole, and no invented ceiling", () => {
  test("every mark declares its kind; only the earning factors carry a trend", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await useExperience(page, "expert");
    const sc = scenario("printing-midjob");
    const mock = await installActiveMock(page, {
      state: sc.state,
      camera: "ok",
      thumbnail: sc.thumbnail,
    });

    for (const vp of DENSITY_VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await visit(page, "/");
      const probe = (await page.evaluate(DENSITY_PROBE)) as ReturnType<
        typeof DENSITY_PROBE
      >;
      expect(probe, `${vp.name}: the Telemetry card must render`).not.toBeNull();
      const { marks, tiles } = probe!;
      const at = vp.name;

      // --- NON-VACUITY ----------------------------------------------
      expect(probe!.zones, `${at}: both zones must render`).toBe(2);
      expect(tiles.length, `${at}: tiles seen`).toBeGreaterThanOrEqual(12);
      expect(marks.length, `${at}: marks seen`).toBeGreaterThanOrEqual(8);

      // --- (1) NO INVENTED CEILING ----------------------------------
      for (const mark of marks) {
        expect(
          mark.rangeTrack || mark.autoscale,
          `${at}: a mark in "${mark.owner}" declares neither a range track nor ` +
            `auto-scaling — an undeclared mark is an unproven ceiling`,
        ).toBe(true);
        expect(
          mark.rangeTrack && mark.autoscale,
          `${at}: "${mark.owner}" cannot be both scaled and auto-scaled`,
        ).toBe(false);
        if (mark.autoscale && mark.ariaLabel) {
          expect(
            mark.ariaLabel,
            `${at}: an auto-scaled trend must say so, not imply a limit`,
          ).toContain("Scaled to the samples themselves");
        }
      }

      // --- (2) ZONING MEANS SOMETHING -------------------------------
      for (const tile of tiles) {
        expect(
          tile.hasTrack,
          `${at}: "${tile.name}" sits in the "${tile.zone}" zone`,
        ).toBe(tile.zone === "scaled");
      }

      // --- (3) TREND SCOPE ------------------------------------------
      for (const [name, announced] of Object.entries(TRENDED)) {
        const tile = tiles.find((t) => t.name === name);
        expect(tile, `${at}: ${name} must render`).toBeTruthy();
        expect(tile!.hasTrend, `${at}: ${name} earns its trend`).toBe(true);
        expect(tile!.hasTrack, `${at}: ${name} must never carry a track`).toBe(false);
        // The trend must announce ITS OWN quantity. Sparkline's aria-label
        // used to be hardcoded to "Temperature … degrees Celsius", which
        // would have read a Z-offset in mm out as a temperature.
        expect(
          tile!.trendAria,
          `${at}: ${name}'s trend must announce itself, not a temperature`,
        ).toContain(announced);
      }
      for (const name of NEVER_MARKED) {
        const tile = tiles.find((t) => t.name === name);
        expect(tile, `${at}: ${name} must render`).toBeTruthy();
        expect(
          tile!.marks,
          `${at}: ${name} must carry NO mark — a flat, monotonic or boolean ` +
            `series drawn as a trend is noise wearing the costume of information`,
        ).toBe(0);
      }

      // --- (4) THE COMPACTION IS REAL -------------------------------
      const gaugeRow = Math.max(
        ...tiles.filter((t) => t.zone === "scaled").map((t) => t.height),
      );
      for (const tile of tiles.filter((t) => t.zone === "readings")) {
        expect(
          tile.height,
          `${at}: readings tile "${tile.name}" (${tile.height.toFixed(1)}px) must ` +
            `never be taller than a gauge row (${gaugeRow.toFixed(1)}px)`,
        ).toBeLessThanOrEqual(gaugeRow + 0.5);
        expect(
          tile.height,
          `${at}: readings tile "${tile.name}" keeps the 44px module`,
        ).toBeGreaterThanOrEqual(44);
      }

      // --- (5) NO WRAP ----------------------------------------------
      for (const tile of tiles.filter((t) => t.zone === "readings")) {
        expect(tile.labelTop, `${at}: ${tile.name} label`).not.toBeNull();
        expect(tile.valueTop, `${at}: ${tile.name} value`).not.toBeNull();
        expect(
          Math.abs(tile.labelTop! - tile.valueTop!),
          `${at}: "${tile.name}" must keep its label and value on ONE line — ` +
            `a wrapped tile drops its value below its row-mates'`,
        ).toBeLessThanOrEqual(3);
      }
    }

    mock.assertSealed();
  });
});
