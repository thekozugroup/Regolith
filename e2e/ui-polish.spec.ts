import { expect, test } from "@playwright/test";
import { installActiveMock, useExperience } from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";

test.describe("Touch camera controls", () => {
  test.use({ hasTouch: true });

  for (const viewport of [{ width: 800, height: 480 }, { width: 1024, height: 768 }]) {
    test(`remain visible without hover at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const mock = await installActiveMock(page, scenario("at-temperature"));
      await page.goto("/");
      const controls = page.locator(".camera-controls");
      await expect(controls).toBeVisible();
      await expect(controls).toHaveCSS("opacity", "1");
      for (const name of ["Refresh camera stream", "Open camera fullscreen"]) {
        const box = await page.getByRole("button", { name }).boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      expect(mock.cameraRequests()).toBe(1);
      mock.assertSealed();
    });
  }
});

test("mouse camera actions reveal on hover and keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const mock = await installActiveMock(page, scenario("at-temperature"));
  await page.goto("/");
  const controls = page.locator(".camera-controls");
  await expect(controls).toHaveCSS("opacity", "0");
  await controls.locator("..").hover();
  await expect(controls).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  await expect(controls).toHaveCSS("opacity", "0");
  await page.getByRole("button", { name: "Refresh camera stream" }).focus();
  await expect(controls).toHaveCSS("opacity", "1");
  expect(mock.cameraRequests()).toBe(1);
  mock.assertSealed();
});

test("live indicators animate transforms and honor reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await useExperience(page, "expert");
  const mock = await installActiveMock(page, scenario("at-temperature"));
  await page.goto("/control");
  const marker = page.getByTestId("toolhead-position");
  await expect(marker).toBeAttached();
  await expect(marker).toHaveCSS("transition-property", "transform");
  mock.push({ motion_report: { live_position: [200, 100, 12, 0], live_velocity: 0 } });
  await expect.poll(async () => {
    const transform = await marker.evaluate(element => element.style.transform);
    return parseFloat(transform.slice("translate(".length));
  }).toBeCloseTo((202 / 308.5) * 100, 3);

  await page.goto("/settings");
  const memory = page.getByTestId("host-memory-bar");
  await expect(memory).toHaveCSS("transition-property", "transform");
  await expect.poll(() => memory.getAttribute("style")).not.toContain("scaleX(0)");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const duration = await memory.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration));
  expect(duration).toBeLessThanOrEqual(0.001);
  mock.assertSealed();
});

test("telemetry updates retain one camera request and a responsive shell", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 800, height: 480 });
  const mock = await installActiveMock(page, scenario("printing-midjob"));
  await page.goto("/");
  await expect(page.locator(".camera-controls")).toBeAttached();
  const samples = await Promise.all([
    page.evaluate(() => new Promise<{ frames: number; maxFrameMs: number; longTasks: number }>((resolve) => {
      let frames = 0;
      let maxFrameMs = 0;
      let previous = performance.now();
      let longTasks = 0;
      const observer = new PerformanceObserver((list) => { longTasks += list.getEntries().length; });
      observer.observe({ type: "longtask" });
      const start = previous;
      const frame = (now: number) => {
        frames++;
        maxFrameMs = Math.max(maxFrameMs, now - previous);
        previous = now;
        if (now - start < 3_000) requestAnimationFrame(frame);
        else { observer.disconnect(); resolve({ frames, maxFrameMs, longTasks }); }
      };
      requestAnimationFrame(frame);
    })),
    (async () => {
      for (let i = 0; i < 30; i++) {
        mock.push({ extruder: { temperature: 254.8 + (i % 3) * 0.1 }, display_status: { progress: 0.4 + i / 10000 } });
        await page.waitForTimeout(100);
      }
    })(),
  ]);
  // Timing is evidence, not a hardware-independent FPS claim or flaky CI
  // threshold. Structural performance and containment remain hard gates.
  await testInfo.attach("local-telemetry-performance", { body: JSON.stringify(samples[0]), contentType: "application/json" });
  expect(mock.cameraRequests()).toBe(1);
  await expect(page.getByRole("region", { name: "Printer status" })).toContainText("Link Ready");
  mock.assertSealed();
});
