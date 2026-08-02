A modern, opinionated web interface for Klipper-based 3D printers — built for ease of use, with foolproofing wired in at every step. Replaces Fluidd on a Creality K1 Max with a mission-control dashboard, calibration tooling, and explicit guard-rails that prevent accidental moves, mid-print misclicks, and out-of-bounds commands.

## Screenshots

![Regolith dashboard during an active print](./docs/screenshot.png)

## How it works

The UI is a static React SPA that talks directly to Moonraker over a single WebSocket. There is no backend service to maintain — drop the built bundle anywhere nginx can serve static files. State subscriptions are merged into immutable snapshots so React renders only what changed, and a stuck-watchdog reconnects the camera stream and WS automatically when the network blips.

Printer actions use a shared typed safety boundary with current-state checks, duplicate prevention, and clear errors. Print start re-checks state after confirmation and again after setup. Control blocks unhomed, busy, or out-of-bounds moves with a 0.5 mm endstop buffer. Expert Console access stays available, but hardware-changing and unknown commands are classified and confirmed. Tune macros currently retain their dedicated confirmation and busy-state guard while migration into the shared boundary continues.

Calibration tasks are exposed as one-click cards with explicit confirm modals, estimated durations, and the literal G-code preview behind a `<details>`. Print confirmation includes a physical-area checklist and optional adaptive bed mesh (KAMP); a setup error blocks print start instead of silently continuing. Print History surfaces the rolling Moonraker job log with success/failure pills and per-print stats.

## Stack

- React 19 + TypeScript on Bun + Vite
- Tailwind v4 with CSS-driven theming (8 accent presets, configurable device name)
- Lucide icons in the Radix stroke aesthetic
- Recharts for thermals, custom SVG for tachometer-style segmented gauges
- No backend — pure static SPA against Moonraker's WebSocket + REST API

## Status

Active

---

## Install for local development

Requirements: macOS or Linux, [Bun](https://bun.sh/), Git, and a Klipper printer reachable through Moonraker.

```sh
git clone https://github.com/thekozugroup/Regolith.git
cd Regolith
bun install
bun run dev
```

Open the local URL printed by Vite. During development, Vite proxies `/printer`, `/server`, `/machine`, `/access`, `/api`, `/webcam`, and `/websocket` to the configured printer.

## Safely install on the printer

Regolith targets `forge.local` by default. The deployment changes static web files only under `/usr/data`; it does not send G-code, move axes, heat components, edit printer configuration, or restart services.

First, verify SSH access. An SSH key is recommended:

```sh
ssh root@forge.local
```

If key authentication is unavailable, install `sshpass` from a trusted package manager. Then either let the script ask for the printer password silently or provide it through the environment. The script uses `sshpass -e`; the password never appears in process arguments.

Optional environment flow (input stays hidden and does not enter shell history):

```sh
read -r -s PRINTER_PASSWORD
export PRINTER_PASSWORD
./deploy.sh --preflight
unset PRINTER_PASSWORD
```

Run the read-only preflight first:

```sh
./deploy.sh --preflight
```

Preflight refuses to continue unless all printer state fields are present, Klipper is ready, no print or calibration is active, virtual SD is inactive, `/usr/data/fluidd` exists, required remote tools exist, and at least 32 MB is free. It does not change remote files.

Deploy after preflight passes:

```sh
./deploy.sh
```

The command installs locked local dependencies, runs lint and all tests, builds, then:

1. Uploads a release archive and verifies byte size plus SHA-256.
2. Extracts to `/usr/data/fluidd.next` and compares its complete file list with local `dist/`.
3. Creates a timestamped verified backup under `/usr/data/regolith-backups`.
4. Atomically moves the current UI to `/usr/data/fluidd.previous` and activates the staged UI.
5. HTTP-checks the HTML and every referenced asset.
6. Automatically swaps the previous UI back and verifies recovery if any post-swap check fails.

Use another trusted LAN hostname only when needed:

```sh
PRINTER_HOST=k1max.local ./deploy.sh --preflight
PRINTER_HOST=k1max.local ./deploy.sh
```

Host values are validated before any command runs. SSH uses the system known-hosts file with `StrictHostKeyChecking=accept-new`; an existing changed host key is rejected.

## Roll back

Rollback is also idle-gated and HTTP-verified:

```sh
./deploy.sh --rollback
```

This swaps `/usr/data/fluidd` and `/usr/data/fluidd.previous`, so the operation remains reversible. If the selected previous slot fails HTTP verification, the script restores the original slot and verifies recovery.

## Software updates and recovery

Creality software updates often preserve `/usr/data`, so Regolith keeps the previous slot and timestamped backups there. This is best-effort, not a guarantee: a firmware image may erase `/usr/data`, replace nginx routing, or change Moonraker behavior.

Before a printer software update, confirm backups exist:

```sh
ssh root@forge.local 'ls -lh /usr/data/regolith-backups /usr/data/fluidd.previous'
```

After an update, run `./deploy.sh --preflight`. Deploy again only if the printer is conclusively idle and the preflight still passes. Never treat a successful static deployment as proof that firmware or printer configuration survived.
