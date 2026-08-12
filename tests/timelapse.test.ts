import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TIMELAPSE_MODE,
  NO_TIMELAPSE_ACTIVITY,
  RECORDING_STALE_MS,
  RENDER_CONFIRMATION,
  RENDER_THREAD_CAP,
  isRecordingNow,
  ownerRenderParams,
  timelapseRenderGate,
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
      autorender: false,
      extraoutputparams: RENDER_THREAD_CAP,
    });
    expect(timelapseSettingsWrite(true, "layermacro")).toEqual({
      enabled: true,
      mode: "layermacro",
      autorender: false,
      extraoutputparams: RENDER_THREAD_CAP,
    });
  });

  // The flag is one global value shared with Fluidd and the stock screen, so
  // "do not record this one" has to be asserted, not assumed.
  test("a disable asserts off and leaves the owner's pinned mode alone", () => {
    expect(timelapseSettingsWrite(false, "layermacro")).toEqual({
      enabled: false,
      autorender: false,
      extraoutputparams: RENDER_THREAD_CAP,
    });
    expect(timelapseSettingsWrite(false, "hyperlapse")).toEqual({
      enabled: false,
      autorender: false,
      extraoutputparams: RENDER_THREAD_CAP,
    });
  });

  // THE INCIDENT. Autorender ran ffmpeg over 1873 frames unattended on a
  // 2-core SoC, load went 2 → 30, and Klipper shut down with "Rescheduled
  // timer in the past". Enabling recording without disarming autorender is
  // the bug, so the disarm rides in the SAME write — never a second one that
  // could fail on its own.
  test("every write disarms autorender, in both directions", () => {
    for (const write of [
      timelapseSettingsWrite(true, "hyperlapse"),
      timelapseSettingsWrite(true, "layermacro"),
      timelapseSettingsWrite(false, "hyperlapse"),
      timelapseSettingsWrite(true, "hyperlapse", { extraoutputparams: "-crf 20" }),
    ]) {
      expect(write.autorender).toBe(false);
    }
  });

  // ffmpeg honours the LAST -threads, so this overrides the component's
  // hardcoded `-threads 2` without patching a third-party file.
  test("the thread cap is written so a render cannot own both cores", () => {
    expect(RENDER_THREAD_CAP).toBe("-threads 1");
    expect(timelapseSettingsWrite(true, "hyperlapse").extraoutputparams).toBe(
      "-threads 1",
    );
    // Nothing of the owner's to protect: absent, empty, whitespace, a
    // non-string, or already our own cap.
    for (const current of [
      null,
      undefined,
      {},
      { extraoutputparams: "" },
      { extraoutputparams: "   " },
      { extraoutputparams: 2 },
      { extraoutputparams: RENDER_THREAD_CAP },
    ]) {
      expect(ownerRenderParams(current)).toBeNull();
      expect(timelapseSettingsWrite(true, "hyperlapse", current).extraoutputparams).toBe(
        RENDER_THREAD_CAP,
      );
    }
  });

  // `extraoutputparams` is one free-text string. Writing ours over theirs
  // would silently delete work they did on purpose.
  test("an owner's own output params are respected, never clobbered", () => {
    const current = { extraoutputparams: "-crf 18 -preset veryslow" };
    expect(ownerRenderParams(current)).toBe("-crf 18 -preset veryslow");
    const write = timelapseSettingsWrite(true, "hyperlapse", current);
    expect(write).toEqual({
      enabled: true,
      mode: "hyperlapse",
      autorender: false,
    });
    expect(Object.keys(write)).not.toContain("extraoutputparams");
    // ...and the disarm still happens, because that one is not a preference.
    expect(write.autorender).toBe(false);
    // Padding is not a different setting.
    expect(ownerRenderParams({ extraoutputparams: "  -threads 1  " })).toBeNull();
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

describe("the manual render gate", () => {
  const IDLE = {
    connected: true,
    busyReason: null,
    queuedJobs: 0,
    rendering: false,
  };

  test("an idle, connected printer may render", () => {
    expect(timelapseRenderGate(IDLE)).toEqual({ allowed: true, reason: null });
    // Unknown is not blocked: the live print state is the authority.
    expect(timelapseRenderGate({ ...IDLE, queuedJobs: null }).allowed).toBe(true);
  });

  // The whole point. A render during a print is the failure that hung this
  // machine, with a live job attached.
  test("a print in flight blocks it, and says why", () => {
    for (const busyReason of [
      "Printing now",
      "Paused",
      "Macro / calibration in progress",
    ]) {
      const gate = timelapseRenderGate({ ...IDLE, busyReason });
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toContain(busyReason);
      expect(gate.reason).toContain("starve Klipper");
    }
  });

  test("a queued job blocks it too — it is about to become a print", () => {
    const gate = timelapseRenderGate({ ...IDLE, queuedJobs: 2 });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("queued");
  });

  test("a render already running is not started twice", () => {
    const gate = timelapseRenderGate({ ...IDLE, rendering: true });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("already running");
  });

  test("an offline printer cannot be asked", () => {
    const gate = timelapseRenderGate({ ...IDLE, connected: false });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("offline");
  });

  // Every blocked answer must carry a reason the owner can read — a disabled
  // control with no explanation is the thing this cockpit refuses to ship.
  test("no silent refusals", () => {
    for (const input of [
      { ...IDLE, connected: false },
      { ...IDLE, busyReason: "Printing now" },
      { ...IDLE, queuedJobs: 1 },
      { ...IDLE, rendering: true },
    ]) {
      const gate = timelapseRenderGate(input);
      expect(gate.allowed).toBe(false);
      expect(gate.reason?.length ?? 0).toBeGreaterThan(20);
    }
  });

  test("the warning names the cost and the precondition", () => {
    expect(RENDER_CONFIRMATION.message).toContain("CPU-heavy");
    expect(RENDER_CONFIRMATION.message).toContain("long time");
    expect(RENDER_CONFIRMATION.message).toContain("idle");
    expect(RENDER_CONFIRMATION.risk).toBe("caution");
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
