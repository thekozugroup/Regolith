/**
 * Active-printer e2e harness.
 *
 * Both pre-existing specs pin an IDLE printer (print_stats.state = "standby",
 * every heater target 0). That left the layouts the owner actually stares at
 * while the machine is hot — MissionTimeline's print-active and tuning
 * branches, the Dial's target index / heating arc, the MissionBar's active
 * readouts — completely unrendered in CI. This module supplies the same
 * strict, fail-on-escape mocking discipline as `instrument-cluster.spec.ts`
 * but lets each test pin a specific live printer state.
 *
 * Strictness rules kept identical to the existing harness:
 *   - any non-GET/HEAD request is recorded as a WRITE and aborted
 *   - any RPC other than `printer.objects.subscribe` closes the socket
 *   - any request that is neither the preview origin nor the mocked camera
 *     is recorded as ESCAPED and aborted
 * Tests assert all three ledgers are empty, so a regression that starts
 * talking to a real printer fails instead of silently reaching the machine.
 */

import { Buffer } from "node:buffer";
import {
  expect,
  type Locator,
  type Page,
  type WebSocketRoute,
} from "@playwright/test";

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";
const CAMERA_PORT = "8080";

/** 1x1 transparent PNG — stands in for gcode thumbnails. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const MOCK_CAMERA_FRAME = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#14191f"/><rect x="500" y="300" width="280" height="180" fill="#222b34" stroke="#5b6876" stroke-width="2"/></svg>`;

export type MockPrinterState = Record<string, unknown>;

/** moonraker-timelapse's stock config, trimmed to what the app reads. */
const TIMELAPSE_SETTINGS: Record<string, unknown> = {
  enabled: false,
  mode: "hyperlapse",
  hyperlapse_cycle: 30,
  autorender: true,
  parkhead: false,
  output_framerate: 30,
  blockedsettings: ["snapshoturl"],
};

/** Klipper objects the K1 Max reports — KAMP is an output pin, not a macro. */
const KLIPPER_OBJECTS = [
  "print_stats",
  "toolhead",
  "virtual_sdcard",
  "gcode_macro START_PRINT",
  "output_pin ADAPTIVE_BED_MESH",
];

export interface ActiveMockOptions {
  /** Live printer objects returned from `printer.objects.subscribe`. */
  state: MockPrinterState;
  /** "absent" simulates an unplugged / missing camera (connection refused). */
  camera?: "ok" | "absent";
  /** Serve a gcode thumbnail so the job panel renders its <img> branch. */
  thumbnail?: boolean;
  /** What `GET /machine/timelapse/settings` reports; "absent" 404s it. */
  timelapseSettings?: Record<string, unknown> | "absent";
  /**
   * Endpoints this test intends to exercise FOR REAL.
   *
   * The default is total seal: every write and every non-subscribe RPC is
   * recorded and aborted. A test that needs to prove what a print start puts
   * on the wire opts in here, and the calls are recorded rather than
   * forwarded — nothing ever reaches a printer either way.
   */
  permit?: {
    /** `printer.objects.list`, `printer.gcode.script`, `printer.print.start`. */
    printStart?: boolean;
    /**
     * `POST /machine/timelapse/settings`. "fail" answers HTTP 500. "hang"
     * records the body and never answers — a socket that accepts and then
     * goes silent, the transport state the write's client-side deadline
     * exists for (a wedged Moonraker cannot be modelled by any HTTP status).
     */
    timelapseWrite?: "ok" | "fail" | "hang";
  };
}

export interface ActiveMock {
  /**
   * Swap the live printer state. Takes effect on the next page load, so the
   * whole scenario matrix runs inside one browser context instead of paying
   * for a fresh route installation per state.
   */
  use: (next: ActiveMockOptions) => void;
  /**
   * Push a live `notify_status_update` diff to every open socket — the same
   * shape Moonraker streams, so mid-session transitions (a lamp trigger, a
   * recovery, a latch release) can be exercised without a reload.
   */
  push: (diff: MockPrinterState) => void;
  /**
   * Push a `notify_timelapse_event` — the moonraker-timelapse plugin's own
   * notification, carrying either `{action:"newframe"}` or `{action:"render"}`.
   */
  pushTimelapse: (event: Record<string, unknown>) => void;
  /**
   * Server-side close of every open socket — simulates a dropped link. The
   * app's own backoff reconnects to the still-installed route.
   */
  dropLink: () => void;
  /** Fails the test if the browser talked to anything outside the fixture. */
  assertSealed: () => void;
  cameraRequests: () => number;
  /** Bodies POSTed to `/machine/timelapse/settings`, in order. */
  timelapseWrites: () => Array<Record<string, unknown>>;
  /** RPC methods permitted and recorded, in order. */
  rpcCalls: () => string[];
}

export async function installActiveMock(
  page: Page,
  initial: ActiveMockOptions,
): Promise<ActiveMock> {
  const writes: string[] = [];
  const escaped: string[] = [];
  const subscriptions: string[] = [];
  const rpcs: string[] = [];
  const timelapseWrites: Array<Record<string, unknown>> = [];
  const sockets = new Set<WebSocketRoute>();
  let cameraRequestCount = 0;
  let options = initial;

  /** RPCs a test has opted into, answered locally and recorded. */
  const permittedRpc = (method: string): unknown | undefined => {
    if (!options.permit?.printStart) return undefined;
    if (method === "printer.objects.list") return { objects: KLIPPER_OBJECTS };
    if (method === "printer.gcode.script" || method === "printer.print.start") {
      return "ok";
    }
    return undefined;
  };

  await page.routeWebSocket("**/websocket", (socket) => {
    sockets.add(socket);
    socket.onClose(() => {
      sockets.delete(socket);
    });
    socket.onMessage((payload) => {
      const request = JSON.parse(String(payload)) as {
        id?: number;
        method?: string;
      };
      if (request.method !== "printer.objects.subscribe") {
        const method = request.method ?? "unknown";
        const permitted = permittedRpc(method);
        if (permitted !== undefined) {
          rpcs.push(method);
          socket.send(
            JSON.stringify({ jsonrpc: "2.0", id: request.id, result: permitted }),
          );
          return;
        }
        writes.push(`rpc:${method}`);
        socket.close({ code: 1008, reason: "Strict mock permits subscriptions only" });
        return;
      }
      subscriptions.push(request.method);
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { status: options.state },
        }),
      );
    });
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    // The one write a test may opt into. It is RECORDED and answered here —
    // never forwarded — so the assertion is about what the app decided to
    // send, and nothing reaches a printer.
    if (
      method === "POST" &&
      url.pathname === "/machine/timelapse/settings" &&
      options.permit?.timelapseWrite
    ) {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      } catch {
        body = { unparseable: request.postData() ?? null };
      }
      timelapseWrites.push(body);
      if (options.permit.timelapseWrite === "hang") {
        // Deliberately unanswered: the request stays pending until the app's
        // own deadline aborts it. Nothing reaches a printer either way.
        return;
      }
      if (options.permit.timelapseWrite === "fail") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "timelapse component failed" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: { ...TIMELAPSE_SETTINGS, ...body },
        }),
      });
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      writes.push(`${method} ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }

    if (url.port === CAMERA_PORT) {
      cameraRequestCount += 1;
      if (options.camera === "absent") {
        await route.abort("connectionrefused");
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: MOCK_CAMERA_FRAME,
      });
      return;
    }

    if (url.origin !== PREVIEW_ORIGIN) {
      escaped.push(request.url());
      await route.abort("blockedbyclient");
      return;
    }

    // Embedded gcode previews. Two shapes reach here: the flat Fluidd guess
    // the Files list row still makes for its 32px tile, and the
    // directory-relative path Moonraker reports in metadata. Withholding
    // both exercises the designed placeholder branches.
    if (
      url.pathname.startsWith("/server/files/gcodes/") &&
      url.pathname.includes("/.thumbs/")
    ) {
      if (!options.thumbnail) {
        await route.fulfill({ status: 404, body: "no thumbnail" });
        return;
      }
      await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
      return;
    }

    // File metadata. Only the `thumbnails` list is answered: MissionTimeline
    // asks what previews a file HAS rather than probing a guessed path, so
    // this fixture is what decides whether its <img> branch renders.
    // `estimated_time` is deliberately absent — supplying one would quietly
    // change every calibrated remaining-time assertion in the suite.
    if (url.pathname === "/server/files/metadata") {
      const filename = url.searchParams.get("filename") ?? "";
      const base = filename.split("/").pop()?.replace(/\.gcode$/i, "") ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: options.thumbnail
            ? {
                thumbnails: [
                  {
                    width: 300,
                    height: 300,
                    size: 1,
                    relative_path: `.thumbs/${base}-300x300.png`,
                  },
                ],
              }
            : {},
        }),
      });
      return;
    }

    // moonraker-timelapse's config. Present on this printer; a host without
    // the component is simulated with "absent", which 404s exactly as the
    // real Moonraker does.
    if (url.pathname === "/machine/timelapse/settings") {
      if (options.timelapseSettings === "absent") {
        await route.fulfill({ status: 404, body: "timelapse component not loaded" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: { ...TIMELAPSE_SETTINGS, ...(options.timelapseSettings ?? {}) },
        }),
      });
      return;
    }

    if (url.pathname === "/printer/info") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            hostname: "forge",
            software_version: "v0.12.0-345-g1a2b3c4",
            state: "ready",
            state_message: "Printer is ready",
          },
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

    await route.continue();
  });

  return {
    use: (next) => {
      options = next;
    },
    push: (diff) => {
      const message = JSON.stringify({
        jsonrpc: "2.0",
        method: "notify_status_update",
        params: [diff],
      });
      for (const socket of sockets) socket.send(message);
    },
    pushTimelapse: (event) => {
      const message = JSON.stringify({
        jsonrpc: "2.0",
        method: "notify_timelapse_event",
        params: [event],
      });
      for (const socket of sockets) socket.send(message);
    },
    dropLink: () => {
      for (const socket of sockets) {
        socket.close({ code: 1001, reason: "fixture link drop" });
      }
      sockets.clear();
    },
    cameraRequests: () => cameraRequestCount,
    timelapseWrites: () => timelapseWrites,
    rpcCalls: () => rpcs,
    assertSealed: () => {
      expect(escaped, "browser traffic escaped the local fixture").toEqual([]);
      expect(writes, "test attempted a printer write or non-subscribe RPC").toEqual([]);
      expect(subscriptions.length, "printer state was never subscribed").toBeGreaterThan(0);
    },
  };
}

/** Pin the experience mode before the app boots. */
export async function useExperience(page: Page, mode: "basic" | "expert") {
  await page.addInitScript((value) => {
    localStorage.setItem("forge.experience-mode", value);
  }, mode);
}

/**
 * Read a panel's visible text as authored.
 *
 * `innerText` is wrong for this UI on two counts: it applies the
 * `text-transform: uppercase` on `.instrument-label`, and it concatenates
 * adjacent inline spans with no separator (`SET220°`). This walks the text
 * nodes instead, skips hidden subtrees, and joins with single spaces — so
 * assertions read like the label/value pairs the owner sees.
 */
export async function readPanelText(locator: Locator): Promise<string> {
  const raw = await locator.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      const element = node.parentElement;
      node = walker.nextNode();
      if (!element || !text.trim()) continue;
      if (element.closest("script, style")) continue;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      parts.push(text.trim());
    }
    return parts.join(" ");
  });
  return raw.replace(/\s+/g, " ").trim();
}

/* -------------------------------------------------------------------------
 * Owner-trust audits — what has to hold before the owner can believe the
 * screen while the nozzle is hot.
 * ---------------------------------------------------------------------- */

/**
 * No raw JS placeholder ever reaches the glass, in ANY state. A dial reading
 * `NaN°C`, a job row reading `undefined / 250`, or a layer row reading
 * `null / null` is worse than no reading at all: it looks like telemetry.
 *
 * Text nodes, `title`, and the accessible-name attributes are all scanned.
 * `title` is the owner's only way to read a truncated filename, and a screen
 * reader user hearing "Remaining undefined" is misled exactly as badly as a
 * sighted one reading it — the aria surfaces have to be held to the same bar.
 */
export async function assertNoBrokenReadouts(page: Page, label: string) {
  const offenders = await page.evaluate(() => {
    const broken = /(?:^|[^\w-])(NaN|undefined|null|Infinity)(?:[^\w-]|$)/;
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      const element = node.parentElement;
      node = walker.nextNode();
      if (!text.trim() || !element) continue;
      if (element.closest("script, style")) continue;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (broken.test(text) || text.includes("[object Object]")) {
        found.push(`<${element.tagName.toLowerCase()}> "${text.trim().slice(0, 120)}"`);
      }
    }
    for (const attribute of ["title", "aria-label", "aria-description", "alt"]) {
      for (const element of document.querySelectorAll(`[${attribute}]`)) {
        const value = element.getAttribute(attribute) ?? "";
        if (broken.test(value) || value.includes("[object Object]")) {
          found.push(`${attribute}="${value.slice(0, 120)}"`);
        }
      }
    }
    return found;
  });
  expect(offenders, `${label}: raw JS placeholders reached the screen:\n${offenders.join("\n")}`).toEqual([]);
}

/**
 * Dials stay honest: never below the 148px floor (the `.dial-slot` container
 * query is supposed to hand off to the bar renderer instead), and never
 * carrying SVG <text>, which scales with the viewBox and would slip under the
 * 11px legibility gate unnoticed. Segment strips share the <text> gate —
 * SegmentGauge's SVG is geometry only, every readout is HTML (they need no
 * width floor: segments degrade gracefully, that is their point).
 */
export async function assertDialFloor(page: Page, label: string) {
  const dishonest = await page.locator(".gauge-dial, .segment-gauge").evaluateAll((items) =>
    items.flatMap((item) => {
      const issues: string[] = [];
      const isDial = item.classList.contains("gauge-dial");
      const svgText = item.querySelectorAll("text").length;
      if (svgText > 0) {
        issues.push(`${isDial ? "dial" : "segment gauge"} contains ${svgText} SVG <text> node(s)`);
      }
      if (!isDial) return issues;
      const box = item.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && box.width < 148) {
        issues.push(
          `dial rendered at ${box.width.toFixed(1)}px — below the 148px floor instead of falling back to the bar renderer`,
        );
      }
      return issues;
    }),
  );
  expect(dishonest, `${label}: dial integrity`).toEqual([]);
}

/**
 * The mission bar is the cockpit's bottom status strip. It must exist on
 * every route, span the full viewport width, sit pinned to the bottom edge —
 * and on compact chrome it must stack DIRECTLY ABOVE the bottom nav: no
 * overlap (the nav stays tappable) and no gap (no dead glass between them).
 */
export async function assertMissionBarPlacement(page: Page, label: string) {
  const geometry = await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('section[aria-label="Printer status"]');
    if (!bar) return null;
    const barBox = bar.getBoundingClientRect();
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Mobile primary"]');
    const navVisible = !!nav && getComputedStyle(nav).display !== "none";
    return {
      left: barBox.left,
      right: barBox.right,
      bottom: barBox.bottom,
      height: barBox.height,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: window.innerHeight,
      navVisible,
      navTop: navVisible ? nav.getBoundingClientRect().top : null,
    };
  });
  expect(geometry, `${label}: mission bar must exist`).not.toBeNull();
  if (!geometry) return;
  expect(geometry.height, `${label}: mission bar must have height`).toBeGreaterThan(0);
  expect(geometry.left, `${label}: mission bar must reach the left edge`).toBeLessThanOrEqual(0.5);
  expect(
    geometry.right,
    `${label}: mission bar must reach the right edge (full width)`,
  ).toBeGreaterThanOrEqual(geometry.viewportWidth - 0.5);
  const restingEdge = geometry.navVisible ? geometry.navTop! : geometry.viewportHeight;
  expect(
    geometry.bottom,
    `${label}: mission bar must not overlap the ${geometry.navVisible ? "bottom nav" : "viewport edge"}`,
  ).toBeLessThanOrEqual(restingEdge + 0.5);
  expect(
    restingEdge - geometry.bottom,
    `${label}: mission bar must sit flush against the ${geometry.navVisible ? "bottom nav" : "bottom edge"} (pinned, no gap)`,
  ).toBeLessThanOrEqual(1);
}

export async function assertNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label}: page has horizontal overflow`).toBeLessThanOrEqual(1);
}

/** Every rendered glyph stays at or above the 11px legibility floor. */
export async function assertTextFloor(page: Page, label: string) {
  const undersized = await page.locator("body *").evaluateAll((items) =>
    items.flatMap((item) => {
      if (item.closest("svg") || item.getAttribute("aria-hidden") === "true") return [];
      const style = getComputedStyle(item);
      const box = item.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        box.width === 0 ||
        box.height === 0
      ) {
        return [];
      }
      const directText = Array.from(item.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      const fontSize = Number.parseFloat(style.fontSize);
      if (!directText || fontSize >= 11) return [];
      return [`<${item.tagName.toLowerCase()}> "${directText.slice(0, 60)}" @ ${style.fontSize}`];
    }),
  );
  expect(undersized, `${label}: text below the 11px floor:\n${undersized.join("\n")}`).toEqual([]);
}

/** Every visible control stays finger-sized. */
export async function assertTouchTargets(page: Page, label: string) {
  const undersized = await page
    .locator("button:visible, a:visible, input:visible, select:visible, textarea:visible")
    .evaluateAll((items) =>
      items
        .filter((item) => {
          const box = item.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
        })
        .map((item) => item.getAttribute("aria-label") || item.textContent?.trim() || item.tagName),
    );
  expect(undersized, `${label}: controls below the 44px touch target`).toEqual([]);
}

/**
 * DOM order follows the mobile task order and must not reshuffle when a job
 * goes active: "is it OK?" (status rail) → "what is it doing?" (job) →
 * "how hot?" (thermals) → "show me" (camera) → details (readiness).
 */
export async function assertDashboardTaskOrder(page: Page, label: string) {
  const order = await page.evaluate(() => {
    const byHeading = (text: string) =>
      [...document.querySelectorAll("main h2, main .instrument-label")].find(
        (node) => node.textContent?.trim() === text,
      ) ?? null;
    const anchors: Array<[string, Element | null]> = [
      ["status rail", document.querySelector('section[aria-label="Printer status"]')],
      ["job", byHeading("Mission Status")],
      ["thermals", byHeading("Thermals")],
      ["camera", byHeading("Camera")],
      ["readiness", byHeading("Readiness")],
    ];
    const missing = anchors.filter(([, node]) => !node).map(([name]) => `missing:${name}`);
    if (missing.length) return missing;
    const out: string[] = [];
    for (let i = 0; i < anchors.length - 1; i += 1) {
      const [nameA, a] = anchors[i];
      const [nameB, b] = anchors[i + 1];
      const following = a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING;
      if (!following) out.push(`${nameB} precedes ${nameA} in the DOM`);
    }
    return out;
  });
  expect(order, `${label}: dashboard DOM task order`).toEqual([]);
}

/** The full owner-trust sweep applied to every active-state scenario. */
export async function assertOwnerTrust(page: Page, label: string) {
  await expect(page.locator("h1"), `${label}: exactly one h1`).toHaveCount(1);
  await expect(
    page.getByRole("status", { name: "Loading view…" }),
    `${label}: route never settled`,
  ).toHaveCount(0);
  await assertNoBrokenReadouts(page, label);
  await assertDialFloor(page, label);
  await assertNoHorizontalOverflow(page, label);
  await assertTextFloor(page, label);
  await assertTouchTargets(page, label);
  await assertDashboardTaskOrder(page, label);
  await assertMissionBarPlacement(page, label);
  await expect(page.locator(".gauge-dial:visible"), `${label}: both dials must render`).toHaveCount(2);
}
