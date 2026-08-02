# Regolith working handoff

## Goal

Make Regolith safe and approachable for a nontechnical Apple user while preserving expert Klipper control. Use calm Apple HIG-style hierarchy, solid industrial surfaces, and frosted blur only for navigation/status chrome. No Liquid Glass.

## Current status

- Exact-current Basic/Expert disclosure, route splitting, camera/network recovery, responsive thermal polish, safety, accessibility, and deployment hardening are committed and pushed on `main` at `a7e56fe`.
- Exact-current static assets are deployed on the live K1 Max. Local and live hashes match for HTML, CSS, core JavaScript, the Dashboard route, and the lazy Expert chart chunk.
- Delivery is fail-closed: key-first authentication, conclusive idle gates, verified archive/staging/backup, atomic swap, automatic rollback, and manual rollback.
- No G-code or hardware-affecting printer action occurred during preflight, deployment, or validation.

## Safety boundaries

- `src/lib/printerActions.ts` is the shared UI action boundary.
- Print start, repeat, pause, resume, cancel, emergency stop, Klipper/firmware restart, console commands, jog, home, and motor release use typed actions.
- Every action checks current connection/printer state. Confirmed actions check again after confirmation to close stale-state races.
- Duplicate action keys are locked until completion.
- Print setup failure blocks print start and reports the actual Moonraker error.
- Console remains available behind an expert-mode control. Known diagnostics are allowlisted; motion, heat, stop, restart, and config commands receive critical warnings; unknown macros receive caution warnings.
- Emergency stop remains available while busy because physical safety takes priority. It clearly warns that Klipper recovery is required.
- Every Tune macro and pressure-advance write now uses the shared runner. Existing accessible confirmations remain; live state is checked after confirmation, Tune actions share a duplicate lock, and failures appear in the UI.
- Calibration plus follow-up commands are submitted as one ordered script. Pressure Advance Save explicitly warns that it writes configuration and restarts Klipper.

## UI and accessibility

- Basic is the safe default for new browser profiles. It keeps Home, Files, Control, Timelapses, Settings, readiness, temperatures, camera, active-job state, guarded movement, and emergency stop visible.
- Expert is a persisted UI-only preference. It reveals Tune, Console, low-level telemetry, full travel bounds, profiles, backup/restore, host diagnostics, and recovery restarts. Direct visits to Tune or Console in Basic mode show a plain-language safety gate instead of loading the tool.
- Settings explains what each mode adds and confirms that mode changes do not alter printer configuration.
- Desktop navigation has visible labels. Mobile uses a four-target bottom bar plus an accessible More sheet.
- Mobile More, print confirmation, and Tune confirmation now share a modal primitive with initial focus, complete Tab/Shift+Tab trapping, Escape dismissal, background inerting, scroll lock, backdrop dismissal, and focus restoration. Busy print confirmation cannot dismiss mid-start.
- Every visible interactive target uses at least a 44x44px hit area, including jog distance presets, theme fields/swatches, brand controls, camera fullscreen, uploads, file filtering, and Console autoscroll.
- UI uses Apple platform typography; monospaced text is reserved for commands and measurements.
- Orange and custom-accent action surfaces choose an accessible light or dark foreground. Default orange action contrast measured 6.96:1 in Chrome.
- Every route exposes one useful visible `h1`; card titles are semantic `h2` headings with a quieter, sentence-case hierarchy.
- Theme fields and pressure advance expose explicit labels, current values, and units. Files and Timelapses announce loading/results and expose `aria-busy`.
- File and Timelapse rows are keyboard-operable buttons. Camera status no longer claims Live after a stream error. Motion honors `prefers-reduced-motion`.
- Camera status starts at Connecting, backs off through bounded automatic retry, settles Offline without continued network churn, and exposes one explicit Try Again action. Printing controls remain independent.
- Moonraker treats CONNECTING and OPEN sockets as active, preventing duplicate connections from concurrent hooks. Reconnect delay grows from 2 seconds to a 30-second cap, stale callbacks are ignored, and pending actions reject when the connection closes.
- Thermal gauges scale to their grid cells, use compact three-column status readouts, and expose full temperature/target descriptions to assistive technology.
- Frosted blur is confined to app navigation/status chrome.

## Live printer validation — 2026-08-02, `a7e56fe`

- Target: Creality K1 Max (`# K1-MAX`, 300 x 300 x 300 mm in `printer.cfg`). Firmware `1.3.5.19`; board `CR4CU220812S11`; Moonraker `v0.10.0-19-g1ed102e` / API `1.5.0`; Klipper reported ready.
- Pre-deploy and post-deploy gates: `print_stats.state=standby`, empty filename/message, `idle_timeout.state=Idle`, `virtual_sdcard.is_active=false`, and no active file.
- Final temperatures: hotend `27.65 C`, bed `26.40 C`; both targets `0.0` and power `0.0`.
- No hardware actions occurred: no G-code, motion, homing, heating, extrusion, fan/light, print control, calibration, firmware update, service restart, or config write.
- `forge.local` SSH succeeded but the first HTTP gate failed closed when macOS mDNS timed out. A fresh resolver lookup returned `192.168.50.179`; its ECDSA host key matched accepted `forge.local` byte-for-byte before use.
- Read-only preflight through the fingerprint-matched resolver address passed with ready/standby/Idle/inactive state and changed no remote files.
- Exact-current guarded deployment archive: 231,781 bytes, SHA-256 `747646c9ac13c1b06f40142f1da9b7adecddb9dbbefc298aea5da8fbabf60842`.
- Exact local/live HTTP hash matches:
  - `index.html`: `609d9f053194b03e46e79e412b65105a94b34587e2a32955432333ac40bf9143`
  - `assets/index-BP6jlvX2.css`: `586e0ee02c40434550cad96491d777b0d2617d99a71af73545e47ac20f382dbc`
  - `assets/index-C1BOr199.js`: `9806735d8c4c2de4af56f85527c2f53023c80f1185861d541fe8a644df9c2308`
  - `assets/Dashboard-4GjB2Eox.js`: `c67c9261033a433b9d83b9e9acdaeda0d1b6dcee5f0ede14e8e0c1f55d86adef`
  - `assets/Sparkline-BzutuvMN.js`: `3c750e9f2210132630b235ba5504e1fc6c6a96380d2cd73fb238b9b8cf2ef37f`
- Routes `/`, `/settings`, `/print`, `/control`, `/tune`, `/timelapses`, and `/console` returned HTTP 200. Printer, system, and server APIs returned HTTP 200; browser WebSocket opened successfully.
- Live browser smoke passed: Basic Home at 1440x1000 and 390x844 showed ready/standby telemetry and a real Live camera feed; Expert Settings and Tune rendered at 390x844. All views had zero overflow and zero visible targets below 44px. There were zero request failures, console errors, or page exceptions. No control was clicked.
- Rollback ready: the previously verified UI remains in `/usr/data/fluidd.previous`.
- Latest persistent verified backup: `/usr/data/regolith-backups/fluidd-before-20260802T172316Z.tgz`, 221,782 bytes, SHA-256 `0d1065a85c0e0bf2a8ee76a4b891b020cac9cca62e9a04681191f35997132444`, 6 entries. Deploy cleanup completed.
- Accepted ECDSA fingerprint remains `SHA256:43wgMSNzgWwHJt/gd9dfgLRYAZGh4XhYfQTaw/OaT2k`. Never use a resolver fallback without matching it first.

## Verification

Exact-current local evidence:

```sh
bun run lint
bun run test
bun run test:deploy
bun run build
bash -n deploy.sh tests/deploy.test.sh scripts/light-watchdog.sh
git diff --check
```

All commands pass on exact-current `a7e56fe`: 24/24 unit tests and 9/9 mocked deployment safety tests. Build output is 0.69 kB HTML, 47.57 kB CSS (8.57 kB gzip), a 308.85 kB initial JavaScript chunk (99.44 kB gzip), and route chunks. Recharts is isolated in a 304.29 kB Expert-only chunk and is not downloaded in Basic mode.

Read-only exact-current local Chrome smoke covered every route in Basic and Expert mode at 390x844 and 1280x900:

- Each route had exactly one useful `h1`, zero horizontal overflow, and zero undersized visible interactive targets.
- Basic direct visits to Tune and Console showed the expert safety gate. Basic Control exposed Toolhead and Position; Expert added Bounds & Safety.
- Offline camera retry settled after the bounded retry sequence, issued zero additional requests during a five-second observation window, and resumed only after Try Again. Local camera resource failures were expected because port 8080 was intentionally absent.
- Basic Home made no Sparkline request. Expert Home loaded the isolated chart chunk on demand.
- No printer-affecting control was activated.
- Browser and preview processes were closed; port 4173 is no longer listening.

## Deployment and rollback

- `deploy.sh` contains no password or fixed-IP default. It prefers SSH keys, optionally accepts a silent prompt or `PRINTER_PASSWORD` through `sshpass -e`, validates host input, and uses `StrictHostKeyChecking=accept-new`.
- `--preflight` is read-only and refuses busy, paused, active virtual-SD, Klipper-not-ready, incomplete/unknown, low-space, or missing-tool states.
- Deployment runs locked dependency install, lint, all tests, and build before upload. It verifies archive size, SHA-256, staged file list, and a timestamped persistent backup before swapping fixed `/usr/data` slots.
- Every post-swap failure triggers automatic slot rollback and HTTP recovery verification. `--rollback` is idle-gated, reversible, and HTTP-verified.
- `/usr/data/fluidd.previous` and `/usr/data/regolith-backups` improve update recovery. Survival remains best-effort because firmware can erase `/usr/data`, replace routing, or change Moonraker.
- Moonraker contains `[update_manager fluidd]` with `channel: beta` and `path: /usr/data/fluidd`. Update status reported Fluidd `v1.36.4`, remote `v1.36.4`, `is_valid=false`. Fluidd, helper, or firmware updates may overwrite or invalidate Regolith; re-run preflight and deploy afterward.
- Mocked shell tests cover bad-host rejection, busy and unknown-state refusal without writes, read-only preflight, successful verified deploy, failed-HTTP automatic rollback/recovery, manual rollback, and insecure SSH/secret patterns.

Recovery commands; provide the password only at runtime or through the silent prompt:

```sh
./deploy.sh --preflight
./deploy.sh --rollback
curl --fail --show-error --connect-timeout 5 --max-time 12 http://forge.local/
```

If mDNS fails, resolve `forge.local`, verify that address against the stored ECDSA fingerprint above, then use `PRINTER_HOST=<verified-resolver-address> ./deploy.sh --preflight` or `--rollback`. Never hard-code an unverified address. Rollback swaps live and previous slots and verifies HTTP; failed verification restores the original slot automatically.

## Remaining issues

- The runtime printer password is absent from HEAD, tracked diff, and current deployment code, but remains in 9 historical commits. Rotate the printer password. Decide whether to coordinate a disruptive history scrub after all clones and deployments are accounted for; do not rewrite history ad hoc.
- Firmware/update survival is best-effort only. `/usr/data` persisted this deployment, but the Fluidd updater explicitly owns `/usr/data/fluidd`.
- Existing browser tabs can still request an old lazy chunk immediately after an atomic deployment. Add a one-time, user-visible update recovery path for chunk-load failures rather than leaving a blank route.
- The Expert chart chunk is 304.29 kB because Recharts remains heavy. Replace the two small temperature trends with a lightweight native SVG implementation.
- `vite.config.ts` still contains one printer-specific development proxy address. Move development connection settings to a validated local environment file and document automatic `forge.local` defaults.
- Installation is safe but terminal-led. Add a macOS-friendly guided installer/check command that discovers the printer, fingerprints it, runs read-only preflight first, and clearly explains rollback/update recovery.

## User-owned files

- `scripts/light-watchdog.py`
- `scripts/light-watchdog.sh`

Keep both byte-for-byte unchanged, untracked, and unstaged.

## Next steps

1. Rotate the exposed historical printer password; decide whether coordinated history rewriting is worth clone disruption.
2. Add chunk-load update recovery and replace Recharts with a tiny native SVG trend so Expert mode also stays light.
3. Replace the hard-coded development proxy with validated local configuration and a `forge.local` default.
4. Add a guided macOS installer/check flow around the existing read-only preflight, verified deployment, backup, and rollback commands.
