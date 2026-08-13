import { describe, expect, test } from "bun:test";
import {
  classifyHostStarvationShutdown,
  isHostStarvationShutdown,
} from "../src/lib/health";

// The classifier behind the shutdown explainer. Its job is to redirect the
// owner AWAY from replacing healthy hardware when Klipper dies of host
// starvation — and, just as important, NOT to hijack genuine hardware
// faults. Incident 2's user-visible string arrived as a gcode response,
// not state_message, so both arms are pinned here.

const down = (message: string) => ({
  state: "shutdown",
  state_message: message,
});

describe("classifyHostStarvationShutdown — starvation wordings", () => {
  test("'Rescheduled timer in the past' — the 01:16 ffmpeg incident", () => {
    const verdict = classifyHostStarvationShutdown(
      down("MCU 'rpi' shutdown: Rescheduled timer in the past"),
      [],
    );
    expect(verdict.starvation).toBe(true);
    expect(verdict.probeMessenger).toBe(false);
    expect(verdict.matchedText).toContain("Rescheduled timer in the past");
  });

  test("'Missed scheduling of next …' — the 17:54 incident", () => {
    const verdict = classifyHostStarvationShutdown(
      down("MCU 'mcu' shutdown: Missed scheduling of next digital out event"),
      [],
    );
    expect(verdict.starvation).toBe(true);
    expect(verdict.probeMessenger).toBe(false);
  });

  test("'Timer too close'", () => {
    expect(
      isHostStarvationShutdown(down("MCU 'mcu' shutdown: Timer too close"), []),
    ).toBe(true);
  });

  test("the probe wording is starvation AND flagged probe-as-messenger", () => {
    const verdict = classifyHostStarvationShutdown(
      down("Unable to obtain 'result_deal_avgs_prtouch' response"),
      [],
    );
    expect(verdict.starvation).toBe(true);
    expect(verdict.probeMessenger).toBe(true);
  });

  test("matching is case-insensitive", () => {
    expect(
      isHostStarvationShutdown(down("mcu shutdown: TIMER TOO CLOSE"), []),
    ).toBe(true);
  });
});

describe("classifyHostStarvationShutdown — the gcode-response arm", () => {
  test("the prtouch wording arriving as a gcode response is caught", () => {
    // Incident 2: state_message carried a generic shutdown, the probe error
    // arrived on notify_gcode_response. Matching only state_message would
    // have missed the exact case this feature exists for.
    const verdict = classifyHostStarvationShutdown(
      down("Printer is shutdown"),
      [
        "// probe samples collected",
        "!! Unable to obtain 'result_deal_avgs_prtouch' response",
      ],
    );
    expect(verdict.starvation).toBe(true);
    expect(verdict.probeMessenger).toBe(true);
    expect(verdict.matchedText).toContain("result_deal_avgs_prtouch");
  });

  test("only the last 40 lines are scanned", () => {
    const old = "!! Unable to obtain 'result_deal_avgs_prtouch' response";
    const lines = [old, ...Array(40).fill("// routine line")];
    expect(
      isHostStarvationShutdown(down("Printer is shutdown"), lines),
    ).toBe(false);
  });
});

describe("classifyHostStarvationShutdown — must NOT misclassify", () => {
  test("klippy READY never classifies, whatever scrolled past in the log", () => {
    const verdict = classifyHostStarvationShutdown(
      { state: "ready", state_message: "Printer is ready" },
      ["!! Rescheduled timer in the past"],
    );
    expect(verdict.starvation).toBe(false);
  });

  test("no webhooks at all is silence", () => {
    expect(
      classifyHostStarvationShutdown(undefined, [
        "!! Timer too close",
      ]).starvation,
    ).toBe(false);
  });

  test("a genuine heater fault stays a heater fault", () => {
    expect(
      isHostStarvationShutdown(
        down(
          "Heater extruder not heating at expected rate\nSee the 'verify_heater' section",
        ),
        [],
      ),
    ).toBe(false);
  });

  test("'Lost communication with MCU' is DELIBERATELY excluded — that one is often a cable", () => {
    expect(
      isHostStarvationShutdown(down("Lost communication with MCU 'mcu'"), []),
    ).toBe(false);
  });

  test("thermistor / ADC faults are not starvation", () => {
    expect(
      isHostStarvationShutdown(
        down("ADC out of range\nThis generally occurs when a heater sensor is malfunctioning"),
        [],
      ),
    ).toBe(false);
  });

  test("an emergency stop is not starvation", () => {
    expect(
      isHostStarvationShutdown(down("Shutdown due to M112 command"), []),
    ).toBe(false);
  });
});
