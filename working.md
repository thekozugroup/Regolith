# Regolith working handoff

## Goal

Make Regolith safe and approachable for a nontechnical Apple user while preserving expert Klipper control. Use calm Apple HIG-style hierarchy, solid industrial surfaces, and frosted blur only for navigation/status chrome. No Liquid Glass.

## Current status

- UI safety, accessibility, responsive hierarchy, and interaction polish are committed on main.
- Delivery hardening is complete locally: key-first authentication, fail-closed idle preflight, verified archive/staging/backup, atomic swap, automatic rollback, and manual rollback.
- No live printer, SSH, deployment, G-code, motion, heat, restart, or configuration action occurred in this delivery effect.
- Live K1 Max state and installed UI path remain unverified because the earlier read-only `forge.local` lookup did not resolve.

## Safety boundaries

- `src/lib/printerActions.ts` is the shared UI action boundary.
- Print start, repeat, pause, resume, cancel, emergency stop, Klipper/firmware restart, console commands, jog, home, and motor release use typed actions.
- Every action checks current connection/printer state. Confirmed actions check again after confirmation to close stale-state races.
- Duplicate action keys are locked until completion.
- Print setup failure blocks print start and reports the actual Moonraker error.
- Console remains available behind an expert-mode control. Known diagnostics are allowlisted; motion, heat, stop, restart, and config commands receive critical warnings; unknown macros receive caution warnings.
- Emergency stop remains available while busy because physical safety takes priority. It clearly warns that Klipper recovery is required.
- Tune-page macro execution still uses its existing confirmation UI and safety gate. Moving this legacy workflow fully into the shared runner is follow-up work.

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

## Verification

Exact-current local evidence:

```sh
bun install
bun run lint
bun run test
bun run build
```

All four commands pass. `bun run test` includes mocked deployment integration coverage. Live browser and printer validation belong to later guarded effects. Do not click printer-affecting controls during visual QA.

Read-only local Chrome inspection covered 390x844 and 1280x900:

- All seven routes had exactly one `h1`, zero horizontal overflow, and no undersized visible target after the Files input correction.
- Mobile More opened with focus on Close, Shift+Tab wrapped to Settings, Escape removed inert state, and focus returned to More.
- A mocked Timelapse row selected by keyboard and measured 364x52px.
- Tune pressure advance exposed `0.0400 seconds`; Theme inputs resolved explicit programmatic labels.
- No printer-affecting control was enabled or activated. Tune confirmation was not force-opened because bypassing its printer-state gate would violate safe-test boundaries; its shared primitive is covered by modal tests and the Mobile More browser path.

## Deployment and rollback

- `deploy.sh` contains no password or fixed-IP default. It prefers SSH keys, optionally accepts a silent prompt or `PRINTER_PASSWORD` through `sshpass -e`, validates host input, and uses `StrictHostKeyChecking=accept-new`.
- `--preflight` is read-only and refuses busy, paused, active virtual-SD, Klipper-not-ready, incomplete/unknown, low-space, or missing-tool states.
- Deployment runs locked dependency install, lint, all tests, and build before upload. It verifies archive size, SHA-256, staged file list, and a timestamped persistent backup before swapping fixed `/usr/data` slots.
- Every post-swap failure triggers automatic slot rollback and HTTP recovery verification. `--rollback` is idle-gated, reversible, and HTTP-verified.
- `/usr/data/fluidd.previous` and `/usr/data/regolith-backups` improve update recovery. Survival remains best-effort because firmware can erase `/usr/data`, replace routing, or change Moonraker.
- Mocked shell tests cover bad-host rejection, busy and unknown-state refusal without writes, read-only preflight, successful verified deploy, failed-HTTP automatic rollback/recovery, manual rollback, and insecure SSH/secret patterns.

## User-owned files

- `scripts/light-watchdog.py`
- `scripts/light-watchdog.sh`

Keep both byte-for-byte unchanged, untracked, and unstaged.

## Next steps

1. Move Tune macro dispatch into the shared typed runner without weakening expert workflows.
2. Perform live read-only `./deploy.sh --preflight`; independently verify K1 Max state, persistent paths, current UI, backup capacity, and nginx routing.
3. Deploy static assets only after idle state and rollback prerequisites are proven live, then inspect desktop and 390px UI without activating printer controls.
