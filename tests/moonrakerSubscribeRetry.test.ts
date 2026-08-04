import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Moonraker } from "../src/lib/moonraker";

/**
 * A failed `printer.objects.subscribe` on a socket that STAYS OPEN must be
 * retried — the regression where it was not.
 *
 * Two reachable failure modes, neither of which drops the socket:
 *
 *   1. Moonraker answers the subscribe with an error ("Klippy Host not
 *      connected") for the entire Klipper-restart window.
 *   2. The 15s RPC timeout — well inside the 30s silence tolerance, since
 *      `notify_proc_stat_update` keeps refreshing the link the whole time.
 *
 * `queueSync` used to commit `activeFields` BEFORE the RPC's outcome was
 * known and `pushSubscription` swallowed every failure, so the equality
 * shortcut suppressed all future pushes: isConnected() true, link "live",
 * zero status updates, forever. These tests pin the recovery paths.
 *
 * Time is synthetic (same discipline as moonrakerReconnect.test.ts) so the
 * backoff is an assertion, not a sleep. Microtasks are flushed explicitly
 * because promise callbacks — not timers — drive the failure handling.
 */

class FakeClock {
  now = 1_700_000_000_000;
  private nextId = 1;
  private timers = new Map<
    number,
    { at: number; every: number | null; fn: () => void }
  >();

  setTimeout = (fn: () => void, ms = 0): number => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + ms, every: null, fn });
    return id;
  };

  setInterval = (fn: () => void, ms = 0): number => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + ms, every: Math.max(1, ms), fn });
    return id;
  };

  clear = (id: number | undefined): void => {
    if (id !== undefined) this.timers.delete(id);
  };

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      let dueId: number | null = null;
      let dueAt = Infinity;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && timer.at < dueAt) {
          dueAt = timer.at;
          dueId = id;
        }
      }
      if (dueId === null) break;
      const timer = this.timers.get(dueId)!;
      this.now = timer.at;
      if (timer.every === null) this.timers.delete(dueId);
      else timer.at = this.now + timer.every;
      timer.fn();
    }
    this.now = target;
  }
}

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
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    if (this.readyState === MockSocket.CLOSED) return;
    this.readyState = MockSocket.CLOSED;
    this.emit("close", {});
  }
  open(): void {
    this.readyState = MockSocket.OPEN;
    this.emit("open", {});
  }
  reply(id: number, result: unknown): void {
    this.emit("message", {
      data: JSON.stringify({ jsonrpc: "2.0", id, result }),
    });
  }
  replyError(id: number, message: string): void {
    this.emit("message", {
      data: JSON.stringify({ jsonrpc: "2.0", id, error: { code: 503, message } }),
    });
  }
  /** A server-initiated push, e.g. the ~1 Hz proc-stat heartbeat. */
  push(method: string, params: unknown[]): void {
    this.emit("message", {
      data: JSON.stringify({ jsonrpc: "2.0", method, params }),
    });
  }
  private emit(type: string, e: unknown): void {
    [...(this.listeners.get(type) ?? [])].forEach((fn) => fn(e));
  }
  subscribeRpcs(): { id: number; objects: Record<string, null> }[] {
    return this.sent
      .map(
        (s) =>
          JSON.parse(s) as {
            id: number;
            method: string;
            params?: { objects: Record<string, null> };
          },
      )
      .filter((m) => m.method === "printer.objects.subscribe")
      .map((m) => ({ id: m.id, objects: m.params?.objects ?? {} }));
  }
}

const g = globalThis as Record<string, unknown>;
const originals = {
  WebSocket: g.WebSocket,
  location: g.location,
  window: g.window,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  dateNow: Date.now,
};

let clock: FakeClock;

beforeEach(() => {
  clock = new FakeClock();
  MockSocket.instances = [];
  g.WebSocket = MockSocket;
  g.location = { protocol: "http:", host: "printer.local" };
  globalThis.setTimeout = clock.setTimeout as unknown as typeof setTimeout;
  globalThis.clearTimeout = clock.clear as unknown as typeof clearTimeout;
  globalThis.setInterval = clock.setInterval as unknown as typeof setInterval;
  globalThis.clearInterval = clock.clear as unknown as typeof clearInterval;
  Date.now = () => clock.now;
  g.window = globalThis;
});

afterEach(() => {
  g.WebSocket = originals.WebSocket;
  g.location = originals.location;
  g.window = originals.window;
  globalThis.setTimeout = originals.setTimeout;
  globalThis.clearTimeout = originals.clearTimeout;
  globalThis.setInterval = originals.setInterval;
  globalThis.clearInterval = originals.clearInterval;
  Date.now = originals.dateNow;
});

const latest = () => MockSocket.instances[MockSocket.instances.length - 1];

/** Flush the promise callbacks (queueSync microtask, RPC .then/.catch). */
const microtasks = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

/** Deterministic jitter draw of 1 ⇒ backoff delays are exactly their base. */
function client(): Moonraker {
  const mr = new Moonraker();
  mr.setRandomSource(() => 1);
  return mr;
}

describe("a subscribe refused while the socket stays OPEN", () => {
  test("is retried on a backoff until the server accepts — no reconnect needed", async () => {
    const mr = client();
    mr.connect();
    const sock = latest();
    sock.open();
    mr.subscribe(["print_stats", "extruder"], () => {});
    await microtasks();
    expect(sock.subscribeRpcs()).toHaveLength(1);

    // Moonraker while Klippy restarts: the socket stays up, the RPC fails.
    sock.replyError(sock.subscribeRpcs()[0].id, "Klippy Host not connected");
    await microtasks();

    // The heartbeat keeps flowing, so nothing tears the link down…
    sock.push("notify_proc_stat_update", [{}]);

    // …and the retry re-pushes the SAME fields on the SAME socket.
    clock.advance(2001);
    await microtasks();
    const rpcs = sock.subscribeRpcs();
    expect(rpcs).toHaveLength(2);
    expect(Object.keys(rpcs[1].objects).sort()).toEqual([
      "extruder",
      "print_stats",
    ]);
    expect(MockSocket.instances).toHaveLength(1);

    // The server accepts: state flows again…
    sock.reply(rpcs[1].id, {
      status: { print_stats: { state: "standby" } },
    });
    await microtasks();
    expect(mr.getState().print_stats?.state).toBe("standby");

    // …and a settled subscription stops retrying. (Stays inside the 30s
    // silence tolerance so the link watchdog is not what ends the test.)
    clock.advance(25_000);
    await microtasks();
    expect(sock.subscribeRpcs()).toHaveLength(2);
    mr.disconnect();
  });

  test("the 15s RPC-timeout path re-pushes too — silence never freezes a live link", async () => {
    const mr = client();
    mr.connect();
    const sock = latest();
    sock.open();
    mr.subscribe(["print_stats"], () => {});
    await microtasks();
    expect(sock.subscribeRpcs()).toHaveLength(1);

    // No reply at all: the RPC times out while the socket stays OPEN.
    clock.advance(15_100);
    await microtasks(); // rollback + retry scheduled
    clock.advance(2001); // first retry fires
    await microtasks();
    expect(sock.subscribeRpcs()).toHaveLength(2);
    expect(sock.readyState).toBe(MockSocket.OPEN);
    mr.disconnect();
  });

  test("a consumer mounting the SAME fields after a refusal issues a fresh RPC", async () => {
    // Pre-regression behaviour: any route change retried a failed subscribe.
    // The rollback restores that without waiting for the timer.
    const mr = client();
    mr.connect();
    const sock = latest();
    sock.open();
    const fields = ["print_stats", "extruder"];
    mr.subscribe(fields, () => {});
    await microtasks();
    sock.replyError(sock.subscribeRpcs()[0].id, "Klippy Host not connected");
    await microtasks();

    mr.subscribe(fields, () => {}); // identical set — the frozen case
    await microtasks();
    expect(sock.subscribeRpcs()).toHaveLength(2);
    mr.disconnect();
  });

  test("consecutive refusals back off instead of hammering a restarting Klippy", async () => {
    const mr = client();
    mr.connect();
    const sock = latest();
    sock.open();
    mr.subscribe(["print_stats"], () => {});
    await microtasks();

    // Refuse the first push and its first retry.
    sock.replyError(sock.subscribeRpcs()[0].id, "Klippy Host not connected");
    await microtasks();
    clock.advance(2001); // attempt 0 → 2s
    await microtasks();
    expect(sock.subscribeRpcs()).toHaveLength(2);
    sock.replyError(sock.subscribeRpcs()[1].id, "Klippy Host not connected");
    await microtasks();

    // The second retry waits 4s, not another 2s.
    clock.advance(2001);
    await microtasks();
    expect(sock.subscribeRpcs()).toHaveLength(2);
    clock.advance(2000);
    await microtasks();
    expect(sock.subscribeRpcs()).toHaveLength(3);
    mr.disconnect();
  });
});

describe("a subscribe that dies WITH its socket", () => {
  test("is not retried by the timer — the open replay owns reconnects", async () => {
    const mr = client();
    mr.connect();
    const first = latest();
    first.open();
    mr.subscribe(["print_stats"], () => {});
    await microtasks();
    expect(first.subscribeRpcs()).toHaveLength(1);

    first.close(); // rejects the in-flight subscribe with the socket gone
    await microtasks();
    clock.advance(2500); // reconnect backoff fires
    const second = latest();
    expect(second).not.toBe(first);
    second.open();
    await microtasks();
    const replay = second.subscribeRpcs();
    expect(replay).toHaveLength(1);
    second.reply(replay[0].id, { status: {} });
    await microtasks();

    // Exactly one replay on the new socket, none on the corpse — and no
    // stray retry timer double-pushing behind the replay.
    clock.advance(25_000);
    await microtasks();
    expect(first.subscribeRpcs()).toHaveLength(1);
    expect(second.subscribeRpcs()).toHaveLength(1);
    mr.disconnect();
  });
});
