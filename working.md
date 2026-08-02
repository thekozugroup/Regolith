# Regolith working handoff

## Goal

Make Regolith safe and approachable for a nontechnical Apple user while preserving expert Klipper control. Use calm Apple HIG-style hierarchy, solid industrial surfaces, and frosted blur only for navigation/status chrome. No Liquid Glass.

## Current status

- Exact-current Basic/Expert disclosure, native temperature trends, stale-update recovery, camera/network recovery, portable development configuration, guided macOS setup, safety, accessibility, and deployment hardening are committed and pushed on `main` at `20c7866`.
- Exact-current static assets are deployed on the live K1 Max. Local and live hashes match for HTML, CSS, core JavaScript, and the Dashboard route.
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
- Temperature trends now use a dependency-free native SVG sampler. It records only real finite readings, announces the recent range, and removes the 304.29 kB Recharts chunk.
- Route-load failures after an atomic software update show an Update Ready recovery view. One explicit reload fetches the current UI, does not change printer state, and cannot enter an automatic reload loop.
- Frosted blur is confined to app navigation/status chrome.

## Live printer validation — 2026-08-02, `20c7866`

- Target: Creality K1 Max (`# K1-MAX`, 300 x 300 x 300 mm in `printer.cfg`). Firmware `1.3.5.19`; board `CR4CU220812S11`; Moonraker `v0.10.0-19-g1ed102e` / API `1.5.0`; Klipper reported ready.
- Pre-deploy and post-deploy gates: `print_stats.state=standby`, empty filename/message, `idle_timeout.state=Idle`, `virtual_sdcard.is_active=false`, and no active file.
- Final temperatures: hotend `27.77 C`, bed `26.49 C`; both targets `0.0` and power `0.0`.
- No hardware actions occurred: no G-code, motion, homing, heating, extrusion, fan/light, print control, calibration, firmware update, service restart, or config write.
- `forge.local` SSH succeeded but the first HTTP gate failed closed when macOS mDNS timed out. A fresh resolver lookup returned `192.168.50.179`; its ECDSA host key matched accepted `forge.local` byte-for-byte before use.
- Read-only preflight through the fingerprint-matched resolver address passed with ready/standby/Idle/inactive state and changed no remote files.
- The new `Install Regolith.command --check` path discovered the ECDSA fingerprint, matched it against the saved known host, explained its read-only scope, and passed preflight without changing remote files.
- Exact-current guided deployment archive: 140,938 bytes, SHA-256 `e6bb9d3c9c6aebe03d9ecab4d9c883acc8f0df2be4cc9fdc6fd11e1409128552`.
- Exact local/live HTTP hash matches:
  - `index.html`: `90af61e8184540f66a2aa043e858b4c79488d07458d6ddfa7aac9ca0aa5ce57d`
  - `assets/index-DsNN90VI.css`: `af9636c0cb07c66ab91f8fcc81596ec3b67e25aaedc758d63e530c9b0d5c6fb4`
  - `assets/index-C8IIx8aG.js`: `855856d45722b47273147e801750cfcd60fae526458e8c1d464cc56ce1e73494`
  - `assets/Dashboard-DWjAP10K.js`: `a5c0e487f65901f915c6492052d34fefabd334ec1c6f10767c8610f929d607de`
- Routes `/`, `/settings`, `/print`, `/control`, `/tune`, `/timelapses`, and `/console` returned HTTP 200. Printer, system, and server APIs returned HTTP 200; browser WebSocket opened successfully.
- Live browser smoke passed: Basic Home at 1440x1000 and Expert Home at 390x844 showed ready/standby telemetry and a real Live camera feed. Expert native trends announced real temperature ranges and loaded no Sparkline/Recharts asset. All views had zero overflow and zero visible targets below 44px. There were zero request failures, console errors, or page exceptions. No control was clicked.
- Rollback ready: the previously verified UI remains in `/usr/data/fluidd.previous`.
- Latest persistent verified backup: `/usr/data/regolith-backups/fluidd-before-20260802T174223Z.tgz`, 229,067 bytes, SHA-256 `ae16998dd6a57c7e0568729c3017da48f018a65b2b8ac260d459492979b3da1c`, 22 entries. Deploy cleanup completed.
- Accepted ECDSA fingerprint remains `SHA256:43wgMSNzgWwHJt/gd9dfgLRYAZGh4XhYfQTaw/OaT2k`. Never use a resolver fallback without matching it first.

## Verification

Exact-current local evidence:

```sh
bun run lint
bun run test
bun run test:deploy
bun run build
bash -n deploy.sh tests/deploy.test.sh tests/setup.test.sh "Install Regolith.command" scripts/light-watchdog.sh
git diff --check
```

All commands pass on exact-current `20c7866`: frozen install, lint, 31/31 unit tests, 9/9 mocked deployment safety tests, guided-setup checks, build, shell syntax, and diff validation. Build output is 0.69 kB HTML, 47.55 kB CSS (8.57 kB gzip), a 283.29 kB initial JavaScript chunk (90.95 kB gzip), and route chunks. Recharts and its transitive runtime are removed.

Read-only exact-current local Chrome smoke covered every route in Basic and Expert mode at 390x844 and 1280x900:

- Each route had exactly one useful `h1`, zero horizontal overflow, and zero undersized visible interactive targets.
- Basic direct visits to Tune and Console showed the expert safety gate. Basic Control exposed Toolhead and Position; Expert added Bounds & Safety.
- Offline camera retry settled after the bounded retry sequence, issued zero additional requests during a five-second observation window, and resumed only after Try Again. Local camera resource failures were expected because port 8080 was intentionally absent.
- Expert Home rendered two accessible native SVG trends from real readings with no Sparkline or Recharts asset request.
- A forced 404 for the Control route chunk produced the Update Ready recovery view; its explicit Reload Regolith action recovered the route once the simulated failure was removed.
- No printer-affecting control was activated.
- Browser and preview processes were closed; port 4173 is no longer listening.

## Deployment and rollback

- `deploy.sh` contains no password or fixed-IP default. It prefers SSH keys, optionally accepts a silent prompt or `PRINTER_PASSWORD` through `sshpass -e`, validates host input, and uses `StrictHostKeyChecking=accept-new`.
- `Install Regolith.command` gives macOS users a Check / Install / Roll Back menu with read-only Check as the default. It discovers the ECDSA identity, refuses saved-key mismatches, requires interactive first trust, and never stores the password.
- Local development defaults to `forge.local`. A validated `VITE_REGOLITH_PRINTER_HOST` in ignored `.env.local` supports another trusted hostname or IPv4 address without editing source; protocols, ports, paths, shell syntax, and invalid IPv4 values fail before Vite starts.
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
- Guided setup still requires a source checkout, Bun, and `sshpass` when SSH keys are unavailable. A signed/notarized macOS installer or prebuilt release would remove Terminal and package-manager friction, but needs a release/signing pipeline.
- Persistent UI backups are verified but not yet retention-bounded. Add a conservative policy that always preserves multiple known-good archives while preventing long-term disk growth.
- Browser matrices and forced stale-chunk recovery are proven through exact-current automation sessions but are not yet checked into a repeatable Playwright E2E suite.

## User-owned files

- `scripts/light-watchdog.py`
- `scripts/light-watchdog.sh`

Keep both byte-for-byte unchanged, untracked, and unstaged.

## Next steps

1. Rotate the exposed historical printer password; decide whether coordinated history rewriting is worth clone disruption.
2. Add bounded verified-backup retention without weakening rollback or firmware-update recovery.
3. Check in repeatable Playwright Basic/Expert, mobile/desktop, offline-camera, and stale-chunk recovery tests.
4. Produce a prebuilt macOS-friendly release path; sign and notarize when credentials are available.
