/**
 * Tailscale — an honest status readout for the printer's mesh VPN.
 *
 * WHY THIS MODULE READS A FILE INSTEAD OF ASKING THE PRINTER
 *
 * Regolith is a browser app. Its only channel to the machine is Moonraker over
 * HTTP/WS; it has no shell. Three candidate read paths were checked against
 * the owner's printer before any of this was written, and two of them are dead
 * ends:
 *
 *  1. `/machine/system_info` → `available_services`. The service provider on
 *     this firmware is `supervisord_cli` and it lists exactly three services:
 *     klipper, moonraker, klipper_mcu. Tailscale is an Entware service
 *     (`/opt/etc/init.d/S06tailscaled`), which supervisord knows nothing
 *     about, so it can never appear there and `POST /machine/services/*` can
 *     never act on it. (`GET /machine/services` is not an endpoint at all —
 *     it 404s.)
 *  2. Moonraker's `shell_command` component IS loaded, but it is an internal
 *     helper other components call; Moonraker exposes no HTTP route that runs
 *     an arbitrary command, by design.
 *  3. Klipper's `gcode_shell_command` extra IS installed (RUN_SHELL_COMMAND
 *     exists on this printer), but it can only run commands DECLARED in the
 *     printer config. The declared set is beep, v4l2-ctl, the shaper graph
 *     helpers and the Helper-Script backup jobs — nothing tailscale-shaped.
 *     Adding one means editing printer config and restarting Klipper, which is
 *     the owner's decision, not a web UI's.
 *
 * So there is no way for this app to run `tailscale status` today, and it does
 * not pretend otherwise. What Moonraker DOES offer is a file API over the
 * config directory. A one-line cron job on the printer can drop the output of
 * `tailscale status --json` there, and this module reads it — a real path,
 * with a real prerequisite, that the panel states plainly when it is absent.
 *
 * WHAT THIS MODULE WILL NOT DO
 *
 *  - It never renders a confident state from a document it cannot date or that
 *    has gone stale. A cockpit that says "Connected" from a three-week-old file
 *    is worse than one that says "Unknown".
 *  - It never surfaces an auth URL and never touches login, logout, exit
 *    nodes, subnet routes, funnel or serve. Those are the owner's, at a shell.
 */

/** Root and filename of the status document, as served by Moonraker. */
export const TAILSCALE_STATUS_ROOT = "config";
export const TAILSCALE_STATUS_FILE = "regolith-tailscale.json";

/**
 * Presence is discovered through the directory listing rather than by
 * requesting the file and catching a 404 — the listing also carries the
 * document's `modified` time, which is the only trustworthy basis for the
 * staleness rule below, and it keeps a printer without the cron job from
 * printing a 404 into the console every poll.
 */
export const TAILSCALE_LIST_URL = `/server/files/list?root=${TAILSCALE_STATUS_ROOT}`;
export const TAILSCALE_FILE_URL = `/server/files/${TAILSCALE_STATUS_ROOT}/${TAILSCALE_STATUS_FILE}`;

/**
 * How long a status document stays believable.
 *
 * The documented cron entry runs every minute, so three minutes is three
 * missed runs: long enough to survive a busy printer, short enough that a dead
 * crond (the exact failure this printer already hit once) turns the readout to
 * Unknown rather than leaving a stale "Connected" on screen.
 */
export const TAILSCALE_STALE_MS = 180_000;

/**
 * A document dated further in the future than this is not trusted either — an
 * unsynced printer clock must not buy a stale file unlimited credit.
 */
export const TAILSCALE_FUTURE_TOLERANCE_MS = 60_000;

/**
 * How often the on-screen age is recomputed. This is a LOCAL clock tick, not
 * a network poll: the panel reads once when it opens and then only when the
 * owner presses Check now. The document carries its own timestamp, so the
 * readout still crosses into "Unknown" on time without asking the printer
 * anything.
 */
export const TAILSCALE_AGE_TICK_MS = 5_000;

/**
 * How long the panel waits after opening before it reads.
 *
 * Settings opens with four host reads already in flight, into a six-connection
 * pool. A fifth fired in the same frame competes with the page the owner is
 * actually looking at — and someone passing through Settings on the way
 * somewhere else should not spend a request on infrastructure they did not
 * open. A second is invisible to anyone who came here to look at this panel.
 */
export const TAILSCALE_OPEN_DELAY_MS = 1_000;

/**
 * Backend states tailscaled reports, plus `not-installed`, the sentinel the
 * documented cron script writes when the binary is missing, and `unknown` for
 * anything a future tailscale release invents.
 */
export type TailscaleBackend =
  | "running"
  | "starting"
  | "stopped"
  | "needs-login"
  | "needs-machine-auth"
  | "no-state"
  | "not-installed"
  | "unknown";

const BACKEND_BY_STATE: Record<string, TailscaleBackend> = {
  Running: "running",
  Starting: "starting",
  Stopped: "stopped",
  NeedsLogin: "needs-login",
  NeedsMachineAuth: "needs-machine-auth",
  NoState: "no-state",
  NotInstalled: "not-installed",
};

export function backendFromState(value: unknown): TailscaleBackend {
  return typeof value === "string" && BACKEND_BY_STATE[value]
    ? BACKEND_BY_STATE[value]
    : "unknown";
}

export interface TailscaleStatus {
  backend: TailscaleBackend;
  /** Tailnet IPv4 (100.64.0.0/10), when the node has one. */
  ipv4: string | null;
  /** MagicDNS name, trailing dot removed. */
  dnsName: string | null;
  tailnet: string | null;
  version: string | null;
  online: boolean | null;
  peers: number | null;
  /**
   * tailscaled published an auth URL, i.e. a human has to sign this machine
   * in. The URL itself is deliberately NOT carried: Regolith shows the command
   * to run at a shell and never handles the flow on the owner's behalf.
   */
  signInRequired: boolean;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Read one `tailscale status --json` document. Total and defensive: every
 * field is optional, because a partial document from a daemon that is still
 * starting is normal, and a missing field must degrade one row rather than
 * blank the panel.
 */
export function parseTailscaleStatus(value: unknown): TailscaleStatus | null {
  const document = record(value);
  if (!document) return null;

  const self = record(document.Self);
  const ips = Array.isArray(self?.TailscaleIPs) ? self.TailscaleIPs : [];
  const ipv4 =
    ips.find(
      (address): address is string =>
        typeof address === "string" && /^\d{1,3}(\.\d{1,3}){3}$/.test(address),
    ) ?? null;

  const dns = text(self?.DNSName);
  const peers = record(document.Peer);

  return {
    backend: backendFromState(document.BackendState),
    ipv4,
    dnsName: dns ? dns.replace(/\.$/, "") : null,
    tailnet: text(record(document.CurrentTailnet)?.Name),
    version: text(document.Version),
    online: typeof self?.Online === "boolean" ? self.Online : null,
    peers: peers ? Object.keys(peers).length : null,
    signInRequired: text(document.AuthURL) !== null,
  };
}

/* -------------------------------------------------------------------------
 * The adapter: one real implementation, one documented prerequisite.
 * ---------------------------------------------------------------------- */

export type TailscaleAvailability = "ready" | "not-configured" | "unreadable";

export interface TailscaleReading {
  availability: TailscaleAvailability;
  status: TailscaleStatus | null;
  /** ms epoch the printer last wrote the document, from the file listing. */
  reportedAt: number | null;
  /** Why a non-ready reading is non-ready, in the owner's words. */
  detail: string | null;
}

interface ListedFile {
  path?: unknown;
  modified?: unknown;
}

async function getJson(
  fetcher: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetcher(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Read the status document, or explain why there isn't one.
 *
 * `fetcher` is injected so the whole path is testable without a network and
 * without a printer.
 */
export async function readTailscaleStatus(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<TailscaleReading> {
  let listing: unknown;
  try {
    listing = await getJson(fetcher, TAILSCALE_LIST_URL, signal);
  } catch {
    return unreadable("The printer's file API did not answer.");
  }

  const files = record(listing)?.result;
  if (!Array.isArray(files)) {
    return unreadable("The printer's file API answered with something else.");
  }

  const entry = (files as ListedFile[]).find(
    (file) => text(file?.path) === TAILSCALE_STATUS_FILE,
  );
  if (!entry) {
    return {
      availability: "not-configured",
      status: null,
      reportedAt: null,
      detail: "No status file on the printer.",
    };
  }

  const modified = typeof entry.modified === "number" ? entry.modified : null;

  let body: unknown;
  try {
    body = await getJson(fetcher, TAILSCALE_FILE_URL, signal);
  } catch {
    return unreadable("The status file is on the printer but could not be read.");
  }

  const status = parseTailscaleStatus(body);
  if (!status) {
    return unreadable("The status file is not a tailscale status document.");
  }

  return {
    availability: "ready",
    status,
    reportedAt:
      modified !== null && Number.isFinite(modified) ? modified * 1000 : null,
    detail: null,
  };
}

function unreadable(detail: string): TailscaleReading {
  return { availability: "unreadable", status: null, reportedAt: null, detail };
}

/* -------------------------------------------------------------------------
 * The display law. One pure function decides what may be claimed on screen.
 * ---------------------------------------------------------------------- */

export type TailscaleDisplayState =
  | TailscaleBackend
  | "not-configured"
  | "unavailable";

export type TailscaleTone = "ok" | "warn" | "idle" | "unknown";

export interface TailscaleDisplay {
  state: TailscaleDisplayState;
  label: string;
  tone: TailscaleTone;
  detail: string;
  /** Only ever true for a fresh document from a running daemon. */
  showsIdentity: boolean;
  /** Age of the document in ms, or null when it could not be dated. */
  ageMs: number | null;
  stale: boolean;
}

const BACKEND_DISPLAY: Record<
  TailscaleBackend,
  { label: string; tone: TailscaleTone; detail: string }
> = {
  running: {
    label: "Connected",
    tone: "ok",
    detail: "The printer is on your tailnet.",
  },
  starting: {
    label: "Starting",
    tone: "warn",
    detail: "tailscaled is coming up. This usually settles in a few seconds.",
  },
  stopped: {
    label: "Stopped",
    tone: "idle",
    detail:
      "tailscaled is installed but not connected. Start it from a shell on the printer.",
  },
  "needs-login": {
    label: "Sign-in required",
    tone: "warn",
    detail:
      "This machine has to be signed in to your tailnet. Run tailscale up on the printer and follow the link it prints — Regolith never handles that flow for you.",
  },
  "needs-machine-auth": {
    label: "Awaiting approval",
    tone: "warn",
    detail:
      "The machine is signed in and waiting for an admin to approve it in the Tailscale console.",
  },
  "no-state": {
    label: "Not set up",
    tone: "idle",
    detail: "tailscaled is running but has never joined a tailnet.",
  },
  "not-installed": {
    label: "Not installed",
    tone: "idle",
    detail: "No tailscale binary was found on the printer.",
  },
  unknown: {
    label: "Unknown",
    tone: "unknown",
    detail: "The printer reported a state this build does not recognise.",
  },
};

/** How the panel explains a printer that simply isn't reporting. */
export const TAILSCALE_NOT_CONFIGURED_DETAIL =
  "Regolith has no shell on the printer, and Moonraker cannot see Entware services like tailscaled. Status appears here once the printer publishes it — see the one-time setup below.";

/**
 * Turn a reading into what the panel is allowed to say.
 *
 * The staleness rule is the whole point: a document that cannot be dated, is
 * older than the freshness window, or is dated in the future is reported as
 * Unknown with the age spelled out. Nothing else in the app may infer a
 * tailnet state.
 */
export function describeTailscale(
  reading: TailscaleReading,
  now: number,
): TailscaleDisplay {
  if (reading.availability === "not-configured") {
    return {
      state: "not-configured",
      label: "Not reporting",
      tone: "unknown",
      detail: TAILSCALE_NOT_CONFIGURED_DETAIL,
      showsIdentity: false,
      ageMs: null,
      stale: false,
    };
  }

  if (reading.availability === "unreadable" || !reading.status) {
    return {
      state: "unavailable",
      label: "Unknown",
      tone: "unknown",
      detail:
        reading.detail ?? "Tailscale status could not be read from the printer.",
      showsIdentity: false,
      ageMs: null,
      stale: false,
    };
  }

  const ageMs = reading.reportedAt === null ? null : now - reading.reportedAt;
  const undatable = ageMs === null;
  const fromTheFuture =
    ageMs !== null && ageMs < -TAILSCALE_FUTURE_TOLERANCE_MS;
  const expired = ageMs !== null && ageMs > TAILSCALE_STALE_MS;

  if (undatable || fromTheFuture || expired) {
    return {
      state: "unknown",
      label: "Unknown",
      tone: "unknown",
      detail: undatable
        ? "The printer's last report could not be dated, so its state cannot be trusted."
        : fromTheFuture
          ? "The printer's last report is dated in the future — check its clock. Its state cannot be trusted."
          : "The printer has not reported recently, so its state cannot be trusted. Check that cron is running on the printer.",
      showsIdentity: false,
      ageMs,
      stale: true,
    };
  }

  const backend = reading.status.backend;
  const base = BACKEND_DISPLAY[backend];
  // An auth URL outranks the reported state: a daemon can say Running while
  // waiting to be signed in again, and the owner needs the actionable line.
  const signIn = reading.status.signInRequired && backend !== "running";
  const shown = signIn ? BACKEND_DISPLAY["needs-login"] : base;

  // Self.Online outranks BackendState's optimism: Running means the local
  // daemon is up, while Online=false is the coordination server saying this
  // node currently has no working path. The panel must not assert "on your
  // tailnet" from a document that says otherwise. The identity rows stay —
  // the address is real, only its reachability is in doubt — and an ABSENT
  // field (online === null) still reads as Connected: absence is not
  // contradiction, and Online can flicker false during a netmap re-poll, so
  // this is a qualified warn rather than an alarm.
  const unseen = backend === "running" && reading.status.online === false;

  return {
    state: signIn ? "needs-login" : backend,
    label: unseen ? "Running, not seen" : shown.label,
    tone: unseen ? "warn" : shown.tone,
    detail: unseen
      ? "tailscaled is running, but your tailnet does not currently see this machine — remote access may not work until it reconnects."
      : shown.detail,
    showsIdentity: backend === "running",
    ageMs,
    stale: false,
  };
}

/* -------------------------------------------------------------------------
 * Controls.
 * ---------------------------------------------------------------------- */

/**
 * Whether Regolith has a real path to start or stop the daemon. It does not,
 * and this constant exists so the reason lives next to the evidence rather
 * than as a comment in a component.
 *
 * Doing it would require an owner-declared `[gcode_shell_command …]` in the
 * printer config plus a macro to invoke it — i.e. the owner granting the web
 * UI arbitrary root command execution through the g-code path. Regolith will
 * not ship a start/stop button that only works if the owner opens that door,
 * and it will not open it for them. The panel prints the exact commands
 * instead; a shell is one ssh away and it is the honest surface for this.
 */
export const TAILSCALE_CONTROL_AVAILABLE: boolean = false;

/** The one-time setup that makes the status above possible. */
export const TAILSCALE_PUBLISH_SETUP = `# on the printer, once:
cat > /usr/data/scripts/regolith-tailscale.sh <<'EOF'
#!/bin/sh
OUT=/usr/data/printer_data/config/${TAILSCALE_STATUS_FILE}
TMP="$OUT.tmp"
if [ ! -x /opt/bin/tailscale ]; then
  printf '{"BackendState":"NotInstalled"}\\n' > "$TMP"
elif ! /opt/bin/tailscale status --json > "$TMP" 2>/dev/null; then
  printf '{"BackendState":"Stopped"}\\n' > "$TMP"
fi
mv "$TMP" "$OUT"
EOF
chmod 755 /usr/data/scripts/regolith-tailscale.sh
ln -sf /usr/data/scripts/regolith-tailscale.sh /opt/etc/cron.1min/regolith-tailscale
/usr/data/scripts/regolith-tailscale.sh`;

/** Owner-only operations, printed rather than performed. */
export const TAILSCALE_OWNER_COMMANDS: ReadonlyArray<{
  title: string;
  command: string;
  note: string;
}> = [
  {
    title: "Start / stop the daemon",
    command: "/opt/etc/init.d/S06tailscaled start   # or stop, restart",
    note: "rc.func prints 'logger: not found' even on success — check pidof tailscaled instead.",
  },
  {
    title: "Sign this machine in",
    command: "/opt/bin/tailscale up",
    note: "Prints a link to open in your browser. Regolith never opens, stores or completes it.",
  },
  {
    title: "Repair the Entware boot hook",
    command: `printf '#!/bin/sh\\n/opt/etc/init.d/rc.unslung "$1"\\n' > /etc/init.d/S50unslung
chmod 755 /etc/init.d/S50unslung`,
    note: "A Creality firmware update can wipe this hook, which silently stops every Entware service — tailscaled and cron included.",
  },
];
