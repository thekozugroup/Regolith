/**
 * Moonraker WebSocket + REST client.
 *
 * Connects to Moonraker's JSON-RPC API:
 *   - WebSocket: /websocket  → live state pushes via notify_status_update
 *   - REST:      /printer/*  → one-off queries, gcode dispatch, file ops
 *
 * Usage:
 *   const mr = new Moonraker();
 *   mr.connect();
 *   mr.subscribe(["print_stats", "extruder", "heater_bed"], (state) => { ... });
 */

import {
  exponentialBackoff,
  isActiveWebSocketState,
  jitteredDelay,
  moonrakerReconnectDelay,
} from "./retry";
import {
  NO_TIMELAPSE_ACTIVITY,
  reduceTimelapseEvent,
  type TimelapseActivity,
  type TimelapseEvent,
} from "./timelapse";
import {
  appendHostSample,
  parseProcStatUpdate,
  reduceBufferStarvation,
  snapshotHostFaultContext,
  summarizeHostLoad,
  NO_BUFFER_STARVATION,
  type BufferStarvation,
  type HostFaultContext,
  type HostLoad,
  type ProcStatSample,
} from "./hostHealth";

type SubscriptionCallback = (state: PrinterState) => void;
type ConnectionCallback = (connected: boolean) => void;
type GcodeLogCallback = (lines: GcodeLine[]) => void;
type TimelapseCallback = (activity: TimelapseActivity) => void;

/**
 * What the link is actually doing, as opposed to what `readyState` claims.
 *
 *  - `down`      no socket. Either backing off, or deliberately disconnected.
 *  - `connecting` a socket exists but has not opened.
 *  - `live`      open, and data is arriving.
 *  - `stale`     open, and nothing has arrived for LINK_SILENCE_MS. This is
 *                the dangerous one: the dashboard looks live and is not.
 */
export type LinkState = "down" | "connecting" | "live" | "stale";
type LinkStateCallback = (state: LinkState) => void;

/**
 * How long a socket may sit in CONNECTING before it is written off.
 *
 * A half-open TCP connection — the normal outcome of closing a laptop lid or
 * moving between access points — leaves a socket that never opens and never
 * errors. Browsers do eventually give up, but on the order of minutes, and
 * `connect()` short-circuits on a CONNECTING socket, so nothing else would
 * ever retry in the meantime.
 */
export const CONNECT_TIMEOUT_MS = 10_000;

/**
 * How long an OPEN socket may go completely silent before it is treated as
 * dead and torn down.
 *
 * Moonraker sends `notify_proc_stat_update` about once a second unprompted,
 * on top of the status diffs, so total silence is not a quiet printer — it is
 * a link that has stopped carrying data while still reporting OPEN. The
 * check only arms once a server-initiated notification has actually been
 * seen, so a server that legitimately never pushes is never torn down.
 */
export const LINK_SILENCE_MS = 30_000;

/** How often the link is inspected without waiting for an event. */
export const LINK_CHECK_MS = 2_000;

/**
 * Deadline on the pre-print timelapse settings write. It is the one HTTP
 * request awaited ahead of `printer.print.start` (the WS RPCs on that path
 * carry their own 15s deadline), so it must not be able to hang a print:
 * a fetch that never settles is converted into an abort rejection, which
 * `applyPrintSetup` folds into the existing "started, but not recording"
 * notice. 5s is generous for a config write on a LAN and short enough that
 * the owner is never left staring at a stuck dialog.
 */
export const TIMELAPSE_WRITE_TIMEOUT_MS = 5_000;

/**
 * How long a connection must survive before it counts as a good one.
 *
 * The attempt counter used to reset the instant a socket opened, so a
 * Moonraker that accepts and immediately drops — which is exactly what it
 * does while Klipper is restarting — produced an endless 2-second reconnect
 * storm instead of backing off. Resetting only after the link has HELD
 * turns that flap into a proper retreat.
 */
export const STABLE_LINK_MS = 10_000;

export interface PrinterState {
  // Print state
  print_stats?: {
    state:
      | "standby"
      | "printing"
      | "paused"
      | "complete"
      | "cancelled"
      | "error";
    filename?: string;
    total_duration?: number;
    print_duration?: number;
    filament_used?: number;
    message?: string;
    info?: { total_layer?: number | null; current_layer?: number | null };
  };
  // Idle timeout
  idle_timeout?: { state: "Idle" | "Ready" | "Printing" };
  // Extruder
  extruder?: {
    temperature: number;
    target: number;
    power: number;
    pressure_advance?: number;
  };
  // Bed
  heater_bed?: { temperature: number; target: number; power: number };
  // Position
  toolhead?: {
    position: [number, number, number, number];
    homed_axes: string;
    print_time: number;
    estimated_print_time: number;
    max_velocity?: number;
    max_accel?: number;
    axis_minimum?: [number, number, number, number];
    axis_maximum?: [number, number, number, number];
  };
  // Virtual SD
  virtual_sdcard?: {
    progress: number;
    is_active: boolean;
    file_position: number;
    file_size: number;
  };
  // Fans
  fan?: { speed: number };
  // Webhooks
  webhooks?: { state: string; state_message: string };
  // Bed mesh — profile_name is "" until a mesh is loaded; a non-empty name
  // is the only proof a mesh is active (the KAMP ADAPTIVE_BED_MESH pin is
  // the TOGGLE, not proof). probed_matrix feeds the heatmap when present.
  bed_mesh?: { profile_name: string; probed_matrix?: number[][] };
  // Auxiliary temperature sensors / fans / heater_fans — driven by the
  // active profile, so klipper object names vary per printer. Indexed
  // access lets a profile uploader expose sensors without code changes.
  [klipperObject: `temperature_fan ${string}`]:
    | { temperature: number; target: number; speed: number }
    | undefined;
  [k2: `temperature_sensor ${string}`]: { temperature: number } | undefined;
  [k3: `heater_fan ${string}`]: { speed: number } | undefined;
  [k4: `heater_generic ${string}`]:
    | { temperature: number; target: number; power: number }
    | undefined;
  // Filament runout switches — subscribed only when the active profile
  // declares them (profile.filamentSensors). filament_detected === false is
  // the runout condition; `enabled` mirrors klipper's sensor arming.
  [k5: `filament_switch_sensor ${string}`]:
    | { filament_detected: boolean; enabled: boolean }
    | undefined;
  // Motion report (live position during macros)
  motion_report?: {
    live_position: [number, number, number, number];
    live_velocity: number;
    live_extruder_velocity: number;
  };
  // Gcode macro current state (custom macros publish via SET_GCODE_VARIABLE)
  gcode_move?: {
    position: [number, number, number, number];
    gcode_position: [number, number, number, number];
    speed: number;
    speed_factor: number;
    extrude_factor?: number;
    homing_origin?: [number, number, number, number];
  };
}

/** Lightweight in-memory log of recent gcode responses (notify_gcode_response). */
export interface GcodeLine {
  ts: number;
  text: string;
  type: "command" | "response";
}

interface RpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id: number;
}

interface RpcResponse<T = unknown> {
  jsonrpc: "2.0";
  result?: T;
  error?: { code: number; message: string };
  id: number;
}

interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown[];
}

const isProd = import.meta.env.PROD;
const HTTP_BASE = isProd ? "" : ""; // Vite proxy rewrites paths in dev
const WS_PATH = "/websocket";

export class Moonraker {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private state: PrinterState = {};
  private subs = new Set<SubscriptionCallback>();
  private connSubs = new Set<ConnectionCallback>();
  private gcodeLogSubs = new Set<GcodeLogCallback>();
  /** How many mounted consumers currently want each klipper object. */
  private fieldRefs = new Map<string, number>();
  /** The field set last pushed to (or queued for) the server. */
  private activeFields = new Set<string>();
  private syncQueued = false;
  /** Re-issues a subscribe the server REFUSED while the socket stayed open. */
  private subscribeRetryTimer: number | null = null;
  private subscribeRetryAttempt = 0;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private manuallyDisconnected = false;
  private gcodeLog: GcodeLine[] = [];
  private static MAX_LOG = 200;
  private timelapse: TimelapseActivity = NO_TIMELAPSE_ACTIVITY;
  private timelapseSubs = new Set<TimelapseCallback>();
  /**
   * Host-health state (host-health guard). The samples come from
   * `notify_proc_stat_update`, which this client ALREADY receives ~1 Hz as
   * the link-silence heartbeat and used to throw away — consuming it adds
   * zero subscriptions, zero HTTP traffic, and zero load on the printer.
   */
  private hostSamples: ProcStatSample[] = [];
  private hostStatsSubs = new Set<() => void>();
  private bufferStarvation: BufferStarvation = NO_BUFFER_STARVATION;
  /** Frozen the moment klippy enters shutdown/error — see getHostFaultContext. */
  private hostFaultContext: HostFaultContext | null = null;
  private linkSubs = new Set<LinkStateCallback>();
  private linkState: LinkState = "down";
  /** When the current socket was created — drives the CONNECTING timeout. */
  private socketCreatedAt = 0;
  /** When the current socket opened, or 0 while it has not. */
  private openedAt = 0;
  /** When anything last arrived on the wire. */
  private lastMessageAt = 0;
  /**
   * Whether this server has ever pushed unprompted. Until it has, silence
   * proves nothing and the staleness check stays disarmed.
   */
  private sawServerPush = false;
  private linkTimer: number | null = null;
  /** Injectable for tests; production takes the real one. */
  private random: () => number = Math.random;

  // ----- Connection lifecycle -----
  connect(): void {
    this.manuallyDisconnected = false;
    // An explicit connect outranks a pending backoff: whoever called this
    // wants the link NOW (a mount, a tab becoming visible, the network
    // coming back), not in another 30 seconds.
    this.clearReconnectTimer();
    if (isActiveWebSocketState(this.ws?.readyState)) {
      this.startLinkWatchdog();
      return;
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}${WS_PATH}`;
    const socket = new WebSocket(url);
    this.ws = socket;
    this.socketCreatedAt = Date.now();
    this.openedAt = 0;
    this.setLinkState("connecting");
    this.startLinkWatchdog();

    socket.addEventListener("open", () => {
      if (this.ws !== socket) return;
      this.openedAt = Date.now();
      this.lastMessageAt = this.openedAt;
      // NOT reset here. A Moonraker that accepts and immediately drops —
      // what it does throughout a Klipper restart — would otherwise pin the
      // backoff at its floor forever. The counter clears in the close
      // handler, and only once the link actually HELD (STABLE_LINK_MS).
      this.connSubs.forEach((cb) => cb(true));
      this.setLinkState("live");
      // A fresh link gets a fresh retry budget.
      this.subscribeRetryAttempt = 0;
      // Replay on reconnect with the CURRENT desired set (replace semantics:
      // a field released while offline must not resurrect here).
      this.activeFields = new Set(this.fieldRefs.keys());
      if (this.activeFields.size > 0) this.pushSubscription();
    });

    socket.addEventListener("message", (e) => {
      if (this.ws !== socket) return;
      this.lastMessageAt = Date.now();
      if (this.linkState === "stale") this.setLinkState("live");
      this.onMessage(e);
    });

    socket.addEventListener("close", () => {
      if (this.ws !== socket) return;
      const held = this.openedAt > 0 && Date.now() - this.openedAt >= STABLE_LINK_MS;
      this.ws = null;
      this.openedAt = 0;
      // The open handler replays the subscription on the next socket — a
      // retry aimed at THIS socket has nothing left to fix.
      this.clearSubscribeRetry();
      if (held) this.reconnectAttempt = 0;
      this.connSubs.forEach((cb) => cb(false));
      this.setLinkState("down");
      this.rejectPending("Printer connection closed before the action completed.");
      if (!this.manuallyDisconnected) this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket.close();
    });
  }

  disconnect(): void {
    this.manuallyDisconnected = true;
    this.clearReconnectTimer();
    this.clearSubscribeRetry();
    this.stopLinkWatchdog();
    const socket = this.ws;
    this.ws = null;
    this.openedAt = 0;
    socket?.close();
    this.rejectPending("Printer connection was closed.");
    this.connSubs.forEach((cb) => cb(false));
    this.setLinkState("down");
  }

  /**
   * Force the link to prove itself, right now.
   *
   * Called when the environment says the previous socket may be a ghost — a
   * tab becoming visible after a lid-close, the browser reporting the network
   * back. A socket that still reports OPEN after a suspend is frequently
   * attached to a connection that no longer exists on the other end, and it
   * will sit there forever looking healthy while the dashboard freezes at
   * whatever it last showed.
   */
  wake(): void {
    if (this.manuallyDisconnected) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Give a live socket one check interval to show a sign of life before
      // tearing down a link that is in fact fine.
      if (this.isSilent(Date.now())) this.dropWedgedSocket();
      else this.startLinkWatchdog();
      return;
    }
    // Nothing open: retry immediately rather than sitting out the rest of a
    // backoff that was scheduled before the machine went to sleep.
    this.reconnectAttempt = 0;
    this.connect();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = jitteredDelay(
      moonrakerReconnectDelay(this.reconnectAttempt),
      this.random(),
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // ----- Link watchdog -----
  /**
   * Neither of the two states this catches raises an event, which is exactly
   * why they need a clock: a socket stuck in CONNECTING and a socket that is
   * OPEN but carrying nothing both look like a healthy app doing nothing.
   */
  private startLinkWatchdog(): void {
    if (this.linkTimer !== null) return;
    this.linkTimer = window.setInterval(() => this.checkLink(), LINK_CHECK_MS);
  }

  private stopLinkWatchdog(): void {
    if (this.linkTimer !== null) {
      clearInterval(this.linkTimer);
      this.linkTimer = null;
    }
  }

  /** True once an OPEN socket has been silent past the tolerance. */
  private isSilent(now: number): boolean {
    return this.sawServerPush && now - this.lastMessageAt >= LINK_SILENCE_MS;
  }

  private checkLink(): void {
    const now = Date.now();
    const readyState = this.ws?.readyState;

    if (readyState === WebSocket.CONNECTING) {
      if (now - this.socketCreatedAt >= CONNECT_TIMEOUT_MS) {
        // Never opened, never errored. Close it so the close handler can put
        // the normal backoff in charge instead of waiting on the browser.
        this.dropWedgedSocket();
      }
      return;
    }

    if (readyState === WebSocket.OPEN) {
      if (this.isSilent(now)) {
        // Surface the truth before tearing down, so anything watching link
        // state sees "stale" rather than an unexplained drop.
        this.setLinkState("stale");
        this.dropWedgedSocket();
      }
      return;
    }

    // No socket: the reconnect timer owns recovery. Nothing to watch until
    // it fires, so stop burning a wakeup every 2s on an idle background tab.
    if (this.ws === null && this.reconnectTimer === null) this.stopLinkWatchdog();
  }

  /**
   * Tear down a socket the browser still believes in. `close()` on a wedged
   * connection does fire `close`, which routes recovery back through the one
   * reconnect path rather than duplicating it here.
   */
  private dropWedgedSocket(): void {
    const socket = this.ws;
    if (!socket) return;
    try {
      socket.close();
    } catch {
      /* already closing — the close listener still runs */
    }
    // A wedged socket can fail to emit `close` at all. Drive the same
    // transition by hand if the listener has not already done it.
    if (this.ws === socket) {
      this.ws = null;
      this.openedAt = 0;
      this.connSubs.forEach((cb) => cb(false));
      this.setLinkState("down");
      this.rejectPending("Printer connection went quiet and was reset.");
      if (!this.manuallyDisconnected) this.scheduleReconnect();
    }
  }

  private setLinkState(next: LinkState): void {
    if (this.linkState === next) return;
    this.linkState = next;
    this.linkSubs.forEach((cb) => cb(next));
  }

  /** Current link state — what the wire is doing, not what readyState says. */
  getLinkState(): LinkState {
    return this.linkState;
  }

  onLinkState(cb: LinkStateCallback): () => void {
    this.linkSubs.add(cb);
    cb(this.linkState);
    return () => {
      this.linkSubs.delete(cb);
    };
  }

  /**
   * Whether this server has ever pushed without being asked.
   *
   * Anything that reads silence as a fault has to check this first: a server
   * that only ever answers requests is quiet by design, and calling that
   * "stale" would be a false alarm on a perfectly good link.
   */
  hasServerPush(): boolean {
    return this.sawServerPush;
  }

  /** ms since anything last arrived, or null before the first byte ever. */
  telemetryAge(now = Date.now()): number | null {
    return this.lastMessageAt === 0 ? null : now - this.lastMessageAt;
  }

  /** Test seam: pin the jitter draw so backoff assertions are exact. */
  setRandomSource(random: () => number): void {
    this.random = random;
  }

  private rejectPending(message: string): void {
    const error = new Error(message);
    this.pending.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(error);
    });
    this.pending.clear();
  }

  // ----- RPC -----
  private send<T>(method: string, params?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not open"));
        return;
      }
      const id = this.nextId++;
      const req: RpcRequest = { jsonrpc: "2.0", method, params, id };
      // Captured so settlement can clear it — an uncleared 15s handle per
      // RPC accumulates across a long session (the WP-PERF timer leak).
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, 15000);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      this.ws.send(JSON.stringify(req));
    });
  }

  private onMessage(e: MessageEvent): void {
    let msg: RpcResponse | RpcNotification;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }

    if ("id" in msg) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
      return;
    }

    // Anything without an id is server-initiated, which proves this server
    // pushes without being asked — the premise the silence check rests on.
    // It is deliberately set for EVERY notification, including the ones
    // ignored below: `notify_proc_stat_update` alone arrives about once a
    // second and is the most reliable heartbeat Moonraker offers.
    this.sawServerPush = true;

    if (msg.method === "notify_status_update") {
      const [diff] = msg.params as [Partial<PrinterState>];
      this.mergeState(diff);
    } else if (msg.method === "notify_gcode_response") {
      const [text] = msg.params as [string];
      this.appendGcodeLine({ ts: Date.now(), text, type: "response" });
    } else if (msg.method === "notify_timelapse_event") {
      // moonraker-timelapse pushes both `newframe` and `render` through this
      // one notification. The reducer is total, so a payload shape this build
      // does not recognize leaves the cockpit readout untouched.
      const [event] = (msg.params ?? []) as [TimelapseEvent | undefined];
      this.setTimelapseActivity(
        reduceTimelapseEvent(this.timelapse, event, Date.now()),
      );
    } else if (msg.method === "notify_proc_stat_update") {
      // Host-health feed. This used to be discarded ("high frequency") —
      // but it is the only live view of the host's CPU and memory, and it
      // is ALREADY on the wire at ~1 Hz. The parser is total: field-shape
      // drift (older Moonraker, non-RPi SoC) parses to nulls, and a payload
      // carrying nothing useful is dropped without a sample.
      const sample = parseProcStatUpdate(msg.params, Date.now());
      if (sample) {
        this.hostSamples = appendHostSample(this.hostSamples, sample);
        this.hostStatsSubs.forEach((cb) => cb());
      }
    }
  }

  private setTimelapseActivity(next: TimelapseActivity): void {
    if (next === this.timelapse) return;
    this.timelapse = next;
    this.timelapseSubs.forEach((cb) => cb(next));
  }

  /**
   * Live capture state — frame count and render progress.
   *
   * Deliberately NOT "is timelapse enabled": that is a global setting shared
   * with every other UI on the machine and it is true on printers that have
   * never captured a frame. See `isRecordingNow` in lib/timelapse.ts.
   */
  getTimelapseActivity(): TimelapseActivity {
    return this.timelapse;
  }

  onTimelapseActivity(cb: TimelapseCallback): () => void {
    this.timelapseSubs.add(cb);
    cb(this.timelapse);
    return () => {
      this.timelapseSubs.delete(cb);
    };
  }

  private appendGcodeLine(line: GcodeLine): void {
    this.gcodeLog = [...this.gcodeLog, line].slice(-Moonraker.MAX_LOG);
    this.gcodeLogSubs.forEach((cb) => cb(this.gcodeLog));
  }

  /** Surface a user-typed command in the log alongside klipper responses. */
  recordCommand(text: string): void {
    this.appendGcodeLine({ ts: Date.now(), text, type: "command" });
  }

  onGcodeLog(cb: GcodeLogCallback): () => void {
    this.gcodeLogSubs.add(cb);
    cb(this.gcodeLog);
    return () => {
      this.gcodeLogSubs.delete(cb);
    };
  }

  getGcodeLog(): GcodeLine[] {
    return this.gcodeLog;
  }

  private mergeState(diff: Partial<PrinterState>): void {
    const prevWebhooksState = this.state.webhooks?.state;
    const next: PrinterState = { ...this.state };
    for (const [key, value] of Object.entries(diff)) {
      const k = key as keyof PrinterState;
      next[k] = {
        ...((this.state[k] as object) ?? {}),
        ...((value as object) ?? {}),
      } as never;
    }
    this.state = next;
    this.trackHostHealth(prevWebhooksState, next);
    this.subs.forEach((cb) => cb(this.state));
  }

  /**
   * Host-health bookkeeping off the state merge (host-health guard):
   * the motion-buffer starvation reducer (a pure fold over fields that are
   * already subscribed — toolhead, print_stats, motion_report), and the
   * fault-context freeze. The freeze happens ON THE TRANSITION into
   * shutdown/error and is then HELD: by the time the explainer renders, the
   * load that caused the fault may have cleared, so live values would lie.
   */
  private trackHostHealth(
    prevWebhooksState: string | undefined,
    next: PrinterState,
  ): void {
    const toolhead = next.toolhead;
    const bufferS =
      toolhead != null &&
      Number.isFinite(toolhead.print_time) &&
      Number.isFinite(toolhead.estimated_print_time)
        ? toolhead.print_time - toolhead.estimated_print_time
        : null;
    this.bufferStarvation = reduceBufferStarvation(this.bufferStarvation, {
      printing: next.print_stats?.state === "printing",
      liveVelocity: next.motion_report?.live_velocity ?? null,
      bufferS,
      now: Date.now(),
    });
    const state = next.webhooks?.state;
    const faulted = state === "shutdown" || state === "error";
    const wasFaulted =
      prevWebhooksState === "shutdown" || prevWebhooksState === "error";
    if (faulted && !wasFaulted) {
      this.hostFaultContext = snapshotHostFaultContext(
        this.hostSamples,
        this.bufferStarvation,
        Date.now(),
      );
    }
  }

  // ----- Host health (host-health guard) -----
  /** Rolling host-load summary over the given window, honest-unknown. */
  getHostLoad(windowMs: number, now = Date.now()): HostLoad {
    return summarizeHostLoad(this.hostSamples, now, windowMs);
  }

  /** Motion-buffer starvation verdict — lamp trigger B. */
  getBufferStarvation(): BufferStarvation {
    return this.bufferStarvation;
  }

  /**
   * Host state frozen at the moment klippy last entered shutdown/error, or
   * null if that has not happened this session. Held, not live, on purpose.
   */
  getHostFaultContext(): HostFaultContext | null {
    return this.hostFaultContext;
  }

  /** Fires whenever a new proc-stat sample lands (~1 Hz while linked). */
  onHostStats(cb: () => void): () => void {
    this.hostStatsSubs.add(cb);
    return () => {
      this.hostStatsSubs.delete(cb);
    };
  }

  // ----- Subscriptions -----
  /**
   * Ref-counted: each mounting consumer declares the fields it needs and
   * releases them on unmount. The union of live claims is pushed to the
   * server as a REPLACEMENT set (Moonraker's own subscribe semantics), and
   * pushes are coalesced per microtask, so N consumers mounting in one
   * React commit produce exactly one `printer.objects.subscribe` RPC.
   */
  subscribe(fields: string[], cb?: SubscriptionCallback): () => void {
    const claimed = [...new Set(fields)];
    claimed.forEach((f) =>
      this.fieldRefs.set(f, (this.fieldRefs.get(f) ?? 0) + 1),
    );
    if (cb) this.subs.add(cb);
    this.queueSync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (cb) this.subs.delete(cb);
      claimed.forEach((f) => {
        const n = this.fieldRefs.get(f) ?? 0;
        if (n <= 1) this.fieldRefs.delete(f);
        else this.fieldRefs.set(f, n - 1);
      });
      this.queueSync();
    };
  }

  private queueSync(): void {
    if (this.syncQueued) return;
    this.syncQueued = true;
    queueMicrotask(() => {
      this.syncQueued = false;
      const desired = new Set(this.fieldRefs.keys());
      if (
        desired.size === this.activeFields.size &&
        [...desired].every((f) => this.activeFields.has(f))
      ) {
        return; // same set already live — no RPC
      }
      // REPLACE, never union: dropped fields must actually stop streaming.
      this.activeFields = desired;
      this.pushSubscription();
    });
  }

  /**
   * Push the committed field set. Three outcomes:
   *
   *  - resolve: the server confirmed the subscription; merge its full status.
   *  - reject because the socket dropped: the open handler replays — no-op.
   *  - reject while the socket is STILL OPEN. This is a real, reachable
   *    state: Moonraker answers subscribe with "Klippy Host not connected"
   *    for the whole Klipper-restart window, and the 15s RPC timeout sits
   *    well inside the 30s silence tolerance (proc-stat pushes keep the link
   *    "live" the whole time). `activeFields` was committed before the
   *    outcome was known, so without a rollback the queueSync equality
   *    shortcut would suppress every later push and the dashboard would sit
   *    frozen forever while reporting a live link. Roll the commit back so
   *    any consumer change re-pushes, and retry on a jittered backoff so
   *    state resumes even with no consumer change at all.
   */
  private pushSubscription(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return; // replayed on open
    const socket = this.ws;
    const pushed = this.activeFields;
    const objects = Object.fromEntries([...pushed].map((f) => [f, null]));
    this.send<{ status: PrinterState }>("printer.objects.subscribe", {
      objects,
    })
      .then(({ status }) => {
        this.subscribeRetryAttempt = 0;
        this.mergeState(status);
      })
      .catch(() => {
        // Socket gone or replaced: the open handler owns the replay.
        if (this.ws !== socket || socket.readyState !== WebSocket.OPEN) return;
        // A newer push already replaced the set; its outcome governs.
        if (this.activeFields !== pushed) return;
        // Un-commit: nothing is live server-side, and the next sync must
        // say so instead of being swallowed by the equality shortcut.
        this.activeFields = new Set();
        this.scheduleSubscribeRetry();
      });
  }

  /** Retry a refused subscribe on a live socket, with bounded backoff. */
  private scheduleSubscribeRetry(): void {
    if (this.subscribeRetryTimer !== null) return;
    const delay = jitteredDelay(
      exponentialBackoff(this.subscribeRetryAttempt, 2000, 30_000),
      this.random(),
    );
    this.subscribeRetryAttempt += 1;
    this.subscribeRetryTimer = window.setTimeout(() => {
      this.subscribeRetryTimer = null;
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.queueSync();
    }, delay);
  }

  private clearSubscribeRetry(): void {
    if (this.subscribeRetryTimer !== null) {
      clearTimeout(this.subscribeRetryTimer);
      this.subscribeRetryTimer = null;
    }
  }

  onConnect(cb: ConnectionCallback): () => void {
    this.connSubs.add(cb);
    if (this.ws?.readyState === WebSocket.OPEN) cb(true);
    return () => {
      this.connSubs.delete(cb);
    };
  }

  getState(): PrinterState {
    return this.state;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ----- Commands -----
  /** Low-level transport. UI actions should use printerActions for safety gates. */
  async runGcode(script: string): Promise<void> {
    await this.send("printer.gcode.script", { script });
  }

  /**
   * Klipper objects currently loaded, e.g. `gcode_macro START_PRINT`,
   * `output_pin ADAPTIVE_BED_MESH`. Used to skip optional commands that this
   * printer's configuration does not support.
   */
  async listObjects(): Promise<string[]> {
    const result = await this.send<{ objects: string[] }>(
      "printer.objects.list",
    );
    return result.objects ?? [];
  }

  async pause(): Promise<void> {
    await this.send("printer.print.pause");
  }
  async resume(): Promise<void> {
    await this.send("printer.print.resume");
  }
  async cancel(): Promise<void> {
    await this.send("printer.print.cancel");
  }
  async startPrint(filename: string): Promise<void> {
    await this.send("printer.print.start", { filename });
  }
  async emergencyStop(): Promise<void> {
    await this.send("printer.emergency_stop");
  }
  async restart(): Promise<void> {
    await this.send("printer.restart");
  }
  async firmwareRestart(): Promise<void> {
    await this.send("printer.firmware_restart");
  }

  // ----- File API (REST) -----
  async listFiles(root = "gcodes"): Promise<MoonrakerFile[]> {
    const res = await fetch(`${HTTP_BASE}/server/files/list?root=${root}`);
    const data = (await res.json()) as { result: MoonrakerFile[] };
    return data.result;
  }

  // ----- Timelapse (moonraker-timelapse component, REST) -----
  //
  // These endpoints exist only when the component is installed. Every caller
  // must treat a rejection as "this printer cannot do timelapses" and carry
  // on — most importantly `applyPrintSetup`, which may never block a print.
  // `snapshoturl` is refused by the plugin itself and is never written here.

  /**
   * Current plugin config. Carries the same deadline as the write, because
   * the pre-print path now reads before it writes (only to avoid clobbering
   * an owner's own `extraoutputparams`) and a fetch with no timeout in front
   * of `printer.print.start` would hold a print hostage on a wedged host.
   */
  async getTimelapseSettings(): Promise<TimelapseSettings> {
    const response = await fetch(`${HTTP_BASE}/machine/timelapse/settings`, {
      signal: AbortSignal.timeout(TIMELAPSE_WRITE_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Timelapse settings unavailable (HTTP ${response.status}).`);
    }
    const data = (await response.json()) as { result?: TimelapseSettings };
    return data.result ?? {};
  }

  /**
   * Flat JSON body of only the keys to change; returns the updated config.
   *
   * The write carries a hard deadline because it sits in the pre-print path:
   * `applyPrintSetup` awaits it BEFORE `printer.print.start`, and a browser
   * fetch has no default timeout. Every failure already resolves into a
   * notice and the print starts — but a socket that accepts and then never
   * answers (wedged Moonraker, black-holed link) would otherwise hold the
   * print hostage indefinitely. The WS RPC path has its own 15s deadline;
   * this is the HTTP equivalent. An abort surfaces as a rejection, which the
   * caller already treats as "carry on and tell the owner".
   */
  async writeTimelapseSettings(
    patch: Record<string, string | number | boolean>,
  ): Promise<TimelapseSettings> {
    const response = await fetch(`${HTTP_BASE}/machine/timelapse/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(TIMELAPSE_WRITE_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Timelapse settings write failed (HTTP ${response.status}).`);
    }
    const data = (await response.json()) as { result?: TimelapseSettings };
    return data.result ?? {};
  }

  /**
   * Render the captured frames into a video, NOW.
   *
   * This is the only way a render happens under Regolith: the pre-print
   * write disarms the plugin's `autorender`, because an unattended ffmpeg
   * pass over a completed print's frames starved this printer's CPU badly
   * enough to shut Klipper down (see lib/timelapse RENDER_THREAD_CAP). The
   * caller is responsible for the gate — `timelapseRenderGate` — and for
   * warning the owner first.
   *
   * DELIBERATELY the one timelapse call with no abort deadline, unlike the
   * settings read/write beside it. The plugin holds this request open for as
   * long as ffmpeg runs, which on this hardware is minutes; a five-second
   * abort would report "the printer did not start the render" about a render
   * that started perfectly, on every successful pass. Aborting the fetch
   * would not stop the encode either — the work is on the printer, not here.
   * Nothing in the UI waits on this promise for its truth: the pending
   * banner and the progress bar are both cleared by the plugin's own
   * `notify_timelapse_event` stream, so a request that never settles costs a
   * stale banner, not a frozen page.
   */
  async renderTimelapse(): Promise<void> {
    const response = await fetch(`${HTTP_BASE}/machine/timelapse/render`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Timelapse render failed (HTTP ${response.status}).`);
    }
  }

  // NOTE: there is deliberately NO thumbnailUrl() helper here. The flat
  // Fluidd guess (`.thumbs/<basename>-NxN.png` percent-encoded at the gcode
  // root) can never resolve for nested files and 404s for every thumbless
  // one. Previews are resolved from what `/server/files/metadata` REPORTS,
  // via `thumbnailUrlFor()` in src/lib/thumbnails.ts.
}

/**
 * moonraker-timelapse configuration, as the plugin reports it.
 *
 * Loosely typed on purpose: the payload carries ~35 keys across several
 * plugin versions and Regolith reads three of them. An index signature keeps
 * an unfamiliar build from failing to parse.
 */
export interface TimelapseSettings {
  enabled?: boolean;
  mode?: string;
  hyperlapse_cycle?: number;
  autorender?: boolean;
  parkhead?: boolean;
  output_framerate?: number;
  /** Extra ffmpeg output arguments. Regolith writes the render thread cap
   *  here unless the owner has put something of their own in it. */
  extraoutputparams?: string;
  [key: string]: unknown;
}

export interface MoonrakerFile {
  path: string;
  modified: number;
  size: number;
  permissions: string;
}

// Singleton
export const moonraker = new Moonraker();
