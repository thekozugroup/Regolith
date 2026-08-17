import { moonraker, type PrinterState } from "./moonraker";
import { canJog, getSafetyState, type Axis } from "./safety";
import {
  timelapseSettingsWrite,
  type TimelapseMode,
  type TimelapseRenderConfig,
} from "./timelapse";

/**
 * One optional pre-print setup choice.
 *
 * The string forms are klipper gcode steps. The object form is an HTTP step:
 * moonraker-timelapse has no gcode surface worth using — its `enabled` flag
 * lives in Moonraker's own database and writing it any other way (e.g. a
 * `SET_GCODE_VARIABLE` into the macro) would desync the value that Fluidd and
 * the stock touchscreen read. It carries its own `mode` because the owner's
 * pinned capture mode is a UI preference, not printer state (lib/timelapse).
 */
export type PrintSetupOption =
  | "kamp-on"
  | "kamp-off"
  | { kind: "timelapse"; enabled: boolean; mode: TimelapseMode };

/** Where the print dialog persists the owner's adaptive-bed-mesh choice. */
export const KAMP_STORAGE_KEY = "forge.print.kamp";

/**
 * Adaptive bed mesh (KAMP) is a basic print-QoL feature and defaults ON for
 * profiles that support it. Only an explicit opt-out ("0", persisted the
 * moment the owner toggles it off) disables it; a fresh browser, a cleared
 * store, or any unrecognized value all resolve to enabled.
 */
export function kampEnabledFromStorage(stored: string | null): boolean {
  return stored !== "0";
}

/**
 * Optional pre-print setup steps.
 *
 * Two kinds, because two different subsystems own the state:
 *
 *  - `gcode` — `object` is the klipper object the command needs. Regolith
 *    checks the live object list first and skips the step when the object is
 *    missing, because printers vary: KAMP here is driven by output pins,
 *    other setups use macro variables, and plenty of printers have neither.
 *  - `http` — a Moonraker REST write, for state klipper does not hold. Gated
 *    by the client exposing the call at all, never by the klipper object list.
 *
 * These steps are conveniences. None of them may ever stop a print — see
 * `applyPrintSetup`.
 */
type PrintSetupStep =
  | { kind: "gcode"; object: string; gcode: string }
  | {
      kind: "http";
      /** Shown to the owner, non-blocking, only when the write FAILED. */
      notice: string;
      run: (client: PrinterActionClient) => Promise<void>;
    };

const KAMP_STEPS: Record<"kamp-on" | "kamp-off", PrintSetupStep> = {
  "kamp-on": {
    kind: "gcode",
    object: "output_pin ADAPTIVE_BED_MESH",
    gcode: "SET_PIN PIN=ADAPTIVE_BED_MESH VALUE=1",
  },
  "kamp-off": {
    kind: "gcode",
    object: "output_pin ADAPTIVE_BED_MESH",
    gcode: "SET_PIN PIN=ADAPTIVE_BED_MESH VALUE=0",
  },
};

/**
 * Resolve one owner choice into the step that carries it out, or null when
 * this build/printer has no way to honour it.
 *
 * The timelapse write goes out on EVERY start, in both directions. Moonraker
 * holds a single global `enabled` flag that Fluidd and the stock touchscreen
 * share, so the state left behind by the last thing to touch it is never
 * something to assume — "do not record this one" has to be asserted.
 */
function resolveSetupStep(option: PrintSetupOption): PrintSetupStep | null {
  if (option === "kamp-on" || option === "kamp-off") return KAMP_STEPS[option];
  if (option && typeof option === "object" && option.kind === "timelapse") {
    return {
      kind: "http",
      notice: option.enabled
        ? "The printer did not accept the timelapse setting, so this print is not being recorded."
        : "The printer did not accept the timelapse setting, so a previously enabled timelapse may still be recording.",
      run: async (client) => {
        // Absent on hosts without the timelapse component. Nothing to do,
        // and nothing to report: the feature simply is not there.
        if (!client.writeTimelapseSettings) return;
        // Read first, for ONE reason: to see whether the owner has their own
        // ffmpeg output params, which the write must not overwrite. A read
        // that fails is not an error and never blocks the write — the
        // autorender disarm is what keeps a 15h print from ending in a host
        // that starves Klipper, and it is not negotiable on a GET.
        let current: TimelapseRenderConfig | null;
        try {
          current = (await client.getTimelapseSettings?.()) ?? null;
        } catch {
          current = null;
        }
        await client.writeTimelapseSettings(
          timelapseSettingsWrite(option.enabled, option.mode, current),
        );
      },
    };
  }
  return null;
}

/**
 * Chamber light.
 *
 * The printer exposes the lamp as a klipper `output_pin`, so the write is the
 * same `SET_PIN` family KAMP already uses. The klipper OBJECT is what the
 * profile declares (`output_pin LED`); the PIN name inside the command is the
 * part after the prefix.
 *
 * THE APP DOES NOT OWN AN OFF TIMER, AND MUST NEVER GROW ONE.
 * The owner's on-printer watchdog (`scripts/light-watchdog.py`, user-owned,
 * run every minute from cron) already turns the lamp off after 10 minutes of
 * inactivity — print finished, idle_timeout, or no toolhead movement — and it
 * only ever writes VALUE=0. A second timer in the browser would race the
 * watchdog for the same pin and produce a lamp that flickers off under one
 * clock and on under another. Regolith implements exactly two things: the
 * manual toggle, and a single auto-ON at print start (see lib/lightControl).
 */
const LIGHT_OBJECT_PREFIX = "output_pin ";

/**
 * `output_pin LED` → `LED`. Anything that is not a plain output pin returns
 * null and no command is ever built from it.
 */
export function lightPinName(object: string): string | null {
  if (!object.startsWith(LIGHT_OBJECT_PREFIX)) return null;
  const pin = object.slice(LIGHT_OBJECT_PREFIX.length).trim();
  return /^[A-Za-z0-9_]+$/.test(pin) ? pin : null;
}

export type PrinterAction =
  | { type: "start-print"; filename: string; setup: PrintSetupOption[] }
  | { type: "pause-print" }
  | { type: "resume-print" }
  | { type: "cancel-print" }
  | { type: "repeat-print"; filename: string }
  | { type: "emergency-stop"; context?: string }
  | { type: "restart-klipper" }
  | { type: "firmware-restart" }
  | { type: "console-gcode"; command: string }
  | {
      type: "tune-command";
      title: string;
      command: string;
      confirmation: string;
    }
  | { type: "set-pressure-advance"; value: number; save: boolean }
  | { type: "jog"; axis: Axis; delta: number }
  | { type: "home"; axis: "all" | "z" }
  | { type: "disable-motors" }
  /** `object` is the klipper object the profile declared, e.g. `output_pin LED`. */
  | { type: "set-light"; on: boolean; object: string };

export type ActionRisk = "routine" | "caution" | "critical";

export interface ActionConfirmation {
  risk: Exclude<ActionRisk, "routine">;
  title: string;
  message: string;
  confirmLabel: string;
}

export interface PrinterActionClient {
  getState(): PrinterState;
  isConnected(): boolean;
  /** Klipper objects currently loaded, e.g. `gcode_macro START_PRINT`. */
  listObjects(): Promise<string[]>;
  runGcode(script: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  startPrint(filename: string): Promise<void>;
  emergencyStop(): Promise<void>;
  restart(): Promise<void>;
  firmwareRestart(): Promise<void>;
  /**
   * Optional: `POST /machine/timelapse/settings`. Absent on hosts without
   * moonraker-timelapse, in which case the timelapse setup step is a no-op.
   */
  writeTimelapseSettings?(
    patch: Record<string, string | number | boolean>,
  ): Promise<unknown>;
  /**
   * Optional: `GET /machine/timelapse/settings`. Read only to protect an
   * owner's own `extraoutputparams` from being overwritten; a host that
   * cannot answer it still gets the write.
   */
  getTimelapseSettings?(): Promise<TimelapseRenderConfig>;
}

export interface ActionCheck {
  allowed: boolean;
  reason?: string;
}

export class PrinterActionError extends Error {
  public readonly code: "blocked" | "duplicate" | "invalid" | "command-failed";

  constructor(
    code: "blocked" | "duplicate" | "invalid" | "command-failed",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "PrinterActionError";
  }
}

const SAFE_CONSOLE_COMMANDS = new Set([
  "BED_MESH_OUTPUT",
  "DUMP_TMC",
  "GET_POSITION",
  "HELP",
  "QUERY_ENDSTOPS",
  "STATUS",
]);

const CRITICAL_CONSOLE_COMMANDS = new Set([
  "M112",
  "RESTART",
  "FIRMWARE_RESTART",
  "SAVE_CONFIG",
]);

const HARDWARE_COMMANDS = /^(?:G0|G1|G2|G3|G28|G29|M18|M84|M104|M109|M140|M190|M220|M221|SET_HEATER_TEMPERATURE|SET_KINEMATIC_POSITION|FORCE_MOVE|STEPPER_BUZZ|PID_CALIBRATE|BED_MESH_CALIBRATE|SHAPER_CALIBRATE|SCREWS_TILT_CALCULATE|PROBE|PROBE_ACCURACY|LOAD_FILAMENT|UNLOAD_FILAMENT|TURN_OFF_HEATERS)(?:\s|$)/i;

function firstCommandWord(line: string): string {
  return line.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? "";
}

export function normalizeConsoleCommand(command: string): string {
  const normalized = command.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    throw new PrinterActionError("invalid", "Enter a G-code command first.");
  }
  if (normalized.length > 4096) {
    throw new PrinterActionError(
      "invalid",
      "Command is too long. Keep console input under 4,096 characters.",
    );
  }
  if (normalized.includes("\0")) {
    throw new PrinterActionError("invalid", "Command contains an invalid null character.");
  }
  const executableLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(";") && !line.startsWith("#"));
  if (executableLines.length === 0) {
    throw new PrinterActionError("invalid", "Enter an executable G-code command.");
  }
  if (executableLines.length > 20) {
    throw new PrinterActionError(
      "invalid",
      "Console input is limited to 20 commands at once. Split this script into smaller steps.",
    );
  }
  return normalized;
}

export function getConsoleCommandRisk(command: string): {
  risk: ActionRisk;
  summary: string;
} {
  const normalized = normalizeConsoleCommand(command);
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(";") && !line.startsWith("#"));
  const words = lines.map(firstCommandWord);

  if (words.some((word) => CRITICAL_CONSOLE_COMMANDS.has(word))) {
    return {
      risk: "critical",
      summary: "Can immediately stop or restart printer control software.",
    };
  }
  if (lines.some((line) => HARDWARE_COMMANDS.test(line))) {
    return {
      risk: "critical",
      summary: "Can move hardware, heat components, or change printer state.",
    };
  }
  if (words.every((word) => SAFE_CONSOLE_COMMANDS.has(word))) {
    return { risk: "routine", summary: "Read-only diagnostic command." };
  }
  return {
    risk: "caution",
    summary: "Unknown or custom command. Printer behavior depends on its configuration.",
  };
}

function validFilename(filename: string): boolean {
  if (!filename || filename.length > 1024 || filename.startsWith("/")) return false;
  if (
    Array.from(filename).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    return false;
  }
  return !filename.split("/").includes("..");
}

function validTuneCommand(command: string): boolean {
  return (
    command.trim().length > 0 &&
    command.length <= 4096 &&
    !command.includes("\0")
  );
}

function isPrintActive(state: PrinterState): boolean {
  const printState = state.print_stats?.state;
  return printState === "printing" || printState === "paused";
}

export function guardPrinterAction(
  state: PrinterState,
  connected: boolean,
  action: PrinterAction,
): ActionCheck {
  if (!connected) {
    return {
      allowed: false,
      reason: "Printer is offline. Reconnect before sending a command.",
    };
  }

  const safety = getSafetyState(state);
  const printState = state.print_stats?.state ?? "standby";

  switch (action.type) {
    case "start-print":
    case "repeat-print":
      if (!validFilename(action.filename)) {
        return { allowed: false, reason: "Selected file name is invalid." };
      }
      if (!safety.klipperReady) {
        return { allowed: false, reason: "Klipper is not ready. Resolve its status first." };
      }
      if (safety.isBusy || isPrintActive(state)) {
        return {
          allowed: false,
          reason: `${safety.busyReason ?? "Printer is busy"}. Wait until it is idle.`,
        };
      }
      return { allowed: true };
    case "pause-print":
      return printState === "printing"
        ? { allowed: true }
        : { allowed: false, reason: "Only an active print can be paused." };
    case "resume-print":
      return printState === "paused"
        ? { allowed: true }
        : { allowed: false, reason: "Only a paused print can be resumed." };
    case "cancel-print":
      return isPrintActive(state)
        ? { allowed: true }
        : { allowed: false, reason: "There is no active print to cancel." };
    case "restart-klipper":
    case "firmware-restart":
      return safety.isBusy || isPrintActive(state)
        ? {
            allowed: false,
            reason: `${safety.busyReason ?? "Printer is busy"}. Restart is blocked.`,
          }
        : { allowed: true };
    case "emergency-stop":
      return { allowed: true };
    case "console-gcode": {
      try {
        const risk = getConsoleCommandRisk(action.command);
        if (!safety.klipperReady && risk.risk !== "critical") {
          return {
            allowed: false,
            reason: "Klipper is not ready. Use Settings for recovery controls.",
          };
        }
        return { allowed: true };
      } catch (error) {
        return {
          allowed: false,
          reason: error instanceof Error ? error.message : "Command is invalid.",
        };
      }
    }
    case "tune-command":
      if (!validTuneCommand(action.command)) {
        return { allowed: false, reason: "Tune command is invalid." };
      }
      if (!safety.klipperReady) {
        return { allowed: false, reason: "Klipper is not ready. Resolve its status first." };
      }
      return safety.isBusy || isPrintActive(state)
        ? {
            allowed: false,
            reason: `${safety.busyReason ?? "Printer is busy"}. Tuning is blocked.`,
          }
        : { allowed: true };
    case "set-pressure-advance":
      if (!Number.isFinite(action.value) || action.value < 0 || action.value > 0.2) {
        return {
          allowed: false,
          reason: "Pressure advance must be between 0 and 0.2 seconds.",
        };
      }
      if (!safety.klipperReady) {
        return { allowed: false, reason: "Klipper is not ready. Resolve its status first." };
      }
      return safety.isBusy || isPrintActive(state)
        ? {
            allowed: false,
            reason: `${safety.busyReason ?? "Printer is busy"}. Pressure advance changes are blocked.`,
          }
        : { allowed: true };
    case "jog":
      return canJog(state, safety, action.axis, action.delta);
    case "home":
      if (!safety.klipperReady) {
        return { allowed: false, reason: "Klipper is not ready. Resolve its status first." };
      }
      return safety.isBusy
        ? { allowed: false, reason: `${safety.busyReason ?? "Printer is busy"}. Homing is blocked.` }
        : { allowed: true };
    case "disable-motors":
      if (!safety.klipperReady) {
        return { allowed: false, reason: "Klipper is not ready. Resolve its status first." };
      }
      return safety.isBusy
        ? { allowed: false, reason: `${safety.busyReason ?? "Printer is busy"}. Motors must stay engaged.` }
        : { allowed: true };
    case "set-light":
      // A lamp is not motion and not heat: it is deliberately allowed WHILE
      // printing — lighting the chamber mid-job is the whole point. The only
      // gates are a well-formed pin and a klipper that can accept SET_PIN.
      if (!lightPinName(action.object)) {
        return { allowed: false, reason: "This printer has no light pin configured." };
      }
      if (!safety.klipperReady) {
        return { allowed: false, reason: "Klipper is not ready. Light control is unavailable." };
      }
      return { allowed: true };
  }
}

export function getActionConfirmation(
  action: PrinterAction,
): ActionConfirmation | null {
  switch (action.type) {
    case "start-print":
    case "repeat-print":
      return {
        risk: "caution",
        title: "Start this print?",
        message: `Start “${action.filename}”? Check that the build plate is seated, the bed is clear, and filament can feed freely.`,
        confirmLabel: "Start print",
      };
    case "cancel-print":
      return {
        risk: "critical",
        title: "Cancel the current print?",
        message: "Printing will stop and cannot be resumed. Heaters may remain hot while the printer runs its cancel routine.",
        confirmLabel: "Cancel print",
      };
    case "emergency-stop":
      return {
        risk: "critical",
        title: "Emergency stop?",
        message: `${action.context ? `${action.context} ` : ""}This immediately disables printer control. Klipper must be restarted before normal use. Use only when hardware or a person may be at risk.`,
        confirmLabel: "Emergency stop",
      };
    case "restart-klipper":
      return {
        risk: "caution",
        title: "Restart Klipper?",
        message: "Printer control will be briefly unavailable. This is blocked while a print or calibration is active.",
        confirmLabel: "Restart Klipper",
      };
    case "firmware-restart":
      return {
        risk: "caution",
        title: "Restart firmware?",
        message: "The printer controller will reconnect. This is blocked while a print or calibration is active.",
        confirmLabel: "Restart firmware",
      };
    case "disable-motors":
      return {
        risk: "caution",
        title: "Release the motors?",
        message: "Axis position will no longer be trusted. Home the printer before its next move.",
        confirmLabel: "Release motors",
      };
    case "console-gcode": {
      const risk = getConsoleCommandRisk(action.command);
      if (risk.risk === "routine") return null;
      return {
        risk: risk.risk,
        title: risk.risk === "critical" ? "Run hardware command?" : "Run custom command?",
        message: `${risk.summary}\n\n${normalizeConsoleCommand(action.command)}`,
        confirmLabel: "Run command",
      };
    }
    case "tune-command":
      return {
        risk: "critical",
        title: `Run ${action.title}?`,
        message: action.confirmation,
        confirmLabel: `Run ${action.title}`,
      };
    case "set-pressure-advance":
      return action.save
        ? {
            risk: "caution",
            title: "Apply and save pressure advance?",
            message:
              "This applies the new value, writes it to printer configuration, and restarts Klipper. Printing must remain idle.",
            confirmLabel: "Apply and save",
          }
        : null;
    default:
      return null;
  }
}

function actionKey(action: PrinterAction): string {
  switch (action.type) {
    case "start-print":
    case "repeat-print":
      return "print-start";
    case "pause-print":
    case "resume-print":
    case "cancel-print":
      return "print-control";
    case "restart-klipper":
    case "firmware-restart":
      return "printer-restart";
    case "jog":
    case "home":
    case "disable-motors":
      return "printer-motion";
    case "console-gcode":
      return "console-gcode";
    case "tune-command":
    case "set-pressure-advance":
      return "printer-tune";
    default:
      return action.type;
  }
}

/**
 * What `applyPrintSetup` did, beyond the user-facing notices:
 * `touchedPrinter` is true when any step was actually attempted against the
 * printer — a gcode send, or the timelapse HTTP write (which makes the
 * moonraker-timelapse component run its `_SET_TIMELAPSE_SETUP` macro on the
 * printer's behalf). The post-setup re-guard uses it to decide whether an
 * `idle_timeout == "Printing"` reading could be the echo of our own
 * commands. An attempt that FAILED still counts: the command may have
 * reached klipper even when the response did not come back clean.
 */
interface PrintSetupOutcome {
  notices: string[];
  touchedPrinter: boolean;
}

/**
 * Apply optional pre-print setup. NEVER THROWS.
 *
 * Every step here is a nicety. A missing klipper object, an unsupported
 * command, an unreachable REST endpoint, or a printer that rejects the write
 * must leave the print unaffected — the user asked to print, not to
 * configure. That guarantee covers the HTTP step exactly as it covers the
 * gcode ones: a timelapse that could not be armed is a note, never a refusal.
 *
 * Regolith used to send `SET_GCODE_VARIABLE MACRO=PRINT_START
 * VARIABLE=use_kamp` and abort the print when it failed. The K1 Max has no
 * `PRINT_START` macro (its start macro is `START_PRINT`) and no `use_kamp`
 * variable, so klipper rejected the mux key and every single print was
 * blocked. Both the wrong target and the fatal handling are fixed here.
 *
 * Returns what could not be done, so the caller can say so WITHOUT turning it
 * into an error. An empty notices array means every requested step landed (or
 * was legitimately skipped as unsupported).
 */
async function applyPrintSetup(
  client: PrinterActionClient,
  setup: PrintSetupOption[],
): Promise<PrintSetupOutcome> {
  const notices: string[] = [];
  let touchedPrinter = false;
  if (setup.length === 0) return { notices, touchedPrinter };

  const steps = setup
    .map(resolveSetupStep)
    .filter((step): step is PrintSetupStep => step !== null);
  if (steps.length === 0) return { notices, touchedPrinter };

  // Only asked for when a gcode step actually needs it, and a failure to read
  // it never suppresses the HTTP steps — they do not depend on klipper.
  let objects: string[] | null = null;
  if (steps.some((step) => step.kind === "gcode")) {
    try {
      objects = await client.listObjects();
    } catch {
      // Cannot confirm what this printer supports, so send no gcode.
      objects = null;
    }
  }

  for (const step of steps) {
    if (step.kind === "gcode") {
      if (!objects || !objects.includes(step.object)) continue;
      touchedPrinter = true;
      try {
        await client.runGcode(step.gcode);
      } catch {
        // Optional step. Keep going and start the print.
      }
      continue;
    }
    touchedPrinter = true;
    try {
      await step.run(client);
    } catch {
      // Optional step. Keep going and start the print — and tell the owner
      // afterwards, because a timelapse silently not recording is exactly the
      // failure this whole feature exists to avoid.
      notices.push(step.notice);
    }
  }
  return { notices, touchedPrinter };
}

/**
 * Post-setup re-guard, echo-aware. THE GUARD IS NOT WEAKENED — it is made
 * honest about whose activity it is looking at.
 *
 * Executing ANY gcode flips klipper's `idle_timeout.state` to "Printing" for
 * about a second (measured ~1.0s on the live K1 Max after a bare `SET_PIN`;
 * klipper's idle_timeout re-checks roughly one second after the last
 * activity). Print setup executes gcode: the KAMP `SET_PIN`, and the
 * timelapse HTTP write that has moonraker-timelapse run
 * `_SET_TIMELAPSE_SETUP`. So the guard's own setup used to trip the guard —
 * every dialog print with KAMP or timelapse enabled refused itself with
 * "Printer state changed during setup. Macro / calibration in progress."
 *
 * The echo has a precise signature: `idle_timeout == "Printing"` while
 * `print_stats` still shows NO job (a bare macro never touches print_stats)
 * and klipper stayed ready. Only that exact signature is granted a short
 * settling window, and only when setup actually touched the printer. It is
 * polled, not assumed: if the state does not return to Ready within the
 * grace, the printer is genuinely busy — someone really did start a macro or
 * calibration mid-setup — and the refusal stands. A `print_stats` change, a
 * dropped socket, or a not-ready klipper refuses immediately, exactly as
 * before.
 */
export const SETUP_ECHO_GRACE_MS = 5000;
export const SETUP_ECHO_POLL_MS = 500;

type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function recheckAfterSetup(
  client: PrinterActionClient,
  action: PrinterAction,
  touchedPrinter: boolean,
  sleep: Sleep,
): Promise<ActionCheck> {
  const polls = Math.ceil(SETUP_ECHO_GRACE_MS / SETUP_ECHO_POLL_MS);
  for (let attempt = 0; ; attempt += 1) {
    const state = client.getState();
    const check = guardPrinterAction(state, client.isConnected(), action);
    if (check.allowed) return check;
    if (!touchedPrinter) return check; // nothing of ours to attribute it to
    const printState = state.print_stats?.state;
    const jobActive = printState === "printing" || printState === "paused";
    const setupEchoOnly =
      client.isConnected() &&
      !jobActive &&
      state.idle_timeout?.state === "Printing" &&
      state.webhooks?.state === "ready";
    if (!setupEchoOnly || attempt >= polls) return check;
    await sleep(SETUP_ECHO_POLL_MS);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Printer did not provide an error message.";
}

/**
 * What a dispatched action did.
 *
 * `notices` appears only when an OPTIONAL step could not be carried out while
 * the action itself succeeded. It is deliberately not an error: the print
 * started, and the owner is told what it started without.
 */
export interface PrinterActionResult {
  executed: boolean;
  notices?: string[];
}

export function createPrinterActionRunner(
  client: PrinterActionClient,
  hooks: { sleep?: Sleep } = {},
) {
  const inFlight = new Set<string>();
  const sleep = hooks.sleep ?? defaultSleep;

  return async function runPrinterAction(
    action: PrinterAction,
    options: {
      confirm?: (details: ActionConfirmation) => boolean | Promise<boolean>;
    } = {},
  ): Promise<PrinterActionResult> {
    const key = actionKey(action);
    if (inFlight.has(key)) {
      throw new PrinterActionError(
        "duplicate",
        "That action is already in progress. Wait for it to finish.",
      );
    }

    const firstCheck = guardPrinterAction(client.getState(), client.isConnected(), action);
    if (!firstCheck.allowed) {
      throw new PrinterActionError("blocked", firstCheck.reason ?? "Action is blocked.");
    }

    inFlight.add(key);
    try {
      const confirmation = getActionConfirmation(action);
      if (confirmation) {
        if (!options.confirm || !(await options.confirm(confirmation))) {
          return { executed: false };
        }
      }

      // State may change while a confirmation is open. Always gate again.
      const finalCheck = guardPrinterAction(client.getState(), client.isConnected(), action);
      if (!finalCheck.allowed) {
        throw new PrinterActionError(
          "blocked",
          `Printer state changed. ${finalCheck.reason ?? "Action is no longer safe."}`,
        );
      }

      let setupNotices: string[] = [];
      try {
        switch (action.type) {
          case "start-print": {
            // Best-effort only. Cannot throw, so it cannot block the print.
            const outcome = await applyPrintSetup(client, action.setup);
            setupNotices = outcome.notices;
            // Setup takes time on the wire; re-gate on live state — but our
            // own setup commands briefly read as "busy" (see
            // recheckAfterSetup), so give exactly that signature a settling
            // window instead of refusing the print we just prepared.
            const startCheck = await recheckAfterSetup(
              client,
              action,
              outcome.touchedPrinter,
              sleep,
            );
            if (!startCheck.allowed) {
              throw new PrinterActionError(
                "blocked",
                `Printer state changed during setup. ${startCheck.reason ?? "Print was not started."}`,
              );
            }
            await client.startPrint(action.filename);
            break;
          }
          case "repeat-print":
            await client.startPrint(action.filename);
            break;
          case "pause-print":
            await client.pause();
            break;
          case "resume-print":
            await client.resume();
            break;
          case "cancel-print":
            await client.cancel();
            break;
          case "emergency-stop":
            await client.emergencyStop();
            break;
          case "restart-klipper":
            await client.restart();
            break;
          case "firmware-restart":
            await client.firmwareRestart();
            break;
          case "console-gcode":
            await client.runGcode(normalizeConsoleCommand(action.command));
            break;
          case "tune-command":
            await client.runGcode(action.command.trim());
            break;
          case "set-pressure-advance":
            await client.runGcode(
              `SET_PRESSURE_ADVANCE ADVANCE=${action.value.toFixed(4)}${
                action.save ? "\nSAVE_CONFIG" : ""
              }`,
            );
            break;
          case "jog":
            await client.runGcode(
              `SAVE_GCODE_STATE NAME=regolith_jog\nG91\nG1 ${action.axis}${action.delta} F3000\nRESTORE_GCODE_STATE NAME=regolith_jog`,
            );
            break;
          case "home":
            await client.runGcode(action.axis === "all" ? "G28" : "G28 Z");
            break;
          case "disable-motors":
            await client.runGcode("M84");
            break;
          case "set-light": {
            // Object-list gated exactly like KAMP: printers without the pin
            // get NOTHING on the wire. Skipping resolves as `executed: false`
            // so the caller rolls its optimistic state back instead of
            // claiming a lamp it never switched.
            const pin = lightPinName(action.object);
            if (!pin) return { executed: false };
            let objects: string[];
            try {
              objects = await client.listObjects();
            } catch {
              // Cannot confirm this printer has the pin, so send nothing.
              return { executed: false };
            }
            if (!objects.includes(action.object)) return { executed: false };
            await client.runGcode(`SET_PIN PIN=${pin} VALUE=${action.on ? 1 : 0}`);
            break;
          }
        }
      } catch (error) {
        if (error instanceof PrinterActionError) throw error;
        throw new PrinterActionError(
          "command-failed",
          `Printer rejected the action. ${errorMessage(error)}`,
        );
      }

      return setupNotices.length > 0
        ? { executed: true, notices: setupNotices }
        : { executed: true };
    } finally {
      inFlight.delete(key);
    }
  };
}

export const runPrinterAction = createPrinterActionRunner(moonraker);
