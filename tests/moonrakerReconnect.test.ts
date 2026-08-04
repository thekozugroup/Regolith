import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  CONNECT_TIMEOUT_MS,
  LINK_CHECK_MS,
  LINK_SILENCE_MS,
  Moonraker,
  STABLE_LINK_MS,
  type LinkState,
} from "../src/lib/moonraker";
import { jitteredDelay, moonrakerReconnectDelay } from "../src/lib/retry";

/**
 * Reconnect robustness — the four ways the link actually fails on hardware.
 *
 *   1. The printer goes away mid-job (Klipper restart, power cycle, Wi-Fi).
 *   2. The printer FLAPS: accepts a socket, drops it, repeat. This is what
 *      Moonraker does throughout a Klipper restart, and it used to pin the
 *      backoff at its floor forever instead of retreating.
 *   3. The socket never opens at all — a half-open TCP after a lid-close.
 *      No open event, no error event, no close event: nothing to react to.
 *   4. The socket stays OPEN and carries nothing. The worst one, because the
 *      dashboard keeps rendering the last values it saw and looks alive.
 *
 * Time is entirely synthetic here. Every timer and `Date.now` is driven by
 * the clock below, so "30 seconds of silence" is an assertion rather than a
 * sleep, and the suite runs in milliseconds.
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

  /** Run the clock forward, firing due timers in chronological order. */
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

  pending(): number {
    return this.timers.size;
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
  /** A wedged socket swallows close() — the exact hazard the watchdog exists for. */
  wedged = false;
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
    if (this.wedged) return; // never emits close, like a half-open TCP
    if (this.readyState === MockSocket.CLOSED) return;
    this.readyState = MockSocket.CLOSED;
    this.emit("close", {});
  }
  open(): void {
    this.readyState = MockSocket.OPEN;
    this.emit("open", {});
  }
  fail(): void {
    this.emit("error", {});
  }
  /** A server-initiated notification — what arms the silence check. */
  push(diff: Record<string, unknown>): void {
    this.emit("message", {
      data: JSON.stringify({
        jsonrpc: "2.0",
        method: "notify_status_update",
        params: [diff],
      }),
    });
  }
  reply(id: number, result: unknown): void {
    this.emit("message", { data: JSON.stringify({ jsonrpc: "2.0", id, result }) });
  }
  private emit(type: string, e: unknown): void {
    [...(this.listeners.get(type) ?? [])].forEach((fn) => fn(e));
  }
  subscribeRpcs(): Record<string, null>[] {
    return this.sent
      .map((s) => JSON.parse(s) as { method: string; params?: { objects: Record<string, null> } })
      .filter((m) => m.method === "printer.objects.subscribe")
      .map((m) => m.params?.objects ?? {});
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
  // Moonraker reaches for `window.setTimeout` / `window.setInterval` and the
  // bare `clearTimeout` / `clearInterval`, so both forms are replaced.
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

/** Deterministic jitter so backoff assertions are exact rather than ranged. */
function client(random = 1): Moonraker {
  const mr = new Moonraker();
  mr.setRandomSource(() => random);
  return mr;
}

/** A connected client with the given subscription already live. */
function live(fields: string[], random = 1): { mr: Moonraker; sock: MockSocket } {
  const mr = client(random);
  mr.connect();
  const sock = latest();
  sock.open();
  mr.subscribe(fields, () => {});
  clock.advance(1); // flush the queueSync microtask boundary
  return { mr, sock };
}

describe("backoff", () => {
  test("is jittered into the second half of its window, and capped", () => {
    for (const attempt of [0, 1, 2, 3, 4, 5, 9]) {
      const base = moonrakerReconnectDelay(attempt);
      expect(jitteredDelay(base, 0)).toBe(base / 2);
      expect(jitteredDelay(base, 1)).toBe(base);
      expect(jitteredDelay(base, 0.5)).toBe(base * 0.75);
      // Never below half the base: a reconnect must actually back off, and
      // never above the cap that keeps a dead printer from being hammered.
      expect(jitteredDelay(base, 0)).toBeGreaterThanOrEqual(base / 2);
      expect(jitteredDelay(base, 1)).toBeLessThanOrEqual(30_000);
    }
  });

  test("garbage or negative delays cannot produce a busy-loop retry", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      expect(jitteredDelay(bad, 0.5)).toBe(0);
    }
    // An out-of-range draw is clamped rather than trusted.
    expect(jitteredDelay(1000, -5)).toBe(500);
    expect(jitteredDelay(1000, 5)).toBe(1000);
  });

  test("grows with each failed attempt and stops at the 30s cap", () => {
    const mr = client(1);
    mr.connect();
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      const before = MockSocket.instances.length;
      latest().close();
      // Find the delay by advancing until a fresh socket appears.
      let waited = 0;
      while (MockSocket.instances.length === before && waited <= 40_000) {
        clock.advance(250);
        waited += 250;
      }
      delays.push(waited);
    }
    expect(delays.slice(0, 5)).toEqual([2000, 4000, 8000, 16_000, 30_000]);
    expect(delays.every((d) => d <= 30_000)).toBe(true);
    mr.disconnect();
  });
});

describe("reconnect storms", () => {
  test("a flapping printer is backed away from, not hammered", () => {
    // Moonraker accepting and instantly dropping is what a Klipper restart
    // looks like from the browser. Resetting the attempt counter on `open`
    // meant every one of those flaps retried at the 2s floor, forever.
    const mr = client(1);
    mr.connect();
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      const sock = latest();
      sock.open();
      clock.advance(50); // dropped long before it could be called stable
      const before = MockSocket.instances.length;
      sock.close();
      let waited = 0;
      while (MockSocket.instances.length === before && waited <= 40_000) {
        clock.advance(250);
        waited += 250;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([2000, 4000, 8000, 16_000, 30_000]);
    mr.disconnect();
  });

  test("a link that HELD resets the backoff — one bad night is not permanent", () => {
    const mr = client(1);
    mr.connect();
    latest().open();
    clock.advance(50);
    latest().close();
    clock.advance(2000); // first retry, 2s
    const second = latest();
    second.open();
    clock.advance(STABLE_LINK_MS + 1000); // this one holds
    const before = MockSocket.instances.length;
    second.close();
    let waited = 0;
    while (MockSocket.instances.length === before && waited <= 40_000) {
      clock.advance(250);
      waited += 250;
    }
    expect(waited).toBe(2000); // back to the floor, not 4000
    mr.disconnect();
  });

  test("twenty rapid connect/drop cycles leave exactly one socket and one live subscription", () => {
    const { mr } = live(["print_stats", "extruder", "heater_bed"]);
    for (let i = 0; i < 20; i++) {
      latest().close();
      clock.advance(31_000); // past any capped backoff
      latest().open();
      clock.advance(10);
    }
    const open = MockSocket.instances.filter(
      (s) => s.readyState === MockSocket.OPEN,
    );
    expect(open).toHaveLength(1);
    // Each open replays exactly once, with the same set — no drift, no union.
    const replay = open[0].subscribeRpcs();
    expect(replay).toHaveLength(1);
    expect(Object.keys(replay[0]).sort()).toEqual([
      "extruder",
      "heater_bed",
      "print_stats",
    ]);
    mr.disconnect();
  });

  test("an explicit connect cancels a pending backoff instead of queueing behind it", () => {
    const mr = client(1);
    mr.connect();
    latest().open();
    clock.advance(50);
    latest().close();
    clock.advance(500); // mid-backoff
    const before = MockSocket.instances.length;
    mr.connect(); // a hook mounting, a tab waking
    expect(MockSocket.instances.length).toBe(before + 1);
    // And the cancelled timer must not fire a SECOND socket afterwards.
    clock.advance(10_000);
    expect(MockSocket.instances.length).toBe(before + 1);
    mr.disconnect();
  });
});

describe("re-subscribe on reconnect", () => {
  test("a drop MID-PRINT replays the exact field set and keeps last-known state", () => {
    const seen: unknown[] = [];
    const mr = client(1);
    mr.connect();
    const first = latest();
    first.open();
    mr.subscribe(["print_stats", "virtual_sdcard", "extruder"], (s) => seen.push(s));
    clock.advance(1);
    first.push({
      print_stats: { state: "printing", filename: "benchy.gcode" },
      virtual_sdcard: { progress: 0.42 },
    });
    expect(mr.getState().print_stats?.state).toBe("printing");

    first.close();
    clock.advance(3000);
    const second = latest();
    second.open();
    clock.advance(1);

    expect(Object.keys(second.subscribeRpcs()[0]).sort()).toEqual([
      "extruder",
      "print_stats",
      "virtual_sdcard",
    ]);
    // The cache is NOT wiped on a drop. Showing the last known job beats
    // blanking the screen while the printer is still extruding.
    expect(mr.getState().print_stats?.filename).toBe("benchy.gcode");
    expect(mr.getState().virtual_sdcard?.progress).toBe(0.42);
    mr.disconnect();
  });

  test("a drop DURING HEATING leaves no half-arrived heater state", () => {
    const { mr, sock } = live(["extruder", "heater_bed"]);
    sock.push({
      extruder: { temperature: 180, target: 250, power: 1 },
      heater_bed: { temperature: 55, target: 60, power: 0.8 },
    });
    // The drop lands between two diffs, exactly where a partial merge would
    // show a target with no temperature (or worse, the reverse).
    sock.close();
    const state = mr.getState();
    expect(state.extruder).toEqual({ temperature: 180, target: 250, power: 1 });
    expect(state.heater_bed).toEqual({ temperature: 55, target: 60, power: 0.8 });
    mr.disconnect();
  });

  test("in-flight RPCs reject with a printer-shaped reason, not a silent hang", async () => {
    const { mr, sock } = live(["print_stats"]);
    const inFlight = mr.listObjects();
    sock.close();
    await expect(inFlight).rejects.toThrow(
      /connection closed before the action completed/i,
    );
    mr.disconnect();
  });

  test("a field released while offline does not come back on reconnect", () => {
    const mr = client(1);
    mr.connect();
    const first = latest();
    first.open();
    const release = mr.subscribe(["print_stats", "motion_report"], () => {});
    clock.advance(1);
    first.close();
    release(); // the motion consumer unmounts while the link is down
    mr.subscribe(["print_stats"], () => {});
    clock.advance(3000);
    const second = latest();
    second.open();
    clock.advance(1);
    expect(second.subscribeRpcs()[0]).toEqual({ print_stats: null });
    mr.disconnect();
  });
});

describe("wedged links", () => {
  test("a socket that never opens is timed out and retried", () => {
    const mr = client(1);
    mr.connect();
    const stuck = latest();
    stuck.wedged = true; // never opens, never errors, never closes
    expect(mr.getLinkState()).toBe("connecting");

    clock.advance(CONNECT_TIMEOUT_MS - LINK_CHECK_MS);
    expect(MockSocket.instances).toHaveLength(1); // still within tolerance

    clock.advance(LINK_CHECK_MS + 100);
    expect(mr.getLinkState()).toBe("down");
    clock.advance(31_000);
    expect(MockSocket.instances.length).toBeGreaterThan(1);
    mr.disconnect();
  });

  test("an OPEN socket carrying nothing is declared stale and torn down", () => {
    const states: LinkState[] = [];
    const { mr, sock } = live(["print_stats"]);
    mr.onLinkState((s) => states.push(s));
    sock.push({ print_stats: { state: "printing" } }); // proves it pushes
    expect(mr.getLinkState()).toBe("live");

    clock.advance(LINK_SILENCE_MS - LINK_CHECK_MS);
    expect(mr.getLinkState()).toBe("live"); // still inside tolerance

    clock.advance(LINK_CHECK_MS * 2);
    // "stale" is published before the teardown so anything watching link
    // state learns WHY the link dropped, then the reconnect path takes over.
    expect(states).toContain("stale");
    expect(mr.getLinkState()).toBe("down");
    expect(mr.isConnected()).toBe(false);
    mr.disconnect();
  });

  test("a server that never pushes is never torn down for being quiet", () => {
    // The strict e2e fixture answers subscriptions and pushes nothing else.
    // Silence from a server that has never pushed proves nothing.
    const { mr } = live(["print_stats"]);
    clock.advance(LINK_SILENCE_MS * 4);
    expect(mr.getLinkState()).toBe("live");
    expect(mr.isConnected()).toBe(true);
    mr.disconnect();
  });

  test("data arriving after a stale verdict restores the link without a reconnect", () => {
    const { mr, sock } = live(["print_stats"]);
    sock.push({ print_stats: { state: "printing" } });
    clock.advance(LINK_SILENCE_MS - 100);
    sock.push({ print_stats: { state: "printing" } }); // one late breath
    clock.advance(LINK_CHECK_MS * 2);
    expect(mr.getLinkState()).toBe("live");
    expect(MockSocket.instances).toHaveLength(1);
    mr.disconnect();
  });

  test("telemetry age is readable, and null before the first byte", () => {
    const mr = client(1);
    expect(mr.telemetryAge()).toBeNull();
    mr.connect();
    latest().open();
    clock.advance(5000);
    expect(mr.telemetryAge()).toBe(5000);
    mr.disconnect();
  });
});

describe("wake", () => {
  test("a tab coming back with no socket reconnects immediately, not after the backoff", () => {
    const mr = client(1);
    mr.connect();
    latest().open();
    clock.advance(50);
    latest().close();
    clock.advance(500); // still inside the scheduled backoff
    const before = MockSocket.instances.length;

    mr.wake();
    expect(MockSocket.instances.length).toBe(before + 1);
    latest().open();
    clock.advance(60_000);
    // Exactly one socket resulted — the cancelled backoff did not also fire
    // a second one behind it.
    expect(MockSocket.instances.length).toBe(before + 1);
    expect(mr.isConnected()).toBe(true);
    mr.disconnect();
  });

  test("a tab coming back to a GHOST socket replaces it", () => {
    const { mr, sock } = live(["print_stats"]);
    sock.push({ print_stats: { state: "printing" } });
    // The lid was shut for a while: the socket still says OPEN, and on the
    // other end there is nothing. This is the state that leaves a dashboard
    // frozen on stale numbers while looking perfectly healthy.
    clock.advance(LINK_SILENCE_MS + 1000);
    sock.wedged = true;

    mr.wake();
    expect(mr.isConnected()).toBe(false);
    clock.advance(31_000);
    expect(MockSocket.instances.length).toBeGreaterThan(1);
    mr.disconnect();
  });

  test("a tab coming back to a HEALTHY socket keeps it", () => {
    const { mr, sock } = live(["print_stats"]);
    sock.push({ print_stats: { state: "printing" } });
    clock.advance(2000);
    mr.wake();
    expect(mr.isConnected()).toBe(true);
    expect(MockSocket.instances).toHaveLength(1);
    mr.disconnect();
  });

  test("wake after an explicit disconnect stays disconnected", () => {
    // Settings deliberately dropping the link must not be undone by the user
    // switching tabs.
    const { mr } = live(["print_stats"]);
    mr.disconnect();
    const before = MockSocket.instances.length;
    mr.wake();
    expect(MockSocket.instances.length).toBe(before);
    expect(mr.isConnected()).toBe(false);
  });
});

describe("link teardown", () => {
  test("disconnect leaves no timer running", () => {
    const { mr, sock } = live(["print_stats"]);
    sock.push({ print_stats: { state: "printing" } });
    mr.disconnect();
    clock.advance(120_000);
    expect(clock.pending(), "a timer survived disconnect").toBe(0);
    expect(MockSocket.instances).toHaveLength(1);
  });

  test("the watchdog stops itself once there is nothing left to watch", () => {
    const mr = client(1);
    mr.connect();
    latest().open();
    mr.disconnect();
    clock.advance(60_000);
    expect(clock.pending()).toBe(0);
  });
});
