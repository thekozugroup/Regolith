import { describe, expect, test } from "bun:test";
import {
  INITIAL_LIGHT_AUTO_STATE,
  reduceLightAuto,
  withManualLightIntent,
  type LightAutoState,
} from "../src/lib/lightControl";

/** Replay a telemetry stream and collect every point auto-ON would fire. */
function replay(
  stream: Array<[string | undefined, string | undefined]>,
  start: LightAutoState = INITIAL_LIGHT_AUTO_STATE,
  manualAt: number[] = [],
): { fires: number[]; state: LightAutoState } {
  let state = start;
  const fires: number[] = [];
  stream.forEach(([printState, filename], index) => {
    const folded = reduceLightAuto(state, printState, filename);
    state = folded.state;
    if (folded.autoOn) fires.push(index);
    if (manualAt.includes(index)) state = withManualLightIntent(state);
  });
  return { fires, state };
}

describe("auto-ON at print start", () => {
  test("fires once on the edge into printing, not on every tick", () => {
    const { fires } = replay([
      ["standby", ""],
      ["standby", ""],
      ["printing", "part.gcode"],
      ["printing", "part.gcode"],
      ["printing", "part.gcode"],
    ]);
    expect(fires).toEqual([2]);
  });

  // Opening a tab onto a print already running is not a print starting. The
  // lamp may already have been switched off by hand an hour ago.
  test("never fires on the first observation, even mid-print", () => {
    const { fires } = replay([
      ["printing", "part.gcode"],
      ["printing", "part.gcode"],
    ]);
    expect(fires).toEqual([]);
  });

  test("a pause and resume is the same job, so it does not re-fire", () => {
    const { fires } = replay([
      ["standby", ""],
      ["printing", "part.gcode"],
      ["paused", "part.gcode"],
      ["printing", "part.gcode"],
    ]);
    expect(fires).toEqual([1]);
  });

  test("the next print lights up again", () => {
    const { fires } = replay([
      ["standby", ""],
      ["printing", "one.gcode"],
      ["complete", "one.gcode"],
      ["standby", ""],
      ["printing", "two.gcode"],
    ]);
    expect(fires).toEqual([1, 4]);
  });

  // The owner's rule, in full: "assume light on during print (can be manually
  // turned off)". Turned off means turned off.
  test("a manual OFF during a print sticks for the rest of that job", () => {
    const { fires, state } = replay(
      [
        ["standby", ""],
        ["printing", "part.gcode"],
        ["printing", "part.gcode"],
        ["paused", "part.gcode"],
        ["printing", "part.gcode"],
        ["printing", "part.gcode"],
      ],
      INITIAL_LIGHT_AUTO_STATE,
      [1],
    );
    expect(fires).toEqual([1]);
    expect(state.manualOverride).toBe(true);
  });

  test("a manual choice dies with its job, so the next print is unaffected", () => {
    const { fires } = replay(
      [
        ["standby", ""],
        ["printing", "one.gcode"],
        ["complete", "one.gcode"],
        ["printing", "two.gcode"],
      ],
      INITIAL_LIGHT_AUTO_STATE,
      [1],
    );
    expect(fires).toEqual([1, 3]);
  });

  test("an override recorded against a job suppresses a re-detected edge", () => {
    const held: LightAutoState = {
      observed: true,
      job: "part.gcode",
      manualOverride: true,
    };
    // Same filename, but the job identity churns through idle and back.
    expect(reduceLightAuto(held, "standby", "").autoOn).toBe(false);
    expect(reduceLightAuto(held, "printing", "other.gcode").autoOn).toBe(false);
  });

  // A toggle while the printer is idle is not a standing instruction about
  // the next print — the owner's rule is that a print assumes the lamp on.
  test("a manual toggle while idle records nothing and blocks nothing", () => {
    const idle: LightAutoState = { observed: true, job: "", manualOverride: false };
    expect(withManualLightIntent(idle)).toEqual(idle);
    const { fires } = replay(
      [
        ["standby", ""],
        ["printing", "part.gcode"],
      ],
      INITIAL_LIGHT_AUTO_STATE,
      [0],
    );
    expect(fires).toEqual([1]);
  });

  // Regression: the app holds an empty state until the first subscription
  // resolves. Treating that emptiness as "the first observation" made the
  // first real frame read as a transition, so opening a tab onto a running
  // print fired auto-ON and undid a lamp the owner had switched off.
  test("the pre-telemetry empty state is not an observation", () => {
    const { fires } = replay([
      [undefined, undefined],
      ["printing", "part.gcode"],
      ["printing", "part.gcode"],
    ]);
    expect(fires).toEqual([]);
  });

  test("a telemetry gap mid-job does not re-assert on the way back", () => {
    const { fires } = replay([
      ["standby", ""],
      ["printing", "part.gcode"],
      [undefined, undefined],
      ["printing", "part.gcode"],
    ]);
    expect(fires).toEqual([1]);
  });

  test("unknown or absent telemetry is not a job", () => {
    const { fires } = replay([
      ["standby", ""],
      [undefined, undefined],
      ["error", "part.gcode"],
      ["cancelled", "part.gcode"],
    ]);
    expect(fires).toEqual([]);
  });
});
