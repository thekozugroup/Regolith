# Regolith working handoff

## Goal

Make Regolith safe and approachable for a nontechnical Apple user while preserving expert Klipper control. Use calm Apple HIG-style hierarchy, solid industrial surfaces, and frosted blur only for navigation/status chrome. No Liquid Glass.

## Current status

- Accessibility hardening and UI hierarchy polish are complete locally and ready for an atomic main-branch commit.
- Exact-current lint, 15 safety/accessibility tests, and production build pass. Build reports one non-blocking existing bundle-size warning (712 kB minified JS).
- No live printer, SSH, deployment, G-code, motion, heat, restart, or configuration action occurred in this implementation effect.
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

All four commands pass. Live browser and printer validation belong to later guarded effects. Do not click printer-affecting controls during visual QA.

Read-only local Chrome inspection covered 390x844 and 1280x900:

- All seven routes had exactly one `h1`, zero horizontal overflow, and no undersized visible target after the Files input correction.
- Mobile More opened with focus on Close, Shift+Tab wrapped to Settings, Escape removed inert state, and focus returned to More.
- A mocked Timelapse row selected by keyboard and measured 364x52px.
- Tune pressure advance exposed `0.0400 seconds`; Theme inputs resolved explicit programmatic labels.
- No printer-affecting control was enabled or activated. Tune confirmation was not force-opened because bypassing its printer-state gate would violate safe-test boundaries; its shared primitive is covered by modal tests and the Mobile More browser path.

## Deployment and rollback

- Current `deploy.sh` is not yet approved for live use. Baseline audit found embedded credential defaults, disabled host-key verification, and no automatic rollback after a failed static-asset swap.
- Do not deploy until the delivery-hardening effect removes those risks, proves printer-idle preflight, creates a verified backup, and arms automatic rollback.
- Update survival is not yet proven. Planned direction: keep recovery metadata and known-good static assets under verified persistent `/usr/data` paths, then document evidence-based restore steps.

## User-owned files

- `scripts/light-watchdog.py`
- `scripts/light-watchdog.sh`

Keep both byte-for-byte unchanged, untracked, and unstaged.

## Next steps

1. Move Tune macro dispatch into the shared typed runner without weakening expert workflows.
2. Harden installer/deploy/rollback/update survival before any live write. Remove the existing committed default password and unsafe host-key bypass.
3. Perform read-only printer preflight; deploy static assets only after idle and rollback proof.
