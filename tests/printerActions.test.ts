import { describe, expect, test } from "bun:test";
import type { PrinterState } from "../src/lib/moonraker";
import {
  createPrinterActionRunner,
  getConsoleCommandRisk,
  guardPrinterAction,
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

function client(initialState = readyState()): PrinterActionClient & {
  state: PrinterState;
  calls: string[];
} {
  return {
    state: initialState,
    calls: [],
    getState() {
      return this.state;
    },
    isConnected: () => true,
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

  test("setup failure prevents print start", async () => {
    const fake = client();
    fake.runGcode = async () => {
      throw new Error("Unknown gcode_macro variable");
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
    ).rejects.toMatchObject({ code: "setup-failed" });
    expect(fake.calls).not.toContain("start:part.gcode");
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
