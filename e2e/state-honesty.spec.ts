/**
 * State honesty — the UI must never assert something about the machine that
 * is not true.
 *
 * Every case here pins a printer that has answered `printer.objects.subscribe`
 * but has NOT yet reported the object the readout depends on. That is the
 * exact window in which the old `?? 0.04` / `?? 1` / `?? [0,0,0,0]` defaults
 * fired, turning UNKNOWN into a confident readout. On a printer-control app
 * that is the highest-severity class of defect there is: the pressure-advance
 * case did not merely mislead, it wrote the invented number to the hardware.
 *
 * The harness is the strict one — any write, any non-subscribe RPC, or any
 * request leaving the fixture fails the test — so "the UI stayed quiet" can
 * never be confused with "the UI silently talked to a real printer".
 */

import { expect, test, type Page } from "@playwright/test";
import { installActiveMock, useExperience } from "./support/active-state-harness";

/**
 * Klipper is READY and the socket is live — but `extruder`, `toolhead`,
 * `gcode_move` and `motion_report` have not arrived. Nothing here is
 * "broken"; these values are simply not known yet.
 */
const TELEMETRY_BLIND = {
  webhooks: { state: "ready", state_message: "Printer is ready" },
  idle_timeout: { state: "Ready" },
  print_stats: {
    state: "standby",
    filename: "",
    total_duration: 0,
    print_duration: 0,
    filament_used: 0,
    message: "",
  },
  virtual_sdcard: { progress: 0, is_active: false, file_position: 0, file_size: 0 },
  heater_bed: { temperature: 25.9, target: 0, power: 0 },
  display_status: { progress: 0, message: "" },
  fan: { speed: 0 },
};

async function openBlind(page: Page, route: string, ready: string | RegExp) {
  const mock = await installActiveMock(page, { state: TELEMETRY_BLIND });
  await page.goto(route);
  await expect(
    page.locator("main").getByRole("heading", { name: ready }),
  ).toBeVisible({ timeout: 15_000 });
  return mock;
}

test.describe("State honesty — unknown machine values are never invented", () => {
  test("pressure advance is unknown, not 0.04, and cannot be applied", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await useExperience(page, "expert");
    const mock = await openBlind(page, "/tune", "Pressure Advance");

    const readout = page.locator("[data-pa-known]");
    await expect(readout).toHaveAttribute("data-pa-known", "false");
    // The single most important assertion in this file: the plausible
    // default must not appear anywhere in the card.
    await expect(readout).toHaveText("—");
    await expect(readout).not.toContainText("0.04");

    const slider = page.getByRole("slider", { name: /Pressure advance/i });
    await expect(slider).toBeDisabled();
    await expect(slider).toHaveAttribute("aria-valuetext", "Unknown");

    // No control may exist that would send a fabricated value.
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Apply & Save" })).toBeDisabled();

    // And the hint says so in words rather than printing a number.
    await expect(page.getByText(/Current: unknown/i)).toBeVisible();

    // Nothing was written to the printer.
    mock.assertSealed();
  });

  test("a known pressure advance re-enables the control and reads the real value", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await useExperience(page, "expert");
    const mock = await installActiveMock(page, {
      state: {
        ...TELEMETRY_BLIND,
        extruder: { temperature: 27.4, target: 0, power: 0, pressure_advance: 0.0325 },
      },
    });
    await page.goto("/tune");
    await expect(
      page.locator("main").getByRole("heading", { name: "Pressure Advance" }),
    ).toBeVisible({ timeout: 15_000 });

    const readout = page.locator("[data-pa-known]");
    await expect(readout).toHaveAttribute("data-pa-known", "true");
    await expect(readout).toHaveText("0.0325 s");
    await expect(page.getByRole("slider", { name: /Pressure advance/i })).toBeEnabled();
    mock.assertSealed();
  });

  test("speed and flow factors read unknown in BASIC mode, never a nominal 100%", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // BASIC is the default and the mode these strips are visible in — the
    // old `?? 1` lit a confident 100% for every casual user.
    await useExperience(page, "basic");
    const mock = await openBlind(page, "/", "Telemetry");

    for (const label of ["Speed Factor", "Flow Factor"]) {
      const strip = page.getByRole("img", { name: new RegExp(`^${label} `) });
      await expect(strip).toHaveAttribute(
        "aria-label",
        `${label} unavailable`,
      );
      await expect(strip).not.toContainText("100%");
      await expect(strip).toContainText("—");
    }
    mock.assertSealed();
  });

  test("a real gcode_move restores the factor readouts", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await useExperience(page, "basic");
    const mock = await installActiveMock(page, {
      state: {
        ...TELEMETRY_BLIND,
        gcode_move: {
          position: [0, 0, 0, 0],
          gcode_position: [0, 0, 0, 0],
          speed: 3_000,
          speed_factor: 1,
          extrude_factor: 0.95,
          homing_origin: [0, 0, 0, 0],
        },
      },
    });
    await page.goto("/");
    await expect(
      page.locator("main").getByRole("heading", { name: "Telemetry" }),
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByRole("img", { name: /^Speed Factor / }),
    ).toContainText("100%");
    await expect(
      page.getByRole("img", { name: /^Flow Factor / }),
    ).toContainText("95%");
    mock.assertSealed();
  });

  test("toolhead position reads em-dash, not a confident 0.00", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await useExperience(page, "expert");
    const mock = await openBlind(page, "/control", "Toolhead");

    const toolhead = page
      .locator("main section.instrument-panel")
      .filter({ has: page.getByRole("heading", { name: "Toolhead", exact: true }) });
    // The `?? [0,0,0,0]` default made every one of these guards unreachable.
    await expect(toolhead.getByText("0.00", { exact: true })).toHaveCount(0);
    await expect(toolhead.getByText("—", { exact: true })).toHaveCount(3);
    mock.assertSealed();
  });

  test("the bed view parks the toolhead marker instead of pinning it to the origin", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await useExperience(page, "expert");
    const mock = await installActiveMock(page, {
      state: {
        ...TELEMETRY_BLIND,
        // Homed, but the position itself has not arrived — the one state in
        // which a marker at 0,0 would be a confident lie.
        toolhead: {
          homed_axes: "xyz",
          print_time: 0,
          estimated_print_time: 0,
          max_velocity: 600,
          max_accel: 20_000,
          axis_minimum: [-2, -2, -10, 0],
          axis_maximum: [306.5, 306, 305, 0],
        },
      },
    });
    await page.goto("/control");
    await expect(
      page.locator("main").getByRole("heading", { name: "Toolhead", exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText("Position unknown")).toBeVisible();
    mock.assertSealed();
  });
});

test.describe("State honesty — a control means what it says", () => {
  test("the console Clear button clears the view and does not reload the page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await useExperience(page, "expert");
    const mock = await openBlind(page, "/console", "Console");

    const clear = page.getByRole("button", { name: "Clear" });
    // Label, tooltip and behaviour must agree. It used to be labelled
    // "Clear", titled "Refresh", drawn as a bin, and wired to reload().
    await expect(clear).toHaveAttribute("title", "Clear the console view");

    // A reload would wipe this marker — and, on the real page, the user's
    // unsent command and their armed expert mode along with it.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__regolithNoReload = true;
    });
    // With an empty log the control is honestly unavailable rather than
    // pretending there is something to clear.
    await expect(clear).toBeDisabled();
    await expect(page.getByText("Waiting for klipper output…")).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>).__regolithNoReload,
      ),
    ).toBe(true);
    mock.assertSealed();
  });

  test("the busy CTA reads as English, never 'Print printing'", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const mock = await installActiveMock(page, {
      state: {
        ...TELEMETRY_BLIND,
        idle_timeout: { state: "Printing" },
        print_stats: {
          state: "printing",
          filename: "a.gcode",
          total_duration: 100,
          print_duration: 90,
          filament_used: 10,
          message: "",
        },
      },
    });
    await page.goto("/print");
    await expect(
      page.locator("main").getByRole("heading", { name: "Files", exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.locator("main")).not.toContainText("Print printing");
    await expect(page.locator("main")).toContainText("Printing now");
    mock.assertSealed();
  });
});

test.describe("State honesty — non-visual channels carry the same truth", () => {
  test("a degenerate bed mesh renders the empty state, never Infinity or NaN", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await useExperience(page, "expert");
    const mock = await installActiveMock(page, { state: TELEMETRY_BLIND });
    // Registered after the harness, so this handler wins. `[[]]` survives a
    // plain length check and then poisons Math.min / the mean.
    await page.route("**/printer/objects/query**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            status: {
              bed_mesh: { profile_name: "default", probed_matrix: [[]], mesh_matrix: [[]] },
            },
          },
        }),
      });
    });
    await page.goto("/tune");
    // Tune has two "Bed Mesh" headings — the calibration action group and
    // the heat map card. The heat map is the last of the pair.
    const mesh = page
      .locator("main section.instrument-panel")
      .filter({ has: page.getByRole("heading", { name: "Bed Mesh" }) })
      .last();
    await expect(mesh).toBeVisible({ timeout: 15_000 });
    await expect(mesh).not.toContainText("Infinity");
    await expect(mesh).not.toContainText("NaN");
    await expect(mesh).toContainText("No mesh saved");
    mock.assertSealed();
  });

  test("a real mesh carries a non-visual table with the true min, max and range", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await useExperience(page, "expert");
    const mock = await installActiveMock(page, { state: TELEMETRY_BLIND });
    await page.route("**/printer/objects/query**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            status: {
              bed_mesh: {
                profile_name: "default",
                probed_matrix: [
                  [-0.05, 0.02],
                  [0.1, 0.25],
                ],
                mesh_matrix: [],
              },
            },
          },
        }),
      });
    });
    await page.goto("/tune");
    await expect(
      page
        .locator("main section.instrument-panel")
        .filter({ has: page.getByRole("heading", { name: "Bed Mesh" }) })
        .last(),
    ).toBeVisible({ timeout: 15_000 });

    // The heat map's numerals are drawn with mix-blend-luminosity and are
    // unreadable by assistive tech; the table is the accessible truth.
    const table = page.getByRole("table");
    await expect(table).toHaveCount(1);
    await expect(table).toContainText("Minimum -0.050 millimetres");
    await expect(table).toContainText("maximum 0.250 millimetres");
    await expect(table).toContainText("range peak to peak 0.300 millimetres");
    await expect(table.getByRole("cell")).toHaveCount(4);
    // The mislabelled statistic is gone: this number is a range, not a variance.
    await expect(page.locator("main")).not.toContainText("Variance");
    mock.assertSealed();
  });

  test("a history row with no usable timestamp renders a dash, not 'Invalid Date'", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const mock = await installActiveMock(page, { state: TELEMETRY_BLIND });
    await page.route("**/server/history/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/totals")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            result: {
              job_totals: {
                total_jobs: 1,
                total_time: 0,
                total_filament_used: 0,
                longest_job: 0,
              },
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            jobs: [
              {
                job_id: "000001",
                exists: true,
                filename: "orphan.gcode",
                filament_used: 0,
                metadata: {},
                print_duration: 0,
                status: "interrupted",
                start_time: 0,
                total_duration: 0,
              },
            ],
          },
        }),
      });
    });
    await page.goto("/print");
    await expect(
      page.locator("main").getByRole("heading", { name: "Print History" }),
    ).toBeVisible({ timeout: 15_000 });

    const row = page.getByRole("listitem").filter({ hasText: "orphan.gcode" });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText("Invalid Date");
    await expect(row).toContainText("—");
    mock.assertSealed();
  });


  test("per-axis homed state is readable without color or shape", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await useExperience(page, "expert");
    const mock = await installActiveMock(page, {
      state: {
        ...TELEMETRY_BLIND,
        toolhead: {
          position: [10, 20, 5, 0],
          homed_axes: "xy",
          print_time: 0,
          estimated_print_time: 0,
          max_velocity: 600,
          max_accel: 20_000,
          axis_minimum: [-2, -2, -10, 0],
          axis_maximum: [306.5, 306, 305, 0],
        },
      },
    });
    await page.goto("/control");
    await expect(
      page.locator("main").getByRole("heading", { name: "Toolhead", exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // X and Y homed, Z not — the ●/○ glyphs are decorative, the words are real.
    await expect(page.locator("main").getByText("homed", { exact: true })).toHaveCount(2);
    await expect(
      page.locator("main").getByText("not homed", { exact: true }),
    ).toHaveCount(1);
    mock.assertSealed();
  });

  test("link state is announced on the narrow panel where the word is hidden", async ({
    page,
  }) => {
    // 390px: the connection word used to be `hidden`, leaving an icon and a
    // `title` on a non-interactive div — nothing an assistive tech can read.
    await page.setViewportSize({ width: 390, height: 844 });
    const mock = await openBlind(page, "/", "Telemetry");

    const banner = page.getByRole("banner");
    await expect(banner.getByText(/^(Connected|Offline)$/)).toHaveCount(1);
    // Visually still icon-only at this width.
    const box = await banner.getByText(/^(Connected|Offline)$/).boundingBox();
    expect(box?.width ?? 0).toBeLessThan(2);
    mock.assertSealed();
  });
});
