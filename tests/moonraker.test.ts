import { afterAll, describe, expect, test } from "bun:test";
import { Moonraker } from "../src/lib/moonraker";

/**
 * WP-PERF subscription hygiene:
 *  - N mounting consumers ⇒ exactly one printer.objects.subscribe RPC
 *  - the pushed field set REPLACES the previous one (never unions), on both
 *    the live path and the reconnect replay path
 *  - every settled RPC clears its 15s timeout handle (the timer leak)
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
  subscribeRpcs(): { id: number; objects: Record<string, null> }[] {
    return this.sent
      .map((s) => JSON.parse(s) as { id: number; method: string; params?: { objects: Record<string, null> } })
      .filter((m) => m.method === "printer.objects.subscribe")
      .map((m) => ({ id: m.id, objects: m.params?.objects ?? {} }));
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

/** Run past microtask coalescing (queueSync) deterministically. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function freshClient(): { mr: Moonraker; sock: MockSocket } {
  const mr = new Moonraker();
  mr.connect();
  const sock = MockSocket.instances[MockSocket.instances.length - 1];
  sock.open();
  return { mr, sock };
}

describe("Moonraker subscription ref-count", () => {
  test("three consumers mounting one field set ⇒ exactly 1 subscribe RPC", async () => {
    const { mr, sock } = freshClient();
    const fields = ["print_stats", "toolhead", "extruder"];
    const u1 = mr.subscribe(fields, () => {});
    const u2 = mr.subscribe(fields, () => {});
    const u3 = mr.subscribe(fields, () => {});
    await flush();
    const rpcs = sock.subscribeRpcs();
    expect(rpcs).toHaveLength(1);
    expect(Object.keys(rpcs[0].objects).sort()).toEqual([...fields].sort());
    u1();
    u2();
    u3();
    mr.disconnect();
  });

  test("releasing the last claimant REPLACES the set — no union leftovers", async () => {
    const { mr, sock } = freshClient();
    const uA = mr.subscribe(["print_stats", "motion_report"], () => {});
    await flush();
    expect(Object.keys(sock.subscribeRpcs()[0].objects).sort()).toEqual([
      "motion_report",
      "print_stats",
    ]);
    uA();
    const uB = mr.subscribe(["print_stats"], () => {});
    await flush();
    const rpcs = sock.subscribeRpcs();
    expect(rpcs).toHaveLength(2);
    // A unioned client would still name motion_report here.
    expect(rpcs[1].objects).toEqual({ print_stats: null });
    uB();
    mr.disconnect();
  });

  test("unsubscribe is idempotent — double release cannot underflow a claim", async () => {
    const { mr, sock } = freshClient();
    const u1 = mr.subscribe(["print_stats"], () => {});
    const u2 = mr.subscribe(["print_stats"], () => {});
    await flush();
    u1();
    u1(); // double release must not steal u2's claim
    await flush();
    expect(sock.subscribeRpcs()).toHaveLength(1); // set unchanged — no RPC
    u2();
    mr.disconnect();
  });

  test("reconnect replays the CURRENT set — a field released offline stays gone", async () => {
    const { mr, sock } = freshClient();
    const uA = mr.subscribe(["print_stats", "motion_report"], () => {});
    await flush();
    expect(sock.subscribeRpcs()).toHaveLength(1);

    sock.close(); // unexpected drop
    uA(); // motion_report claimant unmounts while offline
    mr.subscribe(["print_stats"], () => {});
    await flush();

    mr.connect();
    const sock2 = MockSocket.instances[MockSocket.instances.length - 1];
    expect(sock2).not.toBe(sock);
    sock2.open();
    await flush();
    const replay = sock2.subscribeRpcs();
    expect(replay).toHaveLength(1);
    expect(replay[0].objects).toEqual({ print_stats: null });
    mr.disconnect();
  });
});

describe("Moonraker RPC timeout handles", () => {
  test("a settled RPC clears its 15s timer; disconnect clears pending timers", async () => {
    const created: unknown[] = [];
    const cleared: unknown[] = [];
    const origSet = globalThis.setTimeout;
    const origClear = globalThis.clearTimeout;
    // @ts-expect-error — test shim records 15s RPC timers
    globalThis.setTimeout = (fn: () => void, ms?: number) => {
      const t = origSet(fn, ms);
      if (ms === 15000) created.push(t);
      return t;
    };
    // @ts-expect-error — test shim records cleared handles
    globalThis.clearTimeout = (t: unknown) => {
      cleared.push(t);
      return origClear(t as Parameters<typeof origClear>[0]);
    };
    try {
      const { mr, sock } = freshClient();
      const p = mr.listObjects();
      expect(created).toHaveLength(1);
      const rpc = JSON.parse(sock.sent[sock.sent.length - 1]) as { id: number };
      sock.receive({ jsonrpc: "2.0", id: rpc.id, result: { objects: [] } });
      await p;
      expect(cleared).toContain(created[0]); // resolve path clears the handle

      const dangling = mr.listObjects();
      expect(created).toHaveLength(2);
      mr.disconnect(); // rejectPending path must also clear
      await expect(dangling).rejects.toThrow();
      expect(cleared).toContain(created[1]);
    } finally {
      globalThis.setTimeout = origSet;
      globalThis.clearTimeout = origClear;
    }
  });
});
