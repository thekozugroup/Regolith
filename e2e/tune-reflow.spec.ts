import { expect, test } from "@playwright/test";
import { installActiveMock, useExperience } from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";
import { fulfilFileApi, visit } from "./support/sweep-helpers";

/**
 * TUNE REFLOW LAW (owner: "pressure advance … is too high" / "wasted space
 * in card"). Both complaints were one structural fault: Pressure Advance was
 * a bare grid item, a SIBLING of the calibration <section>, so at xl it
 * started where that section's HEADING started — 38px above where Input
 * Shaper's card actually begins — and then absorbed the whole calibration
 * row's height as internal slack (measured 478px @1280, 508px @1920).
 *
 * The fix gives column 4 its own <section> with an identical heading block,
 * and moves the Bed Mesh heatmap into it below Pressure Advance. This spec
 * pins the four things that make the fix real rather than tuned:
 *
 *   1. ORDER — the Bed Mesh heatmap sits strictly BELOW Pressure Advance at
 *      every breakpoint (reading order calibrate → tune → mesh).
 *   2. ALIGNMENT — at xl, Pressure Advance's card top equals Input Shaper's
 *      card top. Both rails render the same 38px heading block above their
 *      first card, so this is structural: it must hold at 1280 AND 1920
 *      with ZERO tolerance beyond a subpixel, not at one calibrated width.
 *   3. NO ORPHANED OR STRETCHED CARD — every card on /tune keeps its
 *      natural height: the gap between its last laid-out content and its own
 *      bottom edge stays within one --card-pad. A card may only exceed that
 *      when a CARD ROW-MATE (same top AND bottom edge) is setting the height
 *      — equal-height siblings in one grid row are lawful Swiss layout. What
 *      is not lawful, and what this clause exists to catch, is a card
 *      absorbing a row height nothing in its own row asked for: that was
 *      exactly Pressure Advance's 478px @1280 / 508px @1920 hole, taken from
 *      a row whose height the calibration SECTION set. The residual must
 *      land in the transparent <section>, never inside glass.
 *   4. NO HORIZONTAL OVERFLOW at any of the four widths — the stale
 *      lg:col-span-4 / xl:col-span-1 classes on the moved children would
 *      manufacture implicit tracks inside the new 1-column grid, and this
 *      is the clause that catches it.
 *
 * Plus the landmark clause: the reflow adds a second <h2>/labelled region,
 * so its id must be unique and actually referenced.
 */

const TUNE_VIEWPORTS = [
  { name: "390x844", width: 390, height: 844, xl: false },
  { name: "800x480", width: 800, height: 480, xl: false }, // the K1's own panel
  { name: "1280x900", width: 1280, height: 900, xl: true },
  { name: "1920x1080", width: 1920, height: 1080, xl: true },
] as const;

/** Runs in the page. Cards are located by their own <h2>, and by ancestry
 *  where a title repeats (a "Bed Mesh" ACTION card lives in the calibration
 *  rail; the heatmap is the "Bed Mesh" card inside the live-tuning rail). */
const TUNE_LAYOUT_PROBE = () => {
  const rail = document.querySelector<HTMLElement>(
    'section[aria-labelledby="live-tuning"]',
  );
  const cards = Array.from(
    document.querySelectorAll<HTMLElement>("section.instrument-panel"),
  ).filter((card) => card.getClientRects().length > 0);

  const describe = (card: HTMLElement) => {
    const box = card.getBoundingClientRect();
    const body = card.querySelector<HTMLElement>(":scope > .panel-header + div");
    // The lowest laid-out descendant of the body — the true content bottom,
    // blind to how the body distributes its own slack.
    let contentBottom = body ? body.getBoundingClientRect().top : box.top;
    if (body) {
      for (const node of Array.from(body.querySelectorAll<HTMLElement>("*"))) {
        const nodeBox = node.getBoundingClientRect();
        if (nodeBox.height > 0 && nodeBox.width > 0) {
          contentBottom = Math.max(contentBottom, nodeBox.bottom);
        }
      }
    }
    return {
      title: card.querySelector("h2")?.textContent?.trim() ?? "?",
      inRail: rail != null && rail.contains(card),
      top: box.top,
      bottom: box.bottom,
      // Slack below the last content element, inside the card's own glass.
      slack: box.bottom - contentBottom,
      // The card's OWN resolved pad, read off the body — never a hardcoded
      // clamp() value, so a retuned --card-pad is followed automatically.
      cardPad: body ? parseFloat(getComputedStyle(body).paddingBottom) : 0,
    };
  };

  return {
    railFound: rail != null,
    headingIds: Array.from(document.querySelectorAll("#live-tuning")).length,
    railHeadingText:
      document.querySelector("#live-tuning")?.textContent?.trim() ?? null,
    cards: cards.map(describe),
    docOverflow:
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

test.describe("Tune reflow law — one rail per column, no stretched glass", () => {
  test("Pressure Advance heads its own rail, Bed Mesh sits below it", async ({ page }) => {
    test.setTimeout(240_000);
    const sc = scenario("printing-midjob");
    await installActiveMock(page, { state: sc.state, camera: "ok", thumbnail: true });
    await fulfilFileApi(page);
    await useExperience(page, "expert");

    for (const vp of TUNE_VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await visit(page, "/tune");
      const layout = (await page.evaluate(TUNE_LAYOUT_PROBE)) as ReturnType<
        typeof TUNE_LAYOUT_PROBE
      >;
      const at = vp.name;

      // --- LANDMARK -------------------------------------------------
      expect(layout.railFound, `${at}: the live-tuning rail must exist`).toBe(true);
      expect(layout.headingIds, `${at}: #live-tuning must be unique`).toBe(1);
      expect(layout.railHeadingText, `${at}: the rail heading names itself`).toBe(
        "Live tuning",
      );

      // --- NON-VACUITY ----------------------------------------------
      // Calibrated on main: /tune renders 5 calibration cards + Pressure
      // Advance + the Bed Mesh heatmap = 7 panels in expert mode.
      expect(layout.cards.length, `${at}: cards seen`).toBeGreaterThanOrEqual(7);

      const shaper = layout.cards.find((c) => c.title === "Input Shaper");
      const pa = layout.cards.find((c) => c.title === "Pressure Advance");
      const heatmap = layout.cards.find((c) => c.inRail && c.title === "Bed Mesh");
      expect(shaper, `${at}: Input Shaper card`).toBeTruthy();
      expect(pa, `${at}: Pressure Advance card`).toBeTruthy();
      expect(heatmap, `${at}: the Bed Mesh heatmap must live in the rail`).toBeTruthy();
      expect(pa!.inRail, `${at}: Pressure Advance must live in the rail`).toBe(true);

      // --- (1) ORDER ------------------------------------------------
      expect(
        heatmap!.top,
        `${at}: Bed Mesh (top ${heatmap!.top}) must sit below Pressure Advance ` +
          `(bottom ${pa!.bottom})`,
      ).toBeGreaterThanOrEqual(pa!.bottom - 1);

      // --- (2) ALIGNMENT --------------------------------------------
      if (vp.xl) {
        expect(
          Math.abs(pa!.top - shaper!.top),
          `${at}: Pressure Advance (top ${pa!.top}) must share Input Shaper's ` +
            `top edge (${shaper!.top}) — it used to sit 38px high`,
        ).toBeLessThanOrEqual(1);
      } else {
        // Below xl the rail stacks under the calibration section.
        expect(
          pa!.top,
          `${at}: below xl the rail stacks beneath calibration`,
        ).toBeGreaterThan(shaper!.top);
      }

      // --- (3) NO STRETCHED CARD ------------------------------------
      for (const card of layout.cards) {
        const natural = card.slack <= card.cardPad + 2;
        // A row-mate is another card sharing BOTH edges — i.e. a sibling in
        // the same grid row, which is the only lawful source of stretch.
        const rowMateSetsHeight = layout.cards.some(
          (other) =>
            other !== card &&
            Math.abs(other.top - card.top) <= 1 &&
            Math.abs(other.bottom - card.bottom) <= 1 &&
            other.slack <= other.cardPad + 2,
        );
        expect(
          natural || rowMateSetsHeight,
          `${at}: "${card.title}" carries ${card.slack.toFixed(1)}px of internal ` +
            `slack with no card row-mate setting that height — a card must ` +
            `never absorb a row on its own`,
        ).toBe(true);
      }
      // Non-vacuity for (3): the rail's own cards must be tight, always.
      for (const card of layout.cards.filter((c) => c.inRail)) {
        expect(
          card.slack,
          `${at}: rail card "${card.title}" must keep its natural height ` +
            `(${card.slack.toFixed(1)}px of slack)`,
        ).toBeLessThanOrEqual(card.cardPad + 2);
      }

      // --- (4) NO HORIZONTAL OVERFLOW -------------------------------
      expect(layout.docOverflow, `${at}: /tune must not overflow`).toBeLessThanOrEqual(0);
    }
  });
});
