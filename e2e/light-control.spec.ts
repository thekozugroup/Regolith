import {
  expect,
  test,
  type Page,
  type WebSocketRoute,
} from "@playwright/test";
import { useExperience, type MockPrinterState } from "./support/active-state-harness";
import { isPreviewUrl } from "./support/preview-origin";
import { sealPrinterNamespace } from "./support/printer-seal";

/**
 * Chamber light control.
 *
 * The shared active-state harness deliberately closes the socket on any RPC
 * other than `printer.objects.subscribe` — it exists to prove the UI never
 * writes to a printer. This suite is the one place a WRITE is the subject,
 * so it carries its own mock: the same sealed-origin discipline, but with
 * `printer.objects.list` and `printer.gcode.script` answered and recorded.
 *
 * What is under test is the honesty of the chip, not the lamp:
 *   - unknown state stays unknown (a dash, aria-pressed="mixed")
 *   - a tap claims the new state immediately, and gives it back if the
 *     printer refuses or has no such pin
 *   - the chip is a control in its own right, not a nested one
 */

const MOCK_CAMERA_FRAME = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9" viewBox="0 0 16 9"><rect width="16" height="9" fill="#14191f"/></svg>`;

const READY: MockPrinterState = {
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

/** The live K1 Max list, plus whatever the case wants to add or withhold. */
const BASE_OBJECTS = [
  "webhooks",
  "print_stats",
  "toolhead",
  "extruder",
  "heater_bed",
  "gcode_macro START_PRINT",
  "output_pin ADAPTIVE_BED_MESH",
];

interface LightMock {
  /** Every `printer.gcode.script` the app sent, in order. */
  scripts: () => string[];
  push: (diff: MockPrinterState) => void;
  /** Withhold gcode replies so the in-flight (optimistic) frame is testable. */
  hold: () => void;
  /** Answer every withheld gcode call — with an error when `message` is set. */
  release: (message?: string) => void;
  assertSealed: () => void;
}

async function installLightMock(
  page: Page,
  objects: string[],
): Promise<LightMock> {
  const scripts: string[] = [];
  const escaped: string[] = [];
  const sockets = new Set<WebSocketRoute>();
  const held: Array<{ socket: WebSocketRoute; id: number }> = [];
  let holding = false;
  let state = READY;

  const reply = (socket: WebSocketRoute, id: number, body: unknown) =>
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, ...(body as object) }));

  await page.routeWebSocket("**/websocket", (socket) => {
    sockets.add(socket);
    socket.onClose(() => sockets.delete(socket));
    socket.onMessage((payload) => {
      const request = JSON.parse(String(payload)) as {
        id?: number;
        method?: string;
        params?: { script?: string };
      };
      const id = request.id ?? 0;
      switch (request.method) {
        case "printer.objects.subscribe":
          reply(socket, id, { result: { status: state } });
          return;
        case "printer.objects.list":
          reply(socket, id, { result: { objects } });
          return;
        case "printer.gcode.script":
          scripts.push(request.params?.script ?? "");
          if (holding) held.push({ socket, id });
          else reply(socket, id, { result: "ok" });
          return;
        default:
          escaped.push(`rpc:${request.method ?? "unknown"}`);
          socket.close({ code: 1008, reason: "unexpected rpc" });
      }
    });
  });

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.port === "8080") {
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: MOCK_CAMERA_FRAME,
      });
      return;
    }
    if (url.pathname === "/printer/info") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: { hostname: "forge", software_version: "v0.12.0" },
        }),
      });
      return;
    }
    if (url.pathname === "/machine/system_info") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            system_info: {
              distribution: { name: "Buildroot", version_id: "2023.02" },
              cpu_info: { cpu_desc: "K1 Max test fixture" },
            },
          },
        }),
      });
      return;
    }
    if (!isPreviewUrl(url)) {
      escaped.push(route.request().url());
      await route.abort("blockedbyclient");
      return;
    }
    // Same origin, but the preview server proxies the printer namespaces —
    // serve the idle-machine floor and refuse anything else rather than
    // handing it to a server with a proxy table. Refusals land in
    // `escaped`, which `assertSealed()` below asserts empty.
    if (await sealPrinterNamespace(route, url, escaped)) return;
    await route.continue();
  });

  return {
    scripts: () => [...scripts],
    push: (diff) => {
      state = { ...state, ...diff };
      const message = JSON.stringify({
        jsonrpc: "2.0",
        method: "notify_status_update",
        params: [diff],
      });
      for (const socket of sockets) socket.send(message);
    },
    hold: () => {
      holding = true;
    },
    release: (message) => {
      holding = false;
      for (const { socket, id } of held.splice(0)) {
        reply(socket, id, message ? { error: { code: -1, message } } : { result: "ok" });
      }
    },
    assertSealed: () => {
      expect(escaped, "browser traffic escaped the local fixture").toEqual([]);
    },
  };
}

/** Viewport + boot. `useExperience` stays in the test bodies: the lint rule
 *  reads a lowercase named helper as a plain function, and `useX` inside one
 *  looks like a misplaced React hook. */
async function openDashboard(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.locator(".gauge-dial:visible")).toHaveCount(2);
}

const LED = "output_pin LED";
const chip = (page: Page) => page.locator(".readiness-light");

test.describe("Chamber light control", () => {
  test("the chip is a finger-sized control, and says 'unknown' until the pin reports", async ({
    page,
  }) => {
    await useExperience(page, "basic");
    const mock = await installLightMock(page, [...BASE_OBJECTS, LED]);
    await openDashboard(page);

    const light = chip(page);
    await expect(light).toHaveJSProperty("tagName", "BUTTON");
    // No telemetry for the pin yet: a dash and a tri-state pressed value.
    // "false" here would be a claim the printer has not made.
    await expect(light).toContainText("LIGHT —");
    await expect(light).toHaveAttribute("aria-pressed", "mixed");

    const box = (await light.boundingBox())!;
    expect(box.height, "the light toggle must clear the 44px floor").toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);

    mock.push({ [LED]: { value: 1 } });
    await expect(light).toHaveAttribute("aria-pressed", "true");
    mock.push({ [LED]: { value: 0 } });
    await expect(light).toHaveAttribute("aria-pressed", "false");

    expect(mock.scripts(), "reading the lamp must not write to it").toEqual([]);
    mock.assertSealed();
  });

  test("a tap switches the pin, and claims the new state across the round trip", async ({
    page,
  }) => {
    await useExperience(page, "basic");
    const mock = await installLightMock(page, [...BASE_OBJECTS, LED]);
    await openDashboard(page);

    const light = chip(page);
    await expect(light).toContainText("LIGHT —");

    mock.hold();
    await light.click();
    // Optimistic: the chip commits to ON while the command is still in
    // flight, so a 200ms round trip does not read as a dead control.
    await expect(light).toContainText("LIGHT ON");
    await expect(light).toHaveAttribute("aria-pressed", "true");
    // The chip is its own control — tapping it must not open the disclosure.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    mock.release();
    await expect
      .poll(() => mock.scripts())
      .toEqual(["SET_PIN PIN=LED VALUE=1"]);

    // The printer then confirms, and the claim gives way to the real value.
    mock.push({ [LED]: { value: 1 } });
    await expect(light).toContainText("LIGHT ON");
    await expect(light.locator(".telltale-lamp")).toHaveAttribute("data-lit", "true");

    // …and back off again.
    await light.click();
    await expect.poll(() => mock.scripts()).toEqual([
      "SET_PIN PIN=LED VALUE=1",
      "SET_PIN PIN=LED VALUE=0",
    ]);
    mock.push({ [LED]: { value: 0 } });
    await expect(light).toContainText("LIGHT OFF");
    mock.assertSealed();
  });

  test("a refused command rolls the claim back instead of leaving a lie", async ({
    page,
  }) => {
    await useExperience(page, "basic");
    const mock = await installLightMock(page, [...BASE_OBJECTS, LED]);
    await openDashboard(page);

    const light = chip(page);
    mock.push({ [LED]: { value: 0 } });
    await expect(light).toContainText("LIGHT OFF");

    mock.hold();
    await light.click();
    await expect(light).toContainText("LIGHT ON");

    mock.release("Unknown pin");
    // Rolled back to what the printer actually reported.
    await expect(light).toContainText("LIGHT OFF");
    await expect(light).toHaveAttribute("aria-pressed", "false");
    expect(mock.scripts()).toEqual(["SET_PIN PIN=LED VALUE=1"]);
    mock.assertSealed();
  });

  // Printers without a chamber lamp are the reason the action is object
  // gated. Nothing may reach the wire, and nothing may be claimed.
  test("a printer with no light pin gets no command and no false claim", async ({
    page,
  }) => {
    await useExperience(page, "basic");
    const mock = await installLightMock(page, BASE_OBJECTS);
    await openDashboard(page);

    const light = chip(page);
    await expect(light).toContainText("LIGHT —");
    await light.click();

    await expect(light).toContainText("LIGHT —");
    await expect(light).toHaveAttribute("aria-pressed", "mixed");
    expect(mock.scripts(), "no SET_PIN for a pin this printer lacks").toEqual([]);
    mock.assertSealed();
  });

  test("the disclosure states the browser-only limit rather than implying a guarantee", async ({
    page,
  }) => {
    await useExperience(page, "basic");
    const mock = await installLightMock(page, [...BASE_OBJECTS, LED]);
    await openDashboard(page);

    await page.locator("button.readiness-module").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("only while a Regolith tab is open");
    await expect(dialog).toContainText("ten minutes");
    // The old copy claimed light control did not exist. It does now.
    await expect(dialog).not.toContainText("isn't wired up");
    mock.assertSealed();
  });
});
