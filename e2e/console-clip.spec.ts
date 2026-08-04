import { expect, test, type Page } from "@playwright/test";

// Regression guard: the /console command row used to be discarded entirely on
// short viewports. The page pins itself to the viewport-derived height while
// the Card panel is overflow-hidden; because the Card body was not a flex
// column, the feed's min-height forced the column past the clip edge and the
// G-code input plus Send button ended up 169px below it on the K1 Max's own
// 800x480 touch panel — with no scroll container able to reach them.
//
// The law enforced here: every visible interactive control on /console must
// be reachable — its bottom edge inside every clipping (overflow hidden/clip)
// ancestor, within scroll reach of every scrollable ancestor, and reachable
// inside the viewport once the document is scrolled to its limit.

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";

const VIEWPORTS = [
  { width: 320, height: 720 },
  { width: 800, height: 480 }, // the K1 Max's own touch panel — deploy target
  { width: 1280, height: 800 },
] as const;

async function blockPrinterTraffic(page: Page) {
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === PREVIEW_ORIGIN) {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
}

function collectClipViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const violations: string[] = [];
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        "main button, main a[href], main input, main select, main textarea",
      ),
    ).filter((el) => el.getClientRects().length > 0);

    for (const el of controls) {
      const label =
        el.getAttribute("aria-label") ||
        el.textContent?.trim().replace(/\s+/g, " ").slice(0, 40) ||
        el.tagName.toLowerCase();
      const rect = el.getBoundingClientRect();

      for (let node = el.parentElement; node; node = node.parentElement) {
        const overflowY = getComputedStyle(node).overflowY;
        if (overflowY === "visible") continue;
        const nodeRect = node.getBoundingClientRect();
        const describe = `<${node.tagName.toLowerCase()} class="${node.className}">`;
        if (overflowY === "hidden" || overflowY === "clip") {
          // Non-scrollable clip: the control's bottom edge must sit inside
          // the ancestor's visible box — anything past it is unreachable.
          const visibleBottom = nodeRect.top + node.clientTop + node.clientHeight;
          if (rect.bottom > visibleBottom + 0.5) {
            violations.push(
              `"${label}" bottom ${rect.bottom.toFixed(1)}px is clipped ` +
                `${(rect.bottom - visibleBottom).toFixed(1)}px past ${describe} ` +
                `(clip edge ${visibleBottom.toFixed(1)}px)`,
            );
          }
        } else {
          // Scrollable ancestor: the control must be within scroll reach.
          const reachableBottom =
            nodeRect.top + node.clientTop - node.scrollTop + node.scrollHeight;
          if (rect.bottom > reachableBottom + 0.5) {
            violations.push(
              `"${label}" bottom ${rect.bottom.toFixed(1)}px is beyond the ` +
                `scroll reach of ${describe} (${reachableBottom.toFixed(1)}px)`,
            );
          }
        }
      }

      // Viewport: even after scrolling the document to its limit the control
      // must fit on screen (this is exactly how the Send button was lost —
      // rect y=485 in a 480px viewport with only 8px of document scroll).
      const doc = document.scrollingElement ?? document.documentElement;
      const remainingScroll = Math.max(
        0,
        doc.scrollHeight - window.innerHeight - doc.scrollTop,
      );
      if (rect.bottom - remainingScroll > window.innerHeight + 0.5) {
        violations.push(
          `"${label}" bottom ${rect.bottom.toFixed(1)}px cannot be brought ` +
            `into the ${window.innerHeight}px viewport (only ` +
            `${remainingScroll.toFixed(1)}px of document scroll remains)`,
        );
      }
    }
    return violations;
  });
}

test.describe("Console command row is never clipped out of reach", () => {
  for (const viewport of VIEWPORTS) {
    test(`every /console control is reachable at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await blockPrinterTraffic(page);
      await page.addInitScript(() =>
        localStorage.setItem("forge.experience-mode", "expert"),
      );
      await page.goto("/console");
      await expect(
        page.getByRole("heading", { name: "Console", exact: true }),
      ).toBeVisible();

      // The controls this guard exists for must actually be on the page —
      // a vacuous pass over an empty control list proves nothing.
      await expect(page.getByLabel("G-code command")).toBeAttached();
      await expect(page.getByRole("button", { name: /Send/ })).toBeAttached();
      await expect(page.getByRole("button", { name: /Autoscroll/ })).toBeAttached();

      expect(await collectClipViolations(page)).toEqual([]);
    });
  }
});
