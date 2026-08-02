# Regolith working handoff

## Goal

Make Regolith safe and approachable for a nontechnical Apple user while preserving expert Klipper control. Use calm Apple HIG-style hierarchy, solid industrial surfaces, and frosted blur only for navigation/status chrome. No Liquid Glass.

## Current status

- UI safety and responsive-shell implementation is complete locally and ready for its atomic main-branch commit.
- Exact-current `bun install`, lint, 9 safety tests, and production build pass. Build reports one non-blocking existing bundle-size warning (708 kB minified JS).
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
- Shared buttons use at least 44px targets.
- UI uses Apple platform typography; monospaced text is reserved for commands and measurements.
- Print confirmation has dialog semantics, focus trapping, Escape handling, focus return, an accessible close control, live readiness status, and a physical-area acknowledgement.
- File rows are keyboard-operable buttons. Motion honors `prefers-reduced-motion`.
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

## Deployment and rollback

- Current `deploy.sh` is not yet approved for live use. Baseline audit found embedded credential defaults, disabled host-key verification, and no automatic rollback after a failed static-asset swap.
- Do not deploy until the delivery-hardening effect removes those risks, proves printer-idle preflight, creates a verified backup, and arms automatic rollback.
- Update survival is not yet proven. Planned direction: keep recovery metadata and known-good static assets under verified persistent `/usr/data` paths, then document evidence-based restore steps.

## User-owned files

- `scripts/light-watchdog.py`
- `scripts/light-watchdog.sh`

Keep both byte-for-byte unchanged, untracked, and unstaged.

## Next steps

1. Inspect responsive UI locally at desktop, tablet, and 390px without printer actions.
2. Move Tune macro dispatch into the shared typed runner without weakening expert workflows.
3. Harden installer/deploy/rollback/update survival before any live write. Remove the existing committed default password and unsafe host-key bypass.
4. Perform read-only printer preflight; deploy static assets only after idle and rollback proof.
