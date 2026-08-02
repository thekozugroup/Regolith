# Regolith working handoff

## Goal

Make Regolith safe and approachable for a nontechnical Apple user while preserving expert Klipper control. Use calm Apple HIG-style hierarchy, solid industrial surfaces, and frosted blur only for navigation/status chrome. No Liquid Glass.

## Current status

- Exact-current safety, accessibility, responsive hierarchy, deployment hardening, and Tune action race fixes are committed and pushed on `main` at `d2c2e7b`.
- Exact-current static assets are deployed on the live K1 Max. Local and live hashes match for HTML, CSS, and JavaScript.
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

- Desktop navigation has visible labels. Mobile uses a four-target bottom bar plus an accessible More sheet.
- Mobile More, print confirmation, and Tune confirmation now share a modal primitive with initial focus, complete Tab/Shift+Tab trapping, Escape dismissal, background inerting, scroll lock, backdrop dismissal, and focus restoration. Busy print confirmation cannot dismiss mid-start.
- Every visible interactive target uses at least a 44x44px hit area, including jog distance presets, theme fields/swatches, brand controls, camera fullscreen, uploads, file filtering, and Console autoscroll.
- UI uses Apple platform typography; monospaced text is reserved for commands and measurements.
- Orange and custom-accent action surfaces choose an accessible light or dark foreground. Default orange action contrast measured 6.96:1 in Chrome.
- Every route exposes one useful visible `h1`; card titles are semantic `h2` headings with a quieter, sentence-case hierarchy.
- Theme fields and pressure advance expose explicit labels, current values, and units. Files and Timelapses announce loading/results and expose `aria-busy`.
- File and Timelapse rows are keyboard-operable buttons. Camera status no longer claims Live after a stream error. Motion honors `prefers-reduced-motion`.
- Frosted blur is confined to app navigation/status chrome.

## Live printer validation — 2026-08-02

- Target: Creality K1 Max (`# K1-MAX`, 300 x 300 x 300 mm in `printer.cfg`). Firmware `1.3.5.19`; board `CR4CU220812S11`; Moonraker `v0.10.0-19-g1ed102e` / API `1.5.0`; Klipper reported ready.
- Pre-deploy and post-deploy gates: `print_stats.state=standby`, empty filename/message, `idle_timeout.state=Idle`, `virtual_sdcard.is_active=false`, no file, and queue empty.
- Final temperatures: hotend `26.70 C`, bed `25.01 C`; both targets `0.0` and power `0.0`.
- No hardware actions occurred: no G-code, motion, homing, heating, extrusion, fan/light, print control, calibration, firmware update, service restart, or config write.
- `/usr/data` is ext4 and had 4,728,848 KiB free. nginx `1.17.7` listens on port 80 and serves `root /usr/data/fluidd` with SPA fallback.
- Read-only `./deploy.sh --preflight` passed. Fixed-slot manifest before and after preflight remained `3e78a239facffdd485b10a90bdb84254fdde46b84bb3562371d3c6be89cbd2b0`, proving zero preflight writes.
- Exact-current guarded deployment archive: 223,003 bytes, SHA-256 `6251a13dffbe8edcbd0b8910ba9b9791e2efee13fafd57bae775e0b51f61acdb`.
- Exact local/live HTTP hash matches:
  - `index.html`: `69b1df60b451a3cd5c2695b4f5c702bc18177993dff6955864d4602531aaf8d1`
  - `assets/index-CL6ijiBo.css`: `3f2113a8befd018c240416b5f7ad4eda63ba4e3d48b0d974b0966f0059cec638`
  - `assets/index-CDUZ8eNw.js`: `b3ae8b4b1576a07c6d3a41ed343c83a608e23c688d0138fb4aea63c740474817`
- Routes `/`, `/settings`, `/print`, `/control`, `/tune`, `/timelapses`, and `/console` returned HTTP 200. Printer, system, and server APIs returned HTTP 200; browser WebSocket handshakes upgraded with HTTP 101.
- Exact-current live browser smoke passed: desktop Home at 1440x1000 showed ready/standby telemetry; mobile Tune at 390x844 rendered all calibration sections. Both had zero overflow, current CSS/JavaScript returned 200, three API requests succeeded, and no failed network requests, console messages, or page exceptions occurred. No control was clicked.
- Rollback ready: `/usr/data/fluidd.previous/index.html` exists and matches the first verified Regolith slot (`2cbaa5978159696cd53a264d3a24b0d667c671e5f23050689f71b41fd3cfe92b`).
- Latest persistent verified backup: `/usr/data/regolith-backups/fluidd-before-20260802T155117Z.tgz`, 221,394 bytes, SHA-256 `67fcec3819381e43b53fa21309400502b0486a4ae33f8bfdb412355929807af8`, 6 entries. Two verified backups remain. `/usr/data/fluidd.next` and `/usr/data/regolith-deploy.tgz` are absent after cleanup.
- mDNS became intermittent after initial success. Fallback address came from the macOS resolver, not guessing. Its ECDSA host key exactly matched accepted `forge.local`: `SHA256:43wgMSNzgWwHJt/gd9dfgLRYAZGh4XhYfQTaw/OaT2k`; SSH used `HostKeyAlias=forge.local` for pinned checks.

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

All commands pass on exact-current `d2c2e7b`: 18/18 unit tests and 9/9 mocked deployment safety tests. Build output is 0.61 kB HTML, 45.48 kB CSS (8.32 kB gzip), and 714.33 kB JavaScript (215.72 kB gzip).

Read-only exact-current local Chrome smoke covered Home, Tune, and Settings at 390x844 and 1280x900:

- Each route had exactly one useful `h1`, zero horizontal overflow, and zero undersized visible interactive targets.
- Offline Tune exposed every Run, Apply, Apply & Save, and Refresh action as disabled. No printer-affecting control was activated.
- Four console resource errors were expected camera failures against the intentionally absent local port 8080; the UI retained its Stream Offline state.
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
- Production JavaScript remains a monolithic 714.33 kB chunk. Add route-level code splitting after a separate live parity pass.
- Dashboard, Control, Tune, and Settings remain dense for first-time Apple users. Move expert telemetry, acronyms, and uncommon calibration controls behind progressive disclosure without hiding safety state.
- Camera offline handling is clear, but the stream and snapshot probes create repeated expected connection errors. Add bounded exponential retry and one recovery action in a later verified UI iteration.

## User-owned files

- `scripts/light-watchdog.py`
- `scripts/light-watchdog.sh`

Keep both byte-for-byte unchanged, untracked, and unstaged.

## Next steps

1. Rotate the exposed historical printer password; decide whether coordinated history rewriting is worth clone disruption.
2. Add route-level code splitting, then re-run exact local/live asset, route, API, WebSocket, desktop, and 390px parity checks.
3. Simplify first-run hierarchy with Basic and Expert disclosure while keeping temperatures, readiness, active-job state, and emergency control visible.
4. Add bounded camera retry/backoff and test unplugged, delayed, and recovered camera states.
