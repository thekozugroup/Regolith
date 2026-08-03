# Regolith working handoff

## Goal

Make Regolith safe and approachable for a nontechnical Apple user while preserving expert Klipper control. Use calm Apple HIG-style hierarchy, solid industrial surfaces, and frosted blur only for navigation/status chrome. No Liquid Glass.

## Current status

- **Exact-current Regolith through `68181d0` is deployed and verified on the K1 Max (2026-08-03 13:22:35 printer clock), and the print-start bug is proven fixed on real hardware.** A print was started from the deployed UI, klipper accepted it, and no `key69` error appeared anywhere. See "Live release and print-start proof" below.
- Regolith Instrument Cluster cosmetic redesign and responsive refinement are committed and pushed on `main` through `a74d2ac`; the print-start fix, mission-control dashboard, accent fix, responsive rework, and active-state e2e coverage land through `68181d0`. These exact static assets are now live.
- Home uses Mission → Camera → Thermals → Readiness on compact screens, full-width tablet composition through 1024px, and a balanced desktop camera/telemetry zone with the thermal/status rail. The compact PrinterCard metadata uses two wrapped rows, Settings has weighted groups, and Tune is organized as a calibration band plus pressure-advance and mesh surfaces.
- The approved `Skadis Ivar Halter_PETG_2h49m.gcode` print completed successfully under read-only watch at 100%. Virtual SD became inactive, heater targets and power reached zero, cooling was monotonic, snapshots stayed available, and no new Klipper errors appeared. Any future deployment still needs fresh identity, idle, zero-power, backup, and rollback proof.
- Camera stability, aligned card rhythm, bounded backup retention, printer-isolated browser QA, and neutral connection loading states are committed and pushed on `main` at `f2acff5`.
- Static assets from `68181d0` are deployed on the live K1 Max and include the print-start fix, mission-control dashboard, default-accent fix, content-driven responsive layout, Instrument Cluster redesign, camera reconnect fix, backup retention, neutral loading states, and browser harness.
- Delivery is fail-closed: key-first authentication, conclusive idle gates, verified archive/staging/backup, atomic swap, automatic rollback, and manual rollback.
- No G-code or hardware-affecting printer action occurred during preflight or deployment. The one authorized exception is the 2026-08-03 print-start proof recorded below, which the owner explicitly requested; it was cancelled within seconds and the machine was returned to a cold, clear state.

## Safety boundaries

- `src/lib/printerActions.ts` is the shared UI action boundary.
- Print start, repeat, pause, resume, cancel, emergency stop, Klipper/firmware restart, console commands, jog, home, and motor release use typed actions.
- Every action checks current connection/printer state. Confirmed actions check again after confirmation to close stale-state races.
- Duplicate action keys are locked until completion.
- Optional pre-print setup can never block print start. Steps whose klipper object is missing are skipped, and a rejected command is ignored. Only the live safety gates stop a print.
- Console remains available behind an expert-mode control. Known diagnostics are allowlisted; motion, heat, stop, restart, and config commands receive critical warnings; unknown macros receive caution warnings.
- Emergency stop remains available while busy because physical safety takes priority. It clearly warns that Klipper recovery is required.
- Every Tune macro and pressure-advance write now uses the shared runner. Existing accessible confirmations remain; live state is checked after confirmation, Tune actions share a duplicate lock, and failures appear in the UI.
- Calibration plus follow-up commands are submitted as one ordered script. Pressure Advance Save explicitly warns that it writes configuration and restarts Klipper.

## UI and accessibility

- Design direction: **Regolith Instrument Cluster** — disciplined 1980s digital automotive instrumentation governed by Apple HIG clarity. Rectangular segmented readouts, labeled lamps, rules, opaque bezels, tabular values, and a calm status spine carry the visual language. Amber is active/selected, cyan is system information, and every semantic color is paired with text or shape.
- Home is a mission-control cockpit (updated 2026-08-03, `7dd3c0d`): mission status lives in a full-bleed **`MissionBar` pinned to the bottom of the viewport on every route** (print state lamp + word, file, progress %, remaining, link health, plus the full-width progress strip that replaced the old app-bar sliver). On compact chrome the bar stacks directly above the bottom nav — flush, never overlapping — with shared `--mission-h` / `--bottomnav-h` tokens driving bar height, sidebar edge, and combined content clearance. The grid is the content-driven container-query `.dashboard-grid` (1 lane, 2 lanes at 720px, 3 at 1560px), not the former 5/7/12-column desktop split. Mobile follows task order: job → thermals → camera → vitals → readiness, with the mission bar always in view. Thermal instruments render dials at ≥148px and fall back to the rectangular bar renderer below that via CSS container queries.
  - Superseded: before `e538aab` this was a top status rail sticky under the app bar. Any reference to a top rail or a 5/7-column desktop grid describes a build older than `e538aab`, not a regression.
- Shared panels are restrained `InstrumentPanel` surfaces with ruled headers, 6px panel geometry, 44px targets, visible focus, safe-area navigation, and reduced-motion-safe 150ms state changes. Frost remains limited to the app bar and navigation chrome.
- Files and Timelapses use a 5/7 desktop master-detail composition and amber selection rails rather than filled selected cards. Print History uses ruled rows. Control uses a precise control matrix and recessed coordinate plane. Console uses an opaque ruled log surface. Settings uses grouped zones and preserves Basic/Expert behavior.
- No decorative gradients, shimmer, continuous pulse, Liquid Glass, or color-only states remain in the redesigned surfaces. The former blanket bans on "glow" and "fake semicircular thermal gauges" are narrowly amended below (2026-08-03); every other ban stands.
- **Amendment 2026-08-03 — mission-control dials and bounded glow (owner-directed).** The owner asked for a mission-control homepage with temperature dials in an "80s digital dashboard mixed with Apple HIG" style. Two narrow amendments, with binding conditions:
  - Dials are permitted only as honest instruments: a real labeled scale (0° and max endpoints), tick marks at fixed intervals, a visible target index, and a numeric readout that is the dominant element. A decorative arc around a number remains banned. The primary readout never takes the state ramp color; the arc, lamp, and status word carry state.
  - Below the 148px hard floor a dial must fall back to the existing rectangular bar renderer, via CSS container queries only — no JS resize listeners. The e2e suite asserts every rendered dial is ≥148px or absent, and that dials contain zero SVG `<text>` (all dial text is HTML so the 11px gate applies).
  - Glow is permitted only as a static `drop-shadow` of ≤6px on SVG value arcs and active status lamps. Never on text, never animated, never a pulse.
  - Everything else stands: no gradients, no shimmer, no pulse, no Liquid Glass, no color-only state encoding.
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
- Camera status starts at Connecting, backs off only after a real image error, settles Offline without continued network churn, and exposes explicit Try Again and Refresh controls. The removed four-second synthetic watchdog no longer mistakes a healthy MJPEG stream for a stall. Printing controls remain independent.
- Moonraker treats CONNECTING and OPEN sockets as active, preventing duplicate connections from concurrent hooks. Reconnect delay grows from 2 seconds to a 30-second cap, stale callbacks are ignored, and pending actions reject when the connection closes.
- Thermal gauges scale to their grid cells, use compact three-column status readouts, and expose full temperature/target descriptions to assistive technology.
- Temperature trends now use a dependency-free native SVG sampler. It records only real finite readings, announces the recent range, and removes the 304.29 kB Recharts chunk.
- Route-load failures after an atomic software update show an Update Ready recovery view. One explicit reload fetches the current UI, does not change printer state, and cannot enter an automatic reload loop.
- Frosted blur is confined to app navigation/status chrome.
- All primary page grids now use one 12 px card rhythm, 12/16 px responsive page gutters, and consistent 12 px grouped-surface corners. Printer, content, and telemetry cards share the same geometry.
- Unknown startup telemetry is neutral: the UI says Connecting, omits a false Klipper error, and shows unavailable temperatures as an em dash instead of `0.0 C`. The state becomes ready/real-valued after the first subscription response.

## Live printer validation — 2026-08-02, `93fcf9b`

- Latest release attempt stopped before authentication or writes: `forge.local` freshly resolved to `192.168.50.179`, its ECDSA fingerprint exactly matched accepted `SHA256:43wgMSNzgWwHJt/gd9dfgLRYAZGh4XhYfQTaw/OaT2k`, then a read-only Moonraker query found the active `Ivar_Skadis_Hook_PETG_34m53s.gcode` print described above. The guarded installer, backup inspection, static swap, live browser checks, and camera hold were not run.
- Target: Creality K1 Max (`# K1-MAX`, 300 x 300 x 300 mm in `printer.cfg`). Firmware `1.3.5.19`; board `CR4CU220812S11`; Moonraker `v0.10.0-19-g1ed102e` / API `1.5.0`; Klipper reported ready.
- Pre-deploy gate: `print_stats.state=standby`, empty filename/message, `idle_timeout.state=Ready`, `virtual_sdcard.is_active=false`, and no active file.
- No hardware actions occurred: no G-code, motion, homing, heating, extrusion, fan/light, print control, calibration, firmware update, service restart, or config write.
- `forge.local` SSH succeeded but the first HTTP gate failed closed when macOS mDNS timed out. A fresh resolver lookup returned `192.168.50.179`; its ECDSA host key matched accepted `forge.local` byte-for-byte before use.
- Read-only preflight through the fingerprint-matched resolver address passed with ready/standby/Ready/inactive state and changed no remote files.
- The new `Install Regolith.command --check` path discovered the ECDSA fingerprint, matched it against the saved known host, explained its read-only scope, and passed preflight without changing remote files.
- Guided deployment archive: 141,305 bytes, SHA-256 `0bbd55e25e5ba16fec6015196615aef1e8de577bf20174fe09c5126be9130c25`.
- Routes `/`, `/settings`, `/print`, `/control`, `/tune`, `/timelapses`, and `/console` returned HTTP 200. Printer, system, and server APIs returned HTTP 200; browser WebSocket opened successfully.
- Live browser smoke passed every Basic and Expert route at 1440x1000 and 390x844. Each had one page title, zero overflow, and zero visible targets below 44px. The real camera remained Live with no new request during a 15-second hold. There were zero write requests, bad responses, request failures, console errors, or page exceptions. No control was clicked.
- Rollback ready: the previously verified UI remains in `/usr/data/fluidd.previous`.
- Latest persistent verified backup: `/usr/data/regolith-backups/fluidd-before-20260802T180532Z.tgz`, 140,357 bytes, SHA-256 `62fca6533c1195b5f48062a09fe639a3d7cd62256ea4914013f159fbd9ded0c2`, 21 entries. Five archives remain; this deployment pruned none.
- A later read-only preflight for `f2acff5` stopped before writes when `idle_timeout.state=Printing`. A print then failed at 0.15% with `Unknown gcode_macro variable 'user_flag'`. Root cause was a stale KAMP `Start_Print.cfg` symlink pointing at the Ender-3 V3 macro instead of the K1 macro. The printer-side repair was backed up under `/usr/data/printer_data/config/.regolith-repair-backups/20260802T193155Z`, applied as an atomic reversible symlink retarget, and verified before retrying.
- `Skadis Ivar Halter_PETG_2h49m.gcode` then completed at 100% with the full `11,348,737/11,348,737` byte count. A subsequent 12-minute read-only watch found virtual SD inactive, Klipper ready, Idle, zero heater targets/power, no new errors, and a stable camera stream. Fresh gates are still mandatory before deployment.
- Accepted ECDSA fingerprint remains `SHA256:43wgMSNzgWwHJt/gd9dfgLRYAZGh4XhYfQTaw/OaT2k`. Never use a resolver fallback without matching it first.

## Live exact-current release — 2026-08-02, `5826002`

- `forge.local` freshly resolved to `192.168.50.179`; a new ECDSA scan exactly matched accepted fingerprint `SHA256:43wgMSNzgWwHJt/gd9dfgLRYAZGh4XhYfQTaw/OaT2k` before authentication.
- The earlier attempt stopped before authentication or writes when the new print was active. The successful retry freshly proved `Ivar_Skadis_Hook_PETG_34m53s.gcode` complete at `2,446,934/2,446,934` bytes, virtual SD inactive, idle `Ready`, Klipper ready, empty message, and both heater targets/power zero.
- Exact-current syntax, tracked-diff, lint, 31 unit assertions, 11 deployment safety tests, guided setup checks, production build, and 10 strict mocked Playwright tests passed before deployment. Guided `--check` then passed read-only through the verified resolver address.
- Pre-deploy storage was 28% used with 4,645,936 KiB available. Live and previous slots each had a valid index, and all five retained backup candidates were nonempty, tar-readable, traversal-clean, and contained `fluidd/index.html`.
- Deployment archive was 141,583 bytes, SHA-256 `87ff688503ae83bb32f72ed5b02e28a00077d69b006529ade80d7a054359e02a`. Remote size/hash and staged file list matched exactly before swap.
- New verified backup: `/usr/data/regolith-backups/fluidd-before-20260803T010558Z.tgz`, 140,191 bytes, SHA-256 `7119232ab4798475fc7f2f5d0c1fc0a970ba24285a5c530634fe18b140e2cf5a`, 21 entries. Retention kept five verified archives and pruned one oldest archive only after the new backup passed. Post-deploy inspection revalidated all five.
- Atomic static-asset swap and required-asset HTTP verification passed. Rollback was not needed. `/usr/data/fluidd.previous/index.html` retains pre-deploy SHA-256 `3fa526078f52bf73bc9289590a609e9d67c55f3c9664d2bedf8b6561c45c0da4` and remains ready for guarded rollback.
- Exact local/live SHA-256 matched: HTML `fbfa8d9c7160f1377c9d74ca36ac3a129cda26be4197c903b7624f993f529a7d`; core JS `16e06eeb8db7ed0bc6a9c00d0f231347f602df0c6f35c9e2d8b67b064d5458a4`; CSS `eb71778858384b04b9624cfd2f3f53521f819c382af605266cc772dfba9ab19d`; Dashboard JS `6b3640d7590c94d13daa397da7d47b81c59c0243df8e8a22422b2d4a8d2104cb`.
- Read-only live browser QA covered all seven routes in Basic and Expert at 1440x1000 and 390x844: 28/28 states had one `h1`, zero overflow, zero targets under 44px, zero out-of-bounds panels, and zero clipped text. Mobile and desktop captures were visually reviewed for hierarchy and card alignment.
- Camera remained `Live` through a 32.122-second hold with one stream request, no retry transition, no request failure, and no page error. Browser audit recorded 60 read-only subscription RPCs, zero WebSocket writes, zero HTTP writes, zero request failures, and zero page exceptions.
- The completed G-code references a missing `Ivar_Skadis_Hook_PETG_34m53s-300x300.png` thumbnail. Four repeated read-only HTTP 404s produced resource-console errors; the UI rendered its intentional placeholder. This is printer-file metadata, not a static deployment mismatch, so rollback was not triggered.
- Final read-only state remained complete/Ready/inactive at `2,446,934/2,446,934`, with hotend `39.23 C` and bed `41.24 C`, both targets/power zero. No G-code, motion, homing, heating, extrusion, calibration, print control, firmware/service restart, or printer configuration change occurred.

## Live release and print-start proof — 2026-08-03, `68181d0`

Deployed with the repo's own `deploy.sh` (no hand-rolled copy) at printer clock 2026-08-03 13:22:35 EST, against `PRINTER_HOST=192.168.50.179`. `forge.local` does not resolve through this Mac's HTTP client, so the verified resolver address was used.

- Pre-deploy gate, re-confirmed immediately before the swap: `webhooks=ready`, `print_stats=complete`, `idle_timeout=Idle`, `virtual_sdcard.is_active=false`, hotend `28.29 C`/0, bed `26.17 C`/0, plate visually clear on camera. `--preflight` exited 0 and changed no remote files.
- The first deploy attempt failed closed at "Create persistent known-good backup" when dropbear refused a mid-run SSH auth (the printer has 209 MB RAM, ~67 MB free). **Live assets were never touched**: `/usr/data/fluidd/index.html` still hashed `fbfa8d9c…`, the staging slot and upload archive were both cleaned up. The retry succeeded end to end.
- Deployment archive 145,032 bytes, SHA-256 `cdf00b0a4fde24a006cb34536f51bb7b6823f235212df4c60b3a4d33b8f26101`. Remote size/hash and staged file list matched before swap.
- New verified backup `/usr/data/regolith-backups/fluidd-before-20260803T182235Z.tgz`, 139,747 bytes, SHA-256 `c49f75adf21cee318f6719331666a2872d664f8f0a903bd79e383edcbbf756c0`, 21 entries; retention kept five and pruned one oldest only after the new archive verified.
- Atomic swap and required-asset HTTP verification passed; automatic rollback was not triggered. Live `index.html` is now `7abea8ff22966f6440a3d9e3446b838890dd41c517e7a8b5089a3f281cf31919` (was `fbfa8d9c7160f1377c9d74ca36ac3a129cda26be4197c903b7624f993f529a7d`). Live bundles are `index-BDcwHCix.js` / `index-t7XHCBCK.css` / `Dashboard-DOP69ueL.js`.
- **Rollback is armed:** `/usr/data/fluidd.previous` holds the exact prior build (`index.html` = `fbfa8d9c…`, `index-DMN7bzFR.js`, `index-xuuYb8Er.css`, `Dashboard-JWPuMzEa.js`).

Live UI verification, headless Chromium against the deployed build on the real printer (9/10 checks; the one failure is a printer-file data condition, not a code defect):

- StatusRail present, exactly two visible thermal dials, no white screen, no uncaught page errors.
- **Default accent verified on the device**: in a genuinely fresh profile (`localStorage forge.theme.accent` = `null`), computed `--color-accent` is `#f7a224`. This is the owner-reported accent bug, confirmed fixed on real hardware rather than only in mocks. *(Accurate as of `68181d0`. The accent was later snapped to Tailwind v4 amber-400 `#ffb900` in `9ac7ccf`; see the `7dd3c0d` release record below for the current on-device value.)*
- Zero horizontal overflow at 1280x800 and at 800x480 (the K1's own panel size). Both dials render 200x172, above the 148px floor.
- The only console error is a read-only HTTP 404 for `.thumbs/Filament_Swatch_PETG_19m37s-300x300.png`, the same missing-thumbnail metadata condition already tracked under Remaining issues. The UI renders its intentional placeholder.
- macOS local-network privacy blocks Playwright's Chromium from reaching LAN addresses directly, so the browser reached the printer through a loopback reverse proxy. Every byte still came from the printer's own nginx, including the Moonraker WebSocket; nothing on the printer was modified to enable this.

**Print-start proof — the owner's top bug, driven through the deployed UI, not the API:**

- File chosen: `Filament_Swatch_PLA-CF_18m36s.gcode`, the smallest of the 13 gcode files on the printer (1,291,965 bytes) and among the shortest at 18m36s.
- User path exercised: nav **Files** → select the file row → page **Start print** → confirmation dialog "Ready to print?" → acknowledgement checkbox → dialog **Start print**.
- **No `Print setup failed` banner, no `key69`, no "is not valid for MACRO"** — in the rendered UI, in the browser console, or in the 2,339 new `klippy.log` lines. A targeted scan for `key69|not valid for MACRO|SET_GCODE_VARIABLE|PRINT_START` over those new lines returned **zero hits**.
- Klipper accepted the job: `print_stats.state=printing` with `virtual_sdcard.is_active=true` within ~3 s of the click. Verbatim `klippy.log`:

```
13:29:21,794 [virtual_sdcard:work_handler:560] work_handler start print, filename:/usr/data/printer_data/gcodes/Filament_Swatch_PLA-CF_18m36s.gcode
13:29:21,817 [virtual_sdcard:work_handler:667] Starting SD card print (position 0)
13:29:22,757 [verify_heater:check_event:63] Heater extruder approaching new target of 130.000
13:29:22,759 [verify_heater:check_event:63] Heater heater_bed approaching new target of 45.000
13:30:29,836 [verify_heater:check_event:63] Heater extruder approaching new target of 170.000
13:30:56,874 [verify_heater:check_event:63] Heater extruder approaching new target of 200.000
13:35:06,327 [verify_heater:check_event:63] Heater extruder approaching new target of 220.000
13:36:12,469 [virtual_sdcard:work_handler:922] Exiting SD card print (position 9382)
13:36:12,617 [gcode:respond_info:301] action:cancel
```

- The run was cancelled deliberately at position 9382 of 1,291,965 bytes (~0.7%). It completed `START_PRINT` preheat, G28 homing, and the bed-probe self-tests (all five logged `Pass!!`); no part was made and nothing was extruded onto the plate.
- Peak temperatures reached: hotend **222.5 C**, bed **46.1 C**. `M104 S0` and `M140 S0` were then sent explicitly and both returned `ok`.
- Final resting state: `print_stats=cancelled`, `virtual_sdcard.is_active=false`, `idle_timeout=Ready`, both heater targets **0**, cooling monotonically (hotend 95.8 C and falling, bed 40.3 C and falling at last reading), Klipper `ready`. A camera snapshot confirms a clean plate and a parked toolhead.
- The only error-shaped lines in the new log are the K1's routine probe self-tests, each explicitly `Pass!!`.
- Printer configuration was not modified; klipper and moonraker were not restarted; the owner's `scripts/` watchdog and its cron were not touched.

Rollback command for this release:

```sh
PRINTER_HOST=192.168.50.179 PRINTER_PASSWORD=$PRINTER_PASSWORD ./deploy.sh --rollback
```

## Verification

Exact-current local evidence:

```sh
bun run lint
bun run test
bun run test:e2e
bun run test:deploy
bun run build
bash -n deploy.sh tests/deploy.test.sh tests/setup.test.sh "Install Regolith.command" scripts/light-watchdog.sh
git diff --check
```

All commands pass on exact-current runtime code: frozen install, lint, 31/31 unit tests, 11/11 mocked deployment safety tests, guided-setup checks, 10/10 printer-isolated Playwright tests, build, shell syntax, and diff validation. Build output is 0.69 kB HTML, 48.54 kB CSS (9.31 kB gzip), a 283.01 kB initial JavaScript chunk (90.80 kB gzip), and route chunks. Recharts and its transitive runtime are removed.

Instrument Cluster evidence, local only:

- `bun run lint`, `bun run build`, `bun run test`, `bun run test:deploy`, `bun run test:setup`, and `bun run test:e2e` pass on the cosmetic batch. The full browser suite has 10 passing tests.
- `e2e/instrument-cluster.spec.ts` registers HTTP and WebSocket interception before navigation. It permits static localhost assets, only a mocked `printer.objects.subscribe` RPC, and a mocked camera image; it aborts and records all other external requests and all non-GET/HEAD writes. It proves zero escaped requests and zero writes for Basic 320px, Expert 1280px/reduced-motion, and offline-camera states.
- Exact-current local captures in ignored `test-results/` cover all seven routes in Basic/Expert at 320, 390, 768, 1024, and 1280px. The responsive audit produces 70 canonical viewport top-state captures: it resets to `scrollY=0`, waits two animation frames, checks top-state geometry, and captures before any final-control scrolling. This preserves fixed chrome in its actual runtime position. Full-page expansion is intentionally not used as fixed-navigation evidence; a separate post-capture step checks mobile final-control reachability above the fixed navigation. It also checks horizontal bounds, visible text right-edge clipping, and 44px targets. Existing strict-mock coverage also exercises offline camera recovery, neutral telemetry, and stale-chunk recovery.
- The strict local typography gate scans every visible direct text node and form control across those 70 route/mode/viewport states, excludes SVG geometry, and reports the tag, class, text, and computed size for any failure. It found 302 visible text occurrences below 11px across 12 of 14 route/view states before this cosmetic correction; exact-current local result is 0 below 11px. Live deployment verification is complete as of the `68181d0` release recorded above.
- Forbidden production safety and transport files were SHA-256 baselined before UI edits and remain unchanged. No printer, Moonraker, camera-device, forge.local, external network, deployment, service, or remote-file interaction occurred during this cosmetic batch.

Read-only exact-current local Chrome smoke covered every route in Basic and Expert mode at 390x844 and 1280x900:

- Each route had exactly one useful `h1`, zero horizontal overflow, and zero undersized visible interactive targets.
- Basic direct visits to Tune and Console showed the expert safety gate. Basic Control exposed Toolhead and Position; Expert added Bounds & Safety.
- Offline camera retry settled after the bounded retry sequence, issued zero additional requests during a five-second observation window, and resumed only after Try Again. Local camera resource failures were expected because port 8080 was intentionally absent.
- A healthy mocked camera stayed Live for 6.5 seconds with exactly one request; manual Refresh issued exactly one replacement request. Delayed telemetry renders neutral connecting/unavailable states until the idle fixture arrives.
- Expert Home rendered two accessible native SVG trends from real readings with no Sparkline or Recharts asset request.
- A forced 404 for the Control route chunk produced the Update Ready recovery view; its explicit Reload Regolith action recovered the route once the simulated failure was removed.
- No printer-affecting control was activated.
- Browser and preview processes were closed; port 4173 is no longer listening.

## Deployment and rollback

- `deploy.sh` contains no password or fixed-IP default. It prefers SSH keys, optionally accepts a silent prompt or `PRINTER_PASSWORD` through `sshpass -e`, validates host input, and uses `StrictHostKeyChecking=accept-new`.
- `Install Regolith.command` gives macOS users a Check / Install / Roll Back menu with read-only Check as the default. It discovers the ECDSA identity, refuses saved-key mismatches, requires interactive first trust, and never stores the password.
- Local development defaults to `forge.local`. A validated `VITE_REGOLITH_PRINTER_HOST` in ignored `.env.local` supports another trusted hostname or IPv4 address without editing source; protocols, ports, paths, shell syntax, and invalid IPv4 values fail before Vite starts.
- `--preflight` is read-only and refuses busy, paused, active virtual-SD, Klipper-not-ready, incomplete/unknown, low-space, or missing-tool states.
- Deployment runs locked dependency install, lint, hardware-independent tests, and build before upload. It verifies archive size, SHA-256, staged file list, and a timestamped persistent backup before swapping fixed `/usr/data` slots.
- Backup retention preserves the newest five archives. It verifies the new archive and every candidate, proves the new archive is protected, then removes only older timestamped archives. Any malformed archive blocks before the live swap and before pruning.
- Every post-swap failure triggers automatic slot rollback and HTTP recovery verification. `--rollback` is idle-gated, reversible, and HTTP-verified.
- `/usr/data/fluidd.previous` and `/usr/data/regolith-backups` improve update recovery. Survival remains best-effort because firmware can erase `/usr/data`, replace routing, or change Moonraker.
- Moonraker contains `[update_manager fluidd]` with `channel: beta` and `path: /usr/data/fluidd`. Update status reported Fluidd `v1.36.4`, remote `v1.36.4`, `is_valid=false`. Fluidd, helper, or firmware updates may overwrite or invalidate Regolith; re-run preflight and deploy afterward.
- Mocked shell tests cover bad-host rejection, busy, failed-print, and unknown-state refusal without writes, read-only preflight, verified retention, malformed-backup refusal before swap, failed-HTTP automatic rollback/recovery, manual rollback, and insecure SSH/secret patterns.

Recovery commands; provide the password only at runtime or through the silent prompt:

```sh
PRINTER_HOST=192.168.50.179 ./deploy.sh --preflight
PRINTER_HOST=192.168.50.179 ./deploy.sh --rollback
curl --fail --show-error --connect-timeout 5 --max-time 12 http://192.168.50.179/
```

If mDNS fails, resolve `forge.local`, verify that address against the stored ECDSA fingerprint above, then use `PRINTER_HOST=<verified-resolver-address> ./deploy.sh --preflight` or `--rollback`. Never hard-code an unverified address. Rollback swaps live and previous slots and verifies HTTP; failed verification restores the original slot automatically.

## Resolved: print start blocked by `PRINT_START`/`use_kamp` setup

The owner's top bug — no print would start from Regolith — is fixed in code, deployed in `68181d0`, and **proven on the live K1 Max on 2026-08-03**: a print started from the deployed UI, klipper accepted it, and no `key69` appeared in the UI, the console, or `klippy.log`. Full evidence in "Live release and print-start proof" above.

Root cause, verified read-only on `forge.local`. Before every print Regolith sent
`SET_GCODE_VARIABLE MACRO=PRINT_START VARIABLE=use_kamp VALUE=0|1`. Two independent errors:

1. There is no `PRINT_START` macro on this K1 Max. The print-start macro is `START_PRINT` (`Helper-Script/KAMP/Start_Print.cfg:81`); the stock `START_PRINT` in `gcode_macro.cfg:382` is commented out. `SET_GCODE_VARIABLE` is a mux command keyed on `MACRO`, so klipper rejected the unregistered key with `key69` (`klippy/gcode.py:401`), logged in `klippy.log` and as a Moonraker 400 on `printer.gcode.script`.
2. `use_kamp` does not exist anywhere in the config. `START_PRINT` declares only `variable_prepare: 0`, so renaming the macro alone would still have failed. KAMP here is driven by output pins: `ADAPTIVE_BED_MESH`, `FULL_BED_MESH`, `ADAPTIVE_PURGE_LINE`.

The setup step was fatal, so a failure aborted the print before `printer.print.start` was ever called. That handling was the real defect; the wrong macro name was only what triggered it.

Fix (`src/lib/printerActions.ts`, `src/lib/moonraker.ts`):

- The KAMP toggle is user-facing (`PrintDialog`), so it was rewired to the real mechanism: `SET_PIN PIN=ADAPTIVE_BED_MESH VALUE=0|1`.
- `applyPrintSetup` checks `printer.objects.list` first and skips any step whose klipper object is absent, so a printer without KAMP silently gets no command.
- `applyPrintSetup` cannot throw. A missing object, an unreadable object list, or a rejected command leaves the print unaffected. `PrinterActionError`'s `setup-failed` code is gone — optional setup has no way to fail a print any more. This is the general guard for the whole bug class, not just KAMP.
- The live-state re-gate between setup and `startPrint` is unchanged; that is a safety check, not a setup step.

Regression coverage in `tests/printerActions.test.ts` fails if anything ever sends `MACRO=PRINT_START`, `SET_GCODE_VARIABLE`, or `use_kamp` during print setup.

## Live release — 2026-08-03, `7dd3c0d` (cockpit, amber-400 palette, oklab glow, active-print defects)

Deployed sha `7dd3c0de03ef19336d9ad0fbd9d557e426393561` (branch `main`, even with `origin/main`).
Printer clock at deploy: **Mon 2026-08-03 15:47:54 EST**; on-device verification 15:52 EST.
Live `index.html` sha256 moved `7abea8ff2296…1919` → `de1175ff35e8…de59`.

Rollback (armed and verified — `/usr/data/fluidd.previous/index.html` is exactly the pre-deploy `7abea8ff…`):

```
PRINTER_HOST=192.168.50.179 ./deploy.sh --rollback
```

Persistent backup `/usr/data/regolith-backups/fluidd-before-20260803T204754Z.tgz` (143133 bytes, sha256 `74dd0a29e92e…f3e2`, 21 files, 5 retained, 1 pruned).

What shipped:

- **Bottom `MissionBar` cockpit** (`e538aab`) — mission status pinned bottom on every route, density pass, more vitals in basic mode.
- **Tailwind v4 amber-400 palette + oklab glow fix** (`89c1e43` and 5 earlier atomic commits) — the owner's *green dial glowing amber* bug. Every `color-mix` with a `transparent` operand moved from polar `oklch` to rectangular `oklab`, so a source hue can no longer be dragged toward 0° by the powerless-hue rule.
- **Five active-print read-out defects** (`7dd3c0d`) — phantom progress on a stopped job, wrong "Remaining" derived from Klipper's monotonic clock, discarded current-layer-only readings, unsurfaced `print_stats.message`, and forced-colors glow contract pinned by tests.

Independent pre-deploy verification (read-only, all re-run rather than trusted): `bun run lint`, `bun run test` (49 pass), `bun run test:e2e` (91 pass), `bun run build` — all exit 0. `git diff 64e943d -- src/lib/printerActions.ts src/lib/moonraker.ts` empty, so the hardware-proven print fix has not drifted; `git diff 6d11e3e -- deploy.sh scripts/` empty. `PRINT_START`, `SET_GCODE_VARIABLE`, `use_kamp` absent from executable `src/`; `ADAPTIVE_BED_MESH` present.

Measured, not read from source (fresh profile, mocked scenarios):

- Computed `--color-accent` = `rgb(255,185,0)` = `#ffb900`.
- **Glow halo hue proven at the pixel level** by differencing a filter-on against a filter-off screenshot, which isolates the glow's own contribution from the blue-tinted panel. At-temperature: arc pixel `rgb(5,223,114)`, halo delta `(-2,+40,+17)` — decisively **G > R, the halo is green**. Heating arc `rgb(255,185,0)` halo delta `(+41,+28,-5)`; cooling arc `rgb(255,100,103)` halo delta `(+44,+14,+14)`; each halo matches its own arc. Computed filter is `oklab(… / 0.45)` in every state, never `oklch`.
- `--color-gauge-track` relative luminance 0.0013 — an empty gauge still reads empty; it was not brightened to a 400 shade.
- Floors at 320, 800x480, 1024, 1100, 1280, 2560: zero horizontal overflow, 2 dials at every width (151–312px, all ≥148), smallest font 11px, smallest hit target 44px, mission bar `position: fixed` and full-bleed at every width with content clearing its top edge. At 320 and 800x480 the bar's bottom edge equals the bottom nav's top edge exactly — flush, zero overlap.

On-device verification against the deployed build (headless Chromium via an SSH loopback tunnel, since macOS local-network privacy still blocks Chromium from LAN addresses; every byte came from the printer's own nginx and nothing on the printer was modified):

- 1280x800 and 800x480: dashboard renders, exactly 2 dials (211px / 162px), one `h1`, no white screen, zero horizontal overflow, **zero page errors and zero failed requests**, live camera streaming.
- Fresh-profile computed `--color-accent` on the device = `rgb(255,185,0)` = `#ffb900`.
- Dial halo pixel-sampled on the device matches the arc hue at both sizes (idle/cold arc is the cool desaturated state; halo never renders warmer than its arc).
- The printer was genuinely idle before deploy (`webhooks: ready`, `print_stats: cancelled`, `idle_timeout: Idle`, `virtual_sdcard.is_active: false`, nozzle 25.6/0, bed 23.7/0, toolhead position identical across two samples 10s apart). **No print was started.**
- Real-hardware proof of the read-out fixes: the lingering `cancelled` job now reports "STOPPED AT 0.0%", an honest `—` for Remaining, and offers "Print again" — previously it rendered phantom live progress with no affordance.
- Only console error is the read-only HTTP 404 for `.thumbs/Filament_Swatch_PLA-CF_18m36s-300x300.png`, the same missing-thumbnail data condition already tracked under Remaining issues. The UI renders its placeholder.

Known-minor items accepted at this release (none block deployment; all confirmed real but downgraded to minor during refutation):

- `public/favicon.svg` still strokes the legacy orange `#f97316`; the shipped UI accent is unaffected.
- `.status-lamp` paints `background: currentColor`, which forced-colors collapses onto the canvas colour — measured lamp-vs-backdrop contrast is **0**, so lamps are invisible in high-contrast mode. Every lamp is `aria-hidden` and sits beside the same state word as text, so no information is lost, and this release is still strictly better than the previous build, which used `display: none` and erased the dial arcs entirely in that mode.
- Wide-viewport density: hollow card interiors persist at 1920/2560 and a tall empty band remains under the dials at 800x480–1100. Cosmetic; nothing clipped, hidden, or unreachable.

## Remaining issues

- The runtime printer password is absent from HEAD, tracked diff, and current deployment code, but remains in 9 historical commits. Rotate the printer password. Decide whether to coordinate a disruptive history scrub after all clones and deployments are accounted for; do not rewrite history ad hoc.
- Firmware/update survival is best-effort only. `/usr/data` persisted this deployment, but the Fluidd updater explicitly owns `/usr/data/fluidd`.
- Guided setup still requires a source checkout, Bun, and `sshpass` when SSH keys are unavailable. A signed/notarized macOS installer or prebuilt release would remove Terminal and package-manager friction, but needs a release/signing pipeline.
- Several uploaded jobs reference a missing 300x300 thumbnail; as of the `68181d0` release the live 404 is `.thumbs/Filament_Swatch_PETG_19m37s-300x300.png`. Regolith falls back to a clear placeholder, but the browser still reports a read-only 404 and it is the only console error on the deployed dashboard. Avoid generating or writing printer thumbnails during release QA; fix this only in the slicer/upload pipeline or through a separately authorized printer-file workflow.
- `deploy.sh` can fail mid-run when dropbear refuses an SSH auth under memory pressure (209 MB total RAM). It fails closed and leaves live assets untouched, so a plain retry is safe, but a bounded auth retry or a single reused SSH connection would remove the flake.
- The `Filament_Swatch_PLA-CF_18m36s.gcode` job used for the print-start proof is now recorded on the printer as `cancelled`. That is expected and not a fault.

## User-owned files

- `scripts/light-watchdog.py`
- `scripts/light-watchdog.sh`

Keep both byte-for-byte unchanged, untracked, and unstaged.

## Next steps

1. Rotate the exposed historical printer password; decide whether coordinated history rewriting is worth clone disruption.
2. Keep using fresh guided Check, identity, idle, inactive, zero-target, zero-power, backup, and rollback gates for every later deployment. Recheck exact hashes and zero-write browser QA after each successful static swap; roll back only on deployment verification failure.
3. Produce a prebuilt macOS-friendly release path; sign and notarize when credentials are available.
