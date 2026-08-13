import { afterAll, describe, expect, test } from "bun:test";
import { Moonraker } from "../src/lib/moonraker";

/**
 * The host-health bookkeeping that hangs off `mergeState`, driven through the
 * REAL path rather than by hand.
 *
 * `snapshotHostFaultContext` was unit-tested with a hand-passed buffer
 * object, which is exactly the shape of test that cannot see this bug: the
 * client ran the starvation reducer BEFORE freezing the context, on the same
 * merged state, so a realistic shutdown push — one that flips
 * `print_stats.state` off `printing` and `live_velocity` to 0 in the same
 * message as `webhooks.state` — closed the reducer's gate and recorded
 * `bufferS: null`. The explainer then silently dropped its most diagnostic
 * line ("motion buffer 0.1 s, healthy is about 2 s"), and whether it appeared
 * at all depended on the shape of the push.
 *
 * So these tests push messages, not objects.
 */

class MockSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockSocket[] = [];
  readyState = MockSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  constructor(public url: string) {
    MockSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = MockSocket.CLOSED;
    this.emit("close", {});
  }
  open(): void {
    this.readyState = MockSocket.OPEN;
    this.emit("open", {});
  }
  receive(msg: unknown): void {
    this.emit("message", { data: JSON.stringify(msg) });
  }
  private emit(type: string, e: unknown): void {
    [...(this.listeners.get(type) ?? [])].forEach((fn) => fn(e));
  }
}

const g = globalThis as Record<string, unknown>;
const originals = {
  WebSocket: g.WebSocket,
  location: g.location,
  window: g.window,
};
g.WebSocket = MockSocket;
g.location = { protocol: "http:", host: "printer.local" };
if (g.window === undefined) g.window = globalThis;

afterAll(() => {
  g.WebSocket = originals.WebSocket;
  g.location = originals.location;
  g.window = originals.window;
});

function freshClient(): { mr: Moonraker; sock: MockSocket } {
  const mr = new Moonraker();
  mr.connect();
  const sock = MockSocket.instances[MockSocket.instances.length - 1]!;
  sock.open();
  return { mr, sock };
}

const status = (sock: MockSocket, diff: Record<string, unknown>) =>
  sock.receive({ jsonrpc: "2.0", method: "notify_status_update", params: [diff] });

const procStat = (sock: MockSocket, cpu: number) =>
  sock.receive({
    jsonrpc: "2.0",
    method: "notify_proc_stat_update",
    params: [
      {
        system_cpu_usage: { cpu },
        system_memory: { total: 253_952, available: 41_984 },
      },
    ],
  });

/** A print feeding the MCU late: buffer = print_time − estimated_print_time. */
const printingWithBuffer = (bufferS: number, estimated = 900) => ({
  print_stats: { state: "printing" },
  motion_report: { live_velocity: 80 },
  toolhead: { print_time: estimated + bufferS, estimated_print_time: estimated },
});

describe("fault context — the buffer figure survives the shutdown push", () => {
  test("a realistic shutdown push still records the pre-fault buffer", () => {
    const { mr, sock } = freshClient();
    for (let i = 0; i < 5; i += 1) procStat(sock, 97);

    // Mid-print, buffer collapsed to 0.1 s (healthy is ~2 s).
    status(sock, printingWithBuffer(0.1));
    expect(mr.getBufferStarvation().bufferS).toBeCloseTo(0.1, 5);

    // THE PUSH THAT USED TO LOSE IT: Klipper dies, and the same message
    // carries the state change, the stopped head, and the shutdown.
    status(sock, {
      print_stats: { state: "error" },
      motion_report: { live_velocity: 0 },
      webhooks: { state: "shutdown", state_message: "Printer is shutdown" },
    });

    const fault = mr.getHostFaultContext();
    expect(fault).not.toBeNull();
    expect(fault!.bufferS).toBeCloseTo(0.1, 5);
    // The other channels still come from the ring.
    expect(fault!.cpuAvg).toBe(97);
    expect(fault!.memAvailKb).toBe(41_984);
    mr.disconnect();
  });

  test("the shutdown push closes the live gate — the FROZEN figure is not the live one", () => {
    const { mr, sock } = freshClient();
    status(sock, printingWithBuffer(0.1));
    status(sock, {
      print_stats: { state: "error" },
      motion_report: { live_velocity: 0 },
      webhooks: { state: "shutdown", state_message: "Printer is shutdown" },
    });
    // Live reducer: correctly silent, because nothing is being fed any more.
    expect(mr.getBufferStarvation().bufferS).toBeNull();
    // Frozen context: still carries the figure. That is the whole point.
    expect(mr.getHostFaultContext()!.bufferS).toBeCloseTo(0.1, 5);
    mr.disconnect();
  });

  test("a shutdown with no motion data at all omits the buffer, never invents one", () => {
    const { mr, sock } = freshClient();
    procStat(sock, 97);
    status(sock, {
      webhooks: { state: "shutdown", state_message: "Printer is shutdown" },
    });
    expect(mr.getHostFaultContext()!.bufferS).toBeNull();
    mr.disconnect();
  });

  test("the freeze happens ON THE TRANSITION and is then HELD", () => {
    const { mr, sock } = freshClient();
    status(sock, printingWithBuffer(0.1));
    status(sock, {
      motion_report: { live_velocity: 0 },
      print_stats: { state: "error" },
      webhooks: { state: "shutdown", state_message: "Printer is shutdown" },
    });
    const first = mr.getHostFaultContext();
    // More shutdown pushes arrive; the context must not be recomputed.
    procStat(sock, 4);
    status(sock, {
      webhooks: { state: "shutdown", state_message: "Still shut down" },
    });
    expect(mr.getHostFaultContext()).toBe(first!);
    mr.disconnect();
  });
});

describe("stale motion_report can no longer masquerade as a live reading", () => {
  test("only a push that CARRIES motion_report counts as a velocity observation", () => {
    const { mr, sock } = freshClient();
    // A visit to /control leaves a velocity behind. mergeState only ever
    // spreads — it never deletes — so this value persists in state forever.
    status(sock, { motion_report: { live_velocity: 80 } });

    // A normal print warm-up: printing, buffer near zero because nothing is
    // being fed yet. Without the fix the stale velocity held the gate open
    // and this latched a HOST LOAD warning on an unsampled host.
    status(sock, {
      print_stats: { state: "printing" },
      toolhead: { print_time: 0.05, estimated_print_time: 0 },
    });
    expect(mr.getBufferStarvation()).toEqual({
      lowSince: null,
      starved: false,
      bufferS: null,
      bufferAt: null,
    });
    mr.disconnect();
  });
});

describe("console generation — stale lines stop being evidence", () => {
  const gcode = (sock: MockSocket, text: string) =>
    sock.receive({
      jsonrpc: "2.0",
      method: "notify_gcode_response",
      params: [text],
    });

  test("lines are stamped with the generation they arrived in", () => {
    const { mr, sock } = freshClient();
    gcode(sock, "!! Rescheduled timer in the past");
    const [line] = mr.getGcodeLog();
    expect(line!.epoch).toBe(mr.getGcodeEpoch());
    expect(line!.type).toBe("response");
    mr.disconnect();
  });

  test("user-typed commands are tagged as commands, not responses", () => {
    const { mr } = freshClient();
    mr.recordCommand("// user asked: what does 'timer too close' mean?");
    expect(mr.getGcodeLog()[0]!.type).toBe("command");
    mr.disconnect();
  });

  test("a firmware restart retires the generation; the lines stay readable", () => {
    const { mr, sock } = freshClient();
    gcode(sock, "!! Rescheduled timer in the past");
    const before = mr.getGcodeEpoch();
    status(sock, { webhooks: { state: "startup", state_message: "Starting" } });
    expect(mr.getGcodeEpoch()).toBeGreaterThan(before);
    // The console is NOT wiped — the owner is reading it. The line simply
    // belongs to a generation the classifier no longer trusts.
    expect(mr.getGcodeLog()).toHaveLength(1);
    expect(mr.getGcodeLog()[0]!.epoch).toBe(before);
    mr.disconnect();
  });

  test("a reconnect retires the generation too", () => {
    const { mr, sock } = freshClient();
    gcode(sock, "!! Timer too close");
    const before = mr.getGcodeEpoch();
    sock.close();
    // Drive the reconnect deterministically rather than waiting out the
    // backoff timer the close handler scheduled.
    mr.connect();
    MockSocket.instances[MockSocket.instances.length - 1]!.open();
    expect(mr.getGcodeEpoch()).toBeGreaterThan(before);
    mr.disconnect();
  });
});
