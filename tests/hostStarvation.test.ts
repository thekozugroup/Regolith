import { describe, expect, test } from "bun:test";
import {
  classifyHostStarvationShutdown,
  isHostStarvationShutdown,
  STARVATION_LINE_LOOKBACK_MS,
  type StarvationLogLine,
} from "../src/lib/health";

// The classifier behind the shutdown explainer. Its job is to redirect the
// owner AWAY from replacing healthy hardware when Klipper dies of host
// starvation — and, just as important, NOT to hijack genuine hardware
// faults. Incident 2's user-visible string arrived as a gcode response,
// not state_message, so both arms are pinned here.
//
// The negative cases below are the point of this file. A classifier that
// claims "this is not a hardware fault" over a dead board, a stale log line,
// or the owner's own typing is worse than no classifier at all: it sends
// someone away from a real fault on a machine with 255 °C heaters.

const down = (message: string) => ({
  state: "shutdown",
  state_message: message,
});

const FAULT_AT = 1_000_000;

/** A machine-authored console line, contemporaneous with the fault. */
const response = (text: string, at = FAULT_AT - 500): StarvationLogLine => ({
  text,
  at,
  fromUser: false,
});

/** A line the OWNER typed into the console. */
const typed = (text: string, at = FAULT_AT - 500): StarvationLogLine => ({
  text,
  at,
  fromUser: true,
});

const opts = { faultAt: FAULT_AT };

describe("classifyHostStarvationShutdown — starvation wordings", () => {
  test("'Rescheduled timer in the past' — the 01:16 ffmpeg incident", () => {
    const verdict = classifyHostStarvationShutdown(
      down("MCU 'rpi' shutdown: Rescheduled timer in the past"),
      [],
      opts,
    );
    expect(verdict.kind).toBe("starvation");
    expect(verdict.starvation).toBe(true);
    expect(verdict.probeMessenger).toBe(false);
    expect(verdict.matchedText).toContain("Rescheduled timer in the past");
  });

  test("'Missed scheduling of next …' — the 17:54 incident", () => {
    const verdict = classifyHostStarvationShutdown(
      down("MCU 'mcu' shutdown: Missed scheduling of next digital out event"),
      [],
      opts,
    );
    expect(verdict.starvation).toBe(true);
    expect(verdict.probeMessenger).toBe(false);
  });

  test("'Timer too close'", () => {
    expect(
      isHostStarvationShutdown(
        down("MCU 'mcu' shutdown: Timer too close"),
        [],
        opts,
      ),
    ).toBe(true);
  });

  test("the probe wording is starvation AND flagged probe-as-messenger", () => {
    const verdict = classifyHostStarvationShutdown(
      down("Unable to obtain 'result_deal_avgs_prtouch' response"),
      [],
      opts,
    );
    expect(verdict.kind).toBe("starvation");
    expect(verdict.probeMessenger).toBe(true);
    expect(verdict.queryName).toBe("result_deal_avgs_prtouch");
  });

  test("matching is case-insensitive", () => {
    expect(
      isHostStarvationShutdown(
        down("mcu shutdown: TIMER TOO CLOSE"),
        [],
        opts,
      ),
    ).toBe(true);
  });
});

describe("classifyHostStarvationShutdown — the query name decides", () => {
  // `Unable to obtain '<name>' response` was matched WHOLESALE. Every name
  // below produced "this is a timing fault, not a hardware fault".

  test("handshake queries are an MCU COMMUNICATION fault, never starvation", () => {
    for (const query of ["identify", "get_uptime", "get_clock", "get_config"]) {
      const verdict = classifyHostStarvationShutdown(
        down(`Unable to obtain '${query}' response`),
        [],
        opts,
      );
      expect(verdict.kind).toBe("mcu-comms");
      expect(verdict.starvation).toBe(false);
      expect(verdict.probeMessenger).toBe(false);
      expect(verdict.queryName).toBe(query);
    }
  });

  test("'identify' is the connect handshake — the dead-board / bad-cable signature", () => {
    // This is the same class `lost communication with mcu` was excluded for.
    // Admitting it through the query wording would have re-opened the exact
    // hole that exclusion was written to close.
    expect(
      isHostStarvationShutdown(
        down("Unable to obtain 'identify' response"),
        [],
        opts,
      ),
    ).toBe(false);
  });

  test("an unrecognised query name is CAUSE UNCLEAR — claimed as neither", () => {
    const verdict = classifyHostStarvationShutdown(
      down("Unable to obtain 'some_future_query' response"),
      [],
      opts,
    );
    expect(verdict.kind).toBe("unclear");
    expect(verdict.starvation).toBe(false);
    expect(verdict.probeMessenger).toBe(false);
    expect(verdict.queryName).toBe("some_future_query");
    // It still quotes the line — an honest unknown names what it saw.
    expect(verdict.matchedText).toContain("some_future_query");
  });

  test("probe-family names keep the probe-as-messenger claim", () => {
    for (const query of ["result_deal_avgs_prtouch", "run_prtouch", "probe_z"]) {
      const verdict = classifyHostStarvationShutdown(
        down(`Unable to obtain '${query}' response`),
        [],
        opts,
      );
      expect(verdict.kind).toBe("starvation");
      expect(verdict.probeMessenger).toBe(true);
    }
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
        response("// probe samples collected"),
        response("!! Unable to obtain 'result_deal_avgs_prtouch' response"),
      ],
      opts,
    );
    expect(verdict.starvation).toBe(true);
    expect(verdict.probeMessenger).toBe(true);
    expect(verdict.matchedText).toContain("result_deal_avgs_prtouch");
  });

  test("only the last 40 lines are scanned", () => {
    const lines = [
      response("!! Unable to obtain 'result_deal_avgs_prtouch' response"),
      ...Array.from({ length: 40 }, () => response("// routine line")),
    ];
    expect(
      isHostStarvationShutdown(down("Printer is shutdown"), lines, opts),
    ).toBe(false);
  });

  test("with no fault anchor the gcode arm is DISABLED, not guessed at", () => {
    // Without a shutdown timestamp there is no way to know whether a console
    // line describes this fault or a previous session.
    expect(
      isHostStarvationShutdown(
        down("Printer is shutdown"),
        [response("!! Unable to obtain 'result_deal_avgs_prtouch' response")],
        { faultAt: null },
      ),
    ).toBe(false);
  });
});

describe("classifyHostStarvationShutdown — must NOT misclassify", () => {
  test("klippy READY never classifies, whatever scrolled past in the log", () => {
    const verdict = classifyHostStarvationShutdown(
      { state: "ready", state_message: "Printer is ready" },
      [response("!! Rescheduled timer in the past")],
      opts,
    );
    expect(verdict.kind).toBe("none");
  });

  test("no webhooks at all is silence", () => {
    expect(
      classifyHostStarvationShutdown(undefined, [response("!! Timer too close")], opts)
        .starvation,
    ).toBe(false);
  });

  test("a genuine heater fault stays a heater fault", () => {
    expect(
      isHostStarvationShutdown(
        down(
          "Heater extruder not heating at expected rate\nSee the 'verify_heater' section",
        ),
        [],
        opts,
      ),
    ).toBe(false);
  });

  test("'Lost communication with MCU' is DELIBERATELY excluded — that one is often a cable", () => {
    expect(
      isHostStarvationShutdown(
        down("Lost communication with MCU 'mcu'"),
        [],
        opts,
      ),
    ).toBe(false);
  });

  test("thermistor / ADC faults are not starvation", () => {
    expect(
      isHostStarvationShutdown(
        down(
          "ADC out of range\nThis generally occurs when a heater sensor is malfunctioning",
        ),
        [],
        opts,
      ),
    ).toBe(false);
  });

  test("an emergency stop is not starvation", () => {
    expect(
      isHostStarvationShutdown(down("Shutdown due to M112 command"), [], opts),
    ).toBe(false);
  });

  test("a REAL hardware fault is not overturned by a stale starvation line", () => {
    // Measured false positive: a genuine `ADC out of range` shutdown with a
    // hours-old `Rescheduled timer in the past` still sitting in the 200-line
    // ring classified as starvation, and the owner was told their thermistor
    // fault was "not a hardware fault".
    const verdict = classifyHostStarvationShutdown(
      down("ADC out of range"),
      [response("!! Rescheduled timer in the past")],
      opts,
    );
    expect(verdict.kind).toBe("none");
  });

  test("state_message wins over the console ring for every trusted fault wording", () => {
    for (const message of [
      "Lost communication with MCU 'mcu'",
      "Heater bed not heating at expected rate",
      "ADC out of range",
      "Shutdown due to M112 command",
    ]) {
      expect(
        isHostStarvationShutdown(
          down(message),
          [response("!! Timer too close")],
          opts,
        ),
      ).toBe(false);
    }
  });

  test("a line OLDER than the recency window cannot describe this fault", () => {
    const stale = response(
      "!! Rescheduled timer in the past",
      FAULT_AT - STARVATION_LINE_LOOKBACK_MS - 1,
    );
    expect(
      isHostStarvationShutdown(down("Printer is shutdown"), [stale], opts),
    ).toBe(false);
    // …and one inside the window still counts.
    const fresh = response(
      "!! Rescheduled timer in the past",
      FAULT_AT - STARVATION_LINE_LOOKBACK_MS,
    );
    expect(
      isHostStarvationShutdown(down("Printer is shutdown"), [fresh], opts),
    ).toBe(true);
  });

  test("USER-TYPED console text is never evidence", () => {
    // Measured: the owner asking what a message means defeated the
    // `lost communication` exclusion, because recordCommand() writes their
    // typing into the same ring the classifier reads.
    const verdict = classifyHostStarvationShutdown(
      down("Printer is shutdown"),
      [
        typed("// user asked: what does 'timer too close' mean?"),
        typed("RESPOND MSG=\"Unable to obtain 'result_deal_avgs_prtouch' response\""),
      ],
      opts,
    );
    expect(verdict.kind).toBe("none");
  });

  test("user typing cannot resurrect a fault that state_message already named", () => {
    expect(
      isHostStarvationShutdown(
        down("Lost communication with MCU 'mcu'"),
        [typed("// user asked: what does 'timer too close' mean?")],
        opts,
      ),
    ).toBe(false);
  });
});
