import { expect, test, type Locator } from "@playwright/test";
import {
  installActiveMock,
  useExperience,
  type MockPrinterState,
} from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";
import { fulfilFileApi, visit } from "./support/sweep-helpers";

/**
 * Button law (owner rule):
 *
 *  1. EVEN chrome — every Button and button-like control carries even
 *     margins/padding on all four sides. No lopsided px/py pair may
 *     visually offset the label. Enforced two ways: a strict all-four-equal
 *     sweep over the `ui-btn` marker class (the Button component), and a
 *     per-axis symmetry + centered-label sweep over every visible button.
 *
 *  2. STRICT concentricity — when a button sits inside any rounded
 *     container, its corner radius equals the container radius minus the
 *     gap (the derived-radius law), measured on computed styles, not
 *     approximated. Verified on four representative placements:
 *     card body (fluid pad), modal header (p-4), control group (p-1), and
 *     a settings toggle in a card body.
 *
 * NOTE: the four placements are now a fast smoke check — the LAW itself is
 * enforced exhaustively (every element, every rounded ancestor, every
 * corner, every route/mode/state/overlay) by concentricity-law.spec.ts via
 * the shared support/concentricity.ts probe.
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
  extruder: { temperature: 27.4, target: 0, power: 0 },
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

interface ButtonChrome {
  margins: number[];
  paddings: number[];
  radius: number;
  host: { radius: number; inset: number } | null;
  labelOffset: number | null;
}

/** Computed chrome + the nearest rounded host's law inputs. */
async function measure(button: Locator): Promise<ButtonChrome> {
  return button.evaluate((el) => {
    const style = getComputedStyle(el);
    const px = (value: string) => Number.parseFloat(value) || 0;
    const margins = [
      px(style.marginTop),
      px(style.marginRight),
      px(style.marginBottom),
      px(style.marginLeft),
    ];
    const paddings = [
      px(style.paddingTop),
      px(style.paddingRight),
      px(style.paddingBottom),
      px(style.paddingLeft),
    ];
    const radius = px(style.borderTopLeftRadius);

    // Nearest ancestor whose rounding is big enough to demand concentricity
    // (>= the group radius; skips rounded-inner siblings).
    let node = el.parentElement;
    let host: { radius: number; inset: number } | null = null;
    const box = el.getBoundingClientRect();
    while (node && node !== document.body) {
      const hostRadius = px(getComputedStyle(node).borderTopLeftRadius);
      if (hostRadius >= 6) {
        const hostBox = node.getBoundingClientRect();
        const inset = Math.min(
          box.left - hostBox.left,
          hostBox.right - box.right,
          box.top - hostBox.top,
          hostBox.bottom - box.bottom,
        );
        host = { radius: hostRadius, inset };
        break;
      }
      node = node.parentElement;
    }

    // Visual label offset: the content box center vs the button center on
    // the cross axis (flex centering must hold — no lopsided chrome).
    let labelOffset: number | null = null;
    const first = el.firstElementChild;
    if (first) {
      const kids = [...el.children].map((child) => child.getBoundingClientRect());
      const top = Math.min(...kids.map((k) => k.top));
      const bottom = Math.max(...kids.map((k) => k.bottom));
      labelOffset = Math.abs((top + bottom) / 2 - (box.top + box.height / 2));
    }
    return { margins, paddings, radius, host, labelOffset };
  });
}

function expectEvenChrome(chrome: ButtonChrome, label: string) {
  const [mt, mr, mb, ml] = chrome.margins;
  expect(Math.max(mt, mr, mb, ml) - Math.min(mt, mr, mb, ml), `${label}: margins must be even on all four sides`).toBeLessThanOrEqual(0.5);
  const [pt, pr, pb, pl] = chrome.paddings;
  expect(Math.max(pt, pr, pb, pl) - Math.min(pt, pr, pb, pl), `${label}: padding must be even on all four sides`).toBeLessThanOrEqual(0.5);
  if (chrome.labelOffset != null) {
    expect(chrome.labelOffset, `${label}: label must sit centered`).toBeLessThanOrEqual(1);
  }
}

function expectConcentric(chrome: ButtonChrome, label: string) {
  expect(chrome.host, `${label}: must sit inside a rounded container`).not.toBeNull();
  const { radius, inset } = chrome.host!;
  // Strict law: inner = container radius − gap (floored at 0), ±1.5px for
  // borders/fractional layout — the same tolerance as the popover law test.
  const expected = Math.max(0, radius - inset);
  expect(
    Math.abs(chrome.radius - expected),
    `${label}: radius ${chrome.radius} vs derived ${expected} (host ${radius} − inset ${inset})`,
  ).toBeLessThanOrEqual(1.5);
}

test.describe("Button law — even chrome and strict concentricity", () => {
  test("four representative placements obey both laws", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, { state: idleState });

    // 1 — card body, fluid pad: the readiness module button.
    await page.goto("/");
    await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);
    const module = page.locator(".readiness-module");
    const moduleChrome = await measure(module);
    expectEvenChrome(moduleChrome, "readiness module button");
    expectConcentric(moduleChrome, "readiness module button");

    // 2 — modal header at the panel corner (p-4 = --modal-pad).
    await module.click();
    const close = page.getByRole("button", { name: "Close printer detail" });
    await expect(close).toBeVisible();
    const closeChrome = await measure(close);
    expectEvenChrome(closeChrome, "disclosure close button");
    expectConcentric(closeChrome, "disclosure close button");
    await page.keyboard.press("Escape");

    // 3 — control group (p-1): a jog distance button.
    await page.goto("/control");
    const jog = page.getByRole("button", { name: "Jog 1 millimeters" });
    await expect(jog).toBeVisible();
    const jogChrome = await measure(jog);
    expectEvenChrome(jogChrome, "jog distance button");
    expectConcentric(jogChrome, "jog distance button");

    // 4 — settings toggle in a card body.
    await page.goto("/settings");
    const toggle = page.getByRole("button", { name: /Everyday printing/ }).first();
    await expect(toggle).toBeVisible();
    const toggleChrome = await measure(toggle);
    expectEvenChrome(toggleChrome, "experience toggle");
    expectConcentric(toggleChrome, "experience toggle");

    mock.assertSealed();
  });

  test("every Button placement keeps all four sides even; every visible button stays symmetric", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "expert");
    const mock = await installActiveMock(page, { state: idleState });

    for (const path of ["/", "/control", "/tune", "/settings"]) {
      await page.goto(path);
      await expect(page.locator("main > *").first()).toBeVisible();

      // Strict sweep: the Button component marker class.
      const uneven = await page.locator(".ui-btn:visible").evaluateAll((items) =>
        items.flatMap((item) => {
          const style = getComputedStyle(item);
          const px = (v: string) => Number.parseFloat(v) || 0;
          const margins = [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft].map(px);
          const paddings = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(px);
          const issues: string[] = [];
          const name = item.getAttribute("aria-label") || item.textContent?.trim() || "button";
          if (Math.max(...margins) - Math.min(...margins) > 0.5) {
            issues.push(`${name}: uneven margins ${margins.join("/")}`);
          }
          if (Math.max(...paddings) - Math.min(...paddings) > 0.5) {
            issues.push(`${name}: uneven padding ${paddings.join("/")}`);
          }
          return issues;
        }),
      );
      expect(uneven, `${path}: Button chrome must be even on all four sides`).toEqual([]);

      // Per-axis sweep over EVERY visible button-like control: left==right,
      // top==bottom — nothing may visually offset its label.
      const lopsided = await page.locator("button:visible, a[class*='ui-btn']:visible").evaluateAll((items) =>
        items.flatMap((item) => {
          const style = getComputedStyle(item);
          const px = (v: string) => Number.parseFloat(v) || 0;
          const issues: string[] = [];
          const name = item.getAttribute("aria-label") || item.textContent?.trim() || "button";
          if (Math.abs(px(style.paddingLeft) - px(style.paddingRight)) > 0.5) {
            issues.push(`${name}: padding-inline ${style.paddingLeft}/${style.paddingRight}`);
          }
          if (Math.abs(px(style.paddingTop) - px(style.paddingBottom)) > 0.5) {
            issues.push(`${name}: padding-block ${style.paddingTop}/${style.paddingBottom}`);
          }
          if (Math.abs(px(style.marginLeft) - px(style.marginRight)) > 0.5) {
            issues.push(`${name}: margin-inline ${style.marginLeft}/${style.marginRight}`);
          }
          if (Math.abs(px(style.marginTop) - px(style.marginBottom)) > 0.5) {
            issues.push(`${name}: margin-block ${style.marginTop}/${style.marginBottom}`);
          }
          return issues;
        }),
      );
      expect(lopsided, `${path}: no button may carry lopsided chrome`).toEqual([]);
    }
    mock.assertSealed();
  });

  test("no silent touch surfaces: every button states its press", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 480 });
    await useExperience(page, "expert");
    const mock = await installActiveMock(page, { state: idleState });

    // THE PRESS LAW (the touch panel's rule, adopted app-wide by the flatten
    // pass). Before this, `active:translate-y-px` inside buttonStyles.ts was
    // the ONLY :active rule in the codebase — every hand-rolled <button>
    // relied on a hover state that a finger never produces. On the K1's own
    // 800x480 panel, press is the only confirmation the target was hit, so
    // silence there is worse than anywhere else.
    //
    // The check is mechanism-level rather than screenshot-level: a control
    // qualifies if it carries either press channel — the `ui-btn` sink
    // (Button) or the shared `press-flat` verb (everything else). That keeps
    // the law enforceable without pinning a particular pixel offset.
    for (const path of ["/", "/control", "/tune", "/print", "/console", "/settings"]) {
      await page.goto(path);
      await expect(page.locator("main > *").first()).toBeVisible();

      const silent = await page
        .locator("button:visible")
        .evaluateAll((items) =>
          items
            .filter(
              (item) =>
                !item.classList.contains("ui-btn") &&
                !item.classList.contains("press-flat") &&
                !item.classList.contains("telltale-cell") &&
                !item.classList.contains("readiness-module"),
            )
            .map(
              (item) =>
                `${item.getAttribute("aria-label") || item.textContent?.trim() || "button"} [${item.className}]`,
            ),
        );
      expect(silent, `${path}: every touch target must state its press`).toEqual([]);
    }

    // …and the verb must actually resolve to something. A class name with no
    // rule behind it would satisfy the sweep above and change nothing on the
    // glass, so pin the rule itself.
    const verb = await page.evaluate(() =>
      Array.from(document.styleSheets).flatMap((sheet) => {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          return [];
        }
        return Array.from(rules)
          .map((rule) => rule.cssText)
          .filter((text) => text.includes(".press-flat") && text.includes(":active"));
      }),
    );
    expect(verb.length, "the press-flat :active rule must exist in the stylesheet").toBeGreaterThan(0);
    expect(verb.join(" "), "press is geometry — the 1px sink").toContain("translateY(1px)");
    expect(verb.join(" "), "…plus the 2px accent rule along the bottom edge").toMatch(
      /box-shadow:\s*inset 0(px)? -2px 0(px)? var\(--color-accent\)/,
    );
    mock.assertSealed();
  });
});

/**
 * THE EVEN-INSET LAW (owner: "mission status button should be spaced from
 * the side of the card evenly and follow concentricity").
 *
 * The concentricity sweep verifies RADIUS relationships only — nothing
 * asserted that an element's INSET from its container edges is symmetric,
 * which is exactly how a 0/16/0 header-button inset shipped. This law closes
 * that gap:
 *
 *   For any `.ui-btn` (or action cluster containing one) inside an
 *   `.instrument-panel` header, let G be the set of the container's inner
 *   edges the element is adjacent to — an edge counts as adjacent when no
 *   sibling lies between the element and that edge. Every gap in G must
 *   equal the container's padding on that axis (--card-pad, read off the
 *   computed style, never hard-coded) within 1px.
 *
 *   Corollary tying this to the derived-radius law: with the gap uniform,
 *   the element's concentric radius is container radius − gap — one value
 *   for every corner (= --radius-control = 4px), so the header's old "skew
 *   corner" exemption disappears from the cascade.
 *
 * Documented exemptions, and only these: the edge a sibling occupies (a
 * right-aligned header cluster has the title to its left); full-width action
 * rows (individual buttons inside are exempt on the inline axis); and
 * `.bleed` strips, which deliberately cancel --card-pad. Header action
 * clusters — this sweep's subjects — are none of those.
 *
 * Adjacency is computed geometrically, so a header that gains a second
 * control does not need this test edited. The invariant is stated on the
 * action CLUSTER, not each button: while printing, Pause's own right inset
 * is ~100px because Cancel sits beside it — the cluster's is --card-pad.
 */

const INSET_VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "1280x900", width: 1280, height: 900 },
  { name: "800x480", width: 800, height: 480 },
] as const;

const INSET_ROUTES = [
  { name: "Dashboard", path: "/" },
  { name: "Files", path: "/print" },
  { name: "Control", path: "/control" },
  { name: "Tune", path: "/tune" },
  { name: "Timelapses", path: "/timelapses" },
  { name: "Console", path: "/console" },
  { name: "Settings", path: "/settings" },
] as const;

/** Calibrated 2026-08-04: the even-inset sweep observed 66 header action
 *  buttons across 7 routes × 2 modes × 2 print states × 3 viewports
 *  (8 distinct placements: Bed Mesh/Console/Files/Print History/Timelapses
 *  Refresh-Clear clusters plus Mission Status Pause/Cancel/Print again).
 *  The floor is ~80%: layout work may retire a placement, but a collapse
 *  below this means the sweep went blind. */
const INSET_SUBJECT_FLOOR = 52;

interface InsetSubject {
  card: string;
  label: string;
  pad: number;
  gaps: { edge: string; gap: number }[];
  radius: number;
  cardRadius: number;
}

/** In-page probe — measures every header action cluster from the container
 *  down (`section.instrument-panel > .panel-header`), so no card is named
 *  and a retuned --card-pad clamp() is followed automatically. */
const EVEN_INSET_PROBE = () => {
  const rows: {
    card: string;
    label: string;
    pad: number;
    gaps: { edge: string; gap: number }[];
    radius: number;
    cardRadius: number;
  }[] = [];

  for (const header of Array.from(
    document.querySelectorAll<HTMLElement>("section.instrument-panel > .panel-header"),
  )) {
    const card = header.parentElement as HTMLElement;
    const cs = getComputedStyle(card);
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const hbw = parseFloat(getComputedStyle(header).borderBottomWidth) || 0;
    const pad = parseFloat(getComputedStyle(header).paddingRight);
    const cr = card.getBoundingClientRect();
    const hr = header.getBoundingClientRect();

    // The action cluster = the header's last element child, when it is or
    // holds a Button (single Buttons land in the slot unwrapped).
    const cluster = header.lastElementChild as HTMLElement | null;
    if (!cluster) continue;
    const btn = cluster.classList.contains("ui-btn")
      ? cluster
      : cluster.querySelector<HTMLElement>(".ui-btn");
    if (!btn) continue;
    if (cluster.getClientRects().length === 0) continue;
    const r = cluster.getBoundingClientRect();

    // Adjacency: an edge is a subject only when no sibling sits between.
    const siblings = Array.from(header.children).filter((n) => n !== cluster) as HTMLElement[];
    const blockedLeft = siblings.some((s) => s.getBoundingClientRect().right <= r.left + 1);
    const gaps = [
      { edge: "top", gap: r.top - (cr.top + bw) },
      { edge: "right", gap: cr.right - bw - r.right },
      { edge: "bottom", gap: hr.bottom - hbw - r.bottom },
      ...(blockedLeft ? [] : [{ edge: "left", gap: r.left - (cr.left + bw) }]),
    ];
    rows.push({
      card: card.querySelector("h2")?.textContent?.trim() ?? "?",
      label: btn.textContent?.trim() || "(icon)",
      pad,
      gaps: gaps.map((g) => ({ edge: g.edge, gap: Math.round(g.gap * 100) / 100 })),
      radius: parseFloat(getComputedStyle(btn).borderTopRightRadius),
      cardRadius: parseFloat(cs.borderTopRightRadius),
    });
  }
  return rows;
};

/** Subject counts survive across the two state tests below (one worker,
 *  in-file order) so the final floor assertion sees the whole sweep. */
const insetTotal = { seen: 0, sweeps: 0 };

test.describe("Even-inset law — header action clusters", () => {
  for (const stateKey of ["idle", "active-print"] as const) {
    test(`header action clusters sit --card-pad from every free edge, ${stateKey}`, async ({
      page,
    }) => {
      test.setTimeout(360_000);
      page.setDefaultTimeout(4_000);
      page.setDefaultNavigationTimeout(15_000);

      const sc = scenario(stateKey === "idle" ? "at-temperature" : "printing-midjob");
      await installActiveMock(page, { state: sc.state, camera: "ok", thumbnail: true });
      await fulfilFileApi(page);

      for (const viewport of INSET_VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        // Establish the origin so the localStorage mode write lands.
        await visit(page, "/");
        for (const mode of ["basic", "expert"] as const) {
          await page.evaluate((m: string) => {
            localStorage.setItem("forge.experience-mode", m);
            localStorage.setItem("forge.sidebar.collapsed", "0");
          }, mode);
          for (const route of INSET_ROUTES) {
            const label = `${viewport.name} · ${route.name} · ${stateKey}/${mode}`;
            await visit(page, route.path);
            const subjects = (await page.evaluate(EVEN_INSET_PROBE)) as InsetSubject[];
            insetTotal.seen += subjects.length;
            for (const s of subjects) {
              const where = `${label}: ${s.card} / "${s.label}"`;
              for (const g of s.gaps) {
                expect(
                  Math.abs(g.gap - s.pad),
                  `${where}: ${g.edge} gap ${g.gap} must equal pad ${s.pad}`,
                ).toBeLessThanOrEqual(1);
              }
              // Ties the new law to the existing one: uniform gap ⇒ one
              // derived radius (container radius − gap = --radius-control).
              expect(
                Math.abs(s.radius - Math.max(0, s.cardRadius - s.pad)),
                `${where}: radius ${s.radius} must derive from the (now uniform) gap ` +
                  `(card ${s.cardRadius} − pad ${s.pad})`,
              ).toBeLessThanOrEqual(1);
            }
          }
        }
      }
      insetTotal.sweeps += 1;
    });
  }

  test("the even-inset sweep must still see the glass", () => {
    expect(insetTotal.sweeps, "both even-inset state sweeps must have run").toBe(2);
    expect(
      insetTotal.seen,
      `even-inset subjects collapsed below the calibrated floor (${INSET_SUBJECT_FLOOR}) — selector rot or a blind probe`,
    ).toBeGreaterThanOrEqual(INSET_SUBJECT_FLOOR);
  });
});
