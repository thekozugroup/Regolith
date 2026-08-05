import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TIMELAPSE_MODE,
  NO_TIMELAPSE_ACTIVITY,
  RECORDING_STALE_MS,
  isRecordingNow,
  isTimelapseMode,
  reduceTimelapseEvent,
  timelapseEnabledFromStorage,
  timelapseModeFromStorage,
  timelapseSettingsWrite,
  type TimelapseActivity,
} from "../src/lib/timelapse";

describe("capture mode", () => {
  // THE WHOLE POINT. `layermacro` only captures when the SLICED FILE calls
  // TIMELAPSE_TAKE_FRAME, and the owner's files do not. A default of
  // layermacro would ship a toggle that looks like it works and records
  // nothing at all.
  test("defaults to the mode that records with files you already have", () => {
    expect(DEFAULT_TIMELAPSE_MODE).toBe("hyperlapse");
    expect(timelapseModeFromStorage(null)).toBe("hyperlapse");
  });

  test("a deliberately pinned mode is respected", () => {
    expect(timelapseModeFromStorage("layermacro")).toBe("layermacro");
    expect(timelapseModeFromStorage("hyperlapse")).toBe("hyperlapse");
  });

  test("garbage in storage falls back to the capturing default", () => {
    for (const raw of ["", "1", "HYPERLAPSE", "{}", "layer-macro", "null"]) {
      expect(timelapseModeFromStorage(raw)).toBe("hyperlapse");
    }
  });

  test("only the two known modes are modes", () => {
    expect(isTimelapseMode("hyperlapse")).toBe(true);
    expect(isTimelapseMode("layermacro")).toBe(true);
    for (const value of [null, undefined, 1, "", "other", {}]) {
      expect(isTimelapseMode(value)).toBe(false);
    }
  });
});

describe("per-print recording choice", () => {
  // Deliberately the opposite of the KAMP default: recording writes frames to
  // the printer's own storage and re-encodes video on the host at the end of
  // every job. That is a choice, not a quality-of-life default.
  test("a fresh browser records nothing until asked", () => {
    expect(timelapseEnabledFromStorage(null)).toBe(false);
    expect(timelapseEnabledFromStorage("")).toBe(false);
    expect(timelapseEnabledFromStorage("true")).toBe(false);
  });

  test("an explicit opt-in sticks, an explicit opt-out sticks", () => {
    expect(timelapseEnabledFromStorage("1")).toBe(true);
    expect(timelapseEnabledFromStorage("0")).toBe(false);
  });
});

describe("the settings write", () => {
  test("an enable always carries the mode, so the two cannot disagree", () => {
    expect(timelapseSettingsWrite(true, "hyperlapse")).toEqual({
      enabled: true,
      mode: "hyperlapse",
    });
    expect(timelapseSettingsWrite(true, "layermacro")).toEqual({
      enabled: true,
      mode: "layermacro",
    });
  });

  // The flag is one global value shared with Fluidd and the stock screen, so
  // "do not record this one" has to be asserted, not assumed.
  test("a disable asserts off and leaves the owner's pinned mode alone", () => {
    expect(timelapseSettingsWrite(false, "layermacro")).toEqual({
      enabled: false,
    });
    expect(timelapseSettingsWrite(false, "hyperlapse")).toEqual({
      enabled: false,
    });
  });

  test("never writes the blocked snapshoturl key", () => {
    for (const write of [
      timelapseSettingsWrite(true, "hyperlapse"),
      timelapseSettingsWrite(false, "hyperlapse"),
    ]) {
      expect(Object.keys(write)).not.toContain("snapshoturl");
    }
  });
});

describe("notify_timelapse_event reduction", () => {
  const T = 1_000_000;

  test("a frame records its number and the moment it arrived", () => {
    const next = reduceTimelapseEvent(
      NO_TIMELAPSE_ACTIVITY,
      { action: "newframe", frame: 7 },
      T,
    );
    expect(next).toEqual({ frames: 7, lastFrameAt: T, render: null });
  });

  test("the plugin's string frame numbers parse", () => {
    const next = reduceTimelapseEvent(
      NO_TIMELAPSE_ACTIVITY,
      { action: "newframe", frame: "12" },
      T,
    );
    expect(next.frames).toBe(12);
  });

  test("a new frame clears the previous job's render banner", () => {
    const after: TimelapseActivity = {
      frames: 300,
      lastFrameAt: null,
      render: { status: "success", progress: 100, filename: "a.mp4", message: null },
    };
    const next = reduceTimelapseEvent(after, { action: "newframe", frame: 1 }, T);
    expect(next.render).toBeNull();
    expect(next.frames).toBe(1);
  });

  test("render progress is clamped and carried", () => {
    const running = reduceTimelapseEvent(
      { frames: 40, lastFrameAt: T - 1_000, render: null },
      { action: "render", status: "running", progress: 42.6 },
      T,
    );
    expect(running.render).toEqual({
      status: "running",
      progress: 42.6,
      filename: null,
      message: null,
    });
    // Even a RUNNING render means capture has stopped — autorender fires on
    // print completion — so the frame clock is dropped and the RECORDING
    // lamp goes dark on that edge.
    expect(running.lastFrameAt).toBeNull();
    expect(isRecordingNow(running, T)).toBe(false);

    for (const [reported, expected] of [
      [-20, 0],
      [180, 100],
    ] as const) {
      const clamped = reduceTimelapseEvent(
        NO_TIMELAPSE_ACTIVITY,
        { action: "render", status: "running", progress: reported },
        T,
      );
      expect(clamped.render?.progress).toBe(expected);
    }
  });

  test("a terminal render stops the capture clock and keeps its message", () => {
    const done = reduceTimelapseEvent(
      { frames: 88, lastFrameAt: T, render: null },
      {
        action: "render",
        status: "success",
        filename: "timelapse_2026.mp4",
        msg: "done",
      },
      T + 10,
    );
    expect(done.lastFrameAt).toBeNull();
    expect(done.frames).toBe(88);
    expect(done.render).toEqual({
      status: "success",
      progress: 100,
      filename: "timelapse_2026.mp4",
      message: "done",
    });

    const skipped = reduceTimelapseEvent(
      { frames: 1, lastFrameAt: T, render: null },
      { action: "render", status: "skipped", msg: "not enough frames" },
      T,
    );
    expect(skipped.render).toEqual({
      status: "skipped",
      progress: null,
      filename: null,
      message: "not enough frames",
    });
  });

  // A cockpit readout may never be reset by a message this build failed to
  // understand — silence is not the same as "nothing is happening".
  test("unparseable events leave the state exactly as it was", () => {
    const live: TimelapseActivity = { frames: 5, lastFrameAt: T, render: null };
    for (const event of [
      null,
      undefined,
      {},
      { action: "unknown" },
      { action: "newframe" },
      { action: "newframe", frame: "not a number" },
      { action: "newframe", frame: Number.NaN },
      { action: "newframe", frame: -3 },
      { action: "render" },
      { action: "render", status: "banana" },
    ]) {
      expect(reduceTimelapseEvent(live, event, T + 5)).toBe(live);
    }
  });
});

describe("RECORDING honesty", () => {
  const T = 5_000_000;

  // The engine-light rule. `enabled: true` is a SETTING and it is true right
  // now on a printer that has never captured a frame — most obviously one
  // left in layermacro mode with files that never call the macro.
  test("never lights on a printer that has captured nothing", () => {
    expect(isRecordingNow(NO_TIMELAPSE_ACTIVITY, T)).toBe(false);
    expect(
      isRecordingNow(
        { frames: null, lastFrameAt: null, render: null },
        T,
      ),
    ).toBe(false);
  });

  test("lights while frames are advancing", () => {
    expect(isRecordingNow({ frames: 3, lastFrameAt: T - 1_000, render: null }, T)).toBe(
      true,
    );
  });

  test("goes dark when frames stop arriving", () => {
    expect(
      isRecordingNow(
        { frames: 3, lastFrameAt: T - RECORDING_STALE_MS, render: null },
        T,
      ),
    ).toBe(false);
    expect(
      isRecordingNow(
        { frames: 3, lastFrameAt: T - RECORDING_STALE_MS - 1, render: null },
        T,
      ),
    ).toBe(false);
  });

  test("goes dark the moment a render starts reporting a terminal state", () => {
    const done = reduceTimelapseEvent(
      { frames: 120, lastFrameAt: T, render: null },
      { action: "render", status: "success", progress: 100 },
      T,
    );
    expect(isRecordingNow(done, T)).toBe(false);
  });

  // A clock that jumped backwards must not light a lamp for a frame that has
  // not happened yet.
  test("a future frame timestamp does not light it", () => {
    expect(isRecordingNow({ frames: 1, lastFrameAt: T + 10_000, render: null }, T)).toBe(
      false,
    );
  });
});
