import { expect, test, type Page, type Route } from "@playwright/test";
import { installActiveMock } from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";

const FILES = Array.from({ length: 24 }, (_, index) => ({
  path: `part-${String(index).padStart(2, "0")}.gcode`,
  size: 1000 + index,
  modified: 1_700_000_100 - index,
  permissions: "rw",
}));

function metadata(index: number) {
  return {
    estimated_time: 3600,
    layer_count: 100 + index,
    layer_height: 0.2,
    first_layer_extr_temp: 220,
    first_layer_bed_temp: 60,
    slicer: "OrcaSlicer",
    thumbnails: [
      { width: 32, relative_path: `.thumbs/part-${index}-32.png` },
      { width: 300, relative_path: `.thumbs/part-${index}-300.png` },
    ],
  };
}

async function fileFixture(page: Page, options: {
  files?: typeof FILES;
  held?: string[];
  holdFirst?: number;
  failFirst?: boolean;
} = {}) {
  const mock = await installActiveMock(page, { ...scenario("at-temperature"), thumbnail: true });
  let files = options.files ?? FILES;
  let replacementLayers: number | undefined;
  const calls: string[] = [];
  const held = new Map<string, Route>();
  const heldNames = new Set(options.held);
  let active = 0;
  let maxActive = 0;
  const respond = async (route: Route, filename: string) => {
    const index = FILES.findIndex((file) => file.path === filename);
    const result = { ...metadata(index), ...(replacementLayers === undefined ? {} : { layer_count: replacementLayers }) };
    const failed = options.failFirst && calls.filter((name) => name === filename).length === 1;
    active -= 1;
    await route.fulfill({ status: failed ? 503 : 200, contentType: "application/json",
      body: JSON.stringify(failed ? { error: "Temporary metadata failure" } : { result }) });
  };
  await page.route("**/server/files/list*", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: files }) });
  });
  await page.route("**/server/files/metadata*", async (route) => {
    expect(route.request().method()).toBe("GET");
    const filename = new URL(route.request().url()).searchParams.get("filename")!;
    expect(files.some((file) => file.path === filename)).toBe(true);
    calls.push(filename);
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (heldNames.delete(filename) || calls.length <= (options.holdFirst ?? 0)) held.set(filename, route);
    else await respond(route, filename);
  });
  await page.route("**/server/history/list*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { jobs: [] } }) });
  });
  await page.route("**/server/history/totals", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      result: { job_totals: { total_jobs: 0, total_time: 0, total_filament_used: 0, longest_job: 0 } },
    }) });
  });
  return {
    calls, maxActive: () => maxActive, active: () => active,
    held: (filename: string) => held.has(filename),
    release: async (filename: string) => {
      const route = held.get(filename);
      expect(route, `No pending metadata fixture for ${filename}`).toBeDefined();
      held.delete(filename);
      await respond(route!, filename);
    },
    replace: (replacement: typeof FILES, layers: number) => { files = replacement; replacementLayers = layers; },
    assertSealed: mock.assertSealed,
  };
}

const row = (page: Page, index: number) => page.getByRole("button", { name: new RegExp(FILES[index].path.replace(".", "\\.")) });
const layerValue = (page: Page) => page.getByText("Layers", { exact: true }).locator("..").locator("div").last();
const refreshFiles = (page: Page) => page.locator("section").filter({ has: page.getByTestId("file-list") })
  .getByRole("button", { name: "Refresh", exact: true });
const visibleTiles = (page: Page) => page.getByTestId("file-list").evaluate((list) => {
  const bounds = list.getBoundingClientRect();
  return [...list.querySelectorAll("li")].flatMap((item) => {
    // Match the observed tile, not the taller row: a partially clipped
    // filename must not make the expected preview-request set too large.
    const box = item.querySelector("button")!.firstElementChild!.getBoundingClientRect();
    return box.top < bounds.bottom + 32 && box.bottom > bounds.top - 32
      ? [item.querySelector("button div div")?.textContent?.trim() ?? ""] : [];
  });
});

test("24 files load only visible previews, at most two reads, with selected details sharing the read", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const fixture = await fileFixture(page, { holdFirst: 2 });
  await page.goto("/print");
  await expect(page.getByTestId("file-list").getByRole("button")).toHaveCount(24);
  await expect.poll(() => fixture.calls.length).toBe(2);
  const firstCalls = [...fixture.calls];
  const selectedIndex = FILES.findIndex((file) => file.path === firstCalls[0]);
  const initiallyVisible = await visibleTiles(page);
  await row(page, selectedIndex).click();
  // Two occupied slots remain two, even after a detail-panel subscriber joins.
  expect(fixture.calls).toEqual(firstCalls);
  expect(fixture.active()).toBe(2);
  await fixture.release(firstCalls[0]);
  await expect(layerValue(page)).toHaveText(String(100 + selectedIndex));
  await expect(page.getByAltText(`Preview of ${FILES[selectedIndex].path}`)).toBeVisible();
  // Selecting a file can enlarge the aligned grid row and expose additional
  // tiles. Those newly visible previews are legitimate requests too.
  const selectedVisible = await visibleTiles(page);
  const permitted = [...new Set([...initiallyVisible, ...selectedVisible])].sort();
  await fixture.release(firstCalls[1]);
  await expect.poll(() => [...fixture.calls].sort()).toEqual(permitted);
  await expect.poll(() => fixture.active()).toBe(0);
  const initialReads = fixture.calls.length;
  expect(initialReads).toBeGreaterThan(2);
  expect(initialReads).toBeLessThan(24);
  expect(fixture.calls.filter((name) => name === FILES[selectedIndex].path)).toHaveLength(1);
  expect(fixture.maxActive()).toBeLessThanOrEqual(2);
  expect(fixture.calls).not.toContain(FILES[23].path);

  // All filenames stay mounted and keyboard-operable. Scrolling reveals,
  // rather than removes, the deferred previews.
  await row(page, 23).scrollIntoViewIfNeeded();
  await expect(row(page, 23).locator("img")).toBeVisible();
  await row(page, 23).focus();
  await page.keyboard.press("Enter");
  await expect(layerValue(page)).toHaveText("123");
  await expect(row(page, 23)).toHaveAttribute("aria-pressed", "true");
  expect(fixture.calls.filter((name) => name === FILES[23].path)).toHaveLength(1);
  expect(fixture.maxActive()).toBeLessThanOrEqual(2);
  fixture.assertSealed();
});

test("leaving Files cancels queued previews and selected details without sending them", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const fixture = await fileFixture(page, { holdFirst: 2 });
  await page.goto("/print");
  await expect(page.getByTestId("file-list").getByRole("button")).toHaveCount(24);
  await expect.poll(() => fixture.calls.length).toBe(2);
  const sent = [...fixture.calls];
  const queuedIndex = FILES.findIndex((file, index) => index < 5 && !sent.includes(file.path));
  await row(page, queuedIndex).click();
  // Both slots are still held: selected details only promote queued work.
  expect(fixture.calls).toEqual(sent);
  await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByTestId("file-list")).toHaveCount(0);
  await fixture.release(sent[0]);
  await fixture.release(sent[1]);
  // Allow response microtasks and a full rendering turn to drain. Unsent
  // Files work must not resume after its subscribers have unmounted.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  expect(fixture.calls).toEqual(sent);
  expect(fixture.active()).toBe(0);
  expect(fixture.maxActive()).toBe(2);
  fixture.assertSealed();
});

test("a slow previous selection cannot overwrite the newer details", async ({ page }) => {
  const fixture = await fileFixture(page, { files: FILES.slice(0, 2), held: [FILES[0].path, FILES[1].path] });
  await page.goto("/print");
  await expect.poll(() => fixture.calls.length).toBe(2);
  await row(page, 0).click();
  await row(page, 1).click();
  await fixture.release(FILES[1].path);
  await expect(layerValue(page)).toHaveText("101");
  await fixture.release(FILES[0].path);
  await expect(row(page, 0).locator("img")).toBeVisible();
  await expect(layerValue(page)).toHaveText("101");
  await expect(page.getByAltText(`Preview of ${FILES[1].path}`)).toBeVisible();
  expect(fixture.calls).toHaveLength(2);
  fixture.assertSealed();
});

test("failed metadata stays unknown; explicit refresh restores previews and details", async ({ page }) => {
  const fixture = await fileFixture(page, { files: FILES.slice(0, 1), failFirst: true });
  await page.goto("/print");
  await expect.poll(() => fixture.calls.length).toBe(1);
  await expect.poll(() => fixture.active()).toBe(0);
  await expect(row(page, 0).getByTestId("thumb-fallback")).toHaveCount(0);
  await expect(page.getByText("No preview in this file")).toHaveCount(0);
  await refreshFiles(page).click();
  await expect(row(page, 0).locator("img")).toBeVisible();
  await row(page, 0).click();
  await expect(layerValue(page)).toHaveText("100");
  await expect(page.getByAltText(`Preview of ${FILES[0].path}`)).toBeVisible();
  expect(fixture.calls).toHaveLength(2);
  fixture.assertSealed();
});

test("refresh shows a same-name replacement and preserves the selected file", async ({ page }) => {
  const fixture = await fileFixture(page, { files: FILES.slice(0, 1) });
  await page.goto("/print");
  await expect(row(page, 0).locator("img")).toBeVisible();
  await row(page, 0).click();
  await expect(layerValue(page)).toHaveText("100");
  fixture.replace([{ ...FILES[0], modified: FILES[0].modified + 1, size: FILES[0].size + 1 }], 222);
  await refreshFiles(page).click();
  await expect(layerValue(page)).toHaveText("222");
  await expect(row(page, 0)).toHaveAttribute("aria-pressed", "true");
  // One initial identity, one replacement identity, shared by both panels.
  expect(fixture.calls).toHaveLength(2);
  expect(fixture.maxActive()).toBeLessThanOrEqual(2);
  fixture.assertSealed();
});
