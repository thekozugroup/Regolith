/**
 * Host-health guard — lamp, pre-print advisory, and shutdown legibility.
 *
 * Two prints died on 2026-08-12 to host starvation that surfaced as timer /
 * probe errors. The guard reads `notify_proc_stat_update` — traffic the
 * client already receives ~1 Hz as its link heartbeat — so these tests
 * drive the SAME notification through the sealed fixture and assert:
 *
 *   · the HOST LOAD lamp's full lifecycle: dark on an unknown host, lit
 *     with the tripping number after sustained pressure, LATCHED once the
 *     pressure clears, cleared by the standard acknowledge affordance;
 *   · the pre-print advisory: it warns on a loaded idle host, it is
 *     dismissible, and — THE LAW — it can never block a print: the Start
 *     button ignores it and printer.print.start still goes on the wire
 *     with the warning on screen;
 *   · the shutdown explainer: a scheduling/timeout shutdown renders the
 *     plain-language "timing fault, not hardware" text (with the load
 *     frozen at the fault when recorded, and an honest "not recorded"
 *     otherwise), the prtouch wording arriving as a gcode response gets
 *     the probe-is-the-messenger variant, and genuine hardware faults are
 *     NEVER claimed to be starvation.
 *
 * Time is driven with Playwright's fake clock: the triggers need tens of
 * 1 Hz samples over median windows, which real time cannot afford in CI
 * and mocked time makes exact.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  installActiveMock,
  useExperience,
  type ActiveMock,
} from "./support/active-state-harness";
import { scenario } from "./support/printer-scenarios";

const MEM_OK = { memAvailKb: 133_120, memTotalKb: 253_952 };

const GCODE_FILE = {
  path: "benchy_0.2mm_PLA.gcode",
  size: 1_234_567,
  modified: 1_700_000_000,
  permissions: "rw",
};

/** Local REST fixtures for the Files page (same shape files-page.spec uses). */
async function fulfilFileApi(page: Page) {
  await page.route("**/server/files/list*", async (route) => {
    const root = new URL(route.request().url()).searchParams.get("root");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: root === "gcodes" ? [GCODE_FILE] : [] }),
    });
  });
  await page.route("**/server/files/metadata*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { estimated_time: 3_600, layer_count: 100, layer_height: 0.2 },
      }),
    });
  });
  await page.route("**/server/history/list*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: { jobs: [] } }),
    });
  });
  await page.route("**/server/history/totals", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          job_totals: { total_jobs: 0, total_time: 0, total_filament_used: 0, longest_job: 0 },
        },
      }),
    });
  });
}

async function openSystems(page: Page) {
  await page.goto("/");
  await expect(
    page.locator("main").getByRole("heading", { name: "Systems", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
}

/** Push `count` proc-stat samples `stepMs` apart on the mocked clock. */
async function sustainLoad(
  page: Page,
  mock: ActiveMock,
  cpu: number,
  count: number,
  stepMs = 1_500,
) {
  for (let i = 0; i < count; i += 1) {
    mock.pushProcStat({ cpu, ...MEM_OK });
    // Real-time beat so the socket message lands before the clock jumps.
    await page.waitForTimeout(15);
    await page.clock.fastForward(stepMs);
  }
}

const hostLamp = (page: Page) =>
  page.locator('.telltale-cell[data-lamp="host-load"]');

test.describe("HOST LOAD tell-tale", () => {
  test("dark on an unknown host, lit with the tripping number under sustained pressure, latched after it clears, acknowledged by the cell", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    await page.clock.install();
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await openSystems(page);
    await page.clock.fastForward(1_000); // bulb test released

    // Honest-unknown: no proc-stat data has arrived → the lamp exists and
    // is DARK. An unknown host never produces a warning.
    await expect(hostLamp(page)).toHaveAttribute("data-lit", "false");

    // A short burst at 95% is NOT sustained pressure — the median window
    // needs its full sample budget, so the lamp must stay dark.
    await sustainLoad(page, mock, 95, 10);
    await expect(hostLamp(page)).toHaveAttribute("data-lit", "false");

    // Sustained: ~68 s of ≥ 85% median. The lamp lights as a WARNING (a
    // busy host is a risk, not a fault) and the detail line carries the
    // number that tripped it — the non-colour channel.
    await sustainLoad(page, mock, 92, 45);
    await expect(hostLamp(page)).toHaveAttribute("data-lit", "true");
    await expect(hostLamp(page)).toHaveAttribute("data-severity", "warning");
    await expect(hostLamp(page)).toHaveAttribute("data-phase", "on");
    // "median" is in the copy because that is what the number is: a median
    // over the readings inside the 60 s window, not a level held for 60 s.
    await expect(hostLamp(page).locator(".telltale-detail")).toHaveText(
      "CPU 92% median · 60s",
    );

    // Pressure clears. THE POINT OF THE LAMP: the spike that kills a print
    // is over by the time the owner reads the error, so the lamp LATCHES
    // instead of going dark at exactly the moment it matters.
    await sustainLoad(page, mock, 6, 50);
    await expect(hostLamp(page)).toHaveAttribute("data-phase", "latched");
    await expect(hostLamp(page)).toHaveAttribute("data-lit", "true");
    // The latched cell is the acknowledge affordance, labelled as such, and
    // still says WHY it tripped.
    const ack = page.getByRole("button", { name: "Acknowledge Host Load" });
    await expect(ack).toBeVisible();
    await expect(hostLamp(page).locator(".telltale-detail")).toContainText(
      "CPU",
    );

    // Acknowledge with the condition clear → dark.
    await ack.click();
    await expect(hostLamp(page)).toHaveAttribute("data-phase", "off");
    await expect(hostLamp(page)).toHaveAttribute("data-lit", "false");

    mock.assertSealed();
  });

  test("a proc-stat feed with no CPU field stays honest-unknown — never a warning, never a zero", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    await page.clock.install();
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await openSystems(page);
    await page.clock.fastForward(1_000);

    // An older Moonraker shape: memory only, no system_cpu_usage.
    for (let i = 0; i < 45; i += 1) {
      mock.pushProcStat({ ...MEM_OK });
      await page.waitForTimeout(5);
      await page.clock.fastForward(1_500);
    }
    await expect(hostLamp(page)).toHaveAttribute("data-lit", "false");
    await expect(hostLamp(page).locator(".telltale-detail")).toHaveCount(0);

    mock.assertSealed();
  });
});

test.describe("Pre-print host advisory — advisory only, never a gate", () => {
  test("warns on a loaded idle host with the measured number — and the print STILL starts", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    await page.clock.install();
    const mock = await installActiveMock(page, {
      ...scenario("at-temperature"),
      permit: { printStart: true, timelapseWrite: "ok" },
    });
    await fulfilFileApi(page);

    await page.goto("/print");
    const row = page.getByRole("button", { name: /benchy_0\.2mm_PLA\.gcode/ });
    await expect(row).toBeVisible();

    // ~40 s of 74% CPU on a printer that is doing nothing — enough that the
    // 30 s advisory window stays saturated through the UI clicks below.
    await sustainLoad(page, mock, 74, 40, 1_000);

    await row.click();
    await page.getByRole("button", { name: "Start print" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const advisory = dialog.getByTestId("host-load-advisory");
    await expect(advisory).toBeVisible();
    await expect(advisory).toContainText("Host busy");
    await expect(advisory).toContainText("74% CPU");
    await expect(advisory).toContainText("heads-up, not a block");
    // The disclosure to the load-shedding runbook is present.
    await expect(advisory).toContainText("What to stop");

    // THE LAW: the advisory is wired to NOTHING. With the warning still on
    // screen, the acknowledge checkbox alone enables Start — no extra
    // confirm, no override step — and the start reaches the wire.
    await dialog
      .getByRole("checkbox", { name: /build plate is seated/ })
      .click();
    const start = dialog.getByRole("button", { name: "Start print" });
    await expect(start).toBeEnabled();
    await expect(advisory).toBeVisible();
    await start.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(mock.rpcCalls()).toContain("printer.print.start");

    mock.assertSealed();
  });

  test("dismissible for the dialog's lifetime; a quiet host never warns", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    await page.clock.install();
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await fulfilFileApi(page);

    await page.goto("/print");
    const row = page.getByRole("button", { name: /benchy_0\.2mm_PLA\.gcode/ });
    await expect(row).toBeVisible();

    // A quiet host first: ~40 s at 12% — far under every bar. No warning.
    await sustainLoad(page, mock, 12, 40, 1_000);
    await row.click();
    await page.getByRole("button", { name: "Start print" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("host-load-advisory")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close print confirmation" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Now load the host and reopen: the advisory appears and the standard
    // dismiss affordance clears it without touching anything else.
    await sustainLoad(page, mock, 88, 40, 1_000);
    await row.click();
    await page.getByRole("button", { name: "Start print" }).click();
    const dialog2 = page.getByRole("dialog");
    const advisory = dialog2.getByTestId("host-load-advisory");
    await expect(advisory).toBeVisible();
    // 88% median crosses the strong bar: the wording escalates.
    await expect(advisory).toContainText("Host heavily loaded");
    await dialog2
      .getByRole("button", { name: "Dismiss host load warning" })
      .click();
    await expect(advisory).toHaveCount(0);

    mock.assertSealed();
  });

  test("a throw on the advisory path can never take the Start button with it", async ({
    page,
  }) => {
    // /print is the ONLY route in the app that starts a print, and it renders
    // inside the shared RouteErrorBoundary. Before the local boundary, a
    // throw anywhere on this optional advisory's path blanked the page — an
    // advisory removing the control it advises about.
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, {
      ...scenario("at-temperature"),
      permit: { printStart: true, timelapseWrite: "ok" },
    });
    await fulfilFileApi(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("forge.debug.crash", "host-load-advisory");
    });

    await page.goto("/print");
    const row = page.getByRole("button", { name: /benchy_0\.2mm_PLA\.gcode/ });
    await expect(row).toBeVisible();
    await row.click();
    await page.getByRole("button", { name: "Start print" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Contained and NAMED — not a silent hole, and not a printer fault.
    await expect(
      dialog.locator('[data-chrome-failed="host-load-advisory"]'),
    ).toBeVisible();
    // THE POINT: the print path is untouched. Acknowledge, start, on the wire.
    await dialog
      .getByRole("checkbox", { name: /build plate is seated/ })
      .click();
    const start = dialog.getByRole("button", { name: "Start print" });
    await expect(start).toBeEnabled();
    await start.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(mock.rpcCalls()).toContain("printer.print.start");

    mock.assertSealed();
  });
});

test.describe("Shutdown legibility — naming the real cause", () => {
  test("a scheduling shutdown gets the timing-fault explainer; with no samples the context is honestly 'not recorded'", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await openSystems(page);

    // Klipper dies mid-session with the 17:54 wording. No proc-stat sample
    // ever arrived, so the frozen context has nothing — and must say so
    // rather than inventing zeros.
    mock.push({
      webhooks: {
        state: "shutdown",
        state_message:
          "MCU 'mcu' shutdown: Missed scheduling of next digital out event\nOnce the underlying issue is corrected, use the FIRMWARE_RESTART command.",
      },
    });

    const alert = page.locator('[data-alert-id="host-starvation-shutdown"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(
      "This is a timing fault, not a hardware fault.",
    );
    await expect(alert).toContainText(
      "Missed scheduling of next digital out event",
    );
    await expect(alert).toContainText(
      "Host load at the moment of the fault: not recorded.",
    );
    await expect(alert).toContainText("Load shedding before a long print");
    // The generic FIRMWARE lamp still carries the raw message — the alert
    // interprets, it does not replace.
    await expect(
      page.locator('.telltale-cell[data-lamp="firmware"]'),
    ).toHaveAttribute("data-lit", "true");

    mock.assertSealed();
  });

  test("the prtouch wording arriving as a GCODE RESPONSE gets the probe-is-the-messenger text with the load frozen at the fault", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    await page.clock.install();
    const mock = await installActiveMock(page, scenario("printing-midjob"));
    await openSystems(page);

    // A starved host: ~60 s of 97% CPU with memory collapsing.
    for (let i = 0; i < 60; i += 1) {
      mock.pushProcStat({ cpu: 97, memAvailKb: 41_984, memTotalKb: 253_952 });
      await page.waitForTimeout(5);
      await page.clock.fastForward(1_000);
    }

    // Incident 2's actual shape: the probe error arrives as a gcode
    // response; state_message carries only a generic shutdown.
    mock.pushGcode(
      "!! Unable to obtain 'result_deal_avgs_prtouch' response",
    );
    mock.push({
      webhooks: { state: "shutdown", state_message: "Printer is shutdown" },
    });

    const alert = page.locator('[data-alert-id="host-starvation-shutdown"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(
      "The probe is the messenger, not the fault.",
    );
    await expect(alert).toContainText("result_deal_avgs_prtouch");
    await expect(alert).toContainText("Do not start by replacing the probe.");
    // Context is FROZEN at the fault, from real samples: CPU and memory
    // rendered, unknown channels omitted (no motion_report subscribed →
    // no invented buffer figure).
    const context = alert.getByTestId("host-starvation-context");
    await expect(context).toContainText("Host at the moment of the fault:");
    await expect(context).toContainText("CPU 97% (60 s average)");
    await expect(context).toContainText("41 MB memory free");
    await expect(context).not.toContainText("motion buffer");

    mock.assertSealed();
  });

  test("genuine hardware faults are NEVER claimed to be starvation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await openSystems(page);

    // A real heater fault…
    mock.push({
      webhooks: {
        state: "shutdown",
        state_message: "Heater extruder not heating at expected rate",
      },
    });
    await expect(
      page.locator('.telltale-cell[data-lamp="firmware"]'),
    ).toHaveAttribute("data-lit", "true");
    await expect(
      page.locator('[data-alert-id="host-starvation-shutdown"]'),
    ).toHaveCount(0);

    // …and the deliberately-excluded MCU-link wording (often a cable).
    mock.push({
      webhooks: {
        state: "shutdown",
        state_message: "Lost communication with MCU 'mcu'",
      },
    });
    await expect(
      page.locator('[data-alert-id="host-starvation-shutdown"]'),
    ).toHaveCount(0);

    mock.assertSealed();
  });

  test("an unanswered HANDSHAKE query points at the cable, not at host load", async ({
    page,
  }) => {
    // `Unable to obtain '<name>' response` was matched wholesale, so this —
    // the connect handshake going unanswered, i.e. the dead-board signature —
    // rendered "This is a timing fault, not a hardware fault." That sends
    // someone away from a real fault on a machine with 255 °C heaters.
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await openSystems(page);

    mock.push({
      webhooks: {
        state: "shutdown",
        state_message: "Unable to obtain 'identify' response",
      },
    });

    await expect(
      page.locator('[data-alert-id="host-starvation-shutdown"]'),
    ).toHaveCount(0);
    const alert = page.locator('[data-alert-id="host-mcu-comms-shutdown"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("The mainboard did not answer.");
    await expect(alert).toContainText("data cable");
    // And it must not repeat the probe claim over an unrelated query.
    await expect(alert).not.toContainText("strain-gauge probe");

    mock.assertSealed();
  });

  test("an unrecognised query is CAUSE UNCLEAR — Regolith declines to guess", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await openSystems(page);

    mock.push({
      webhooks: {
        state: "shutdown",
        state_message: "Unable to obtain 'some_unknown_query' response",
      },
    });

    const alert = page.locator('[data-alert-id="host-shutdown-unclear"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("the cause is unclear");
    await expect(alert).toContainText("some_unknown_query");
    await expect(
      page.locator('[data-alert-id="host-starvation-shutdown"]'),
    ).toHaveCount(0);

    mock.assertSealed();
  });

  test("a hardware fault standing next to a STALE starvation line stays a hardware fault", async ({
    page,
  }) => {
    // The console ring holds 200 lines and is never cleared. A genuine ADC
    // shutdown with an old timer line still in the scrollback classified as
    // starvation, because the gcode arm was allowed to outvote state_message.
    await page.setViewportSize({ width: 1280, height: 900 });
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, scenario("at-temperature"));
    await openSystems(page);

    mock.pushGcode("!! Rescheduled timer in the past");
    mock.push({
      webhooks: {
        state: "shutdown",
        state_message:
          "ADC out of range\nThis generally occurs when a heater sensor is malfunctioning.",
      },
    });

    await expect(
      page.locator('.telltale-cell[data-lamp="firmware"]'),
    ).toHaveAttribute("data-lit", "true");
    await expect(
      page.locator('[data-alert-id="host-starvation-shutdown"]'),
    ).toHaveCount(0);

    mock.assertSealed();
  });
});
