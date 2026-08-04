import { expect, test, type Page } from "@playwright/test";
import { installActiveMock } from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";
import { fulfilFileApi, tryOpen, visit } from "./support/sweep-helpers";

// THE REACHABILITY LAW — app-wide. Born on /console: the command row used to
// be discarded entirely on short viewports. The page pinned itself to the
// viewport-derived height while the Card panel was overflow-hidden; because
// the Card body was not a flex column, the feed's min-height forced the
// column past the clip edge and the G-code input plus Send button ended up
// 169px below it on the K1 Max's own 800x480 touch panel — with no scroll
// container able to reach them. That law was /console-scoped for years; had
// it been app-wide from the start it would have caught the blocker the day
// it shipped. Now it is app-wide:
//
// Every visible interactive control on EVERY route, in both experience
// modes, idle AND active-print, with each route's cheap overlays opened
// (readiness dialog, print dialog, disclosure groups, the compact more
// sheet), must be reachable — its bottom edge inside every clipping
// (overflow hidden/clip) ancestor, within scroll reach of every scrollable
// ancestor, and reachable inside the viewport once the document is scrolled
// to its limit — at 320x720 (narrowest supported), 800x480 (the K1 Max's
// own touch panel — deploy target) and 1280x800 (desk chrome).
//
// NON-VACUITY: each route asserts a calibrated minimum visible-control
// count; a sweep that sees an empty page must fail loudly, never pass.

const VIEWPORTS = [
  { width: 320, height: 720 },
  { width: 800, height: 480 }, // the K1 Max's own touch panel — deploy target
  { width: 1280, height: 800 },
] as const;

const MODES = ["basic", "expert"] as const;

/** Calibrated 2026-08-04: minimum visible interactive controls observed for
 *  the route across every viewport x state combination, per experience mode
 *  (basic locks /control, /tune and /console behind the ExpertOnly
 *  placeholder, so those floors differ by mode), held at ~80% so layout work
 *  has headroom without letting the sweep go blind. */
const ROUTES = [
  { name: "Dashboard", path: "/", minControls: { basic: 5, expert: 5 } },
  { name: "Files", path: "/print", minControls: { basic: 8, expert: 8 } },
  { name: "Control", path: "/control", minControls: { basic: 12, expert: 15 } },
  { name: "Tune", path: "/tune", minControls: { basic: 4, expert: 14 } },
  { name: "Timelapses", path: "/timelapses", minControls: { basic: 5, expert: 5 } },
  { name: "Console", path: "/console", minControls: { basic: 4, expert: 7 } },
  { name: "Settings", path: "/settings", minControls: { basic: 16, expert: 28 } },
] as const;

interface Reachability {
  controls: number;
  violations: string[];
}

/** The original /console clip probe, generalized to the whole document:
 *  every rendered control (not just main's) is measured against its clipping
 *  ancestors, its scrollable ancestors, and the viewport's residual scroll. */
function collectReachability(page: Page): Promise<Reachability> {
  return page.evaluate(() => {
    const violations: string[] = [];
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button, a[href], input, select, textarea",
      ),
    ).filter((el) => {
      if (el.getClientRects().length === 0) return false;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden") return false;
      // Screen-reader-only affordances are deliberately 1px boxes parked
      // under clip rects; they are not touch targets and their geometry is
      // not a reachability claim.
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return false;
      if (el.closest('[aria-hidden="true"]')) return false;
      return true;
    });

    for (const el of controls) {
      const label =
        el.getAttribute("aria-label") ||
        el.textContent?.trim().replace(/\s+/g, " ").slice(0, 40) ||
        el.tagName.toLowerCase();
      const rect = el.getBoundingClientRect();
      // position:fixed escapes ancestor clipping AND document scroll; its
      // law is simply "inside the viewport", asserted below.
      const isFixed = getComputedStyle(el).position === "fixed";

      // Scrollable ancestors BETWEEN the control and an outer clip edge can
      // legitimately carry the control into view (a modal panel with
      // overflow-y-auto inside a pinned body, say) — so each clip check is
      // made against the control's bottom minus the downward scroll slack
      // accumulated on the way up. The Console blocker stays caught: there,
      // no scrollable ancestor sat between the command row and the clipping
      // Card, so its slack was zero.
      let slack = 0;
      if (!isFixed) {
        for (let node = el.parentElement; node; node = node.parentElement) {
          const overflowY = getComputedStyle(node).overflowY;
          if (overflowY === "visible") continue;
          const nodeRect = node.getBoundingClientRect();
          const describe = `<${node.tagName.toLowerCase()} class="${node.className}">`;
          if (overflowY === "hidden" || overflowY === "clip") {
            // Non-scrollable clip: the control's reachable bottom edge must
            // sit inside the ancestor's visible box — past it is unreachable.
            const visibleBottom = nodeRect.top + node.clientTop + node.clientHeight;
            if (rect.bottom - slack > visibleBottom + 0.5) {
              violations.push(
                `"${label}" bottom ${rect.bottom.toFixed(1)}px (${slack.toFixed(1)}px ` +
                  `of inner scroll slack) is clipped past ${describe} ` +
                  `(clip edge ${visibleBottom.toFixed(1)}px)`,
              );
            }
          } else {
            // Scrollable ancestor: the control must be within scroll reach…
            const reachableBottom =
              nodeRect.top + node.clientTop - node.scrollTop + node.scrollHeight;
            if (rect.bottom > reachableBottom + 0.5) {
              violations.push(
                `"${label}" bottom ${rect.bottom.toFixed(1)}px is beyond the ` +
                  `scroll reach of ${describe} (${reachableBottom.toFixed(1)}px)`,
              );
            }
            // …and whatever it can still scroll downward is slack that outer
            // clip edges must credit.
            slack += Math.max(0, node.scrollHeight - node.clientHeight - node.scrollTop);
          }
        }
      }

      // Viewport: even after scrolling the document to its limit the control
      // must fit on screen (this is exactly how the Send button was lost —
      // rect y=485 in a 480px viewport with only 8px of document scroll).
      const doc = document.scrollingElement ?? document.documentElement;
      const remainingScroll = isFixed
        ? 0
        : Math.max(0, doc.scrollHeight - window.innerHeight - doc.scrollTop) + slack;
      if (rect.bottom - remainingScroll > window.innerHeight + 0.5) {
        violations.push(
          `"${label}" bottom ${rect.bottom.toFixed(1)}px cannot be brought ` +
            `into the ${window.innerHeight}px viewport (only ` +
            `${remainingScroll.toFixed(1)}px of document scroll remains)`,
        );
      }
    }
    return { controls: controls.length, violations };
  });
}

async function assertReachable(page: Page, where: string, minControls: number) {
  const { controls, violations } = await collectReachability(page);
  expect(violations, `reachability law violations at ${where}`).toEqual([]);
  expect(
    controls,
    `${where}: only ${controls} visible controls — below the calibrated ` +
      `floor (${minControls}); the sweep may have gone blind`,
  ).toBeGreaterThanOrEqual(minControls);
  return controls;
}

test.describe("Reachability law — every control on every route", () => {
  for (const viewport of VIEWPORTS) {
    test(`every visible control on every route is reachable at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      test.setTimeout(360_000);
      page.setDefaultTimeout(4_000);
      page.setDefaultNavigationTimeout(15_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const mock = await installActiveMock(page, {
        state: scenario("at-temperature").state,
        camera: "ok",
        thumbnail: true,
      });
      await fulfilFileApi(page);
      // Establish the origin so localStorage writes have somewhere to land.
      await visit(page, "/");

      for (const stateKey of ["idle", "active-print"] as const) {
        mock.use({
          state: scenario(stateKey === "idle" ? "at-temperature" : "printing-midjob")
            .state,
          camera: "ok",
          thumbnail: true,
        });

        for (const mode of MODES) {
          await page.evaluate((m: string) => {
            localStorage.setItem("forge.experience-mode", m);
            localStorage.setItem("forge.sidebar.collapsed", "0");
          }, mode);

          for (const route of ROUTES) {
            const where = `${viewport.width}x${viewport.height} · ${route.name} · ${stateKey}/${mode}`;
            await visit(page, route.path);

            // The controls this law was born for must actually be on the
            // page — a vacuous pass over an empty list proves nothing.
            // (Basic mode locks /console behind the ExpertOnly placeholder.)
            if (route.path === "/console" && mode === "expert") {
              await expect(page.getByLabel("G-code command")).toBeAttached();
              await expect(page.getByRole("button", { name: /Send/ })).toBeAttached();
              await expect(
                page.getByRole("button", { name: /Autoscroll/ }),
              ).toBeAttached();
            }

            await assertReachable(page, where, route.minControls[mode]);

            // Compact chrome's "More" nav sheet — its controls are exactly
            // the kind an off-screen drawer can strand.
            if (
              await tryOpen(
                page,
                async () => {
                  const b = page.getByRole("button", { name: "More navigation" });
                  if ((await b.count()) && (await b.first().isVisible()))
                    await b.first().click();
                },
                'nav[aria-label="More"]',
              )
            ) {
              // Overlays may aria-hide the page behind them, so their floor
              // is only "the overlay's own controls exist" — route-level
              // non-vacuity was already asserted on the base capture.
              await assertReachable(page, `${where} + more-sheet`, 1);
              await page
                .getByRole("button", { name: "Close more navigation" })
                .first()
                .click()
                .catch(() => {});
              await page.waitForTimeout(180);
            }

            // Cheap overlays, idle only (the readiness disclosure and the
            // print flow are idle affordances).
            if (stateKey === "idle" && route.path === "/") {
              if (
                await tryOpen(
                  page,
                  async () => {
                    const b = page.locator(
                      'button.readiness-module[aria-haspopup="dialog"]',
                    );
                    if ((await b.count()) && (await b.first().isVisible()))
                      await b.first().click();
                  },
                  '[role="dialog"]',
                )
              ) {
                await assertReachable(page, `${where} + readiness-dialog`, 1);
                await page.keyboard.press("Escape").catch(() => {});
                await page.waitForTimeout(180);
              }
            }

            if (stateKey === "idle" && route.path === "/print") {
              const row = page.getByRole("button", {
                name: /benchy_0\.2mm_PLA_K1Max\.gcode/,
              });
              if ((await row.count()) && (await row.first().isVisible())) {
                await row.first().click().catch(() => {});
                await page.waitForTimeout(260);
              }
              if (
                await tryOpen(
                  page,
                  async () => {
                    const b = page.getByRole("button", {
                      name: /^Print\b|Start print/i,
                    });
                    if (
                      (await b.count()) &&
                      (await b.first().isVisible()) &&
                      (await b.first().isEnabled())
                    )
                      await b.first().click();
                  },
                  '[role="dialog"]',
                )
              ) {
                await assertReachable(page, `${where} + print-dialog`, 1);
                await page.keyboard.press("Escape").catch(() => {});
                await page.waitForTimeout(180);
              }
            }

            if (
              route.path === "/settings" ||
              route.path === "/control" ||
              route.path === "/tune"
            ) {
              // Expand every disclosure, then re-measure: collapsed groups
              // hide exactly the controls a clipped layout would strand.
              const changed = await page.evaluate(() => {
                let n = 0;
                for (const d of Array.from(document.querySelectorAll("details"))) {
                  if (!(d as HTMLDetailsElement).open) {
                    (d as HTMLDetailsElement).open = true;
                    n += 1;
                  }
                }
                return n;
              });
              if (changed > 0) {
                await page.waitForTimeout(180);
                await assertReachable(
                  page,
                  `${where} + details-open`,
                  route.minControls[mode],
                );
              }
            }
          }
        }
      }
    });
  }
});
