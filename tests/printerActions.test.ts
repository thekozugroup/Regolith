import { describe, expect, test } from "bun:test";
import type { PrinterState } from "../src/lib/moonraker";
import {
  createPrinterActionRunner,
  getActionConfirmation,
  getConsoleCommandRisk,
  guardPrinterAction,
  kampEnabledFromStorage,
  PrinterActionError,
  type PrinterActionClient,
} from "../src/lib/printerActions";

function readyState(overrides: PrinterState = {}): PrinterState {
  return {
    webhooks: { state: "ready", state_message: "Ready" },
    idle_timeout: { state: "Ready" },
    print_stats: { state: "standby" },
    toolhead: {
      position: [150, 150, 10, 0],
      homed_axes: "xyz",
      print_time: 0,
      estimated_print_time: 0,
      axis_minimum: [0, 0, 0, 0],
      axis_maximum: [300, 300, 300, 0],
    },
    ...overrides,
  };
}

/** Mirrors the live K1 Max: KAMP is driven by output pins, and there is no
 *  `PRINT_START` macro — the start macro is `START_PRINT`. */
const K1_MAX_OBJECTS = [
  "print_stats",
  "toolhead",
  "gcode_macro START_PRINT",
  "output_pin ADAPTIVE_BED_MESH",
  "output_pin FULL_BED_MESH",
  "output_pin ADAPTIVE_PURGE_LINE",
];

function client(
  initialState = readyState(),
  objects: string[] = K1_MAX_OBJECTS,
): PrinterActionClient & {
  state: PrinterState;
  calls: string[];
  timelapseWrites: Array<Record<string, string | number | boolean>>;
} {
  return {
    state: initialState,
    calls: [],
    timelapseWrites: [],
    async writeTimelapseSettings(patch) {
      this.timelapseWrites.push(patch);
      this.calls.push(`timelapse:${JSON.stringify(patch)}`);
      return patch;
    },
    getState() {
      return this.state;
    },
    isConnected: () => true,
    async listObjects() {
      return objects;
    },
    async runGcode(script) {
      this.calls.push(`gcode:${script}`);
    },
    async pause() {
      this.calls.push("pause");
    },
    async resume() {
      this.calls.push("resume");
    },
    async cancel() {
      this.calls.push("cancel");
    },
    async startPrint(filename) {
      this.calls.push(`start:${filename}`);
    },
    async emergencyStop() {
      this.calls.push("emergency-stop");
    },
    async restart() {
      this.calls.push("restart");
    },
    async firmwareRestart() {
      this.calls.push("firmware-restart");
    },
  };
}

describe("printer action safety", () => {
  test("blocks print start when calibration becomes active", () => {
    const state = readyState({ idle_timeout: { state: "Printing" } });
    const check = guardPrinterAction(state, true, {
      type: "start-print",
      filename: "part.gcode",
      setup: [],
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("calibration");
  });

  test("re-checks live state after confirmation", async () => {
    const fake = client();
    const run = createPrinterActionRunner(fake);
    await expect(
      run(
        { type: "start-print", filename: "part.gcode", setup: [] },
        {
          confirm: () => {
            fake.state = readyState({
              print_stats: { state: "printing", filename: "other.gcode" },
            });
            return true;
          },
        },
      ),
    ).rejects.toThrow("Printer state changed");
    expect(fake.calls).toEqual([]);
  });

  test("optional setup failure never blocks the print", async () => {
    const fake = client();
    fake.runGcode = async () => {
      throw new Error("Unknown command");
    };
    const run = createPrinterActionRunner(fake);
    const result = await run(
      { type: "start-print", filename: "part.gcode", setup: ["kamp-on"] },
      { confirm: () => true },
    );
    expect(result.executed).toBe(true);
    expect(fake.calls).toContain("start:part.gcode");
  });

  test("an unreadable object list never blocks the print", async () => {
    const fake = client();
    fake.listObjects = async () => {
      throw new Error("RPC timeout: printer.objects.list");
    };
    const run = createPrinterActionRunner(fake);
    const result = await run(
      { type: "start-print", filename: "part.gcode", setup: ["kamp-on"] },
      { confirm: () => true },
    );
    expect(result.executed).toBe(true);
    expect(fake.calls).toEqual(["start:part.gcode"]);
  });

  test("toggles KAMP through the adaptive bed mesh pin", async () => {
    const on = client();
    await createPrinterActionRunner(on)(
      { type: "start-print", filename: "part.gcode", setup: ["kamp-on"] },
      { confirm: () => true },
    );
    expect(on.calls).toEqual([
      "gcode:SET_PIN PIN=ADAPTIVE_BED_MESH VALUE=1",
      "start:part.gcode",
    ]);

    const off = client();
    await createPrinterActionRunner(off)(
      { type: "start-print", filename: "part.gcode", setup: ["kamp-off"] },
      { confirm: () => true },
    );
    expect(off.calls).toEqual([
      "gcode:SET_PIN PIN=ADAPTIVE_BED_MESH VALUE=0",
      "start:part.gcode",
    ]);
  });

  test("skips setup a printer does not support, and still prints", async () => {
    const fake = client(readyState(), ["print_stats", "toolhead"]);
    const run = createPrinterActionRunner(fake);
    const result = await run(
      { type: "start-print", filename: "part.gcode", setup: ["kamp-on"] },
      { confirm: () => true },
    );
    expect(result.executed).toBe(true);
    expect(fake.calls).toEqual(["start:part.gcode"]);
  });

  // Regression: SET_GCODE_VARIABLE is a mux command keyed on MACRO. Targeting
  // a macro this printer does not have (PRINT_START) makes klipper reject the
  // request, which used to abort every print. Never send it again.
  test("never targets a PRINT_START macro during print setup", async () => {
    const TIMELAPSE_ON = {
      kind: "timelapse",
      enabled: true,
      mode: "hyperlapse",
    } as const;
    const TIMELAPSE_OFF = {
      kind: "timelapse",
      enabled: false,
      mode: "hyperlapse",
    } as const;
    for (const setup of [
      ["kamp-on"],
      ["kamp-off"],
      ["kamp-on", "kamp-off"],
      [TIMELAPSE_ON],
      [TIMELAPSE_OFF],
      ["kamp-on", TIMELAPSE_ON],
      ["kamp-off", TIMELAPSE_OFF],
    ] as const) {
      const fake = client();
      await createPrinterActionRunner(fake)(
        { type: "start-print", filename: "part.gcode", setup: [...setup] },
        { confirm: () => true },
      );
      expect(fake.calls).toContain("start:part.gcode");
      for (const call of fake.calls) {
        expect(call).not.toContain("PRINT_START");
        expect(call).not.toContain("SET_GCODE_VARIABLE");
        expect(call).not.toContain("use_kamp");
      }
      // ADAPTIVE_BED_MESH stays the KAMP mechanism, and nothing about
      // timelapse may displace it.
      if (setup.some((option) => option === "kamp-on")) {
        expect(fake.calls).toContain("gcode:SET_PIN PIN=ADAPTIVE_BED_MESH VALUE=1");
      }
    }
  });

  test("state change during setup prevents print start", async () => {
    const fake = client();
    fake.runGcode = async (script) => {
      fake.calls.push(`gcode:${script}`);
      fake.state = readyState({
        print_stats: { state: "printing", filename: "other.gcode" },
      });
    };
    const run = createPrinterActionRunner(fake);
    await expect(
      run(
        {
          type: "start-print",
          filename: "part.gcode",
          setup: ["kamp-on"],
        },
        { confirm: () => true },
      ),
    ).rejects.toThrow("state changed during setup");
    expect(fake.calls).not.toContain("start:part.gcode");
  });

  test("prevents duplicate action dispatch", async () => {
    const fake = client(readyState({ print_stats: { state: "printing" } }));
    let release = () => {};
    fake.pause = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const run = createPrinterActionRunner(fake);
    const first = run({ type: "pause-print" });
    await expect(run({ type: "pause-print" })).rejects.toBeInstanceOf(
      PrinterActionError,
    );
    release();
    await first;
  });

  test("blocks a Tune macro when printer becomes busy during confirmation", async () => {
    const fake = client();
    const run = createPrinterActionRunner(fake);
    await expect(
      run(
        {
          type: "tune-command",
          title: "Calibrate Bed Mesh",
          command: "G28\nBED_MESH_CALIBRATE PROFILE=default",
          confirmation: "This homes and probes the bed grid.",
        },
        {
          confirm: () => {
            fake.state = readyState({ idle_timeout: { state: "Printing" } });
            return true;
          },
        },
      ),
    ).rejects.toThrow("Printer state changed");
    expect(fake.calls).toEqual([]);
  });

  test("locks Tune dispatch and sends follow-up in one ordered script", async () => {
    const fake = client();
    let release = () => {};
    fake.runGcode = (script) => {
      fake.calls.push(`gcode:${script}`);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const run = createPrinterActionRunner(fake);
    const action = {
      type: "tune-command" as const,
      title: "Auto Calibrate",
      command: "G28\nSHAPER_CALIBRATE\nSAVE_CONFIG",
      confirmation: "This homes the printer and runs a frequency sweep.",
    };
    const first = run(action, { confirm: () => true });
    await expect(run(action, { confirm: () => true })).rejects.toMatchObject({
      code: "duplicate",
    });
    expect(fake.calls).toEqual(["gcode:G28\nSHAPER_CALIBRATE\nSAVE_CONFIG"]);
    release();
    await first;
  });

  test("validates and idle-gates pressure advance changes", async () => {
    expect(
      guardPrinterAction(readyState(), true, {
        type: "set-pressure-advance",
        value: 0.25,
        save: false,
      }).allowed,
    ).toBe(false);
    expect(
      guardPrinterAction(
        readyState({ print_stats: { state: "printing" } }),
        true,
        { type: "set-pressure-advance", value: 0.04, save: true },
      ).allowed,
    ).toBe(false);
  });
});

describe("adaptive bed mesh default", () => {
  // Owner request: basic print QoL (adaptive bed mesh) is ON by default.
  // Only an explicit, persisted opt-out may disable it.
  test("a fresh browser with nothing stored defaults ON", () => {
    expect(kampEnabledFromStorage(null)).toBe(true);
  });

  test("an explicit opt-out stays off, an explicit opt-in stays on", () => {
    expect(kampEnabledFromStorage("0")).toBe(false);
    expect(kampEnabledFromStorage("1")).toBe(true);
  });

  test("garbage in storage falls back to the QoL default, ON", () => {
    expect(kampEnabledFromStorage("")).toBe(true);
    expect(kampEnabledFromStorage("false")).toBe(true);
  });
});

describe("per-print timelapse setup", () => {
  const ON = { kind: "timelapse", enabled: true, mode: "hyperlapse" } as const;
  const OFF = { kind: "timelapse", enabled: false, mode: "hyperlapse" } as const;

  // The setting is ONE global value in Moonraker's database, shared with
  // Fluidd and the stock touchscreen. Whatever the last thing to touch it
  // left behind is never safe to assume, so both directions are asserted on
  // every start — a print the owner did not want recorded must actively turn
  // recording off.
  test("writes on every start, in both directions", async () => {
    const on = client();
    await createPrinterActionRunner(on)(
      { type: "start-print", filename: "part.gcode", setup: [ON] },
      { confirm: () => true },
    );
    expect(on.timelapseWrites).toEqual([{ enabled: true, mode: "hyperlapse" }]);
    expect(on.calls.at(-1)).toBe("start:part.gcode");

    const off = client();
    await createPrinterActionRunner(off)(
      { type: "start-print", filename: "part.gcode", setup: [OFF] },
      { confirm: () => true },
    );
    expect(off.timelapseWrites).toEqual([{ enabled: false }]);
    expect(off.calls.at(-1)).toBe("start:part.gcode");
  });

  // Enabling from the UI must carry the mode with it, or the owner gets a
  // switch that is on while the printer is in a mode that captures nothing.
  test("an enable carries the chosen mode; a deliberate layermacro is honoured", async () => {
    const fake = client();
    await createPrinterActionRunner(fake)(
      {
        type: "start-print",
        filename: "part.gcode",
        setup: [{ kind: "timelapse", enabled: true, mode: "layermacro" }],
      },
      { confirm: () => true },
    );
    expect(fake.timelapseWrites).toEqual([
      { enabled: true, mode: "layermacro" },
    ]);
  });

  // THE LAW: applyPrintSetup NEVER THROWS, and that guarantee now covers an
  // HTTP step exactly as it covers a gcode one.
  test("a rejected settings write still starts the print, and says so", async () => {
    const fake = client();
    fake.writeTimelapseSettings = async () => {
      throw new Error("HTTP 500");
    };
    const result = await createPrinterActionRunner(fake)(
      { type: "start-print", filename: "part.gcode", setup: [ON] },
      { confirm: () => true },
    );
    expect(result.executed).toBe(true);
    expect(fake.calls).toEqual(["start:part.gcode"]);
    expect(result.notices?.length).toBe(1);
    expect(result.notices?.[0]).toContain("not being recorded");
  });

  test("a write that hangs up on the socket still starts the print", async () => {
    for (const thrown of [
      new Error("Failed to fetch"),
      new Error("Timelapse settings write failed (HTTP 404)."),
      "not even an error",
    ]) {
      const fake = client();
      fake.writeTimelapseSettings = async () => {
        throw thrown;
      };
      const result = await createPrinterActionRunner(fake)(
        { type: "start-print", filename: "part.gcode", setup: [ON, "kamp-on"] },
        { confirm: () => true },
      );
      expect(result.executed).toBe(true);
      expect(fake.calls).toContain("start:part.gcode");
    }
  });

  test("a failed disable warns that a previous timelapse may still run", async () => {
    const fake = client();
    fake.writeTimelapseSettings = async () => {
      throw new Error("HTTP 503");
    };
    const result = await createPrinterActionRunner(fake)(
      { type: "start-print", filename: "part.gcode", setup: [OFF] },
      { confirm: () => true },
    );
    expect(result.executed).toBe(true);
    expect(result.notices?.[0]).toContain("may still be recording");
  });

  // A host without moonraker-timelapse simply has no such call. That is not
  // a failure and must not be reported as one.
  test("a host without the timelapse API sends nothing and reports nothing", async () => {
    const fake = client();
    delete (fake as { writeTimelapseSettings?: unknown }).writeTimelapseSettings;
    const result = await createPrinterActionRunner(fake)(
      { type: "start-print", filename: "part.gcode", setup: [ON] },
      { confirm: () => true },
    );
    expect(result).toEqual({ executed: true });
    expect(fake.calls).toEqual(["start:part.gcode"]);
  });

  // The klipper object list gates GCODE steps. A timelapse write is a
  // Moonraker REST call and does not depend on klipper at all, so an
  // unreadable object list must not silently suppress it.
  test("an unreadable klipper object list does not suppress the settings write", async () => {
    const fake = client();
    fake.listObjects = async () => {
      throw new Error("RPC timeout: printer.objects.list");
    };
    await createPrinterActionRunner(fake)(
      { type: "start-print", filename: "part.gcode", setup: ["kamp-on", ON] },
      { confirm: () => true },
    );
    expect(fake.timelapseWrites).toEqual([{ enabled: true, mode: "hyperlapse" }]);
    // ...while the gcode step it COULD not confirm stays unsent.
    expect(fake.calls).not.toContain("gcode:SET_PIN PIN=ADAPTIVE_BED_MESH VALUE=1");
    expect(fake.calls).toContain("start:part.gcode");
  });

  test("the write lands before the print starts, never after", async () => {
    const fake = client();
    await createPrinterActionRunner(fake)(
      { type: "start-print", filename: "part.gcode", setup: ["kamp-on", ON] },
      { confirm: () => true },
    );
    expect(fake.calls).toEqual([
      "gcode:SET_PIN PIN=ADAPTIVE_BED_MESH VALUE=1",
      'timelapse:{"enabled":true,"mode":"hyperlapse"}',
      "start:part.gcode",
    ]);
  });

  test("a print blocked after setup reports no success notice", async () => {
    const fake = client();
    fake.writeTimelapseSettings = async () => {
      fake.state = readyState({
        print_stats: { state: "printing", filename: "other.gcode" },
      });
      throw new Error("HTTP 500");
    };
    await expect(
      createPrinterActionRunner(fake)(
        { type: "start-print", filename: "part.gcode", setup: [ON] },
        { confirm: () => true },
      ),
    ).rejects.toThrow("state changed during setup");
    expect(fake.calls).not.toContain("start:part.gcode");
  });

  test("a repeat-print carries no setup and writes nothing", async () => {
    const fake = client();
    await createPrinterActionRunner(fake)(
      { type: "repeat-print", filename: "part.gcode" },
      { confirm: () => true },
    );
    expect(fake.timelapseWrites).toEqual([]);
  });
});

describe("expert console classification", () => {
  test("allows known diagnostics without confirmation", () => {
    expect(getConsoleCommandRisk("GET_POSITION").risk).toBe("routine");
  });

  test("marks motion and heating as critical", () => {
    expect(getConsoleCommandRisk("G28").risk).toBe("critical");
    expect(getConsoleCommandRisk("M104 S220").risk).toBe("critical");
  });

  test("treats custom macros as caution, preserving expert access", () => {
    expect(getConsoleCommandRisk("MY_CUSTOM_MACRO MODE=TEST").risk).toBe(
      "caution",
    );
  });

  test("rejects unsafe file traversal", () => {
    const check = guardPrinterAction(readyState(), true, {
      type: "start-print",
      filename: "../printer.cfg",
      setup: [],
    });
    expect(check.allowed).toBe(false);
  });
});

describe("chamber light", () => {
  const LED = "output_pin LED";
  const WITH_LED = [...K1_MAX_OBJECTS, LED];

  test("switches the pin the profile declared, both ways", async () => {
    const on = client(readyState(), WITH_LED);
    expect(
      await createPrinterActionRunner(on)({ type: "set-light", on: true, object: LED }),
    ).toEqual({ executed: true });
    expect(on.calls).toEqual(["gcode:SET_PIN PIN=LED VALUE=1"]);

    const off = client(readyState(), WITH_LED);
    await createPrinterActionRunner(off)({ type: "set-light", on: false, object: LED });
    expect(off.calls).toEqual(["gcode:SET_PIN PIN=LED VALUE=0"]);
  });

  // Printers without a chamber lamp are the reason this is object-gated:
  // sending SET_PIN for a pin klipper has never heard of is an error toast
  // for a feature that machine does not have.
  test("sends nothing at all when the printer has no light pin", async () => {
    const fake = client(readyState(), K1_MAX_OBJECTS);
    const result = await createPrinterActionRunner(fake)({
      type: "set-light",
      on: true,
      object: LED,
    });
    expect(result).toEqual({ executed: false });
    expect(fake.calls).toEqual([]);
  });

  test("an unreadable object list is silence, not a throw", async () => {
    const fake = client(readyState(), WITH_LED);
    fake.listObjects = async () => {
      throw new Error("RPC timeout: printer.objects.list");
    };
    const result = await createPrinterActionRunner(fake)({
      type: "set-light",
      on: true,
      object: LED,
    });
    expect(result).toEqual({ executed: false });
    expect(fake.calls).toEqual([]);
  });

  test("never builds a command out of an object it does not understand", async () => {
    for (const object of ["", "LED", "output_pin ", "output_pin LED; M112", "gcode_macro LED"]) {
      const fake = client(readyState(), [...WITH_LED, object]);
      await expect(
        createPrinterActionRunner(fake)({ type: "set-light", on: true, object }),
      ).rejects.toBeInstanceOf(PrinterActionError);
      expect(fake.calls).toEqual([]);
    }
  });

  test("locks duplicate toggles, and holds its own lock — never the print lock", async () => {
    const fake = client(readyState(), WITH_LED);
    let release = () => {};
    fake.runGcode = (script) => {
      fake.calls.push(`gcode:${script}`);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const run = createPrinterActionRunner(fake);
    const first = run({ type: "set-light", on: true, object: LED });
    await expect(
      run({ type: "set-light", on: false, object: LED }),
    ).rejects.toMatchObject({ code: "duplicate" });
    // A held lamp toggle must not be able to hold a print hostage.
    await run(
      { type: "start-print", filename: "part.gcode", setup: [] },
      { confirm: () => true },
    );
    release();
    await first;
    expect(fake.calls).toContain("start:part.gcode");
  });

  // A lamp is neither motion nor heat. Lighting the chamber to look at a
  // running print is the main reason the control exists.
  test("stays available while a print runs, and refuses when klipper is not ready", () => {
    expect(
      guardPrinterAction(
        readyState({ print_stats: { state: "printing", filename: "part.gcode" } }),
        true,
        { type: "set-light", on: true, object: LED },
      ).allowed,
    ).toBe(true);
    expect(
      guardPrinterAction(
        readyState({ webhooks: { state: "shutdown", state_message: "Shutdown" } }),
        true,
        { type: "set-light", on: true, object: LED },
      ).allowed,
    ).toBe(false);
    expect(
      guardPrinterAction(readyState(), false, {
        type: "set-light",
        on: true,
        object: LED,
      }).allowed,
    ).toBe(false);
  });

  test("light control asks for no confirmation dialog", () => {
    expect(
      getActionConfirmation({ type: "set-light", on: true, object: LED }),
    ).toBeNull();
  });
});
