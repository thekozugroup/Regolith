import { describe, expect, test } from "bun:test";
import {
  TAILSCALE_AGE_TICK_MS,
  TAILSCALE_CONTROL_AVAILABLE,
  TAILSCALE_FILE_URL,
  TAILSCALE_FUTURE_TOLERANCE_MS,
  TAILSCALE_LIST_URL,
  TAILSCALE_OPEN_DELAY_MS,
  TAILSCALE_STALE_MS,
  TAILSCALE_STATUS_FILE,
  backendFromState,
  describeTailscale,
  parseTailscaleStatus,
  readTailscaleStatus,
  type TailscaleReading,
} from "../src/lib/tailscale";

/**
 * The values below are fabricated. Nothing here may carry the owner's real
 * tailnet address, machine name or tailnet — a test fixture is a tracked file.
 */
const NODE_IPV4 = "100.64.0.5";
const NODE_IPV6 = "fd7a:115c:a1e0::1234:5678";

function statusDocument(overrides: Record<string, unknown> = {}) {
  return {
    Version: "1.96.1",
    BackendState: "Running",
    AuthURL: "",
    Self: {
      TailscaleIPs: [NODE_IPV4, NODE_IPV6],
      DNSName: "example-printer.example-tailnet.ts.net.",
      Online: true,
    },
    CurrentTailnet: { Name: "example-tailnet" },
    Peer: { a: {}, b: {}, c: {} },
    ...overrides,
  };
}

describe("backend states", () => {
  // Every state tailscaled can report, mapped explicitly. A state that falls
  // through to "unknown" must never be dressed up as anything else.
  test("each documented BackendState maps to its own state", () => {
    expect(backendFromState("Running")).toBe("running");
    expect(backendFromState("Starting")).toBe("starting");
    expect(backendFromState("Stopped")).toBe("stopped");
    expect(backendFromState("NeedsLogin")).toBe("needs-login");
    expect(backendFromState("NeedsMachineAuth")).toBe("needs-machine-auth");
    expect(backendFromState("NoState")).toBe("no-state");
    // The sentinel the documented publish script writes when the binary is
    // gone — the one state tailscaled itself can never report.
    expect(backendFromState("NotInstalled")).toBe("not-installed");
  });

  test("anything else is unknown, not a guess", () => {
    for (const value of [
      null,
      undefined,
      "",
      "running",
      "RUNNING",
      "Connected",
      42,
      {},
      [],
    ]) {
      expect(backendFromState(value)).toBe("unknown");
    }
  });
});

describe("parsing a status document", () => {
  test("a full document yields every field", () => {
    const status = parseTailscaleStatus(statusDocument());
    expect(status).not.toBeNull();
    expect(status!.backend).toBe("running");
    expect(status!.ipv4).toBe(NODE_IPV4);
    // Trailing dot removed: MagicDNS names are fully qualified on the wire.
    expect(status!.dnsName).toBe("example-printer.example-tailnet.ts.net");
    expect(status!.tailnet).toBe("example-tailnet");
    expect(status!.version).toBe("1.96.1");
    expect(status!.online).toBe(true);
    expect(status!.peers).toBe(3);
    expect(status!.signInRequired).toBe(false);
  });

  test("an IPv6-only node reports no IPv4 rather than an IPv6 in its place", () => {
    const status = parseTailscaleStatus(
      statusDocument({ Self: { TailscaleIPs: [NODE_IPV6] } }),
    );
    expect(status!.ipv4).toBeNull();
    expect(status!.dnsName).toBeNull();
    expect(status!.online).toBeNull();
  });

  test("a document missing every optional field still parses", () => {
    const status = parseTailscaleStatus({ BackendState: "Stopped" });
    expect(status).toEqual({
      backend: "stopped",
      ipv4: null,
      dnsName: null,
      tailnet: null,
      version: null,
      online: null,
      peers: null,
      signInRequired: false,
    });
  });

  test("junk in a field degrades that field only", () => {
    const status = parseTailscaleStatus({
      BackendState: "Running",
      Self: { TailscaleIPs: "100.64.0.5", DNSName: 17, Online: "yes" },
      CurrentTailnet: "example-tailnet",
      Peer: [],
      Version: "   ",
    });
    expect(status!.backend).toBe("running");
    expect(status!.ipv4).toBeNull();
    expect(status!.dnsName).toBeNull();
    expect(status!.tailnet).toBeNull();
    expect(status!.online).toBeNull();
    expect(status!.peers).toBeNull();
    expect(status!.version).toBeNull();
  });

  test("an AuthURL means a human has to sign the machine in", () => {
    const status = parseTailscaleStatus(
      statusDocument({
        BackendState: "NeedsLogin",
        AuthURL: "https://login.example/auth/fabricated",
      }),
    );
    expect(status!.signInRequired).toBe(true);
    // The URL itself is deliberately not carried anywhere in the parsed
    // shape: Regolith shows the command, never the flow.
    expect(JSON.stringify(status)).not.toContain("login.example");
  });

  test("a non-document is not a status", () => {
    for (const value of [null, undefined, "Running", 3, [], true]) {
      expect(parseTailscaleStatus(value)).toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ */

function fetchStub(
  routes: Record<string, { status?: number; body?: string }>,
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = routes[url];
    if (!match) throw new Error(`unexpected request: ${url}`);
    return {
      ok: (match.status ?? 200) < 400,
      status: match.status ?? 200,
      json: async () => JSON.parse(match.body ?? ""),
    } as Response;
  }) as typeof fetch;
}

const MODIFIED = 1_700_000_000; // seconds, as Moonraker reports

function listing(files: Array<{ path: string; modified?: number }>) {
  return JSON.stringify({ result: files });
}

describe("reading the status the printer published", () => {
  test("a listed, parseable document is ready and dated", async () => {
    const reading = await readTailscaleStatus(
      fetchStub({
        [TAILSCALE_LIST_URL]: {
          body: listing([
            { path: "printer.cfg", modified: 1 },
            { path: TAILSCALE_STATUS_FILE, modified: MODIFIED },
          ]),
        },
        [TAILSCALE_FILE_URL]: { body: JSON.stringify(statusDocument()) },
      }),
    );
    expect(reading.availability).toBe("ready");
    expect(reading.status!.backend).toBe("running");
    expect(reading.reportedAt).toBe(MODIFIED * 1000);
  });

  // The honest gap: a printer that has never been given the cron job. This is
  // the state of a stock machine and it must read as a missing prerequisite,
  // not as a failure and never as a state.
  test("a printer that publishes nothing is not-configured", async () => {
    const reading = await readTailscaleStatus(
      fetchStub({
        [TAILSCALE_LIST_URL]: { body: listing([{ path: "printer.cfg" }]) },
      }),
    );
    expect(reading.availability).toBe("not-configured");
    expect(reading.status).toBeNull();
  });

  test("a file API that does not answer is unreadable, not empty", async () => {
    const reading = await readTailscaleStatus(
      fetchStub({ [TAILSCALE_LIST_URL]: { status: 500, body: "{}" } }),
    );
    expect(reading.availability).toBe("unreadable");
    expect(reading.detail).toBeTruthy();
  });

  test("a listing that is not a listing is unreadable", async () => {
    const reading = await readTailscaleStatus(
      fetchStub({ [TAILSCALE_LIST_URL]: { body: "<!doctype html>" } }),
    );
    expect(reading.availability).toBe("unreadable");
  });

  test("malformed JSON in the document is unreadable, never a state", async () => {
    const reading = await readTailscaleStatus(
      fetchStub({
        [TAILSCALE_LIST_URL]: {
          body: listing([{ path: TAILSCALE_STATUS_FILE, modified: MODIFIED }]),
        },
        [TAILSCALE_FILE_URL]: { body: "{ this is not json" },
      }),
    );
    expect(reading.availability).toBe("unreadable");
    expect(reading.status).toBeNull();
  });

  test("a document that parses but is not a status object is unreadable", async () => {
    const reading = await readTailscaleStatus(
      fetchStub({
        [TAILSCALE_LIST_URL]: {
          body: listing([{ path: TAILSCALE_STATUS_FILE, modified: MODIFIED }]),
        },
        [TAILSCALE_FILE_URL]: { body: '"Running"' },
      }),
    );
    expect(reading.availability).toBe("unreadable");
  });

  test("an undated entry still reads, but carries no timestamp", async () => {
    const reading = await readTailscaleStatus(
      fetchStub({
        [TAILSCALE_LIST_URL]: { body: listing([{ path: TAILSCALE_STATUS_FILE }]) },
        [TAILSCALE_FILE_URL]: { body: JSON.stringify(statusDocument()) },
      }),
    );
    expect(reading.availability).toBe("ready");
    expect(reading.reportedAt).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

const NOW = 1_800_000_000_000;

function ready(
  document: Record<string, unknown>,
  ageMs = 0,
): TailscaleReading {
  return {
    availability: "ready",
    status: parseTailscaleStatus(document),
    reportedAt: NOW - ageMs,
    detail: null,
  };
}

describe("what the panel is allowed to claim", () => {
  test("a fresh running document is the only thing that shows identity", () => {
    const display = describeTailscale(ready(statusDocument()), NOW);
    expect(display.state).toBe("running");
    expect(display.label).toBe("Connected");
    expect(display.tone).toBe("ok");
    expect(display.showsIdentity).toBe(true);
    expect(display.stale).toBe(false);
  });

  // THE RULE THIS MODULE EXISTS FOR. A cockpit that says "Connected" from a
  // document nobody has refreshed in an hour is worse than one that admits it
  // does not know.
  test("a stale running document reads as unknown and hides the address", () => {
    const display = describeTailscale(
      ready(statusDocument(), TAILSCALE_STALE_MS + 1),
      NOW,
    );
    expect(display.state).toBe("unknown");
    expect(display.label).toBe("Unknown");
    expect(display.showsIdentity).toBe(false);
    expect(display.stale).toBe(true);
    expect(display.detail).toContain("not reported recently");
  });

  test("a document just inside the window is still believed", () => {
    const display = describeTailscale(
      ready(statusDocument(), TAILSCALE_STALE_MS - 1),
      NOW,
    );
    expect(display.state).toBe("running");
    expect(display.showsIdentity).toBe(true);
  });

  test("a document that cannot be dated is unknown", () => {
    const display = describeTailscale(
      { ...ready(statusDocument()), reportedAt: null },
      NOW,
    );
    expect(display.state).toBe("unknown");
    expect(display.ageMs).toBeNull();
    expect(display.showsIdentity).toBe(false);
  });

  // A printer whose clock has drifted forward must not buy itself credit.
  test("a document from the future is unknown", () => {
    const display = describeTailscale(
      ready(statusDocument(), -(TAILSCALE_FUTURE_TOLERANCE_MS + 1_000)),
      NOW,
    );
    expect(display.state).toBe("unknown");
    expect(display.detail).toContain("future");
  });

  test("a small clock skew is tolerated rather than shouted about", () => {
    const display = describeTailscale(ready(statusDocument(), -1_000), NOW);
    expect(display.state).toBe("running");
  });

  test("every non-running state renders itself and hides identity", () => {
    const cases: Array<[string, string]> = [
      ["Stopped", "stopped"],
      ["Starting", "starting"],
      ["NeedsLogin", "needs-login"],
      ["NeedsMachineAuth", "needs-machine-auth"],
      ["NoState", "no-state"],
      ["NotInstalled", "not-installed"],
      ["SomethingNew", "unknown"],
    ];
    for (const [reported, expected] of cases) {
      const display = describeTailscale(
        ready(statusDocument({ BackendState: reported })),
        NOW,
      );
      expect(display.state).toBe(expected as never);
      expect(display.showsIdentity).toBe(false);
      expect(display.label).not.toBe("Connected");
    }
  });

  test("a pending sign-in outranks the reported state", () => {
    const display = describeTailscale(
      ready(
        statusDocument({
          BackendState: "Stopped",
          AuthURL: "https://login.example/auth/fabricated",
        }),
      ),
      NOW,
    );
    expect(display.state).toBe("needs-login");
    expect(display.detail).toContain("tailscale up");
    expect(display.detail).not.toContain("login.example");
  });

  test("a printer that publishes nothing says exactly that", () => {
    const display = describeTailscale(
      {
        availability: "not-configured",
        status: null,
        reportedAt: null,
        detail: null,
      },
      NOW,
    );
    expect(display.state).toBe("not-configured");
    expect(display.label).toBe("Not reporting");
    expect(display.showsIdentity).toBe(false);
    expect(display.detail).toContain("no shell");
  });

  test("an unreadable printer keeps its own explanation", () => {
    const display = describeTailscale(
      {
        availability: "unreadable",
        status: null,
        reportedAt: null,
        detail: "The printer's file API did not answer.",
      },
      NOW,
    );
    expect(display.state).toBe("unavailable");
    expect(display.label).toBe("Unknown");
    expect(display.detail).toBe("The printer's file API did not answer.");
  });

  test("no reading ever produces a confident label without a fresh document", () => {
    const confident = ["Connected"];
    const readings: TailscaleReading[] = [
      { availability: "not-configured", status: null, reportedAt: null, detail: null },
      { availability: "unreadable", status: null, reportedAt: null, detail: "x" },
      { ...ready(statusDocument()), reportedAt: null },
      ready(statusDocument(), TAILSCALE_STALE_MS + 1),
      { availability: "ready", status: null, reportedAt: NOW, detail: null },
    ];
    for (const reading of readings) {
      expect(confident).not.toContain(describeTailscale(reading, NOW).label);
    }
  });
});

describe("read cadence", () => {
  // The panel reads once, a beat after it opens, and then only on demand.
  // Settings already has four host reads in flight into a six-connection
  // pool; a fifth fired in the opening frame measurably slows the page.
  test("the open delay is real but invisible", () => {
    expect(TAILSCALE_OPEN_DELAY_MS).toBeGreaterThanOrEqual(500);
    expect(TAILSCALE_OPEN_DELAY_MS).toBeLessThanOrEqual(2_000);
  });

  // The age tick is a LOCAL clock, so it must be well inside the freshness
  // window — that is what lets a panel nobody touches still go Unknown.
  test("the age tick can catch the staleness edge without a network", () => {
    expect(TAILSCALE_AGE_TICK_MS).toBeLessThan(TAILSCALE_STALE_MS / 10);
  });
});

describe("controls", () => {
  // No start/stop is shipped, and the constant is the single source of that
  // truth. If a future phase wires a real control path it flips here, and the
  // e2e that asserts the buttons are absent flips with it.
  test("no control path is claimed", () => {
    expect(TAILSCALE_CONTROL_AVAILABLE).toBe(false);
  });
});
