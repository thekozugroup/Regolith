/**
 * Timelapse — modes, per-print intent, and the honest RECORDING derivation.
 *
 * Everything here is pure. The transport lives in `lib/moonraker.ts` and the
 * pre-print write lives in `lib/printerActions.ts`; this module holds the
 * rules both of them (and the UI) have to agree on.
 *
 * THE TRAP THIS MODULE EXISTS TO AVOID
 *
 * moonraker-timelapse ships two capture modes and they are not
 * interchangeable:
 *
 *  - `layermacro` — a frame is taken only when the SLICED GCODE calls
 *    `TIMELAPSE_TAKE_FRAME` on layer change. Layer-aligned and the better
 *    looking result, but a file sliced without that custom gcode records
 *    absolutely nothing, silently, while every status field says "enabled".
 *  - `hyperlapse` — Moonraker starts its own timer when a file is selected
 *    and takes a frame every `hyperlapse_cycle` seconds. Time-spaced rather
 *    than layer-aligned, but it works with ANY existing gcode file and needs
 *    no re-slicing.
 *
 * So "enable timelapse" from a print dialog defaults to `hyperlapse`: a
 * toggle that appears to work and yields an empty folder is worse than no
 * toggle. An owner who deliberately pins `layermacro` in Settings is
 * respected — and warned, at the point of starting a print, that the file may
 * capture nothing.
 */

/** Capture modes Regolith is willing to write. */
export type TimelapseMode = "hyperlapse" | "layermacro";

export const TIMELAPSE_MODES: readonly TimelapseMode[] = [
  "hyperlapse",
  "layermacro",
] as const;

/**
 * Default mode. See the module note: this is the only mode that records with
 * the gcode files an owner already has.
 */
export const DEFAULT_TIMELAPSE_MODE: TimelapseMode = "hyperlapse";

/** Where the print dialog persists the owner's per-print recording choice. */
export const TIMELAPSE_STORAGE_KEY = "forge.print.timelapse";

/** Where Settings persists a deliberately pinned capture mode. */
export const TIMELAPSE_MODE_STORAGE_KEY = "forge.timelapse.mode";

export function isTimelapseMode(value: unknown): value is TimelapseMode {
  return value === "hyperlapse" || value === "layermacro";
}

/**
 * A mode is only honoured when it is one Regolith understands. A cleared
 * store, a hand-edited key, or a backup from another build all resolve to the
 * mode that actually captures.
 */
export function timelapseModeFromStorage(stored: string | null): TimelapseMode {
  return isTimelapseMode(stored) ? stored : DEFAULT_TIMELAPSE_MODE;
}

/**
 * Recording is OFF unless it was explicitly turned on.
 *
 * Deliberately the opposite of the KAMP default: a timelapse writes frames to
 * the printer's own storage and re-encodes video on a small SBC at the end of
 * every job. That is a choice, not a quality-of-life default.
 */
export function timelapseEnabledFromStorage(stored: string | null): boolean {
  return stored === "1";
}

/**
 * The exact body sent to `POST /machine/timelapse/settings`.
 *
 * Written on EVERY print start, in both directions. The setting is a single
 * global value in Moonraker's database, shared with Fluidd and the stock
 * touchscreen, so the previous value is never something to assume — "off"
 * has to be asserted just as loudly as "on".
 *
 * `mode` rides along with an enable so the mode and the switch can never
 * disagree; a disable does not touch the mode, because the owner's pinned
 * preference must survive a print they chose not to record.
 */
export function timelapseSettingsWrite(
  enabled: boolean,
  mode: TimelapseMode,
): Record<string, string | boolean> {
  return enabled ? { enabled: true, mode } : { enabled: false };
}

/* -------------------------------------------------------------------------
 * Live capture state, derived from `notify_timelapse_event`.
 * ---------------------------------------------------------------------- */

export type TimelapseRenderStatus = "running" | "success" | "skipped" | "error";

export interface TimelapseRender {
  status: TimelapseRenderStatus;
  /** 0-100 while running; 100 on success; null when the plugin sent none. */
  progress: number | null;
  /** Output file, when the plugin named one. */
  filename: string | null;
  /** The plugin's own message, for skipped/error. */
  message: string | null;
}

export interface TimelapseActivity {
  /** Frame number last reported, or null when none has arrived. */
  frames: number | null;
  /** ms timestamp of that frame — the whole basis of RECORDING honesty. */
  lastFrameAt: number | null;
  /** The most recent render, or null when none has been reported. */
  render: TimelapseRender | null;
}

export const NO_TIMELAPSE_ACTIVITY: TimelapseActivity = {
  frames: null,
  lastFrameAt: null,
  render: null,
};

/** The payload shape `notify_timelapse_event` carries. All fields optional. */
export interface TimelapseEvent {
  action?: string;
  frame?: number | string;
  status?: string;
  progress?: number | string;
  msg?: string;
  filename?: string;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function renderStatus(value: unknown): TimelapseRenderStatus | null {
  return value === "running" ||
    value === "success" ||
    value === "skipped" ||
    value === "error"
    ? value
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Fold one plugin event into the live capture state. Total: an event this
 * build does not understand leaves the state exactly as it was, because a
 * cockpit readout may never be reset by a message it failed to parse.
 */
export function reduceTimelapseEvent(
  previous: TimelapseActivity,
  event: TimelapseEvent | null | undefined,
  now: number,
): TimelapseActivity {
  if (!event || typeof event !== "object") return previous;

  if (event.action === "newframe") {
    const frame = finiteNumber(event.frame);
    if (frame === null || frame < 0) return previous;
    // A frame arriving means a NEW capture run: the previous job's render
    // banner is history and must not sit over a live recording.
    return { frames: Math.floor(frame), lastFrameAt: now, render: null };
  }

  if (event.action === "render") {
    const status = renderStatus(event.status);
    if (!status) return previous;
    const reported = finiteNumber(event.progress);
    const progress =
      reported === null
        ? status === "success"
          ? 100
          : null
        : Math.min(100, Math.max(0, reported));
    return {
      frames: previous.frames,
      // ANY render event means capture has stopped — autorender fires when
      // the print completes. Dropping the frame clock here is what makes the
      // RECORDING lamp go dark on that edge instead of coasting for another
      // two and a half minutes on the staleness timeout. A capture that
      // resumes re-lights it with its next frame.
      lastFrameAt: null,
      render: {
        status,
        progress,
        filename: text(event.filename),
        message: text(event.msg),
      },
    };
  }

  return previous;
}

/**
 * How long a frame stays proof of an active recording.
 *
 * The plugin's stock `hyperlapse_cycle` is 30s and layer-macro frames on a
 * large layer can be further apart still, so the window has to be generous;
 * what it must NOT do is stay lit forever after capture stops.
 */
export const RECORDING_STALE_MS = 150_000;

/**
 * THE ENGINE-LIGHT RULE, applied to recording.
 *
 * `enabled: true` is a setting, not an observation — it is true right now on
 * a printer that has never captured a single frame. The lamp lights only
 * while frames are actually ADVANCING, which is the one thing that cannot be
 * faked by a stale global setting or the wrong capture mode.
 */
export function isRecordingNow(
  activity: TimelapseActivity,
  now: number,
  staleMs: number = RECORDING_STALE_MS,
): boolean {
  if (activity.frames === null || activity.lastFrameAt === null) return false;
  const age = now - activity.lastFrameAt;
  return age >= 0 && age < staleMs;
}
