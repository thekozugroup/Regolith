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

/* -------------------------------------------------------------------------
 * Rendering — the part that hung the printer.
 * ---------------------------------------------------------------------- */

/**
 * THE INCIDENT, IN ONE COMMENT.
 *
 * A 15h33m print finished with the plugin's `autorender` still armed. On
 * completion moonraker-timelapse ran ffmpeg over 1873 frames at 1280x720
 * with `-threads 2` HARDCODED (timelapse.py:684-694 — no nice, no ionice)
 * on a 2-core SoC. Load went 2 → 30 and 28 seconds later Klipper died with
 * `MCU 'rpi' shutdown: Rescheduled timer in the past` — host CPU
 * starvation. The machine hung until it was power-cycled. The print had
 * just finished, so nothing was lost; the SAME starvation during a print
 * kills a live job.
 *
 * Two facts fall out of that, and neither is a preference:
 *
 *  1. Unattended render is not safe on this class of hardware. Regolith
 *     therefore asserts `autorender: false` in the same write that turns
 *     recording on — see `timelapseSettingsWrite`. Rendering is something
 *     the owner triggers, on an idle printer, watching it happen.
 *  2. A render must never be allowed to own both cores. ffmpeg honours the
 *     LAST `-threads` on the command line, so appending our own overrides
 *     the component's hardcoded `-threads 2` without patching a
 *     third-party file.
 *
 * The wider rule: never rely on a third-party component's defaults being
 * safe on constrained hardware.
 */
export const RENDER_THREAD_CAP = "-threads 1";

/** The slice of the plugin's config Regolith reads before writing. */
export interface TimelapseRenderConfig {
  extraoutputparams?: unknown;
  [key: string]: unknown;
}

/**
 * The owner's OWN ffmpeg output params, when they have deliberately set
 * some. `extraoutputparams` is a single free-text string: writing ours over
 * theirs would silently delete work they did on purpose, so a non-empty
 * value that is not simply our own cap reads as theirs and is left alone.
 *
 * Returns null when the field is empty, unreadable, or already exactly the
 * cap Regolith writes — in all three cases there is nothing of the owner's
 * to protect.
 */
export function ownerRenderParams(
  current: TimelapseRenderConfig | null | undefined,
): string | null {
  if (!current || typeof current !== "object") return null;
  const raw = current.extraoutputparams;
  const params = typeof raw === "string" ? raw.trim() : "";
  if (!params || params === RENDER_THREAD_CAP) return null;
  return params;
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
 *
 * `autorender: false` and the thread cap ride along in BOTH directions, for
 * the same reason `enabled: false` does: the value is global and the last
 * thing to touch it may have been another UI. Those two keys are not
 * preferences — they are the fix for a host that starved Klipper to death
 * (see RENDER_THREAD_CAP). A mode is a taste; an armed autorender is a
 * hung printer.
 */
export function timelapseSettingsWrite(
  enabled: boolean,
  mode: TimelapseMode,
  current?: TimelapseRenderConfig | null,
): Record<string, string | boolean> {
  const write: Record<string, string | boolean> = enabled
    ? { enabled: true, mode }
    : { enabled: false };
  write.autorender = false;
  if (ownerRenderParams(current) === null) {
    write.extraoutputparams = RENDER_THREAD_CAP;
  }
  return write;
}

/* -------------------------------------------------------------------------
 * The manual render, and when it is allowed to run.
 * ---------------------------------------------------------------------- */

export interface TimelapseRenderGate {
  allowed: boolean;
  /** Why not, in the owner's words. Null only when allowed. */
  reason: string | null;
}

/**
 * Whether the owner may trigger a render RIGHT NOW.
 *
 * Rendering competes with Klipper for the same two cores. The gate is
 * therefore not a nicety: a render started during a print is the exact
 * shape of the failure that hung this machine, with a live job attached.
 *
 * `queuedJobs` is null when the host does not answer the job-queue API —
 * unknown is not the same as zero, but it is not a reason to block either,
 * because the live print state is the authority on what is running.
 */
export function timelapseRenderGate(input: {
  connected: boolean;
  /** `SafetyState.busyReason` when busy, else null. */
  busyReason: string | null;
  queuedJobs: number | null;
  rendering: boolean;
}): TimelapseRenderGate {
  if (!input.connected) {
    return {
      allowed: false,
      reason: "Printer is offline — Regolith cannot ask it to render.",
    };
  }
  if (input.busyReason) {
    return {
      allowed: false,
      reason: `${input.busyReason} — rendering re-encodes video on the printer's own CPU and can starve Klipper. Wait until the printer is idle.`,
    };
  }
  if ((input.queuedJobs ?? 0) > 0) {
    return {
      allowed: false,
      reason:
        "A print is queued to start — a render would be competing with it for the printer's CPU. Clear the queue or let it finish first.",
    };
  }
  if (input.rendering) {
    return { allowed: false, reason: "A render is already running." };
  }
  return { allowed: true, reason: null };
}

/** The warning shown before a render starts. Never skipped. */
export const RENDER_CONFIRMATION = {
  risk: "caution",
  title: "Render timelapse now?",
  message:
    "Rendering re-encodes every captured frame into video with ffmpeg, on the printer's own processor. On this hardware that is CPU-heavy and can take a long time — a 1873-frame job once drove system load past 30 and shut Klipper down.\n\nThe printer should be idle and stay idle until the render finishes. Regolith caps the render to one core, but leave the printer alone while it runs.",
  confirmLabel: "Render now",
} as const;

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
