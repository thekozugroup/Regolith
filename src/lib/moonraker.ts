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

type SubscriptionCallback = (state: PrinterState) => void;
type ConnectionCallback = (connected: boolean) => void;
type GcodeLogCallback = (lines: GcodeLine[]) => void;

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
  // Display status (progress)
  display_status?: { progress: number; message: string };
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
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private state: PrinterState = {};
  private subs = new Set<SubscriptionCallback>();
  private connSubs = new Set<ConnectionCallback>();
  private gcodeLogSubs = new Set<GcodeLogCallback>();
  private subscribedFields = new Set<string>();
  private reconnectTimer: number | null = null;
  private gcodeLog: GcodeLine[] = [];
  private static MAX_LOG = 200;

  // ----- Connection lifecycle -----
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}${WS_PATH}`;
    this.ws = new WebSocket(url);

    this.ws.addEventListener("open", () => {
      this.connSubs.forEach((cb) => cb(true));
      // Re-subscribe on reconnect
      if (this.subscribedFields.size > 0) {
        this.subscribe([...this.subscribedFields]);
      }
    });

    this.ws.addEventListener("message", (e) => this.onMessage(e));

    this.ws.addEventListener("close", () => {
      this.connSubs.forEach((cb) => cb(false));
      this.scheduleReconnect();
    });

    this.ws.addEventListener("error", () => {
      this.ws?.close();
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
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
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.ws.send(JSON.stringify(req));

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, 15000);
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
      if (msg.error) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
    } else if (msg.method === "notify_status_update") {
      const [diff] = msg.params as [Partial<PrinterState>];
      this.mergeState(diff);
    } else if (msg.method === "notify_gcode_response") {
      const [text] = msg.params as [string];
      this.appendGcodeLine({ ts: Date.now(), text, type: "response" });
    } else if (msg.method === "notify_proc_stat_update") {
      // ignore — high frequency
    }
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
    const next: PrinterState = { ...this.state };
    for (const [key, value] of Object.entries(diff)) {
      const k = key as keyof PrinterState;
      next[k] = {
        ...((this.state[k] as object) ?? {}),
        ...((value as object) ?? {}),
      } as never;
    }
    this.state = next;
    this.subs.forEach((cb) => cb(this.state));
  }

  // ----- Subscriptions -----
  subscribe(
    fields: string[],
    cb?: SubscriptionCallback
  ): () => void {
    fields.forEach((f) => this.subscribedFields.add(f));
    const objects = Object.fromEntries(fields.map((f) => [f, null]));
    this.send<{ status: PrinterState }>(
      "printer.objects.subscribe",
      { objects }
    )
      .then(({ status }) => this.mergeState(status))
      .catch(() => {
        /* WS likely not ready yet, will retry on connect */
      });
    if (cb) this.subs.add(cb);
    return () => {
      if (cb) this.subs.delete(cb);
    };
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

  // ----- Commands -----
  async runGcode(script: string): Promise<void> {
    await this.send("printer.gcode.script", { script });
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

  thumbnailUrl(filename: string, size: 32 | 300 = 300): string {
    // Fluidd thumbnail convention
    const base = filename.replace(/\.gcode$/i, "");
    return `${HTTP_BASE}/server/files/gcodes/.thumbs/${encodeURIComponent(base)}-${size}x${size}.png`;
  }
}

export interface MoonrakerFile {
  path: string;
  modified: number;
  size: number;
  permissions: string;
}

// Singleton
export const moonraker = new Moonraker();
