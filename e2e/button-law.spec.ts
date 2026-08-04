import { expect, test, type Locator } from "@playwright/test";
import {
  installActiveMock,
  useExperience,
  type MockPrinterState,
} from "./support/active-state-harness";

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
});
