/**
 * Tailscale panel — the honesty of a readout the app cannot take for granted.
 *
 * Regolith has no shell on the printer and Moonraker cannot see Entware
 * services, so this panel reads a status document the printer publishes into
 * its config directory (see the header of src/lib/tailscale.ts). Everything
 * below pins the consequences of that:
 *
 *   - a printer that publishes nothing says so, and prints the setup;
 *   - a fresh Running document is the ONLY thing that may say "Connected" or
 *     show a tailnet address;
 *   - a stale or unreadable one reads as Unknown, with the address gone;
 *   - an auth URL never reaches the DOM;
 *   - no start/stop control is rendered while no control path exists;
 *   - the whole panel is expert-only.
 *
 * Every fixture address, machine name and tailnet below is fabricated.
 */

import { expect, test, type Page } from "@playwright/test";
import { installActiveMock } from "./support/active-state-harness";
import { SCENARIOS } from "./support/printer-scenarios";

const STATUS_FILE = "regolith-tailscale.json";
const NODE_IPV4 = "100.64.0.5";
const AUTH_URL = "https://login.example/auth/fabricated";

type Publish =
  | { kind: "absent" }
  | { kind: "listing-fails" }
  | { kind: "malformed"; ageSeconds?: number }
  | { kind: "document"; body: Record<string, unknown>; ageSeconds?: number };

function runningDocument(overrides: Record<string, unknown> = {}) {
  return {
    Version: "1.96.1",
    BackendState: "Running",
    AuthURL: "",
    Self: {
      TailscaleIPs: [NODE_IPV4, "fd7a:115c:a1e0::1234:5678"],
      DNSName: "example-printer.example-tailnet.ts.net.",
      Online: true,
    },
    CurrentTailnet: { Name: "example-tailnet" },
    Peer: {},
    ...overrides,
  };
}

/** Stand in for the printer's file API, registered after the harness. */
async function publish(page: Page, publication: Publish) {
  await page.route("**/server/files/list*", async (route) => {
    const root = new URL(route.request().url()).searchParams.get("root");
    if (root !== "config") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: [] }),
      });
      return;
    }
    if (publication.kind === "listing-fails") {
      await route.fulfill({ status: 500, body: "{}" });
      return;
    }
    const files: Array<{ path: string; modified: number }> = [
      { path: "printer.cfg", modified: 1_700_000_000 },
    ];
    if (publication.kind !== "absent") {
      files.push({
        path: STATUS_FILE,
        modified: Date.now() / 1000 - (publication.ageSeconds ?? 0),
      });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: files }),
    });
  });

  await page.route(`**/server/files/config/${STATUS_FILE}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body:
        publication.kind === "document"
          ? JSON.stringify(publication.body)
          : "{ not json",
    });
  });
}

async function openSettings(
  page: Page,
  publication: Publish,
  mode: "basic" | "expert" = "expert",
) {
  await installActiveMock(page, SCENARIOS[0]);
  await page.addInitScript((value) => {
    localStorage.setItem("forge.experience-mode", value);
  }, mode);
  await publish(page, publication);
  await page.goto("/settings");
}

const panel = (page: Page) => page.getByRole("region", { name: "Tailscale" });

test("a printer that publishes nothing says so and prints the setup", async ({
  page,
}) => {
  await openSettings(page, { kind: "absent" });

  await expect(page.getByTestId("tailscale-state")).toHaveText("Not reporting");
  await expect(page.getByTestId("tailscale-detail")).toContainText("no shell");
  // The gap is named, with the exact plumbing that closes it.
  const setup = page.getByTestId("tailscale-setup");
  await expect(setup).toBeVisible();
  await expect(setup).toContainText(STATUS_FILE);
  await expect(setup).toContainText("cron.1min");
  await expect(page.getByTestId("tailscale-address")).toHaveCount(0);
});

test("a fresh running document is the only thing that says Connected", async ({
  page,
}) => {
  await openSettings(page, { kind: "document", body: runningDocument() });

  await expect(page.getByTestId("tailscale-state")).toHaveText("Connected");
  await expect(page.getByTestId("tailscale-address")).toHaveText(NODE_IPV4);
  await expect(panel(page)).toContainText(
    "example-printer.example-tailnet.ts.net",
  );
  await expect(page.getByTestId("tailscale-age")).not.toHaveText("—");
  // A working printer is not nagged with setup instructions.
  await expect(page.getByTestId("tailscale-setup")).toHaveCount(0);
});

test("a stale document reads as unknown and takes the address away", async ({
  page,
}) => {
  await openSettings(page, {
    kind: "document",
    body: runningDocument(),
    ageSeconds: 600,
  });

  await expect(page.getByTestId("tailscale-state")).toHaveText("Unknown");
  await expect(page.getByTestId("tailscale-detail")).toContainText(
    "not reported recently",
  );
  await expect(page.getByTestId("tailscale-address")).toHaveCount(0);
  await expect(panel(page)).not.toContainText(NODE_IPV4);
});

test("a stopped daemon reads as stopped, not as an error", async ({ page }) => {
  await openSettings(page, {
    kind: "document",
    body: { BackendState: "Stopped" },
  });

  await expect(page.getByTestId("tailscale-state")).toHaveText("Stopped");
  await expect(page.getByTestId("tailscale-address")).toHaveCount(0);
});

test("a missing install reads as not installed", async ({ page }) => {
  await openSettings(page, {
    kind: "document",
    body: { BackendState: "NotInstalled" },
  });

  await expect(page.getByTestId("tailscale-state")).toHaveText("Not installed");
});

test("a pending sign-in shows the command and never the auth URL", async ({
  page,
}) => {
  await openSettings(page, {
    kind: "document",
    body: runningDocument({ BackendState: "NeedsLogin", AuthURL: AUTH_URL }),
  });

  await expect(page.getByTestId("tailscale-state")).toHaveText(
    "Sign-in required",
  );
  await expect(page.getByTestId("tailscale-detail")).toContainText(
    "tailscale up",
  );
  // The owner completes an auth flow themselves, at a shell. The URL must not
  // appear in the document at all — not as text, not as a link.
  expect(await page.content()).not.toContain(AUTH_URL);
  await expect(page.getByRole("link", { name: /login/i })).toHaveCount(0);
});

test("a document that will not parse is unknown, never a state", async ({
  page,
}) => {
  await openSettings(page, { kind: "malformed" });

  await expect(page.getByTestId("tailscale-state")).toHaveText("Unknown");
  await expect(page.getByTestId("tailscale-address")).toHaveCount(0);
  await expect(page.getByTestId("tailscale-setup")).toBeVisible();
});

test("a file API that does not answer is unknown, with its own reason", async ({
  page,
}) => {
  await openSettings(page, { kind: "listing-fails" });

  await expect(page.getByTestId("tailscale-state")).toHaveText("Unknown");
  await expect(page.getByTestId("tailscale-detail")).toContainText(
    "did not answer",
  );
});

test("no control is rendered while no control path exists", async ({ page }) => {
  await openSettings(page, { kind: "document", body: runningDocument() });

  const buttons = panel(page).getByRole("button");
  // Exactly one: the read-only re-check. Start, stop, sign-in, logout, exit
  // node, subnet routes and funnel are the owner's, at a shell.
  await expect(buttons).toHaveCount(1);
  await expect(buttons.first()).toHaveText(/Check now/);
  for (const forbidden of [
    /^start$/i,
    /^stop$/i,
    /disconnect/i,
    /log ?out/i,
    /exit node/i,
    /funnel/i,
  ]) {
    await expect(panel(page).getByRole("button", { name: forbidden })).toHaveCount(
      0,
    );
  }
  // The commands exist as text to run yourself, which is the honest surface.
  await expect(page.getByTestId("tailscale-owner-commands")).toContainText(
    "S06tailscaled",
  );
});

test("re-checking asks the printer again", async ({ page }) => {
  await openSettings(page, { kind: "document", body: runningDocument() });
  await expect(page.getByTestId("tailscale-state")).toHaveText("Connected");

  let listed = 0;
  page.on("request", (request) => {
    if (request.url().includes("/server/files/list?root=config")) listed += 1;
  });
  await panel(page).getByRole("button", { name: /Check now/ }).click();
  await expect.poll(() => listed).toBeGreaterThan(0);
});

test("the panel is expert-only infrastructure", async ({ page }) => {
  await openSettings(page, { kind: "document", body: runningDocument() }, "basic");

  await expect(page.getByTestId("tailscale-state")).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
});
