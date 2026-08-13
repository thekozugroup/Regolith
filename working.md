# Regolith working handoff

## Goal

Make Regolith safe and approachable for a nontechnical Apple user while preserving expert Klipper control. Use calm Apple HIG-style hierarchy, solid industrial surfaces, and frosted blur only for navigation/status chrome. No Liquid Glass.

## Current status

- **Commit SHAs recorded before the 2026-08-04 history rewrite are stale.** The credential scrub rewrote `main`, so every SHA in the release and validation records below that predates the rewrite no longer resolves. Treat those records as narrative history, not as references you can `git show`. Match releases by date and description; verify anything load-bearing against the current `main` rather than an old SHA.
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
  - ~~Glow is permitted only as a static `drop-shadow` of ≤6px on SVG value arcs and active status lamps. Never on text, never animated, never a pulse.~~ **Withdrawn 2026-08-04 (owner: "remove glow on the dials as well.")** — the bounded-glow permission is retired and the original no-glow ban is back in force; no filter rides any instrument geometry. The dial amendment above stands unchanged.
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
- **Amendment 2026-08-03 — derived concentric radius system (SD1 plan R4/R5; supersedes the "6px panel geometry" prose above and this section's "consistent 12 px grouped-surface corners").** Radii are no longer hand-authored per surface. Exactly two radii are authored in `src/index.css`: `--radius-control` (0.25rem, every interior control) and `--radius-lamp` (1px, the signature lamp corner). Every container radius is derived as pad + inner — `--radius-panel` (14–20px fluid from `--card-pad`), `--radius-modal` (20px), `--radius-group` (8px) — and children consume the cascade via `rounded-inner` (`--radius-inner: max(0px, outer − pad)`), never a literal. Panel corners therefore soften from 6px to 14–20px; the hard-edged fallback is one line (`--radius-control: 0px`) and panel softness is an owner checkpoint at WP-VERIFY. Radius is paint, not metric: the 44px hit-target audits must show zero diff through this work.
- Unknown startup telemetry is neutral: the UI says Connecting, omits a false Klipper error, and shows unavailable temperatures as an em dash instead of `0.0 C`. The state becomes ready/real-valued after the first subscription response. This rule now also covers homing: the HOMED tell-tale renders absent toolhead telemetry as neutral dashes, never as a struck-through "not homed" claim.

## Amendment ledger — SD1 instrument cluster + Track A (2026-08-03)

Binding design amendments from the SD1/Track A workflow (`d37c24d`…`79e8a0a`, verification backlog cleared in the follow-up fix commit). Each entry supersedes any conflicting prose above it.

- **Neutral palette, Variant A (PROVISIONAL — owner checkpoint pending).** The chrome palette moved to the fully neutral C=0 tokens (`--color-bg` oklch(0.145 0 0) through `--color-border-strong` oklch(0.38 0 0)) — Variant A of the two candidates. This is provisional until the owner answers checkpoint (a) below; Variant B remains a token-only swap.
- **Derived concentric radius system (R4/R5).** Recorded in full under "UI and accessibility" above (2026-08-03 amendment): exactly two authored radii (`--radius-control`, `--radius-lamp`), every container radius derived as pad + inner, children consume `rounded-inner`. Supersedes the 6px-panel and 12px-corner prose. Two verified consequences: the system is concentric with respect to the PADDING box (a systematic, accepted +1.00px against the border box — do not "rediscover" it), and any surface whose real pad differs from its cascade default must override the pad token on the element (BrandLogo popover: `--modal-pad: 0.5rem`; re-check the HealthAlerts toast, same class of mismatch).
- **Tell-tale cluster (SD1 §3).** Eight lamps in severity order: THERMAL RUNAWAY, HEATER FAULT, FIRMWARE, LINK LOST, FAN FAULT, MCU HOT, MESH ACTIVE, HOMED XYZ. FILAMENT ships in code but the lamp exists only where the profile declares a physical sensor — the K1 Max base profile declares none, pending a live probe of the machine (an unlit lamp would promise monitoring that is not happening). MAINTENANCE is deferred (P2): no honest data source exists in push state. Every lamp carries three channels (shape, icon, always-visible 11px label); the unlit outline is `--color-gauge-tick` (4.071:1 on the cell well — the 3:1 non-text floor is e2e-pinned); MCU HOT's warning→error escalation carries a CRIT text affix, never color alone.
- **Collapsible sidebar.** Desk-only icon rail with persisted preference; the `desk` HEIGHT-GATE OUTRANKS THE PREFERENCE — the K1's 800x480 panel keeps touch chrome regardless of the stored collapse state (e2e-pinned). Above the dashboard shell's deliberate 2200px readability cap (viewports ≳2424px), collapsing the rail widens the centring margins rather than the dials — accepted trade, e2e-pinned, Sidebar docstring corrected.
- **ETA calibration + thermal slope heuristics are ON BY DEFAULT and are NOT labeled AI.** Both are arithmetic over data the printer already sends, run entirely on the client, and must never be described as AI. Calibrated values render visibly non-measured (`~` prefix, muted, always-visible provenance text — never hover-only) and fail closed to the placeholder; the calibrated estimate is spent once the measured crossfade completes (never leaks past 100% progress). These two features deliberately survived the 2026-08-05 assistant removal (see "AI assistant removal" below) — they were never part of the assistant.
- **AI gateway — REMOVED 2026-08-05 (superseded; see "AI assistant removal" below).** The gateway/flags/explain/post-mortem feature, its Settings panel, its lint fence, and its tests were removed at the owner's request. The historical design (off by default, build-failing import fence, owner-supplied endpoint + key, Expert-only panel, code-split off the cold path) is recorded in the removal entry for whenever it is restored.
- **`--color-fg-subtle` is PROVISIONAL** at oklch(0.64 0 0) pending the WP-VERIFY contrast measurement pass; finalize from measurement, not taste.
- **Open owner checkpoints (unanswered as of this ledger):**
  - (a) Neutral palette Variant A vs Variant B.
  - (b) Warm vs neutral `--color-fg`.
  - (c) `--radius-control` 4px vs 0px (hard-edged fallback is the one-line change).
  - (d) Camera/vision default-off override: explicit acknowledgment required before any camera-vision feature ships (no camera/vision code exists in v1; default is OFF).
- **Still open:** rotate the historical printer password (see "Remaining issues" — unchanged, out of this workflow's scope, still recommended).

## Record conventions

Deploy and validation records below use placeholders: `<printer-host>` for the printer's address and `<accepted-host-fingerprint>` for its SSH host key. Supply the real values at runtime (`PRINTER_HOST=... ./deploy.sh`, plus `PRINTER_USER`, `FLUIDD_ROOT`, and `WEBUI_DIR` if your printer differs from the defaults — see README “Any Klipper printer”). Never commit host-specific addresses, host keys, or credentials: Regolith targets any Klipper printer, and machine-specific values belong in your shell environment or an ignored `.env.local`.

## Live printer validation — 2026-08-02, `93fcf9b`

- Latest release attempt stopped before authentication or writes: `forge.local` freshly resolved to `<printer-host>`, its ECDSA fingerprint exactly matched the accepted host key (`<accepted-host-fingerprint>`), then a read-only Moonraker query found the active `Ivar_Skadis_Hook_PETG_34m53s.gcode` print described above. The guarded installer, backup inspection, static swap, live browser checks, and camera hold were not run.
- Target: Creality K1 Max (`# K1-MAX`, 300 x 300 x 300 mm in `printer.cfg`). Firmware `1.3.5.19`; board `CR4CU220812S11`; Moonraker `v0.10.0-19-g1ed102e` / API `1.5.0`; Klipper reported ready.
- Pre-deploy gate: `print_stats.state=standby`, empty filename/message, `idle_timeout.state=Ready`, `virtual_sdcard.is_active=false`, and no active file.
- No hardware actions occurred: no G-code, motion, homing, heating, extrusion, fan/light, print control, calibration, firmware update, service restart, or config write.
- `forge.local` SSH succeeded but the first HTTP gate failed closed when macOS mDNS timed out. A fresh resolver lookup returned `<printer-host>`; its ECDSA host key matched accepted `forge.local` byte-for-byte before use.
- Read-only preflight through the fingerprint-matched resolver address passed with ready/standby/Ready/inactive state and changed no remote files.
- The new `Install Regolith.command --check` path discovered the ECDSA fingerprint, matched it against the saved known host, explained its read-only scope, and passed preflight without changing remote files.
- Guided deployment archive: 141,305 bytes, SHA-256 `0bbd55e25e5b…0c25`.
- Routes `/`, `/settings`, `/print`, `/control`, `/tune`, `/timelapses`, and `/console` returned HTTP 200. Printer, system, and server APIs returned HTTP 200; browser WebSocket opened successfully.
- Live browser smoke passed every Basic and Expert route at 1440x1000 and 390x844. Each had one page title, zero overflow, and zero visible targets below 44px. The real camera remained Live with no new request during a 15-second hold. There were zero write requests, bad responses, request failures, console errors, or page exceptions. No control was clicked.
- Rollback ready: the previously verified UI remains in `/usr/data/fluidd.previous`.
- Latest persistent verified backup: `/usr/data/regolith-backups/fluidd-before-20260802T180532Z.tgz`, 140,357 bytes, SHA-256 `62fca6533c11…d0c2`, 21 entries. Five archives remain; this deployment pruned none.
- A later read-only preflight for `f2acff5` stopped before writes when `idle_timeout.state=Printing`. A print then failed at 0.15% with `Unknown gcode_macro variable 'user_flag'`. Root cause was a stale KAMP `Start_Print.cfg` symlink pointing at the Ender-3 V3 macro instead of the K1 macro. The printer-side repair was backed up under `/usr/data/printer_data/config/.regolith-repair-backups/20260802T193155Z`, applied as an atomic reversible symlink retarget, and verified before retrying.
- `Skadis Ivar Halter_PETG_2h49m.gcode` then completed at 100% with the full `11,348,737/11,348,737` byte count. A subsequent 12-minute read-only watch found virtual SD inactive, Klipper ready, Idle, zero heater targets/power, no new errors, and a stable camera stream. Fresh gates are still mandatory before deployment.
- The accepted ECDSA fingerprint is unchanged; it lives in your own `known_hosts`, not in this repo. Never use a resolver fallback without matching it first.

## Live exact-current release — 2026-08-02, `5826002`

- `forge.local` freshly resolved to `<printer-host>`; a new ECDSA scan exactly matched accepted fingerprint `<accepted-host-fingerprint>` before authentication.
- The earlier attempt stopped before authentication or writes when the new print was active. The successful retry freshly proved `Ivar_Skadis_Hook_PETG_34m53s.gcode` complete at `2,446,934/2,446,934` bytes, virtual SD inactive, idle `Ready`, Klipper ready, empty message, and both heater targets/power zero.
- Exact-current syntax, tracked-diff, lint, 31 unit assertions, 11 deployment safety tests, guided setup checks, production build, and 10 strict mocked Playwright tests passed before deployment. Guided `--check` then passed read-only through the verified resolver address.
- Pre-deploy storage was 28% used with 4,645,936 KiB available. Live and previous slots each had a valid index, and all five retained backup candidates were nonempty, tar-readable, traversal-clean, and contained `fluidd/index.html`.
- Deployment archive was 141,583 bytes, SHA-256 `87ff688503ae…e02a`. Remote size/hash and staged file list matched exactly before swap.
- New verified backup: `/usr/data/regolith-backups/fluidd-before-20260803T010558Z.tgz`, 140,191 bytes, SHA-256 `7119232ab479…cf5a`, 21 entries. Retention kept five verified archives and pruned one oldest archive only after the new backup passed. Post-deploy inspection revalidated all five.
- Atomic static-asset swap and required-asset HTTP verification passed. Rollback was not needed. `/usr/data/fluidd.previous/index.html` retains pre-deploy SHA-256 `3fa526078f52bf73bc9289590a609e9d67c55f3c9664d2bedf8b6561c45c0da4` and remains ready for guarded rollback.
- Exact local/live SHA-256 matched: HTML `fbfa8d9c7160f1377c9d74ca36ac3a129cda26be4197c903b7624f993f529a7d`; core JS `16e06eeb8db7ed0bc6a9c00d0f231347f602df0c6f35c9e2d8b67b064d5458a4`; CSS `eb71778858384b04b9624cfd2f3f53521f819c382af605266cc772dfba9ab19d`; Dashboard JS `6b3640d7590c94d13daa397da7d47b81c59c0243df8e8a22422b2d4a8d2104cb`.
- Read-only live browser QA covered all seven routes in Basic and Expert at 1440x1000 and 390x844: 28/28 states had one `h1`, zero overflow, zero targets under 44px, zero out-of-bounds panels, and zero clipped text. Mobile and desktop captures were visually reviewed for hierarchy and card alignment.
- Camera remained `Live` through a 32.122-second hold with one stream request, no retry transition, no request failure, and no page error. Browser audit recorded 60 read-only subscription RPCs, zero WebSocket writes, zero HTTP writes, zero request failures, and zero page exceptions.
- The completed G-code references a missing `Ivar_Skadis_Hook_PETG_34m53s-300x300.png` thumbnail. Four repeated read-only HTTP 404s produced resource-console errors; the UI rendered its intentional placeholder. This is printer-file metadata, not a static deployment mismatch, so rollback was not triggered.
- Final read-only state remained complete/Ready/inactive at `2,446,934/2,446,934`, with hotend `39.23 C` and bed `41.24 C`, both targets/power zero. No G-code, motion, homing, heating, extrusion, calibration, print control, firmware/service restart, or printer configuration change occurred.

## Live release and print-start proof — 2026-08-03, `68181d0`

Deployed with the repo's own `deploy.sh` (no hand-rolled copy) at printer clock 2026-08-03 13:22:35 EST, against `PRINTER_HOST=<printer-host>`. `forge.local` does not resolve through this Mac's HTTP client, so the verified resolver address was used.

- Pre-deploy gate, re-confirmed immediately before the swap: `webhooks=ready`, `print_stats=complete`, `idle_timeout=Idle`, `virtual_sdcard.is_active=false`, hotend `28.29 C`/0, bed `26.17 C`/0, plate visually clear on camera. `--preflight` exited 0 and changed no remote files.
- The first deploy attempt failed closed at "Create persistent known-good backup" when dropbear refused a mid-run SSH auth (the printer has 209 MB RAM, ~67 MB free). **Live assets were never touched**: `/usr/data/fluidd/index.html` still hashed `fbfa8d9c…`, the staging slot and upload archive were both cleaned up. The retry succeeded end to end.
- Deployment archive 145,032 bytes, SHA-256 `cdf00b0a4fde…6101`. Remote size/hash and staged file list matched before swap.
- New verified backup `/usr/data/regolith-backups/fluidd-before-20260803T182235Z.tgz`, 139,747 bytes, SHA-256 `c49f75adf21c…56c0`, 21 entries; retention kept five and pruned one oldest only after the new archive verified.
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
PRINTER_HOST=<printer-host> PRINTER_PASSWORD="$PRINTER_PASSWORD" ./deploy.sh --rollback
```

Password: set PRINTER_PASSWORD in your environment; do not commit it.

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

- **Deploy is printer-agnostic.** `PRINTER_HOST`, `PRINTER_USER`, `FLUIDD_ROOT`, and `WEBUI_DIR` describe where any Klipper printer serves its WebUI; every remote path (live, `.next`, `.previous`, upload archive, backup dir, backup filename prefix) is derived from them. Defaults stay `root@forge.local:/usr/data/fluidd`, and the composed remote command strings are byte-identical to the pre-parameterisation script — verified by diffing the mocked SSH command log against the previous revision. Overrides are resolved from the environment *before* the `readonly` declarations and validated (absolute path, single path segment, plain account name) before any remote command runs, because they are spliced into remote shell text.
- **Machine-specific config belongs in profiles.** `src/profiles` owns pins, limits, macros, and tell-tales. `deploy.sh` owns only where the static bundle lands. Nothing about a K1 Max is encoded in the deployment any more.
- **SSH keys are the primary, documented auth path.** The key probe runs first and is what the docs, `--help`, and the guided setup tell a new user to set up (`ssh <user>@<host>` once, then `ssh-copy-id`). The key-auth failure message now names the exact `ssh-copy-id` command. The `PRINTER_PASSWORD`/`sshpass -e` fallback is retained deliberately — our own forge testing relies on it — but is framed as a fallback.
- **Bounded retry for transient dropbear refusals.** `remote_retry` repeats a step up to two extra times (1s, 2s backoff) *only* on ssh exit 255, which is ssh's own "could not establish or authenticate the session". Any other status is the remote command's own exit code and fails closed on the first attempt. Applied to read-only and idempotent steps: preflight, archive upload (truncating write, re-opened per attempt, still size/SHA-256 verified), remote size/hash reads, staging extract (`rm -rf` first), staged file listing, previous-slot existence check, post-deploy cleanup. **Deliberately not applied** to the persistent backup + retention prune, the atomic swap, or the rollback swap: replaying a mutation whose acknowledgement was lost could write a duplicate backup, evict an extra known-good archive, or discard the real previous slot. Those three stay failing-closed with an explanatory comment at each call site, and `tests/deploy.test.sh` asserts each is attempted exactly once when the session is refused.
- `deploy.sh` contains no password or fixed-IP default. It prefers SSH keys, optionally accepts a silent prompt or `PRINTER_PASSWORD` through `sshpass -e`, validates host input, and uses `StrictHostKeyChecking=accept-new`.
- `Install Regolith.command` gives macOS users a Check / Install / Roll Back menu with read-only Check as the default. It discovers the ECDSA identity, refuses saved-key mismatches, requires interactive first trust, and never stores the password.
- Local development defaults to `forge.local`. A validated `VITE_REGOLITH_PRINTER_HOST` in ignored `.env.local` supports another trusted hostname or IPv4 address without editing source; protocols, ports, paths, shell syntax, and invalid IPv4 values fail before Vite starts.
- `--preflight` is read-only and refuses busy, paused, active virtual-SD, Klipper-not-ready, incomplete/unknown, low-space, or missing-tool states.
- Deployment runs locked dependency install, lint, hardware-independent tests, and build before upload. It verifies archive size, SHA-256, staged file list, and a timestamped persistent backup before swapping fixed `/usr/data` slots.
- Backup retention preserves the newest five archives. It verifies the new archive and every candidate, proves the new archive is protected, then removes only older timestamped archives. Any malformed archive blocks before the live swap and before pruning.
- Every post-swap failure triggers automatic slot rollback and HTTP recovery verification. `--rollback` is idle-gated, reversible, and HTTP-verified.
- `/usr/data/fluidd.previous` and `/usr/data/regolith-backups` improve update recovery. Survival remains best-effort because firmware can erase `/usr/data`, replace routing, or change Moonraker.
- Moonraker contains `[update_manager fluidd]` with `channel: beta` and `path: /usr/data/fluidd`. Update status reported Fluidd `v1.36.4`, remote `v1.36.4`, `is_valid=false`. Fluidd, helper, or firmware updates may overwrite or invalidate Regolith; re-run preflight and deploy afterward.
- Mocked shell tests cover bad-host rejection, busy, failed-print, and unknown-state refusal without writes, read-only preflight, verified retention, malformed-backup refusal before swap, failed-HTTP automatic rollback/recovery, manual rollback, and insecure SSH/secret patterns. They also cover the printer-agnostic layout: unset environment keeps the K1 Max defaults and key-first auth; a full deploy under `PRINTER_USER=maker FLUIDD_ROOT=/opt/printer-data WEBUI_DIR=webui` retargets every remote path and emits no `/usr/data` string; unsafe `FLUIDD_ROOT`/`WEBUI_DIR`/`PRINTER_USER` values are rejected before any mock is reached; a refused session is retried and recovers; a genuine remote failure is not retried; and backup, swap, and rollback swap are each attempted exactly once when refused. Every one of those assertions was mutation-checked — each fails when the behaviour it guards is broken.

Recovery commands; provide the password only at runtime or through the silent prompt:

```sh
PRINTER_HOST=<printer-host> ./deploy.sh --preflight
PRINTER_HOST=<printer-host> ./deploy.sh --rollback
curl --fail --show-error --connect-timeout 5 --max-time 12 http://<printer-host>/
```

If mDNS fails, resolve `forge.local`, verify that address against the fingerprint stored in your `known_hosts`, then use `PRINTER_HOST=<verified-resolver-address> ./deploy.sh --preflight` or `--rollback`. Never hard-code an unverified address. Rollback swaps live and previous slots and verifies HTTP; failed verification restores the original slot automatically.

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
PRINTER_HOST=<printer-host> ./deploy.sh --rollback
```

Persistent backup `/usr/data/regolith-backups/fluidd-before-20260803T204754Z.tgz` (143133 bytes, sha256 `74dd0a29e92e…f3e2`, 21 files, 5 retained, 1 pruned).

What shipped:

- **Bottom `MissionBar` cockpit** (`e538aab`) — mission status pinned bottom on every route, density pass, more vitals in basic mode.
- **Tailwind v4 amber-400 palette + oklab glow fix** (`89c1e43` and 5 earlier atomic commits) — the owner's *green dial glowing amber* bug. Every `color-mix` with a `transparent` operand moved from polar `oklch` to rectangular `oklab`, so a source hue can no longer be dragged toward 0° by the powerless-hue rule.
- **Five active-print read-out defects** (`7dd3c0d`) — phantom progress on a stopped job, wrong "Remaining" derived from Klipper's monotonic clock, discarded current-layer-only readings, unsurfaced `print_stats.message`, and forced-colors glow contract pinned by tests.

Independent pre-deploy verification (read-only, all re-run rather than trusted): `bun run lint`, `bun run test` (49 pass), `bun run test:e2e` (91 pass), `bun run build` — all exit 0. `git diff 64e943d -- src/lib/printerActions.ts src/lib/moonraker.ts` empty, so the hardware-proven print fix has not drifted; `git diff 6d11e3e -- deploy.sh scripts/` empty. `PRINT_START`, `SET_GCODE_VARIABLE`, `use_kamp` absent from executable `src/`; `ADAPTIVE_BED_MESH` present.

Measured, not read from source (fresh profile, mocked scenarios):

- Computed `--color-accent` = `rgb(255,185,0)` = `#ffb900`.
- **Glow halo hue proven at the pixel level** by differencing a filter-on against a filter-off screenshot, which isolates the glow's own contribution from the blue-tinted panel. At-temperature: arc pixel `rgb(5,223,114)`, halo delta `(-2,+40,+17)` — decisively **G > R, the halo is green**. Heating arc `rgb(255,185,0)` halo delta `(+41,+28,-5)`; cooling arc `rgb(255,100,103)` halo delta `(+44,+14,+14)`; each halo matches its own arc. Computed filter is `oklab(… / 0.45)` in every state, never `oklch`. *(Historical record of removed code, kept for the law's provenance: the glow these pixels measured was deleted 2026-08-04 on owner direction. The oklab-over-oklch mixing law the measurement established survives its subject — canonical statement now on `--color-accent-soft` in index.css, still pinned by `tests/accentDefault.test.ts`.)*
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

## Measured performance validation — 2026-08-03, `c840027`

Full-stack measurement pass over WP-PERF's work. Every number below is
measured against a real build in headless Chromium, never read from source.
Cold-load and runtime figures are 800x480 (the K1 panel's geometry, and the
weakest client that could ever host a webview) with CDP CPU throttling and
emulated network; the runtime stress figures use 20x CPU to model the panel
rather than the development machine. Render attribution comes from an
unminified React *profiling* build so component names survive.

**A correction to `31d30e2`'s commit message.** That message reports
"FCP 612 -> 520ms (-15%)". The 612ms baseline was measured against a `dist/`
built before a stale Tailwind cache cleared, so it carried a 62.8 kB
stylesheet where HEAD produces 70.6 kB — two different generations of build.
Re-measured properly, same-generation and warm, three runs each:

| metric (800x480, 4x CPU, 60ms RTT) | before | after |
| --- | --- | --- |
| FCP | 504, 508 ms | 520, 528, 528 ms |
| **LCP** (the dial readout) | 748, 748 ms | **672, 676, 684 ms** |
| TTI (last long task) | 390, 390 ms | 406, 408, 414 ms |
| longest task | 67, 67 ms | 60, 62, 64 ms |
| **wall clock to settled** | 831, 834 ms | **716, 716, 729 ms** |

So the honest result is a **trade, not a clean win**: about 20ms later to the
first pixel of chrome, in exchange for 71ms earlier to the largest contentful
paint and 115ms earlier to a fully settled dashboard. The skeleton the owner
stares at while the route loads shrinks from 244ms to 148ms. FCP moves the
wrong way because the preloaded route chunk competes with the entry chunk for
bandwidth; a variant preloading only the 46 kB route chunk and not its small
dependencies was measured and was **worse on every count** (LCP 764-768ms,
settled 845-848ms) while costing the same FCP, so the committed version
stands.

The waterfall is what actually changed. Before, the shell landed at 281ms and
then nothing happened until 460ms while React parsed, executed and rendered
far enough to discover the route import; the nine-request route wave that
followed ran to 616ms, with three requests queued behind the HTTP/1.1
six-connection limit. After, all thirteen requests are issued at 81-86ms and
the last lands at 304ms.

Bundle, final build (gzip): entry 104.5 kB, dashboard route 13.7 kB, CSS
12.5 kB, then settings 7.2, files 5.5, tune 5.1, react 3.1, control 3.1,
console 2.6, timelapses 2.0; 27 chunks, 166.8 kB total. No route carries
another route's weight, and **no duplicate dependencies**: the icon chunks
import `createLucideIcon` from the entry rather than restating it, and the
entry links the react chunk instead of copying it. The assistant's chunks
(`AiGloss`, `AiPostMortem`, `explain`, `gateway`) are absent from the cold
waterfall entirely, which is the point of `df2107a`.

No web fonts and no images: `--font-sans` / `--font-mono` are system stacks,
the compiled stylesheet contains zero `url()` references, and the only asset
outside JS/CSS is the SVG favicon. Nothing to trim there.

Runtime, 30s simulated print at 250ms telemetry cadence with the camera live.
React commits are 2.3-2.5 per push and were left alone — the plan's rejection
of render coalescing stands and no coalescing was added. At 20x CPU, two runs
each:

| metric | before | after |
| --- | --- | --- |
| long tasks (>50ms) | 4, 11 | 1, 2 |
| longest task | 64, 73 ms | 52, 54 ms |
| total blocking time | 19, 64 ms | 2, 4 ms |
| frame p95 | 65.1, 60.2 ms | 49.2, 49.2 ms |
| worst frame | 99.5, 117.4 ms | 81.5, 76.1 ms |
| dropped frames (>32ms) | 9.05%, 9.89% | 8.58%, 8.11% |

Blocking time is essentially eliminated. Dropped frames move only 9.5% ->
8.3%, and that residue is the camera's MJPEG decode under a 20x throttle
rather than React — stated plainly because the smaller number is the one that
would be easy to overclaim. At 4x CPU there are **zero** dropped frames and
zero long tasks, before and after: the dial's arc and the mission bar's
progress strip are CSS transitions and never depended on render work.

Render attribution over 60 pushes, which is what `c840027` was aimed at:

- `Sidebar` 36.2ms across 149 renders -> 0.0ms; `PrintProgress` picks up 8.0ms
- `Dial` 31.6ms across 171 renders -> 14.3ms across 108
- `BrandLogo` 5.7ms -> no longer rendered during telemetry at all

Memory, 10 minutes of sustained telemetry (2,400 pushes), sampled after a
forced GC each minute, using CDP's exact heap figure rather than the browser's
bucketed `performance.memory`:

| | before | after |
| --- | --- | --- |
| heap, min 1 -> min 10 | 5.15 -> 6.27 MB | 5.08 -> 6.09 MB |
| DOM nodes | 830 -> 830 (0) | 841 -> 841 (0) |
| JS event listeners | 208 -> 208 (0) | 208 -> 208 (0) |
| window/document listeners | 31 live, flat | 31 live, flat |

**No leak of the kind that was being looked for.** Node count, listener count
and window/document listener count are exactly flat across 2,400 pushes in
both builds, so there are no detached nodes, no accumulating listeners, and
the previously fixed timer leak stays fixed. Every ring buffer is bounded and
was re-checked: gcode log 200, temperature history 90, sparkline 60, job
history 20.

## Pre-deploy validation record — 2026-08-04, `8cffd40`

Validation run for sha `8cffd40993a9c792fe484e732e6cdb67ef9a7cd4` (branch `main`, even with `origin/main`, no tracked-file changes). All four gates re-run fresh at this HEAD on 2026-08-04, real exit codes:

- `bun run lint` — exit 0.
- `bun run test` — exit 0: 277 pass, 0 fail, 3,443 `expect()` calls, plus the 11 deployment safety tests and guided setup checks.
- `bun run test:e2e` — exit 0: 135 passed (1.8m), strict local mocks, zero printer contact.
- `bun run build` — exit 0 (`tsc -b && vite build`).

What this release contains since the last hardware-proven baseline `68181d0` (50 commits; the `7dd3c0d` slice — MissionBar cockpit, amber-400/oklab glow, active-print read-out fixes — is already live on the K1 Max):

- **SD1 instrument-cluster redesign**: neutral chroma-0 palette (Variant A, provisional), derived concentric radius/spacing tokens, binnacle instrument wells + Z5 strip, SegmentGauge strips, the eight-lamp tell-tale cluster, collapsible desk sidebar with the 800x480 height gate, ETA calibration + thermal-slope heuristics (on by default, never labeled AI), and the AI gateway off by default behind a build-failing import fence.
- **WP-PERF subscription rework** (`c4e0c0f`, `06113a4`, `c840027`, `31d30e2`, `df2107a`): ref-counted field-level Moonraker subscriptions (−27.6% WS payload), selector subscriptions so telemetry ticks stop committing the shell, navigation no longer redrawn for the progress sliver, declared landing-route chunks, assistant off the cold path.
- **Polish/harden/perf backlog**: persisted-storage fuzz fixes (every key survives corruption/dead storage), chrome error boundaries instead of white screens, unhandled-rejection capture with a lint gate, reconnect hardening (jittered backoff, storm retreat, ghost-link watchdog, subscribe retry in `8cffd40`), sleep/wake link survival, metadata-gated thumbnail probes, in-app dialogs for timelapse delete/settings reset, file placeholders/skeletons, focus rings, modulepreload, and the Sidebar split.

Printer idle re-confirmed cold before this record (`print_stats=cancelled`, extruder 25.5 C/0, bed 23.65 C/0). Deployment itself is recorded separately below once it happens; this entry is the gate evidence for `8cffd40`.

## Live release — 2026-08-04, `8cffd40` (SD1 instrument cluster + WP-PERF + hardening backlog)

Deployed static assets built at sha `8cffd40993a9c792fe484e732e6cdb67ef9a7cd4` (the working tree at deploy was `2d91305`, which differs from `8cffd40` only by this file's validation record — no source, build config, or asset input changed). Printer clock at deploy: **Mon 2026-08-03 23:46:54 EST** (backup timestamp `20260804T044640Z`).

- Pre-deploy gate, re-confirmed immediately before the swap with two samples 11 s apart: `webhooks=ready`, `print_stats=cancelled`, `idle_timeout=Idle`, `virtual_sdcard.is_active=false`, hotend `25.40→25.37 C`/target 0/power 0, bed `23.55→23.54 C`/target 0/power 0, toolhead position identical across both samples (`296.50, 153.00, 150.04`). **No print was started.** `--preflight` exited 0 and changed no remote files.
- `./deploy.sh` (repo script, `PRINTER_HOST=<printer-host>`) exited 0 first try — no dropbear flake this run. Archive 162,458 bytes, SHA-256 `b3e55873051b…1d83`; remote size/hash and staged file list matched before the swap. Atomic swap and required-asset HTTP verification passed; automatic rollback was not triggered.
- Live `index.html` moved `de1175ff35e8b1d6984a27a1bf14efccd56f10af1a55d668df75da858140de59` → `ffd9036110b76ae699160ee6e710aa030c93b1305112adee4f4ccb2726076609` (exact match with local `dist/index.html`). Live bundles: `index-DxjXKT4b.js` / `index-BRomDO5p.css` / `Dashboard-DAJTRcUl.js`.
- New verified backup `/usr/data/regolith-backups/fluidd-before-20260804T044640Z.tgz`, 143,065 bytes, SHA-256 `96d504b58589…5bc2`, 21 files; retention kept five and pruned the oldest (`20260802T174223Z`) only after the new archive verified.
- **Rollback is armed:** `/usr/data/fluidd.previous/index.html` is exactly the pre-deploy `7dd3c0d` build (`de1175ff…de59`). Note the previous slot now holds the `7dd3c0d`-era build, not `68181d0` — `68181d0`'s build (`7abea8ff…1919`) was rotated out of the slot by this swap but survives in backup `fluidd-before-20260803T204754Z.tgz`.

```sh
PRINTER_HOST=<printer-host> PRINTER_PASSWORD="$PRINTER_PASSWORD" ./deploy.sh --rollback
```

On-device verification (headless Chromium via SSH loopback tunnels — page through printer nginx :80, camera through printer :8080, since macOS local-network privacy still blocks Chromium from LAN addresses; every byte came from the printer and nothing on it was modified), at 1280x800 and 800x480:

- Dashboard renders at both sizes: binnacle instrument wells, the full 8-cell tell-tale cluster, `MissionBar` pinned bottom, one `h1`, zero horizontal overflow.
- **Zero console errors, zero page errors, zero failed requests at both sizes.** The long-standing thumbnail 404 is gone from the live console — `ae80c62`'s metadata gating verified against the real printer's file set.
- Fresh-profile computed `--color-accent` on the device = `#ffb900`. Body ground computes to `lab(2.75 0 0)` — chroma exactly 0, the neutral Variant A palette confirmed live.
- Sidebar: expanded by default at 1280x800, collapses to a 64 px icon rail and re-expands via the toggle. At 800x480 the desk rail is suppressed (toggle renders 0x0) and the touch chrome is kept — bottom nav visible full-width at 800x65 with the mission bar flush above it. The height gate outranks preference on the K1's own panel geometry, as pinned.
- **Live-tick proof of the reworked subscription path:** the hotend dial's readout updated `25.3 → 25.4 C` within seconds of load against real Moonraker — the ref-counted fieldRefs subscription (`c4e0c0f`) delivers live pushes on hardware, and the `8cffd40` subscribe-retry path did not impede initial subscription.
- LINK is connected: mission bar reads `LINK READY`; the cancelled job renders honestly (`STOPPED AT 0.0%`, Remaining `—`, `Print again` offered); camera streams LIVE.
- Screenshots (session scratchpad): `ondevice-1280x800.png`, `ondevice-1280x800-sidebar-collapsed.png`, `ondevice-800x480.png`.

Final state after verification: printer untouched apart from the static asset swap and its backup — no G-code, motion, heating, print control, service restart, or configuration change; the owner's `scripts/` watchdog was not contacted.

## Swiss grid + readiness redesign — 2026-08-04, `17e145b`..`a594900`

Four-commit slice replacing the ad hoc dashboard layout with a named-area Swiss
modular grid and rebuilding the printer-identity card as a two-layer readiness
module:

- **`17e145b` feat: Swiss modular grid with named-area zone placement.** 4/8/12
  column modular grid on the existing 720/1560cqi breakpoints; zones placed by
  `grid-template-areas` (`.z-*` classes) instead of source order, with
  Readiness pinned to row 1 column 1 on every multi-column class. The old
  binnacle sub-grid dissolves into sibling Telemetry/TellTales zones. The
  800x480 K1 panel map keeps Thermals in row 1 so both dials stay above the
  fold. DOM order (mobile task order) is unchanged.
- **`4c0ef25` feat: readiness module with K1 silhouette, disclosure, honest
  light chip.** `PrinterCard` becomes the Z6 readiness module: one
  body-button surface showing only the persistent layer (ready lamp + word,
  a new `K1MaxSilhouette` line-art component, status line, display-only light
  chip). Everything else — hostname, OS, Klipper, network, homed axes,
  checks, the printer-photo feature — moves into a `ModalSurface` disclosure
  opened on demand; the two one-shot meta fetches move from mount to first
  open. The light chip reads `output_pin` LED state via a new
  declare-to-subscribe `statusPins` profile field and stays honestly
  three-state (dash until telemetry, then ON/OFF). Forced-colors pins
  silhouette strokes to `CanvasText`.
- **`711e964` style: even button chrome + strict concentricity.** Every
  `Button` and button-like control now carries even padding/margins on all
  four sides (sizes moved to `p-3`/`p-3`/`p-3.5`, 44px hit floor kept via
  `min-h`); dialog headers/footers that seat corner buttons pad to
  `p-4 = --modal-pad` so `radius-modal − gap` equals the control radius
  exactly. New `e2e/button-law.spec.ts` measures margins, padding, and
  computed radii on four representative placements plus full-page sweeps.
- **`a594900` test: swiss grid e2e + square thermal instrument modules.**
  Thermal instruments become true squares (`aspect-ratio: 1` as a preference;
  content height still wins below the 148px floor and on the 800x480 panel,
  so every measured floor holds). New `e2e/swiss-grid.spec.ts` covers:
  readiness top-left showing only the persistent layer, the honest
  three-state light chip + silhouette rays from `output_pin` pushes,
  disclosure focus trap/Escape/focus-restoration, column-start alignment at
  the 8-column class (1280), tile squareness within 2% with undistorted dial
  art at 1280/2560, and the floor sweep at 320/800x480/1280/2560.

Net effect on the suite: baseline **135 → 143** e2e tests (button-law +2,
swiss-grid +6, no removals), all green.

## Pre-deploy validation record — 2026-08-04, `a594900` (final gate)

Independent final-gate validation for sha `a594900ffa4ffdc44d878acff0c755fa5b4b194e`
(branch `main`, even with `origin/main`; tree quiet — no sibling vite/playwright
processes, port 4173 free before the run). All four gates re-run fresh at this
HEAD, real exit codes:

- `bun run lint` — exit 0.
- `bun run test` — exit 0: 277 pass, 0 fail, 3,443 `expect()` calls, plus the 11
  deployment safety tests and guided setup checks.
- `bun run test:e2e` — exit 0: **143 passed** (1.8m; baseline 135, no shrink),
  strict local mocks, zero printer contact.
- `bun run build` — exit 0 (`tsc -b && vite build`).

Targeted re-runs beyond the full suite, each in isolation:

- `e2e/swiss-grid.spec.ts -g "readiness"` — 3/3 pass (top-left placement,
  honest light chip, disclosure focus trap/Escape/restore).
- `e2e/swiss-grid.spec.ts -g "alignment and floors"` — 3/3 pass, including the
  1280 8-column-class left-edge spot-check and the 320/800x480/1280/2560
  floor sweep.
- `e2e/button-law.spec.ts` (full file) — 2/2 pass: even chrome + strict
  concentricity on four representative placements and a full-page sweep.
- `e2e/console-hygiene.spec.ts` (full file) — 4/4 pass, zero console noise
  across basic/expert routes and both preview-thumbnail scenarios.

Frozen-file check: `src/lib/printerActions.ts`, `src/lib/moonraker.ts`,
`src/lib/safety.ts`, `deploy.sh`, and `scripts/` all last modified by commits
that predate this workflow (`de30d449`, `8cffd409`, `46262541`, `93fcf9bd`
respectively, all ancestors of and older than `3283b70`) — none touched by
`17e145b`/`4c0ef25`/`711e964`/`a594900`. Working tree has no tracked
modifications; only the expected untracked scratch paths (`.a5c/`, `.claude/`,
`CLAUDE.md`, `node-compile-cache/`, `playwright-transform-cache-501/`,
`scripts/`) are present, none of them staged or committed.

This entry is gate evidence only — no deploy was performed as part of this
validation pass; see the Deploy phase agent's own record for the live swap.

## Live release — 2026-08-04, `3e38c9f` (Swiss grid + readiness module)

Deployed static assets built at sha `3e38c9f8bd95a69f9753549f3c43e8834c7aec8d`
(`main`, even with `origin/main`; tree had no tracked modifications). Backup
timestamp `20260804T125648Z`.

- `./deploy.sh --preflight` (`PRINTER_HOST=<printer-host>`) exited 0 and changed
  no remote files.
- Idle re-confirmed immediately before the deploy with two Moonraker samples
  10.2 s apart (12:56:05Z / 12:56:15Z): `webhooks=ready`,
  `print_stats=cancelled`, `idle_timeout=Idle`, `virtual_sdcard.is_active=false`,
  hotend `26.3 C`/target 0, bed `24.3 C`/target 0, toolhead position identical
  across both samples (`296.50, 153.00, 150.04`). **No print was started.**
- `./deploy.sh` exited 0 first try — no dropbear flake, automatic rollback did
  not trigger. In-script gates green: lint, 277 unit tests + 11 deployment
  safety tests + guided setup checks, `tsc -b && vite build`. Archive 164,525
  bytes, SHA-256 `c3c0cefffc36012aa9e0229cf4bc830fba5f5222eaa6895a3770c33df85c6e2d`;
  remote size/hash and staged file list matched before the atomic swap;
  required-asset HTTP verification passed.
- Live `index.html` moved `ffd9036110b76ae699160ee6e710aa030c93b1305112adee4f4ccb2726076609`
  → `3e7eb1ba97154f69c77de4c2874824a8a88bea49710f5f2eaa32b43ca331b317`. Live
  bundles: `index-CKaJoMdf.js` / `index-BKw1cIeX.css` / `Dashboard-BNJNZHHz.js`.
- New verified backup `/usr/data/regolith-backups/fluidd-before-20260804T125648Z.tgz`,
  159,430 bytes, SHA-256 `07903799015c8295829fb01cdea44627c9c8ce373bf70162904455fef6565cb2`,
  32 files; retention kept five and pruned the oldest (`20260802T180532Z`) only
  after the new archive verified.
- **Rollback is armed:** `/usr/data/fluidd.previous/index.html` is exactly the
  pre-deploy `8cffd40` live build (`ffd90361…6609`), re-verified after the swap.

```sh
PRINTER_HOST=<printer-host> PRINTER_PASSWORD="$PRINTER_PASSWORD" ./deploy.sh --rollback
```

On-device verification (SSH loopback tunnels — page through printer nginx :80,
camera through printer :8080; every byte from the printer, nothing modified),
interactive Chromium plus headless capture at 1280x800 and 800x480:

- 1280x800: Readiness module renders top-left with the `K1MaxSilhouette`
  line-art and READY lamp; disclosure opens from the readiness body-button
  (hostname `forge`, Buildroot 2020.02.1, Klipper `09faed31`, HOMED, MESH
  adaptive, **LINK connected**, camera path) and closes cleanly; cards sit on
  the Swiss grid with aligned column edges; camera streams LIVE.
- 800x480: touch chrome kept per the pinned e2e law — bottom nav, no desktop
  sidebar, Thermals dials above the fold, mission bar reading `LINK READY`;
  Readiness present below the fold (y≈1094) by design (mobile DOM task order).
- **Zero console errors, zero page errors, zero failed requests at both
  viewports** (initial run showed 3 `ERR_CONNECTION_REFUSED` on
  `localhost:8080/?action=stream` — the camera port not yet tunneled, a tunnel
  artifact, not an app defect; clean once :8080 was forwarded).
- **Live-tick proof:** 197 DOM mutations observed in `main` over 15.03 s of
  MutationObserver watch; raw Moonraker over the same idle period ticked
  hotend `26.28→26.29 C` and bed `24.28→24.35 C` across two samples 15.3 s
  apart (13:00:16Z / 13:00:31Z), matching the displayed `26.3` / `24.3`
  rounding — the subscription path delivers live pushes on hardware.
- Screenshots (session scratchpad): `ondevice-1280x800.png`,
  `ondevice-1280x800-disclosure.png`, `ondevice-800x480.png`.

Final state: printer untouched apart from the static asset swap and its backup —
no G-code, motion, heating, print control, service restart, or configuration
change; the owner's `scripts/` watchdog was not contacted.

## Inter webfont — 2026-08-04, `71b6a90`

Owner direction: "use inter for both webui and touch panel font" (the touch
panel already ships it). The web UI now self-hosts Inter as `--font-sans`.

- **File**: official InterVariable v4 (rsms.me `font-files/InterVariable.woff2`,
  344 kB), subset in an isolated fontTools 4.x venv to Latin-1 plus every
  non-ASCII codepoint the source actually renders (typographic punctuation,
  math `− ≈ ≤ ≥ ± × °`, arrows, geometric lamp shapes, `✓ ⚠`) →
  `public/fonts/InterVariable.woff2`, **105 kB** raw (woff2 is already
  brotli-compressed; gzip does not shrink it). All GSUB features (`tnum`,
  `calt`, `ss01`, `zero`, …) and both axes (`opsz` 14–32, `wght` 100–900)
  retained; `─ ⏸ 🚩` are absent from full Inter too, so glyph fallback is
  unchanged. Subset command: `pyftsubset InterVariable.woff2 --flavor=woff2
  --unicodes="U+0000-00FF,U+2000-206F,U+2190-21FF,U+2212,U+2248,U+2264,
  U+2265,U+23F8,U+2500,U+25A0-25FF,U+2600-26FF,U+2713,U+1F6A9"
  --layout-features='*' --name-IDs='*' --name-languages='*'`.
- **Zero-shift swap**: `font-display: swap` over an "Inter Fallback" face —
  local Arial with `size-adjust: 105.15%`, `ascent-override: 92.13%`,
  `descent-override: 22.94%`, `line-gap-override: 0%`, computed with
  fontTools from string advances of the actual subset (wght 400 / opsz 14)
  against this machine's Arial. `index.html` preloads the woff2; headless
  check shows Inter `loaded` at `document.fonts.ready` with the fallback
  face never fetched, and first paint (theme/accent, CSS-only) is not
  blocked by the font.
- **Mono decision**: `--font-mono` stays a system mono stack, reserved
  strictly for machine text — Console log/input, G-code viewers, file
  names/paths, hex colors, AI endpoint/key inputs, profile ids, version
  strings — where slice-anywhere alignment and code-ness carry meaning.
  All numeric telemetry (`.readout`, `.instrument-value`, MissionBar
  clocks, dial numerals, position/temperature/mesh/stat values) is Inter
  with `tabular-nums slashed-zero`. Rationale: Inter's `tnum` gives the
  same tick-stable equal digit advances mono provided, matching the touch
  panel's Inter numerals, while a visually distinct mono keeps honest
  signal value for genuinely machine-generated text.
- **Italic**: the roman variable file only. The two `italic` sites (empty
  states in MissionTimeline/Console) render synthesized oblique — not
  worth a second ~100 kB face for two muted placeholders.
- **Measurements** (headless Chromium, `vite preview`, 800x480):
  - Digit advances: `111` = `999` = `000` = `888` widths, byte-equal, in
    real `.readout` and `.instrument-value` elements and in synthetic
    dial-numeral/clock contexts — tabular confirmed under Inter.
  - LCP median of 5: **60 ms** after vs **76 ms** baseline — no
    regression (>5% threshold not approached).
  - Floors re-measured with Inter live via the full e2e suite: **143/143
    passed** — 11 px minimum text, 44 px targets, 148 px dial floor,
    button-law even padding, MissionBar/StatusRail truncation, overflow,
    concentricity, Swiss grid, tell-tales, accent guards, console hygiene
    all held; **zero fixes required**.
  - Note: the body-level `font-feature-settings: "calt" 1, "ss01" 1,
    "zero" 1` now actually activates (system fonts ignored it): slashed
    zeros and Inter's ss01 alternate digits are live everywhere — the
    intended instrument look.

## Final gate validation — 2026-08-04, `2781947`

Deploy-gate re-check at exact HEAD `278194726ffb593e51ec1aef2956215853b89481`
(docs-only commit; no code change since `71b6a90`). Working tree was clean
against this HEAD (no tracked-file diff; local `main` even with
`origin/main`). Only untracked, user-owned/tooling paths present
(`scripts/`, `.a5c/`, `.claude/`, `CLAUDE.md`, build caches) — left
untracked, not staged.

- `bun run lint` — exit 0.
- `bun run test` — exit 0 (277 unit tests pass, `deploy.test.sh` 11/11,
  `setup.test.sh` pass).
- `bun run build` — exit 0.
- `bun run test:e2e` — exit 0, **143/143 passed**, matching baseline
  (no shrink). Retried once after an initial run failed on a port-4173
  collision from a concurrent process on this machine; freed on its own,
  no process was killed to force it.
- Frozen files (`printerActions.ts`, `moonraker.ts`, `safety.ts`,
  `deploy.sh`, `scripts/`) untouched — confirmed via clean `git diff`.
- Grepped tracked files at this HEAD for the literal printer password: no
  matches — password stays clean of tracked history at HEAD (see prior
  scrub entry for the historical-commit caveat, still unresolved).
- No console errors observed in the e2e run; no external font network
  requests (`fonts.googleapis`/`fonts.gstatic`) present in `src/` or
  `index.html` — Inter is fully self-hosted per the entry above.

## Live deployment — 2026-08-04, `d96968f`

Deployed `main` HEAD `d96968f2fe14347a04e4a824690d0b2bd4caef6e` (tracked tree
clean, even with `origin/main`) to the K1 Max at `<printer-host>` via
`deploy.sh` only. Gate had reported SAFE TO DEPLOY: YES; standing owner
authorization. No config, service, or watchdog contact; no print started.

- **Preflight**: `PRINTER_HOST=<printer-host> PRINTER_PASSWORD=$PRINTER_PASSWORD
  ./deploy.sh --preflight` — exit 0; "Printer is conclusively idle
  (cancelled, Idle)".
- **Rollback anchor**: pre-deploy live `index.html` SHA-256
  `3e7eb1ba97154f69c77de4c2874824a8a88bea49710f5f2eaa32b43ca331b317`;
  `fluidd.previous` present; backups through
  `fluidd-before-20260804T125648Z.tgz`.
- **Double idle check** (Moonraker, two samples 10 s apart, immediately
  pre-deploy): klipper `ready`, print `cancelled`, activity `Idle`, SD
  inactive both samples; hotend/bed targets 0/0 both samples; live position
  byte-identical (`[296.5, 153, 150.0436…]`). PASS — no abort.
- **Deploy**: `./deploy.sh` exit 0. Local gates (bun install/lint/test/build)
  passed inside the script. Archive 273153 bytes, SHA-256
  `9980f3f342d5b6062a659cbf35426c83b0d5032b12c28a1fd623b2814dddb6ce`; remote
  size+hash matched; staged file list matched dist; atomic swap OK; live HTML
  and every referenced asset verified over HTTP. No auto-rollback occurred.
  Persistent backup `fluidd-before-20260804T142354Z.tgz` (161085 bytes,
  SHA-256 `ad9808a3…9248f32`, 32 files, retained=5, pruned=1).
- **On-device verify** (headless Chromium against the live device through a
  loopback TCP forward — macOS local-network permission blocks Chromium from
  LAN IPs; node/curl unaffected — at 1280x800 and 800x480):
  - Computed body font-family `Inter, "Inter Fallback", system-ui, …`; numeric
    instruments render Inter with `font-variant-numeric: tabular-nums
    slashed-zero`. No time-of-day/ETA clocks are on screen while idle
    (no active job), so tabular proof is from the numeric instruments.
  - Readiness silhouette present, SVG rendered, visible at both sizes.
  - Swiss grid intact (6–7 grid containers), no horizontal overflow at
    either viewport.
  - **Zero console errors** at both viewports (initial run showed webcam
    ERR_CONNECTION_REFUSED — an artifact of the loopback forward missing
    port 8080; forwarding it cleared all errors; camera streams LIVE).
  - Live-tick proof: WebSocket `/websocket` open, **75 frames received in
    the 15 s window** between temp samples 14:29:43Z (hotend 25.8 °C, bed
    24.0 °C) and 14:29:58Z (identical at 0.1° display resolution; raw
    Moonraker samples earlier drifted 25.79→25.83 °C). UI is live-updating.
  - **LINK READY** shown in the status rail at both viewports; header shows
    Connected.
  - Screenshots: `k1max-live-1280x800.png`, `k1max-live-800x480.png`
    (session scratchpad).
- **Rollback armed**: post-deploy `fluidd.previous/index.html` SHA-256 equals
  the pre-deploy anchor exactly (`3e7eb1ba…331b317`); new live index SHA-256
  `942e0b611a148a6f240e13fbf37edb154c01bd87fd089570d976c14e8d28e0ec`; 5
  backups retained. Rollback command:
  `PRINTER_HOST=<printer-host> PRINTER_PASSWORD=$PRINTER_PASSWORD ./deploy.sh --rollback`.

## Final gate validation — 2026-08-04, `5324d46`

Deploy-gate re-check at exact HEAD `5324d468def28bd564a84623e0daa17806eeb460`.
Working tree was clean against this HEAD (no tracked-file diff; local `main`
even with `origin/main`). Only untracked, user-owned/tooling paths present
(`scripts/`, `.a5c/`, `.claude/`, `CLAUDE.md`, build caches) — left
untracked, not staged.

- `bun run lint` — exit 0.
- `bun run test` — exit 0 (277 unit tests pass, `deploy.test.sh` 11/11,
  `setup.test.sh` pass).
- `bun run build` — exit 0.
- `bun run test:e2e` — exit 0, **151/151 passed**, above the 143 baseline
  (no shrink).
- Frozen files (`printerActions.ts`, `moonraker.ts`, `safety.ts`,
  `deploy.sh`, `scripts/`) untouched — confirmed via clean `git diff`.
- `e2e/concentricity-law.spec.ts` re-run in isolation: 5/5 passed, including
  the subject-pair-count floor test — no selector rot.
- `e2e/instrument-cluster.spec.ts` "Tell-tale cluster — SD1 lamp block"
  re-run in isolation: 6/6 passed (uniform cell sizes, icon-only
  engine-light rendering verified).
- Grepped tracked files at this HEAD for the literal printer password: no
  matches — password stays clean of tracked history at HEAD (see prior
  scrub entry for the historical-commit caveat, still unresolved; provide
  the password only via `$PRINTER_PASSWORD`, never a literal).
- No console errors observed in the e2e run (`console-hygiene.spec.ts`
  passed as part of the full suite).

## Deployment — 2026-08-04, `81f2084` live on the K1 Max

Deployed HEAD `81f2084b1f1a50d6eeb3d52763a2a93c7d9437cd` (identical to
`origin/main`, tracked tree clean) to `<printer-host>` via `./deploy.sh` only.
Credentials supplied solely through `$PRINTER_PASSWORD` (never a literal).

- **Preflight**: `PRINTER_HOST=<printer-host> ./deploy.sh --preflight` exit 0
  (klipper ready, print `cancelled`, activity Idle, no SD job).
- **Double idle check immediately before deploy** (read-only Moonraker
  samples at 18:07:40Z and 18:07:50Z, 10 s apart): extruder/bed targets
  0.0/0.0, `print_stats` cancelled, `idle_timeout` Idle, `virtual_sdcard`
  inactive, `motion_report.live_position` byte-identical
  `[296.5, 153.0, 150.044]` — position static. Deploy proceeded immediately.
- **Deploy**: internal gates green (`bun install/lint/test/build`); archive
  size + SHA-256 verified after upload; staged file list matched local
  `dist` exactly; persistent backup
  `fluidd-before-20260804T180827Z.tgz` (SHA-256 `6ca01b9d…c70d00`,
  34 files, 5 retained / 1 pruned); atomic swap; live HTML plus every
  referenced asset verified over HTTP. Success epilogue printed
  (`Deploy verified`), and post-state confirms the exit-0 path: staging
  slot and upload tarball removed (only happens after verification).
- **Hashes**: live `/usr/data/fluidd/index.html` SHA-256
  `2130c3f472251c3835281eea7809864e732a55bada8b0e1f839ab33aab99b582` ==
  local `dist/index.html` exactly; `fluidd.previous/index.html` ==
  pre-deploy live anchor `942e0b61…8e0ec` exactly.
- **On-device QA** (read-only browser over a loopback SSH forward, at
  1280x800 and 800x480): **six distinct nested rounded pairs spot-measured
  live** with the repo's own `CONCENTRICITY_PROBE`/classifier — readiness
  module in instrument panel (1280: inner 4, outer 16.8, gap 13.8; 800:
  inner 4, outer 14, gap 11), jog-distance control group in instrument
  panel (inner 4, outer 14, gap 11), two modal buttons in the readiness
  disclosure `modal-panel` (inner 4, outer 12, gap 9), more-sheet button in
  `modal-panel` (inner 4, outer 12, gap 9) — **0 violations** in every probe
  across Home/Files/Control/Settings plus opened disclosures; the law holds
  on device within the ±1px tolerance.
- **Zero console errors and zero page errors** at both viewports across all
  probed routes (webcam port forwarded, so no spurious stream errors; the
  known thumbnail 404 did not reproduce).
- **Live-tick proof**: hotend aria-label ticked 27.8 → 27.7 °C within 3 s at
  1280x800 — telemetry is live-updating.
- **LINK connected**: `LINK READY` (green) in the status rail at both
  viewports; header shows Connected; the "Link Lost" tell-tale lamp cell is
  present but unlit (`data-lit="false"`), as designed.
- Screenshots: `live-81f2084-1280x800.png`, `live-81f2084-800x480.png`
  (session scratchpad).
- One dropbear auth flake on a post-deploy read-only check; a single retry
  succeeded (known memory-pressure flake — live assets unaffected).
- **Rollback armed**: `fluidd.previous` holds the prior verified release
  (anchor hash match exact). Rollback command:
  `PRINTER_HOST=<printer-host> PRINTER_PASSWORD=$PRINTER_PASSWORD ./deploy.sh --rollback`.

## Final gate validation — 2026-08-04, `8cd188e`

Deploy-gate check at exact HEAD `8cd188e654da6133317b74747b920e986cd11fc3`
(`fix: give lit tell-tales a structural channel under forced colors`), the
sync target carrying the test-law and forced-colors work (`ed4bf53`,
`5b4c153`, `8cd188e`) on top of live `81f2084`. Working tree clean against
this HEAD (no tracked-file diff; local `main` even with `origin/main`). Only
untracked, user-owned/tooling paths present (`scripts/`, `.a5c/`, `.claude/`,
`CLAUDE.md`, build caches) — left untracked, not staged.

- `bun run lint` — exit 0.
- `bun run test` — exit 0 (277 unit tests pass across 25 files, 0 fail;
  `deploy.test.sh` and `setup.test.sh` pass).
- `bun run build` — exit 0, `dist/index.html` produced.
- `bun run test:e2e` — exit 0, **153/153 passed** (7.8m), above the 143
  baseline (no shrink). Provenance note: a first background attempt at this
  gate stalled and was killed (its recorded 143 was the SIGTERM, not a test
  result); the citable run is the fresh synchronous re-run executed after
  freeing an orphaned `vite preview` left on port 4173 by the killed
  attempt. lint/test/build exit codes are from completed runs with logs
  retained in the session scratchpad (`gates/`).
- Grepped tracked files at this HEAD for the literal printer password: no
  matches — credentials remain `$PRINTER_PASSWORD`-only in tracked content
  (historical-commit caveat from the prior scrub entry still stands).

## Deployment — 2026-08-04, `8cd188e` live on the K1 Max

Deployed the validated `8cd188e` tree to `<printer-host>` via `./deploy.sh`
only. The working tree at deploy time sat at `7f068a5`, which is `8cd188e`
plus this file's validation record — a docs-only delta, so the built UI
assets are exactly the `8cd188e` source. Credentials supplied solely through
`$PRINTER_PASSWORD` (never a literal).

- **Preflight**: `PRINTER_HOST=<printer-host> ./deploy.sh --preflight`
  exit 0 (klipper ready, print `cancelled`, activity Idle, no SD job).
- **Double idle check immediately before deploy** (read-only Moonraker
  samples at 19:20:12Z and 19:20:22Z, 10.3 s apart): extruder/bed targets
  0.0/0.0, `print_stats` cancelled, `idle_timeout` Idle, `virtual_sdcard`
  inactive, `motion_report.live_position` byte-identical
  `[296.5, 153.0, 150.044]` — position static. Deploy proceeded immediately.
- **Deploy**: exit 0 (captured in bash). Internal gates green
  (`bun install/lint/test/build`); archive 273972 bytes, SHA-256
  `3ae29775…88d6d`, remote size + hash verified after upload; staged file
  list matched local `dist` exactly; persistent backup
  `fluidd-before-20260804T192050Z.tgz` (SHA-256 `7699fc12…38da0b`, 34 files,
  5 retained / 1 pruned); atomic swap; live HTML plus every referenced asset
  verified over HTTP; `Deploy verified` epilogue printed, and post-state
  confirms the exit-0 path (staging slot and upload tarball removed).
- **Hashes**: live `/usr/data/fluidd/index.html` SHA-256
  `a6047861e5978bd6d27b64676704a3645bd422626a2b43d3b25873ee3faa89ab` ==
  local `dist/index.html` exactly; `fluidd.previous/index.html` == the
  pre-deploy live anchor `2130c3f4…b582` (the verified `81f2084` build)
  exactly.
- **Rollback armed**: `fluidd.previous` holds the prior verified release
  (anchor hash match exact). Rollback command:
  `PRINTER_HOST=<printer-host> PRINTER_PASSWORD=$PRINTER_PASSWORD ./deploy.sh --rollback`.
- **On-device QA** (read-only Chromium through an in-process loopback relay
  to the printer's own nginx — Chromium is LAN-blocked by macOS local
  network privacy; the relay was opened and closed inside each
  self-terminating verify script, no persistent tunnel): at **1280x800 and
  800x480** — **zero console errors, zero page errors, zero failed
  requests**; no horizontal overflow at either viewport.
- **Live-tick proof**: hotend aria-label ticked 27.6 → 27.5 °C within 6 s
  at 1280x800 — telemetry is live-updating.
- **LINK connected**: `LINK READY` (green) in the status rail at both
  viewports; header shows Connected; camera streams live.
- **Tell-tale cluster spot-check** (the subject of `8cd188e`): all 8 cells
  render (Thermal Runaway, Heater Fault, Firmware, Link Lost, Fan Fault,
  MCU Hot, Mesh Active, Homed XYZ); `Mesh Active` lit, `Link Lost` present
  but unlit as designed. The new structural channel verified live: under
  emulated forced colors exactly the lit cell's `.instrument-label` carries
  `text-decoration: underline` and all seven unlit labels stay bare; under
  the normal palette no underline appears (severity color carries state) —
  the lit/unlit law holds on-device on both sides.
- Screenshots: `live-8cd188e-1280x800.png`, `live-8cd188e-800x480.png`
  (session scratchpad).

## Flatten + de-glow — 2026-08-04 (owner-directed reversal slice)

Owner direction, verbatim: *"for elements like telemetry and thermals, please
remove the backgrounds on each element so it is cleaner, instead ensuring even
spacing between elements and from the sides left right top bottom."* and
*"remove glow on the dials as well."* Four commits: de-glow, flatten, spacing
rhythm, flat press states. This section AMENDS earlier ledger entries rather
than letting the code silently contradict them.

**Reversals (decisions that were deliberate and are now deliberately undone):**

- **Binnacle instrument-well recession (SD1 §1.2, WP-BINNACLE) — REVERSED.**
  `.instrument-well` (fill, border, inset recession) is deleted with both call
  sites. There is no fascia plane: instruments sit flat ON the panel,
  separated by space. Its complement, `.instrument-panel`'s raised inset
  highlight, goes with it. The panel spec's §1/§5 well rows are now web/panel
  divergences until the panel follows.
- **Telemetry hairline grid — REVERSED.** The 1px-gap-over-border-color table
  with per-tile fills becomes a real gap (`--card-pad`). Incidental finding
  recorded: that rule had been LOSING a specificity tie (0-1-0 vs 0-1-0, same
  layer, source order) to `.instrument-well`, so Telemetry had shipped two
  different tile backgrounds side by side since the wells landed. The flatten
  removed the defect by construction.
- **Forced-colors glow contract — RETIRED WITH ITS SUBJECT.** The contract's
  four e2e tests are deleted, not weakened, because the class they pinned no
  longer exists. The underlying lesson is restated as a general rule: **never
  `display: none` a class applied to load-bearing geometry** — kill the
  decoration, keep the geometry. A no-filter sweep and a stylesheet-level
  guard (the CRT family cannot be re-adopted) replace them.
- **The oklab color-mix law — NOT reversed; it outlives its subject.** The
  glow that exposed the polar-mix bug is gone; the law binds the remaining
  mixes and its canonical statement moved to `--color-accent-soft`
  (index.css), with `tests/accentDefault.test.ts` still enforcing it.
- **Two-up dial arithmetic re-derived.** 174px (= 148 floor + well
  padding/border) → 148px flat; the 800x480 short-viewport chrome trade
  (166px + 8px padding) is deleted outright — the flat threshold fits the
  panel with ~46px to spare. The owner's square dial modules
  (`aspect-ratio: 1`) STAY — the flatten removed fills, not the square grid.
- **Track legibility retune, not a compliance fix.** 60 fg/bg pairs measured;
  nothing crosses a WCAG threshold in either direction. `--color-gauge-track`
  0.26 → 0.282 and `--color-gauge-tick-minor` 0.34 → 0.362 preserve the exact
  +0.097 L step each had over the deleted well. Measured live at 800x480:
  track vs surface 1.29:1 (an empty gauge still reads empty — the release
  claim above survives with a new number), gauge-tick 3.94:1 (≥3:1 holds).
- **One spacing rhythm.** `--page-gutter` = `clamp(0.625rem, 1vw, 1rem)`,
  `--grid-gap` aliased to it; tile gap inside a card = `--card-pad` = the
  card's padding; App shell's compact bottom clearance drops its `+0.5rem`
  double-count (the whole cause of the 2x bottom inset). Measured: insets
  even within 0.25px on all four sides at 390 / 800x480 / 1280, and pinned by
  a new e2e rhythm law.
- **"Fit, not scroll" at 1280x800 — claim corrected, not forced.** Measured
  live: the square dial modules (~290px + header) plus the 16:9 camera exceed
  the 696px glass budget, so 1280x800 scrolls by design; a true fit would
  require reversing the owner's squares. The stale comment was the defect.
- **Flat press grammar.** Interactive instrument surfaces (latched tell-tale
  cells, the readiness module) drop the hover fill for ink-brightening under
  `@media (hover: hover)`; press = the app's existing `translateY(1px)` sink
  plus a 2px inset accent rule; focus law untouched; 44px floors untouched.
  Honest gap, mitigated not solved: a flat latched cell has no resting touch
  affordance — the ACK affix now renders in the accent for exactly that
  reason.
- **Concentricity sweep recalibrated.** Flat tiles draw no corners, so their
  pairs lawfully left the law's domain: the 800x480 panel pair floor moves
  50 → 36 (measured 46 post-flatten vs 64 before). The law itself is
  unchanged and still passes with zero violations.
- Lit/unlit lamp discrimination re-verified after the de-glow: three channels
  under normal palettes (severity color, stroke weight, label ink), two under
  forced colors (weight, label underline) — the glow was never a channel, so
  the counts are unchanged and still e2e-pinned.

## State honesty — 2026-08-04 (P0 truthfulness slice from the flatten audit)

One disease, ten symptoms: **the UI asserting something about the machine that
is not true.** On a printer-control app that is the highest-severity class
there is, so this slice landed ahead of the remaining polish work. Every fix
is pinned by `e2e/state-honesty.spec.ts` (13 tests, all against the strict
harness that fails the run on any write or any request leaving the fixture).

**The one that could change machine behaviour, fixed first.** `Tune.tsx`'s
`state.extruder?.pressure_advance ?? 0.04` did not merely *display* an
invented number — **Apply wrote it to the printer.** A user opening Tune
before the first extruder push, dragging the slider and pressing Apply was
sending a fabricated baseline to hardware. The fallback is gone: unknown
stays `null`, the readout renders `—` with `data-pa-known="false"`, the
slider and both Apply buttons are disabled, `aria-valuetext` says "Unknown",
the hint reads "Current: unknown — waiting for extruder telemetry", and
`applyPa` returns early on a null value as a second, independent guard.

**The rule this establishes, stated once so it is not re-litigated:** a
plausible default is not a safe default. Where a value describes the machine,
UNKNOWN must render as unknown and must disable anything that would transmit
it. `??` on telemetry is a defect unless the fallback is itself the truth.

The other nine, each a case of the same rule:

- `Dashboard.tsx` — `(speedFactor ?? 1) * 100` and `(flowFactor ?? 1) * 100`
  lit a confident **100%** segment strip off no `gcode_move` at all, in
  **basic** mode. Now `null` flows to `SegmentGauge`'s existing unknown
  state, the way `hotendPower` already did on the very next line.
- `Control.tsx` — `state.toolhead?.position ?? [0, 0, 0, 0]` made all six
  `?? "—"` guards **unreachable**; X/Y/Z read `0.00` with zero toolhead data.
  Default dropped, guards now fire. The bed-view marker additionally requires
  finite coordinates before it is drawn, and renders "Position unknown"
  rather than pinning the toolhead to the origin — a homed machine whose
  position has not arrived is exactly the state where 0,0 is a lie.
- `Console.tsx` — one control carried **four contradictory claims**: labelled
  "Clear", titled "Refresh", drawn as `Trash2`, wired to `location.reload()`.
  It now clears the console view and nothing else: no reload, so an unsent
  command, the armed expert mode and scroll position all survive. The
  transport's rolling buffer is not ours to destroy, so the clear is a view
  mark on `line.ts`; the button disables itself when there is nothing to
  clear rather than pretending there is.
- `safety.ts` — `busyReason = \`Print ${printState}\`` composed the raw
  klipper word onto a label and rendered the Files page's **primary CTA as
  "Print printing"**. Mapped to "Printing now" / "Paused". This is the one
  string changed in `safety.ts` this pass; the guard logic is untouched.
- `BedMeshHeatmap.tsx` — `probed_matrix: [[]]` passes a length check, so
  `Math.min(...[])` (Infinity) and `sum/0` (NaN) reached the glass as the
  literal strings. A new `hasProbePoints` requires one finite sample before
  a mesh is claimed at all, statistics filter to finite values, and every
  formatter falls back to `—`.
- `PrintHistory.tsx` — `new Date((end_time ?? start_time) * 1000)` printed
  **"Invalid Date"**, which is a stack trace wearing a date's clothes.
  Guarded to `—`.
- **A11y, three sites where state existed only in pixels.** The bed mesh had
  no non-visual representation at all (colour fills plus numerals in
  `mix-blend-luminosity`, a channel whose contrast is unmeasurable by
  construction): it now carries an `sr-only` table with the true min, max,
  peak-to-peak range and every probed height by row and column, and the heat
  map itself is `aria-hidden` — the table *is* the accessible truth, not a
  paraphrase of it. `Control.tsx`'s per-axis `●`/`○` and `AppBar.tsx`'s
  connection state both relied on `title` on a **non-interactive** element,
  which reaches no assistive tech; both now carry real `sr-only` text, and
  the app bar's link word is `sr-only sm:not-sr-only` instead of `hidden`, so
  the 390px phone and the K1's own 800x480 panel stop losing it entirely.
- `BedMeshHeatmap.tsx` — the stat labelled **"Variance"** computed
  `max − min`, which is the range. Renamed "Range (p-p)"; the wrong word was
  itself a small untruth.

**Corrected while verifying, recorded so the correction is visible:** the
audit's `Control.tsx` division finding stays downgraded — `safety.bounds`
resolves from the `k1max` profile literal, so `sizeX`/`sizeY` are non-zero
constants today. The real defect on that line was the fabricated position,
and the marker's new finite check covers the degenerate-profile case anyway.

## Panel consistency — 2026-08-04 (press verb, engine light, glyph budget)

Three cross-surface items from the same audit, landed with the state-honesty
slice because they share its files.

- **The press verb is now app-wide (P1-6 / spec §A.2c).** `active:translate-y-px`
  inside `buttonStyles.ts` was the **only** `:active` rule in the codebase, so
  25 hand-rolled `<button>`s had hover feedback and nothing else — and hover is
  a state a finger never produces. On the K1's own panel, press is the only
  confirmation a target was hit, so that was the worst possible place to be
  silent. A single `.press-flat` component class now carries the verb the
  flatten pass defined (the 1px geometric sink plus a 2px inset accent rule
  along the bottom edge — a rule, not a box: no corners, encloses nothing) and
  every raw button opts in. Safe by construction: nothing touches the box
  model, so the 44px floors hold; `transform` survives forced colors even
  though `box-shadow` does not, so the press keeps a channel there; `:active`
  is a state rather than an animation, so reduced-motion leaves it instant.
  Pinned by a new **press law** in `button-law.spec.ts` that sweeps six routes
  for a button with neither `ui-btn` nor `press-flat`, and separately asserts
  the CSS rule itself exists — a class name with no rule behind it would
  satisfy the sweep and change nothing on the glass.
- **`.status-lamp` is DELETED (D-4).** The engine-light direction removed lamp
  chrome from the panel kit; the web still drew the 6x6 pip in nine places.
  Every one was `aria-hidden` decoration sitting beside the word it
  duplicated, so the word simply took over the severity ink. **This closes the
  known-minor carried since `8cd188e`** (a lamp is nothing but its background,
  forced colors strips author backgrounds, measured lamp-vs-backdrop contrast
  was 0) — closed at the source rather than by patching a CanvasText repaint
  onto it. Two sites gained a channel rather than losing one: the camera badge
  now tints its own status word, and the console's autoscroll toggle reads
  "Autoscroll on"/"Autoscroll off" where the lamp had encoded on/off in colour
  alone. `--radius-lamp` and `.telltale-lamp` **stay** — that one is the
  readiness light chip, where outline-versus-fill *is* the state. The
  forced-colors lamp contract test is replaced, not deleted: it now pins that
  no lamp survives, that no `.status-lamp` rule survives in the stylesheet,
  and that the state WORDS are still legible in high contrast.
- **Idle shows no dead complications (D-3).** See the MissionBar note in the
  state-honesty section; recorded here too because it is the panel's law
  (spec §3) that the web was contradicting outright.
- **Glyph budget (B.4.4).** The two EN dashes (U+2013) at `TellTaleCluster` and
  `PrinterCard` are now the em dash the rest of the app uses for unknowns, and
  `Control.tsx`'s axis-bounds range separator is a plain ASCII hyphen. The
  shared budget is ASCII + `°` + `—` only; U+2013 is outside the converted
  glyph set and would have rendered as tofu the moment this copy was mirrored
  to the panel (the same failure that bit milestone 5 on the jog pad).

## Cross-surface law: dial colour encodes STATE, not identity (D-8)

The audit found the largest semantic divergence between the two surfaces:
the web colours a thermal dial by **state** (heating / stable / above target
/ standby), the panel spec colours it by **instrument identity** (hotend
red, bed yellow, chamber cyan). Same dial, same data, incompatible
encodings — an amber arc means "heating" on one surface and "this is the
bed" on the other, and someone using both will misread one of them.

**Canonical rule for BOTH surfaces: colour by STATE.** The reasoning, not
just the verdict: identity is already carried losslessly by the always-visible
label under every dial, so identity-colour spends the only remaining channel
on information the user already has. State is not carried anywhere else on
the instrument, so state-colour adds a channel instead of duplicating one.
It also keeps the dial consistent with every other coloured element in the
app (segment strips, tell-tales, the mission bar), all of which are already
state-coded. The web already implements this and is unchanged by the rule;
**the panel is the surface that must follow.**

Flagged for owner confirmation before the panel is changed — this supersedes
a written panel-spec decision, so it is recorded here rather than applied to
the panel silently.

## Chamber light control — 2026-08-04, `d497700`..`d065693`

Owner's direction: "wire up light control and look to assume light on during
print (can be manually turned off), and auto turn off light after 10 minutes
after print is complete or inactivity (if manually turned on)."

**What the app now does — and only this.**

- **Manual toggle.** The readiness light chip is the switch. `set-light` is a
  typed printer action that sends `SET_PIN PIN=LED VALUE=1|0`, gated on the
  klipper object the profile declares (`output_pin LED` on the K1 Max) exactly
  the way the KAMP pre-print step is gated. A printer without the pin gets
  nothing on the wire and the chip claims nothing.
- **Auto-ON at print start.** `print_stats.state` crossing into a job fires the
  lamp on once. Not on every telemetry tick, not on resume from pause, and not
  on the first observation after a page load — opening a tab onto a running
  print is not a print starting, and re-asserting there would undo a lamp the
  owner had already switched off. A manual toggle during a job is recorded and
  outranks auto-ON for the rest of that job; it dies with the job, so the next
  print still lights up.

**What the app deliberately does NOT do: the OFF timer.**
`scripts/light-watchdog.py` (user-owned, on the printer, cron every minute)
already implements the owner's auto-off exactly as specified — printing,
paused, `idle_timeout = Printing`, and toolhead movement all count as
activity; after 600s of none, and only if the lamp is on, it sends
`SET_PIN PIN=LED VALUE=0`. It only ever turns the lamp off. A browser-side
off-timer would be a second clock racing the watchdog for the same pin, so
there is none, and both `src/lib/printerActions.ts` and
`src/lib/lightControl.ts` carry a comment saying why nobody should add one.

**HONEST LIMITATION — auto-ON is browser-side only.** `useLightAutoOn` is
mounted in the app shell, so the print-start lamp fires only while a Regolith
tab is open somewhere. A print started from the printer's own panel, from
Fluidd, or overnight with no browser running will NOT light the chamber. This
is stated in the readiness disclosure copy in those terms — a convenience, not
a printer-side guarantee — rather than implied to be automatic. Making it hold
headless means extending the owner's watchdog to also switch the lamp ON when
the printer is active; that is their file and their call, and nothing here
touches it.

**Truth rules kept.** The chip never renders a confident OFF: before the pin
reports it shows a dash and `aria-pressed="mixed"`. A tap claims the new state
only for the round trip — dropped the moment the pin agrees, rolled back if
the command is refused or the printer has no such pin, and self-healed after
6s if the pin never reports at all.

**Structural note.** The chip could not become a control while it lived inside
the card-body button, because a button cannot nest inside a button. The grid
moved to `.readiness-shell`; `button.readiness-module` now spans every cell
(`place-self: stretch`) and still takes the tap everywhere except the chip,
with the readouts set `pointer-events: none`. The Z6 "one interactive surface"
reading is preserved for the disclosure — there are two controls now because
there are two actions. `e2e/swiss-grid.spec.ts` asserted the chip was NOT a
control; that assertion encoded the old "not wired up" state and was replaced
with the non-nesting law it was really protecting.

Gates at `d065693`: lint, `bun test` (295), `bun run test:e2e` (174), build —
all green. The print-start regression test (no `PRINT_START`,
`SET_GCODE_VARIABLE`, or `use_kamp`; `ADAPTIVE_BED_MESH` present) still passes.

## Remaining issues

- Heap grows about 0.1 MB/min under sustained telemetry after the first two
  minutes and does not flatten within a 10-minute window — roughly 6 MB/hour
  for a panel left on the dashboard. This is **pre-existing and unchanged**
  by this pass (the post-change build is marginally lower at every sample),
  and it is not a DOM or listener leak, so attributing it needs a heap
  snapshot diff rather than counters. Worth its own pass before anything is
  left running for days.
- `BrandLogo` statically imports 34 lucide icons for its brand-icon picker,
  and it renders in the app shell, so **9.4 kB of icon path data (2.85% of
  the entry chunk) ships on every cold boot** for a popover that opens only
  when the owner clicks the mark. Deliberately not fixed here: the currently
  selected icon has to resolve from that same map at first paint, so the only
  correct fix is per-icon dynamic import plus a lazy picker, and risking a
  missing brand mark on boot is not worth ~4 kB gzip against a 176ms entry
  download. Revisit if the icon library grows.
- The literal printer password has now been scrubbed from all tracked files at HEAD, but it remains in historical commits (6 commits match `git log -S`) and the repository is PUBLIC. **Rotation of the printer password is URGENT and awaiting owner go.** Decide whether to coordinate a disruptive history scrub after all clones and deployments are accounted for; do not rewrite history ad hoc.
- Firmware/update survival is best-effort only. `/usr/data` persisted this deployment, but the Fluidd updater explicitly owns `/usr/data/fluidd`.
- Guided setup still requires a source checkout, Bun, and `sshpass` when SSH keys are unavailable. A signed/notarized macOS installer or prebuilt release would remove Terminal and package-manager friction, but needs a release/signing pipeline.
- Several uploaded jobs reference a missing 300x300 thumbnail; as of the `68181d0` release the live 404 is `.thumbs/Filament_Swatch_PETG_19m37s-300x300.png`. Regolith falls back to a clear placeholder, but the browser still reports a read-only 404 and it is the only console error on the deployed dashboard. Avoid generating or writing printer thumbnails during release QA; fix this only in the slicer/upload pipeline or through a separately authorized printer-file workflow.
- ~~`deploy.sh` can fail mid-run when dropbear refuses an SSH auth under memory pressure (209 MB total RAM).~~ Addressed: read-only and idempotent steps now retry twice on ssh exit 255 (see "Deployment and rollback"). Mutating steps still fail closed by design, so a refusal landing exactly on the backup, swap, or rollback swap will still abort the run — rerun it. A single reused SSH connection (`ControlMaster`) would remove the remaining exposure but was not attempted here.
- The `Filament_Swatch_PLA-CF_18m36s.gcode` job used for the print-start proof is now recorded on the printer as `cancelled`. That is expected and not a fault.

## Final gate validation — 2026-08-04, HEAD `a89ccd4`

Independent pre-deploy gate, tree quiet first (only the always-untracked
`scripts/`, `.a5c/`, `.claude/`, `CLAUDE.md`, and caches present; nothing
else outstanding). `main` even with `origin/main` at `a89ccd4`, on the
rewritten lineage from `a140447` — no rebase, no reset, no force-push used.

- `bun run lint` — 0 problems.
- `bun run test` — `bun test tests` 295 pass / 0 fail (3480 expect calls),
  `tests/deploy.test.sh` 19/19 ok, `tests/setup.test.sh` passed.
- `bun run build` — `tsc -b && vite build` clean.
- `bunx playwright test`, run in isolation after killing every stray
  Chromium/vite-preview process from earlier overlapping attempts (two
  concurrent `playwright test` invocations against the same port 4173 had
  been silently killing each other's `vite preview` server and producing
  9–25 `ERR_CONNECTION_REFUSED` false failures) — **174/174 passed clean in
  8.0m**, meeting the 153 e2e floor with no shrink. The false failures were
  self-inflicted process contamination from this verification pass, not a
  product regression; recorded here so a future run doesn't waste time
  rediscovering it — never run two `playwright test` invocations against the
  same `webServer` port concurrently.
- `d065693`..`a89ccd4` changes `working.md` only (61 insertions, no code),
  so the functional verification at `d065693` (print-start regression,
  square dial modules ≥148px, no SVG `<text>` in gauges, no residual
  instrument-tile fills or dial/lamp glow, Tune truth fixes, light toggle
  degrade-without-pin, no app-side off-timer) carries forward unchanged to
  this HEAD.
- No literal printer password in any tracked file at this HEAD (grep swept;
  only prose references to "the printer password" and test fixture strings
  like `runtime-only-secret` matched).
- `safety.ts`, `moonraker.ts`, `printerActions.ts`, `deploy.sh`,
  `tests/deploy.test.sh` — no working-tree diff against HEAD; untouched by
  this pass.

**SAFE TO DEPLOY: YES**

## Deployment record — 2026-08-04, HEAD `078d98d`

Deployed under the standing owner authorization after the `a89ccd4` gate
(`078d98d` is that gate's own working.md record; no code changed since).
Host addressed as `<printer-host>` throughout — no mDNS. `deploy.sh` only,
no config/service/watchdog contact, no print started.

- Preflight: `./deploy.sh --preflight` exit 0 (auth via `sshpass -e`,
  printer conclusively idle: `cancelled`, `Idle`).
- Rollback anchor (pre-deploy): live `index.html` sha256 `a604786…`,
  `fluidd.previous` present at `2130c3f…`, newest backup
  `fluidd-before-20260804T192050Z.tgz`.
- Double idle check immediately before deploy, two Moonraker samples 10s
  apart: klipper `ready`, print `cancelled`, idle_timeout `Idle`,
  virtual_sdcard inactive, extruder target 0, bed target 0, toolhead
  position byte-identical across samples. PROCEED.
- Deploy: `./deploy.sh` exit 0 (bash-captured `PIPESTATUS`). Persistent
  backup `fluidd-before-20260805T003545Z.tgz` size 269696 sha256
  `acae1f8…` files 34, retained 5 / pruned 1. Atomic swap OK, every
  referenced asset HTTP-verified, staging cleaned.
- On-device verify (Chromium via SSH tunnel `127.0.0.1:18080→:80` because
  the Mac's local-network permission blocks headless Chromium on the LAN;
  camera port 8080 tunneled too, after which console errors went to zero
  at both sizes — the earlier 5x `ERR_CONNECTION_REFUSED` were tunnel
  artifacts of the untunneled camera port, not the deployment):
  - 1280x800 and 800x480, screenshots in the session scratchpad
    (`regolith-live-1280x800.png`, `regolith-live-800x480.png`).
  - Flattened instruments: all 6 Telemetry tiles computed background
    `rgba(0,0,0,0)` on ground `lab(2.75381 0 0)` — the tile surface IS the
    ground; no residual fills.
  - No glow: `filter: none`, `box-shadow: none` on both dials, their
    modules, and the chip lamp.
  - Dials square: 1280x800 modules exactly 234.2x234.2; 800x480 modules
    176.5x180.3 (aspect-ratio is a documented PREFERENCE — content height
    wins at panel size; dial width 176.5 ≥ the 148px floor).
  - Even edge insets: 12.8/12.8/12.8 at 1280x800; 10/10/10 at 800x480.
  - Light chip vs real LED: Moonraker `output_pin LED` value 0; chip reads
    `LIGHT OFF`, lamp `data-lit="false"`, `aria-pressed="false"`. Match.
  - Zero console errors, zero failed requests at both sizes.
  - Live tick: 107–109 `notify_status_update` WebSocket frames received
    during each viewport session (readout text stayed 26.3°C/24.1°C —
    idle temps hold at 0.1° resolution; the frame stream is the proof).
  - LINK: `Link Ready` (connected + Klipper ready — the connected-good
    state) in the mission bar, green.
- Rollback armed: post-deploy `fluidd.previous/index.html` is exactly the
  pre-deploy live sha `a604786…`; live now `9843e57…` = freshly built
  `dist/index.html` byte-for-byte. `fluidd.next` and the upload archive
  removed. Rollback command:
  `PRINTER_HOST=<printer-host> PRINTER_PASSWORD=$PRINTER_PASSWORD ./deploy.sh --rollback`

## Tailscale status panel — 2026-08-04 (read path investigated, gap documented)

Settings gains an expert-only **Tailscale** panel. It is READ-ONLY, and the
reason is not caution — it is that no control path exists. What was checked,
live, read-only, against the owner's printer before a line was written:

| Candidate path | Verdict |
|---|---|
| `GET /machine/system_info` → `available_services` | Provider is `supervisord_cli`; it lists exactly `klipper`, `moonraker`, `klipper_mcu`. Tailscale is an Entware service (`/opt/etc/init.d/S06tailscaled`), invisible to supervisord — so `POST /machine/services/*` can never act on it. |
| `GET /machine/services` | **404** — not an endpoint. |
| Moonraker `shell_command` component | Loaded (it appears in `/server/info` components), but it is an internal helper for other components. Moonraker exposes no HTTP route that runs an arbitrary command, by design. |
| Klipper `gcode_shell_command` extra | Installed — `RUN_SHELL_COMMAND` is in `/printer/gcode/help`. But it only runs commands DECLARED in the printer config, and the declared set is `beep`, `v4l2-ctl`, the shaper-graph helpers and the Helper-Script backup jobs. Nothing tailscale-shaped. Adding one means editing printer config and restarting Klipper. |
| Moonraker file API over `config` | **Works.** `/server/files/list?root=config` and `/server/files/config/<file>` are read-only GETs the app already speaks. |

So the app cannot run `tailscale status`, and it does not pretend to. The one
real implementation is the file path: the printer publishes
`tailscale status --json` into its config directory once a minute and Regolith
reads it. **That cron job does not exist on the printer today** (verified: the
file 404s), so on a stock machine the panel reads *Not reporting* and prints
the exact one-time setup. Nothing was written to the printer to make this
work — no `moonraker.conf` edit, no `printer.cfg` edit, no service change.

- `src/lib/tailscale.ts` — parser + adapter + the display law. Pure and
  injectable (`readTailscaleStatus(fetcher, signal)`), so the whole path is
  tested without a network.
- `src/components/TailscaleSettings.tsx` — the panel. Mounted expert-only in
  Settings, alongside Host and Backup: this is infrastructure, not a printing
  control.
- Presence is discovered through the directory LISTING, not by requesting the
  file and catching a 404 — the listing carries the `modified` time (the only
  trustworthy basis for staleness) and a printer without the cron job never
  prints a 404 into the console.
- Read cadence: ONE read a second after the panel opens, then only on **Check
  now**. No background poll — Settings already runs four host reads into a
  six-connection pool, and a fifth fired in the opening frame measurably slowed
  navigation away from Settings (measured: +5s a visit, which pushed the
  instrument-cluster geometry sweep from 15.7s to 78s). Freshness survives the
  choice because the document carries its own timestamp: an untouched panel
  still crosses into Unknown on a local clock tick.
- Staleness law: a document that cannot be dated, is older than 3 minutes
  (three missed cron runs), or is dated more than a minute in the future reads
  as **Unknown** and the tailnet address disappears with it. A stale
  "Connected" is worse than an honest "Unknown" — and this printer has already
  had crond silently dead for three months once.
- Never rendered: the auth URL. `AuthURL` is reduced to a boolean at the parse
  boundary and the panel prints `tailscale up` for the owner to run instead.
  No login, logout, exit node, subnet route, funnel or serve is offered.
- No start/stop button. Wiring one would require the owner to declare a
  `[gcode_shell_command …]` in printer config — i.e. to grant the web UI
  arbitrary root commands through the g-code path. `TAILSCALE_CONTROL_AVAILABLE`
  is the single source of that truth; `tests/tailscale.test.ts` pins it false
  and `e2e/tailscale.spec.ts` pins the panel to exactly one button (`Check now`,
  a re-read).

**What the owner would have to install for status to appear** (read-only; it
changes nothing about the tailnet, and Regolith will not run it for you). The
panel prints this verbatim when no document is present:

```sh
cat > /usr/data/scripts/regolith-tailscale.sh <<'EOF'
#!/bin/sh
OUT=/usr/data/printer_data/config/regolith-tailscale.json
TMP="$OUT.tmp"
if [ ! -x /opt/bin/tailscale ]; then
  printf '{"BackendState":"NotInstalled"}\n' > "$TMP"
elif ! /opt/bin/tailscale status --json > "$TMP" 2>/dev/null; then
  printf '{"BackendState":"Stopped"}\n' > "$TMP"
fi
mv "$TMP" "$OUT"
EOF
chmod 755 /usr/data/scripts/regolith-tailscale.sh
ln -sf /usr/data/scripts/regolith-tailscale.sh /opt/etc/cron.1min/regolith-tailscale
/usr/data/scripts/regolith-tailscale.sh
```

That cron directory only fires while Entware's boot hook is intact — the
failure this printer already hit. The panel prints the two-line repair
(`printf '#!/bin/sh\n/opt/etc/init.d/rc.unslung "$1"\n' > /etc/init.d/S50unslung`
+ `chmod 755`) alongside it, because a firmware update can wipe it again.

Gates: `bun run lint`, `bun run test` (27 new unit tests), `bun run test:e2e`
(11 new specs), `bun run build` — all exit 0.

## Final gate validation — 2026-08-05, HEAD `801711b`

Independent final-gate pass ahead of a live K1 Max deploy, quiet tree first
(only the standing untracked set present — `scripts/`, `.a5c/`, `.claude/`,
`CLAUDE.md`, and build caches — nothing else outstanding). `main` even with
`origin/main` at `801711b`; no rebase, reset, or force-push used.

- `bun run lint` — 0 problems, exit 0.
- `bun run test` — `bun test tests` 358 pass / 0 fail (3,738 expect calls),
  plus `tests/deploy.test.sh` 19/19 ok and `tests/setup.test.sh` passed. Exit 0.
- `bun run build` — `tsc -b && vite build` clean, exit 0.
- `bun run test:e2e` — **214/214 passed (10.6m)**, run once in isolation
  (no concurrent `playwright test`/`vite preview` collision). This is above
  the 174 floor recorded at the last hardware-adjacent checkpoint; no shrink.
- `safety.ts`, `deploy.sh`, `src/lib/printerActions.ts`, `src/lib/moonraker.ts`
  — zero working-tree diff against `HEAD`; untouched by this pass, confirmed
  by `git diff HEAD -- <paths>`.
- `scripts/light-watchdog.py` / `.sh` remain untracked and unstaged; not read
  or edited by this pass.
- No literal printer password and no owner LAN IP / tailnet address in any
  tracked file at this HEAD: `git grep` for `password\s*[:=]\s*"..."`,
  `192.168.x.x`/`10.x.x.x` octets, and `ts.net` all come back clean except
  the two placeholder fixtures (`example-printer.example-tailnet.ts.net` in
  `e2e/tailscale.spec.ts` and `tests/tailscale.test.ts`, which are synthetic
  test data, not a real address). `<printer-host>` placeholders remain the
  only host references in docs (25 occurrences).
- Print-start regression: `tests/printerActions.test.ts` still fails if
  `MACRO=PRINT_START`, `SET_GCODE_VARIABLE`, or `use_kamp` is sent during
  print setup; `ADAPTIVE_BED_MESH` is the live KAMP mechanism and is present.
  KAMP defaults on (`kampEnabledFromStorage` treats anything but a stored
  `"0"` as enabled).
- Timelapse mode decision: per-print timelapse is a Moonraker HTTP write
  (`writeTimelapseSettings`, `src/lib/moonraker.ts`) that now carries a hard
  5-second client-side deadline (`TIMELAPSE_WRITE_TIMEOUT_MS`,
  `AbortSignal.timeout`) on top of the existing 15s WS RPC deadline. It sits
  in `applyPrintSetup`'s optional pre-print step list
  (`src/lib/printerActions.ts`), which by construction cannot throw: a
  missing `timelapse` Moonraker component, a rejected write, or a write that
  never answers within its own deadline all resolve to "skip and notify",
  never to blocking `printer.print.start`. `e2e/timelapse.spec.ts` pins both
  the rejected-write and the hung-write (deadline) cases explicitly ("a
  rejected settings write still starts the print" / "a HUNG settings write
  still starts the print — the deadline is the law").
- Tailscale scope: read-only status panel, Expert-only, sourced from a file
  the printer's own cron optionally publishes (`src/lib/tailscale.ts`); no
  control path exists or is offered (`e2e/tailscale.spec.ts` pins exactly one
  button, "Check now"). Staleness law: undated, >3 minutes old, or dated more
  than a minute in the future all read as **Unknown** and drop the tailnet
  address. This HEAD's own change narrows a remaining gap: `BackendState`
  alone used to print "Connected" even when `Self.Online:false` (daemon up,
  coordination server reports no working path); `describeTailscale` now
  reads that combination as a qualified "Running, not seen" warn, while an
  *absent* `Online` field (older tailscale, or a document with no such key)
  still reads Connected, since absence is not contradiction. Covered by
  `tests/tailscale.test.ts` (new assertions this HEAD) and the existing
  `e2e/tailscale.spec.ts` suite.
- Alignment laws: `e2e/telemetry-rows.spec.ts` pins the telemetry row law —
  within a `.telemetry-grid` row, every `.instrument-label` top, every
  `.instrument-value` top, and every present segment-bar top agree within
  1px, regardless of how many tiles in the row carry a bar. Verified across
  390 / 800x480 / 1280 / 2560 in both printing-midjob and cooling-after-job
  scenarios, basic and expert (16 assertions, all passed this run).
  `e2e/swiss-grid.spec.ts` pins the equal-inset rhythm law ("one page rhythm:
  equal insets on all four sides at 390, the K1 panel and 1280") and the
  derived-radius/flat-instrument-fill checks; `e2e/button-law.spec.ts` and
  `e2e/concentricity-law.spec.ts` pin the button and concentricity laws
  separately. All passed this run (214/214 overall).
- Console: `e2e/console-hygiene.spec.ts` passed; no `console.log`/`console.debug`
  found in `src/` outside tests by direct grep.
- Light control: `src/lib/lightControl.ts` still explicitly does not
  implement an app-side off-timer (`scripts/light-watchdog.py`, user-owned,
  owns the off half via cron); the file's own header comment states this is
  a deliberate, permanent boundary, not an oversight. Unchanged this pass.

**SAFE TO DEPLOY: YES**

## User-owned files

- `scripts/light-watchdog.py`
- `scripts/light-watchdog.sh`

Keep both byte-for-byte unchanged, untracked, and unstaged.

## Next steps

1. Rotate the exposed historical printer password; decide whether coordinated history rewriting is worth clone disruption.
2. Keep using fresh guided Check, identity, idle, inactive, zero-target, zero-power, backup, and rollback gates for every later deployment. Recheck exact hashes and zero-write browser QA after each successful static swap; roll back only on deployment verification failure.
3. Produce a prebuilt macOS-friendly release path; sign and notarize when credentials are available.

## Deployment record — 2026-08-05, HEAD `1c50adf`

Deployed under the standing owner authorization after the `1c50adf` gate
(SAFE TO DEPLOY: YES; `1c50adf` is the gate's own record commit on top of
`801711b`). Host addressed as `<printer-host>` throughout. `deploy.sh` only,
no config/service/watchdog contact, no print started.

- Preflight: `./deploy.sh --preflight` exit 0 (auth via `sshpass -e`,
  printer conclusively idle: `cancelled`, `Idle`).
- Rollback anchor (pre-deploy): live `index.html` sha256 `9843e57…`,
  `fluidd.previous` present at `a604786…`, newest backup
  `fluidd-before-20260805T003545Z.tgz`.
- Double idle check immediately before deploy, two Moonraker samples 10s
  apart: klipper `ready`, print `cancelled`, idle_timeout `Idle`,
  virtual_sdcard inactive, extruder target 0, bed target 0, toolhead
  live_position byte-identical across samples. PROCEED.
- Deploy: `./deploy.sh` exit 0 (bash-captured). Local gates inside the
  script: eslint clean, 358 unit tests pass / 0 fail, production build OK.
  Persistent backup `fluidd-before-20260805T044530Z.tgz` size 270508
  files 34, retained 5 / pruned 1. Atomic swap OK, every referenced asset
  HTTP-verified, staging slot and upload archive removed.
- On-device verify (Chromium via SSH tunnel `127.0.0.1:18080→:80`, camera
  `8080→:8080`), 1280x800 and 800x480, screenshots in the session
  scratchpad (`live-1c50adf-{1280x800,800x480}.png`):
  - Telemetry label row alignment: every row measured, label tops
    byte-equal within each row — maxDelta 0.0px in all 7 rows (1280x800,
    two-column) and all 13 rows (800x480, single-column).
  - Mission Status header action cluster (`Print again`): insets vs
    header padding — 1280x800 pad 12.8, gaps right/top/bottom
    12.8/12.8/13.8 (bottom includes the header's 1px border ⇒ 12.8);
    800x480 pad 10, gaps 10/10/11 (⇒ 10). Even within the law's 1px.
  - Bed Power: half-width tile at 1280x800 (gauge 234.2px in a 481.2px
    grid); at 800x480 the whole telemetry grid is a single 363px column
    and Bed Power spans exactly its column like every sibling tile — no
    distinguished full-width strip at either size.
  - Print dialog (opened from Files via Start print; PRINT NOT sent;
    closed via the X): `timelapse-toggle` present with "Record timelapse"
    label at both sizes. Printer re-sampled idle afterward — unchanged.
  - Tailscale panel (expert Settings): honest state — "Not reporting",
    Last report "—", with the one-time on-printer setup text; no
    fabricated status.
  - Flat grammar: all 13 telemetry tiles computed background
    `rgba(0,0,0,0)` on ground `lab(2.75381 0 0)`; dials `filter: none`,
    `box-shadow: none`; modules 234.2x234.2 (square) at 1280x800,
    176.5x180.3 at 800x480 (documented aspect-ratio preference; width
    above the 148px floor).
  - Zero console errors, zero failed requests at both sizes.
  - Live tick: 40 `notify_status_update` frames received during each 10s
    observation window; readout text changed across the window.
  - LINK: `Link Ready` in the mission bar, green.
- Rollback armed: post-deploy `fluidd.previous/index.html` is exactly the
  pre-deploy live sha `9843e57…`; live now `f600ff5…` = freshly built
  `dist/index.html` byte-for-byte. Rollback command:
  `PRINTER_HOST=<printer-host> PRINTER_PASSWORD=$PRINTER_PASSWORD ./deploy.sh --rollback`

## AI assistant removal — 2026-08-05 (owner: "remove the assistant feature for now")

The opt-in AI assistant (gateway + flags + explain + post-mortem) is removed
in this commit, cleanly and reversibly. The feature last exists intact at sha
`304afca` (this removal commit's parent); to restore it, `git revert` this
removal commit, or cherry-pick the deleted files from `304afca`.

Deleted (everything that existed only to serve the assistant):

- `src/lib/ai/` — `gateway.ts`, `flags.ts`, `explain.ts`, `postmortem.ts`.
- `src/components/AiGloss.tsx`, `AiPostMortem.tsx`, `AiSettings.tsx`.
- The Settings mount (`{isExpert && <AiSettings />}`) — no empty section or
  dangling expert-gated block remains; Backup and Tailscale close ranks.
- MissionTimeline's lazy `AiGloss`/`AiPostMortem` chunk wiring, `explainLine`,
  and the stopped-job gloss block; Console's explain affordance.
- The ESLint safety fence (`no-restricted-imports` on `src/lib/ai/**`) and
  `tests/aiImportFence.test.ts` — the fence guarded an import path that no
  longer exists; a rule for deleted code is cruft. **If the assistant is
  restored, restore the fence and its test in the same commit** — the fence
  is the reason AI output could never reach the printer. Also removed the
  `__*__` synthetic-file lint ignore that existed only for that test.
- `tests/aiGateway.test.ts`.
- e2e: the two "Assistant defaults" tests in `e2e/track-a.spec.ts`; the
  Assistant-heading assertions in `e2e/regolith.spec.ts` (replaced with the
  equivalent Expert-gating assertion on "Backup & Restore" so the Basic/Expert
  toggle behaviour stays pinned); the four `forge.ai.*` corrupt-key seeds in
  `e2e/resilience.spec.ts` (no reader exists any more).

**e2e baseline: 214 → 212.** This is the one sanctioned shrink: exactly the
two deleted "Assistant defaults" tests, nothing else. Recorded here so the
new baseline is explicit and auditable, not silent erosion.

**Deliberately NOT removed — the two default-on math features that were never
labelled AI:** the calibrated ETA (`src/lib/jobProgress.ts` + job history
calibration) and the thermal-slope heuristics feeding `src/lib/health.ts`.
Both stay on by default. Verified after removal: `bun test` targeted run of
`thermalSlope`/`jobProgress`/`jobCalibration`/`health` — 80 pass, 0 fail —
and the three "Calibrated remaining time" e2e tests passed in the full run.

localStorage: the persisted `forge.ai.{endpoint,key,model,disabled,feature.*}`
keys become dead data. Existing values are left alone (harmless), but nothing
reads them and no code path can resurrect the feature — verified against the
built bundle: zero AI chunks in `dist/assets`, zero `forge.ai` references.

Gates at this commit, all run to completion: `bun run lint` exit 0;
`bun run test` 336 pass / 0 fail (26 files); `bun run test:e2e` 212 passed
(10.5m), exit 0; `bun run build` exit 0.

## Dial segmentation — 2026-08-05, HEAD `37e878a`

The dial value channel (`src/components/Dial.tsx`) moves from a continuous
SVG arc to 24 discrete arc segments (10° each, 70/30 duty, butt caps) on the
unchanged `TRACK_R`/viewBox geometry.

**Why 24, not the telemetry strip's 20:** the strip's `SEGMENT_COUNT = 20`
(`src/components/segmentScale.ts`) gives 5% resolution across a straight
bar, where segment count is free to pick for readability alone. The dial is
a 300°, not 360°, arc with major graduations every 30° (10 ticks). 24
segments of 10° each means every 30° graduation lands exactly on a segment
boundary — 20 segments (15° each) would not divide evenly into 30°
graduations and would produce off-boundary ticks. 24 also keeps each
segment's *apparent* size within a pixel of the strip's own segment size at
the shared 148px floor, so the two instrument families read as one visual
system rather than two different tick densities. `DIAL_SEGMENT_COUNT = 24`
is a separate constant from `SEGMENT_COUNT`, deliberately — they answer
different geometry questions and coupling them would be an accidental
coincidence, not a rule.

**Mapping is strictly discrete:** both the lit count and the target index
route through the same exported `litSegments()` the strips use (called with
`count = 24`), so `lit = round(clamp((value − min) / (max − min)) * 24)` —
no fractional segment, no partial-lit terminal segment. The HTML readout
(the numeric temperature) carries the actual precision; the dial face is
honestly stepped, matching what a duty-cycle instrument actually is.

**The target index stays UNSNAPPED**, at its true continuous angle — target
temperature is a setpoint, not a discretized reading, and snapping it to a
segment boundary would be false precision in the other direction (implying
the printer only accepts 24 discrete target values, which it does not). The
index keeps the strip's index grammar (2px wide, r 64→84) and stays a
`<line>` so existing selectors survive.

**Delta band renders per-segment**, in the same 22% ink used elsewhere, so
it can never disagree with the segments it visually spans — `active-states.spec.ts`
pins the exact arithmetic (hotend 48.3° of 300° → 4 lit segments, target
220° → index 18, so exactly 14 segments carry the delta tint).

e2e: `e2e/segmented-instruments.spec.ts` (new) pins the fixed 24-count
across the responsive matrix, exact lit arithmetic, unknown-value-lights-nothing,
unsnapped target-index angle, delta === |Δlit|, the panel-size segment
floor, flat grammar (no filter/fill), forced-colors countability (lit vs
unlit differ by geometry, not just color), and reduced-motion collapse.
`e2e/active-states.spec.ts` repaired in place (no net test-count change) to
select `.gauge-segment[data-lit="true"]` instead of the deleted continuous
`path[stroke="currentColor"]`.

## Range bars — 2026-08-05, HEAD `57cda2b`

Per the segmented-dials spec's factor audit, of the 13 telemetry factors on
`src/pages/Dashboard.tsx`, exactly 8 have a real, printer-published (or
structurally known) range and get a `SegmentGauge` strip; the other 5 have
no such range and stay numeric `MetricTile`s with **zero** `<svg>` — not a
faded/ghost bar, not a synthesized default ceiling.

| Factor | Bar? | Range source |
|---|---|---|
| Chamber | yes | printer's own `chamber.maxTemp`; **no bar at all** if the profile omits it (deleted the old `?? 80` invented ceiling) |
| Part Fan | yes | fixed 0–100% duty |
| Speed Factor | yes | 50–150% display clamp, index at nominal 100; values beyond the clamp draw a warning caret + `›`/`‹` affix rather than reading as a true 150% |
| Flow Factor | yes | same 50–150% clamp/caret treatment as Speed Factor |
| Live Velocity | yes | printer's own `toolhead.max_velocity`; absent → numeric tile, no bar |
| Position Z | yes | homed axis limits, profile bounds as fallback; **homing-gated** — an unhomed Z is a raw stepper coordinate, so the bar disappears and a muted "unhomed" word explains why |
| Hotend Power | yes | fixed 0–100% PWM duty |
| Bed Power | yes | fixed 0–100% PWM duty |
| Z-Offset | no | no published range — babystep is a signed correction, not a scale |
| Filament | no | no published range for remaining/used length |
| Pressure Advance | no | no published range (this is the same class as the prior fabricated-`0.04` incident — a bar here would invent a ceiling) |
| Max Accel | no | printer publishes a live value, not a bounding range |
| Homed | no | a state word (`XYZ` / `none`), not a scalar |

Zero `<svg>` on all 5 bar-less factors is pinned directly by
`e2e/segmented-instruments.spec.ts` ("the five bar-less factors carry zero
svg in every state — the PA pin"), plus four no-bar-when-unknown fixtures
(profile without chamber maxTemp, absent `max_velocity`, absent axis limits
with a boundless profile, unhomed Z), a mixed-row top-edge law test (bar-less
tiles sit strictly shorter than bar tiles but share the row's top edge), the
over-range marking tests, and the 44px tile floor.

## Final gate validation — 2026-08-05, HEAD `57cda2b`

Independent final-gate pass ahead of a live K1 Max deploy, covering the
three commits since the last deployed HEAD (`304afca`): AI assistant
removal (`c746b35`), dial segmentation (`37e878a`), range bars (`57cda2b`).
Quiet tree first — only the standing untracked set present (`scripts/`,
`.a5c/`, `.claude/`, `CLAUDE.md`, build caches); `main` even with
`origin/main` at `57cda2b`; no rebase, reset, or force-push used.

- `bun run lint` — 0 problems, exit 0.
- `bun run test` — `bun test tests` 337 pass / 0 fail (3,650 expect calls),
  plus `tests/deploy.test.sh` 19/19 ok and `tests/setup.test.sh` passed.
  Exit 0.
- `bun run build` — `tsc -b && vite build` clean, exit 0; `dist/assets`
  carries zero AI chunks and zero `forge.ai` references, confirming the
  removal reached the built bundle.
- `bun run test:e2e` — **231/231 passed (10.8m)**, run once to completion in
  the foreground. Reconciled against the 214 floor: 214 − 2 (the sanctioned
  "Assistant defaults" removal, recorded above) = 212, + 19 new tests from
  `e2e/segmented-instruments.spec.ts` (9 dial tests + 10 range-bar tests,
  added across the two feature commits) = 231. No unexplained drop.
- `safety.ts`, `deploy.sh`, `src/lib/printerActions.ts`, `src/lib/moonraker.ts`
  — zero diff against the deployed `304afca`: `git diff 304afca -- safety.ts
  deploy.sh src/lib/printerActions.ts src/lib/moonraker.ts` empty.
- `scripts/` remains untracked and unstaged (`light-watchdog.py`/`.sh`
  unread, unedited, unchanged).
- No literal printer password, owner LAN IP, or tailnet address in any
  tracked file: `git grep` for a quoted password assignment, private-range
  octets, and `.ts.net` all come back clean except the two synthetic
  placeholder fixtures (`example-printer.example-tailnet.ts.net` in
  `e2e/tailscale.spec.ts` / `tests/tailscale.test.ts`).
- AI feature fully gone: no `src/lib/ai`, `AiGloss`, `AiPostMortem`,
  `AiSettings`, or `forge.ai` references anywhere outside this file's own
  removal record. ETA (`src/lib/jobProgress.ts`) and thermal-slope
  (`src/lib/health.ts`) heuristics — the two default-on math features that
  were never labelled AI — remain present, unit-tested, and covered by the
  "Calibrated remaining time" e2e suite (all passed this run).
- Dials: `DIAL_SEGMENT_COUNT = 24` in `src/components/Dial.tsx`; discrete
  mapping via `litSegments(..., 24)`; target index unsnapped at its true
  angle; dial modules square (`aspect-ratio: 1` in `src/index.css`) and
  clear the 148px floor (`--gauge-size-min: 148px`).
- Range bars: exactly 8 `<SegmentGauge>` usages in `src/pages/Dashboard.tsx`
  (Chamber, Part Fan, Speed Factor, Flow Factor, Live Vel., Position Z,
  Hotend Power, Bed Power); the other 5 factors (Z-Offset, Filament,
  Pressure Advance, Max Accel, Homed) render through `<MetricTile>`, which
  emits no `<svg>`; no default substituted for an unknown range (Chamber's
  old `?? 80` fallback is deleted, not defaulted).
- Print-start regression: `grep` for `PRINT_START`/`SET_GCODE_VARIABLE`/
  `use_kamp` in `src/lib/printerActions.ts` finds only the header comment
  explaining why they're gone; `ADAPTIVE_BED_MESH` (the live KAMP pin) is
  present and defaults on. Timelapse write carries its own 5s deadline
  (`TIMELAPSE_WRITE_TIMEOUT_MS`) layered under the print-start step list,
  which cannot throw — confirmed by the passing "rejected settings write"
  and "HUNG settings write" e2e cases. Light control: `lightControl.ts`
  still explicitly carries no app-side off-timer (owner-owned watchdog cron
  keeps that half). Tailscale: `describeTailscale` in `src/lib/tailscale.ts`
  reads undated / stale (>3min old or future-dated) / absent documents as
  Unknown, never a stale Connected; `e2e/tailscale.spec.ts` (all 11 cases)
  passed.
- Laws: `e2e/button-law.spec.ts`, `e2e/concentricity-law.spec.ts`,
  `e2e/swiss-grid.spec.ts`, `e2e/telemetry-rows.spec.ts`, and
  `e2e/console-clip.spec.ts` (app-wide reachability) all passed this run,
  including the 320 / 800x480 (K1 panel) / 1280 / 2560 floor sweeps inside
  `swiss-grid.spec.ts` and the four-size reachability sweep in
  `console-clip.spec.ts`.
- Console: `e2e/console-hygiene.spec.ts` passed for both basic and expert
  routes, zero console noise.

**SAFE TO DEPLOY: YES**

## Deployment record — 2026-08-05, HEAD `8caf99e` (live instrument release)

Owner standing authorization ("deploy when ready"); gate above issued
**SAFE TO DEPLOY: YES** for `57cda2b`, deployed here as its docs-only
descendant `8caf99e` (identical `src/`/`dist` inputs). Deployed via
`./deploy.sh` only; printer host and password supplied on the command
line as `PRINTER_HOST=<printer-host>` / `$PRINTER_PASSWORD`, never
written to any tracked file.

- **Preflight**: `PRINTER_HOST=<printer-host> ./deploy.sh --preflight`
  exit **0** — writable data root, live slot present, tar/sha256sum, 32MB
  free, Moonraker conclusively idle (`cancelled`, `Idle`).
- **Rollback anchor (pre-deploy)**: live `index.html` SHA-256
  `f600ff543cfb3cdccf74222e0d3b7b68dd31c16bce81392b1df209580c6c6647`;
  `fluidd.previous` present; latest persistent backup
  `fluidd-before-20260805T044530Z.tgz`.
- **Double idle check** (immediately before deploy, two Moonraker samples
  10s apart): both `klipper=ready`, `print=cancelled`, `idle=Idle`,
  `sd_active=false`, extruder target 0.0, bed target 0.0, live/toolhead
  position byte-identical across samples (`[296.5, 153.0, 150.044]`).
  **PASS** — no motion, no heat, nothing queued.
- **Deploy**: `PRINTER_HOST=<printer-host> PRINTER_PASSWORD=$PRINTER_PASSWORD
  ./deploy.sh` exit **0**. Gates re-ran inside the script (lint, unit,
  build), archive size/SHA-256 matched remote, staged file list matched
  local `dist`, atomic swap OK, every referenced asset HTTP-verified.
  New persistent backup `fluidd-before-20260805T070847Z.tgz` (277,699
  bytes, SHA-256 `0c1d2608b37867cc346729bfd34da5168c22f0883494d943335d4e4531b0f465`,
  35 files, retained 5 / pruned 1).
- **On-device verification** (Playwright Chromium against the live UI
  through a loopback SSH forward, both 1280x800 and 800x480):
  - Dials: 2 dials, **24 `.gauge-segment` cells each** at both sizes;
    dial SVG 234.2x201.4px (1280x800) and 176.5x151.8px (800x480) —
    square dial modules clear the 148px floor, dial renderer active (no
    bar fallback).
  - Discrete lit mapping against live temperature: hotend 27.0°C of
    300° → round(2.16) = **2 lit** (observed 2); bed 25.0°C of 120° →
    round(5.0) = **5 lit** (observed 5); stable across two samples 8s
    apart; cross-checked against Moonraker at sample time (27.02/25.01).
  - Target index: not rendered live — both setpoints are 0 and the index
    only exists while a target is active (idle machine stayed cold, per
    the no-heat rule). Deployed `Dashboard-DlV9l8nY.js` chunk confirmed
    to carry `gauge-target-index` with the continuous
    `rotate(${angle}deg)` transform — present and unsnapped in the
    shipped code, and pinned by the passing e2e suite for this build.
  - Range bars: every eligible factor rendered in the current state
    carries a bar (Chamber, Part Fan, Speed Factor, Flow Factor — 4
    `.segment-gauge` strips); the rendered ineligible factors (Z-Offset,
    Filament) carry **zero `<svg>`**; Pressure Adv. / Max Accel / Homed
    tiles are not rendered in the panel's current mode/state, and the
    no-bar pin for all five is enforced by the passing e2e suite.
  - Telemetry rows: per-row top-edge delta **0px** in every row at both
    viewports.
  - No AI settings section: Settings headings are Experience / Theme /
    Timelapse / System; zero `AI` tokens in page text.
  - Console: **zero** console errors / page errors at both viewports.
  - Live tick: 40 (1280x800) and 39 (800x480) WebSocket frames received
    in an 8s window; mission bar reads **Link Ready**.
  - Screenshots retained in the session scratchpad (untracked):
    `verify-1280x800.png`, `verify-800x480.png`,
    `verify-settings-1280x800.png`.
- **Rollback armed**: post-deploy `fluidd.previous/index.html` SHA-256
  equals the pre-deploy anchor (`f600ff54…`), so one command restores the
  exact prior UI: `PRINTER_HOST=<printer-host> ./deploy.sh --rollback`.
- No config/service/watchdog contact; no print started; no G-code sent;
  heaters and motion untouched throughout (idle re-confirmed by the
  double check above).

## Deployment record — 2026-08-05, HEAD `8dae959` (square dial modules)

Owner standing authorization ("deploy when ready"). Tree clean, `8dae959`
even with `origin/main`, gates green before the run (lint 0, unit 0, e2e
235 passed, build 0). Deployed via `./deploy.sh` only; printer host and
password supplied on the command line as `PRINTER_HOST=<printer-host>` /
`$PRINTER_PASSWORD`, never written to any tracked file.

- **Preflight**: `PRINTER_HOST=<printer-host> ./deploy.sh --preflight`
  exit **0** — Moonraker conclusively idle (`cancelled`, `Idle`), no
  remote files changed.
- **Rollback anchor (pre-deploy)**: live `index.html` SHA-256
  `8c8532ce…`; `fluidd.previous` present (18 assets, prior
  `Dashboard-DlV9l8nY.js`); latest persistent backup
  `fluidd-before-20260805T070847Z.tgz`.
- **Double idle check** (immediately before deploy, two Moonraker samples
  11.3s apart): both `webhooks=ready`, `print_stats=cancelled`,
  `idle_timeout=Idle`, `virtual_sdcard.is_active=false`, extruder target
  0.0, bed target 0.0, toolhead position byte-identical across samples
  (`[296.5, 153.0, 150.04364591869918, 53278.616829942934]`).
  **PASS** — no motion, no heat, nothing queued.
- **Deploy**: `PRINTER_HOST=<printer-host> PRINTER_PASSWORD=$PRINTER_PASSWORD
  ./deploy.sh` exit **0**. Gates re-ran inside the script (lint, 337 unit
  tests, 19 deploy/setup shell checks, build), archive size/SHA-256
  matched remote, staged file list matched local `dist`, atomic swap OK,
  every referenced asset HTTP-verified. New persistent backup
  `fluidd-before-20260805T081105Z.tgz` (28 files, retained 5 / pruned 1).
- **On-device verification** (Playwright Chromium against the live UI
  through a loopback SSH forward, both 1280x800 and 800x480):
  - **Square dial modules — the owner-protected property**:
    `.thermal-instrument` tiles measured **234.20 x 234.20 px** at
    1280x800 and **176.50 x 176.50 px** at 800x480 — both dials at both
    sizes, **0.000% off square** (budget 2%). The dial art is not
    stretched to buy it: rendered `.gauge-dial` ratio drifts **0.004%**
    from the authored `0 0 200 172` viewBox at both sizes (SVG boxes
    234.20x201.41 and 176.50x151.78, exactly the authored 1.1628).
  - Dials: 2 dials, **24 `.gauge-segment` cells each** at both sizes.
  - Discrete lit mapping against live temperature: hotend 27.0°C of 300°
    → round(2.16) = **2 lit** (observed 2); bed 25.0°C of 120° →
    round(5.0) = **5 lit** (observed 5); identical at both viewports and
    cross-checked against Moonraker at sample time (27.04 / 25.01).
  - Target index: not rendered live — both setpoints are 0 and the index
    only exists while a target is active (idle machine stayed cold, per
    the no-heat rule). Deployed `Dashboard-6cNiU2Hd.js` chunk confirmed
    to carry `gauge-target-index` with the continuous `rotate(${…}deg)`
    transform — present and unsnapped in the shipped code, and pinned by
    the passing e2e suite for this build.
  - Range bars: every eligible factor rendered in the current state
    carries a bar (Chamber, Part Fan, Speed Factor, Flow Factor — 4
    `.segment-gauge` strips at both sizes); the rendered ineligible
    factors (Z-Offset, Filament) carry **zero `<svg>`**; Pressure Adv. /
    Max Accel / Homed tiles are not rendered in the panel's current
    mode/state, and the no-bar pin for all five is enforced by the
    passing e2e suite.
  - Telemetry rows: per-row top-edge delta **0px** in every row at both
    viewports (3 two-up rows at 1280x800, 6 single-column rows at
    800x480).
  - Console: **zero** console errors and **zero** page errors at both
    viewports.
  - Live tick: 71 (1280x800) and 77 (800x480) WebSocket frames received
    in a 15s window, with Moonraker moving 27.04→27.03 / 25.01→25.03
    across the same window; mission bar reads **LINK READY**.
  - Screenshots retained in the session scratchpad (untracked):
    `deploy-8dae959-1280x800.png`, `deploy-8dae959-800x480.png`.
- **Rollback armed**: post-deploy `fluidd.previous/index.html` SHA-256
  equals the pre-deploy anchor (`8c8532ce…`), so one command restores the
  exact prior UI: `PRINTER_HOST=<printer-host> ./deploy.sh --rollback`.
- No config/service/watchdog contact; no print started; no G-code sent;
  no printer config touched; heaters and motion untouched throughout
  (idle re-confirmed by the double check above).

---

## Deploy — telemetry density (HD-4) + mesh table clip · 2026-08-07

- **Shipped**: `6c17776` (telemetry density / HD-4) and `5807586` (bed mesh
  accessible-table clip). `main == origin/main` at `5807586`, tracked tree
  clean.
- **Gates, real exit codes**: `bun run lint` **0**, `bun run test` **0**,
  `bun run test:e2e` **0** — **240 passed** (baseline 235; +4 from the
  density/reflow/telltale laws, +1 from the new mesh-table law), `bun run
  build` **0**.
- **HD-4 — the bar-shaped hole is removed, not filled.** `.telemetry-grid`
  became two zones: a *scaled* zone keeping the gauges' column rhythm and a
  *readings* zone that packs bar-less factors at their natural size. A tile
  picks its zone from what it actually renders, not its label, so Live Vel.
  and Position Z move zones with the telemetry rather than lying about their
  type. Nothing new was drawn to occupy space.
  - Trend (auto-scaled, no axis/endpoint/track): **Z-Offset**, **Max Accel**.
  - No trend by design: **Pressure Adv.** (flat >99%, would render a dead
    line), **Filament** (monotonic — every rate looks like the same ramp),
    **Homed** (a per-axis boolean, not a scalar).
  - Honesty marks: `[data-range-track]` = declared proportional track,
    `[data-autoscale]` = self-scaled trend. The no-invented-ceiling law
    asserts on the claim a mark makes rather than on "an svg", so it can
    neither go blind nor fire falsely as tiles gain trends. Verified live:
    **0 undeclared `<svg>`** in either zone at both viewports; the readings
    zone carries **0 tracks**.
- **Bed mesh table — an overflow that only existed on a real printer.** The
  accessible `<table>` carried `sr-only` directly. Table layout treats width
  as a minimum and expands to min-content, so the 1x1 clip was ignored: the
  table laid out at its natural **1012px**, stayed in flow, and pushed
  `documentElement.scrollWidth` past the viewport — **+232px @800x480** and
  **+764px @1280** once the heatmap moved into the narrow live-tuning rail.
  The clip now lives on a `<div>` wrapper, which table layout does not
  govern. Every no-overflow law had been green because the fixture publishes
  no mesh, so the table never rendered; `e2e/bed-mesh-a11y-table.spec.ts`
  now publishes a real probed mesh and was confirmed to fail on the old
  markup and pass on the new.
- **Idle proof, both deploys**: two samples ~11s apart — `print_stats`
  `complete`, `idle_timeout` `Idle`, klippy `ready`, extruder and bed targets
  **0**, toolhead position byte-identical across samples. Preflight exit
  **0** (read-only, key auth) before each.
- **Deploy exit code 0** (twice; the second carries the mesh fix). Verified
  live HTML and every referenced asset. Persistent backups written, retention
  enforced (retained=5).
- **On-device verification** at **1280x800** and **800x480**:
  - Card headers: **62.59px** @1280 (pad 8.8) and **57.00px** @800x480 (pad
    6.0) — identical across all six dashboard cards, zero spread; padding
    equal on all four sides (even-inset holds); text gap 20.3/21.3 and
    17.5/18.5 — optically balanced within 1px.
  - Dial modules **square**: **234.2 x 234.2** @1280 and **176.5 x 176.5**
    @800x480 — **Δ = 0.000%**, **24 segments** each, both above the 148px
    floor. (The dial *art* keeps its own authored 0.86 viewBox ratio, as the
    law allows — it is the module that must be square.)
  - Tune: the live-tuning rail exists and is unique. At 1280 Pressure
    Advance's card top **equals** Input Shaper's (**110.8 / 110.8, Δ=0.00**)
    and Bed Mesh sits **below** it (418.78). PA's internal slack is **13.8px
    against its own 12.8px pad** — one card-pad, no stretched glass. Below
    xl the rail stacks (800x480: Δ=703.5), which is the intended no-op.
  - Tell-tales: max glyph offset **0.01px**, max label offset **0.01px**
    from cell centre across all 8 lamps at both viewports.
  - Telemetry: readings zone has **no bars and no tracks**; scaled zone rows
    are uniform; **0 undeclared `<svg>`**.
  - **Zero horizontal overflow** on both Dashboard and Tune at both
    viewports (Δ=0) — the mesh-table regression is gone.
  - Console: **zero** errors and **zero** page errors with the camera live.
  - Live tick: **60 WebSocket frames in 12s** at both viewports with the DOM
    text changing across the window; mission bar reads **LINK READY**.
  - Screenshots retained in the session scratchpad (untracked):
    `final-dashboard-1280x800.png`, `final-dashboard-800x480.png`,
    `final-tune-1280x800.png`, `final-tune-800x480.png`.
- **Rollback armed**: `fluidd.previous/index.html` holds the exact
  pre-deploy build, so one command restores the prior UI:
  `PRINTER_HOST=<printer-host> ./deploy.sh --rollback`
- **Load note**: repeated headless verification passes (each pulling the
  MJPEG stream) drove the printer's load average to 15.5 and briefly timed
  out Moonraker over HTTP. The live build was confirmed untouched by SSH
  throughout; load settled to 3.4 and the final pass blocked the camera
  stream. Worth throttling on-device verification on this SoC.
- No config/service/watchdog contact; **no print started**; no G-code sent;
  no printer config touched; heaters and motion untouched throughout.

## Incident — autorender starved Klipper and hung the printer · 2026-08-12

Shipped as `822fb7a` (the settings write) and `b48003b` (the manual
render). Gates green on both: lint / unit / build exit 0, e2e **246
passed** (baseline 240 + 6 new).

**Severity: the machine had to be power-cycled.** Nothing was lost only
because of when it happened.

### What happened, on the owner's hardware

A 15h33m print finished. moonraker-timelapse's `autorender` was still armed
— the per-print timelapse feature Regolith shipped never touched it — so the
component immediately started an ffmpeg pass over **1873 frames at
1280x720**, with **`-threads 2` hardcoded** (`timelapse.py:684-694`: no
`nice`, no `ionice`, no way to configure it) on a **2-core SoC**. Load
average went **2 → 30**. **28 seconds later** Klipper shut down:

```
MCU 'rpi' shutdown: Rescheduled timer in the past
```

That is host CPU starvation, not a firmware fault: the Klipper host process
could not schedule its own timers because ffmpeg owned both cores. The
machine hung until it was power-cycled. **The print had just finished, so
nothing was lost — the same starvation twenty minutes earlier would have
killed a live 15-hour job.**

### Root cause

Regolith wrote `enabled: true` (and the capture mode) and stopped there. It
treated the rest of a third-party component's configuration as somebody
else's business. But `autorender` is the switch that decides whether the
plugin gets to run an unbounded, unattended, un-niced encode on the printer
the moment a print ends, and its default is ON. Enabling capture without
disarming autorender is enabling the encode. The frame-clearing behaviour
compounds it: **frames are deleted only after a render SUCCEEDS**, so a
failed render leaves the whole backlog queued for the next one — each
attempt bigger than the last.

### The fix

- **Every pre-print settings write now carries `autorender: false`**, in the
  same body that arms recording, in both directions. Same body, never a
  second write that could fail on its own; both directions, because the
  value is one global shared with Fluidd and the stock touchscreen and
  whatever last touched it is never safe to assume.
- **`extraoutputparams: "-threads 1"`** rides along. ffmpeg honours the LAST
  `-threads` on the command line, so this overrides the component's
  hardcoded 2 without patching a third-party file. An owner who deliberately
  set their own `extraoutputparams` keeps them untouched — the write reads
  the current config first for that one field only, and a read that fails
  still gets the disarm.
- **Rendering became an explicit action** on the Timelapses page. It is
  DISABLED with a stated reason while a print is printing, paused, mid-macro
  or queued; it warns what it costs before it starts; it shows the plugin's
  own progress and its terminal success / skipped / error state.
- **The frame backlog is stated out loud** — how many frames are waiting,
  and that they are cleared only by a render that succeeds.

### The rules this buys

1. **No unattended CPU-heavy work on the printer, ever, and absolutely not
   while it prints.** The printer's CPU is Klipper's real-time budget.
   Anything that competes with it is a motion fault waiting for a long
   enough job. If work must happen on the host, the owner starts it, on an
   idle machine, watching it.
2. **Never assume a third-party component's defaults are safe on
   constrained hardware.** They are tuned for a desktop-class host. When
   Regolith turns a component on, it owns every setting of that component
   that can hurt the printer — not just the one that sounds like the
   feature.
3. Corollary, already learned once (see the 2026-08-07 load note) and now
   paid for: this SoC has no headroom. Two cores is the whole budget.

## Deploy — a deadline on the timelapse library read · 2026-08-12, HEAD `9b4eae9`

The video list was the one read on the Timelapses page with no abort
deadline. A browser `fetch` has no default timeout, and a CPU-starved
Moonraker is not an error path: the socket accepts and then never answers,
so no rejection ever arrives on its own. This printer has already been
observed in exactly that state (see the autorender incident above). The
page sat in its loading skeleton forever — the "looks like it is working"
lie this cockpit refuses to render.

### What changed

- **`/server/files/list?root=timelapse` now carries the same 5s deadline**
  as the timelapse settings calls beside it. It is the one fetch on the
  page with no "unknown" to fall back to — it *is* the page — so its abort
  surfaces as a named failure rather than a fallback value.
- **The DELETE carries it too.** A delete that never settles leaves the
  owner watching a file that is neither gone nor reported.
- **An honest failure replaced the eternal skeleton**: "Couldn't reach the
  printer / The printer accepted the connection and then didn't answer
  within 5 seconds. The timelapses on it are unknown, not gone." with a
  **Try again** button. Unknown, never a false empty state — the page must
  not imply the printer holds no videos when it simply did not answer.
- **The render POST stays deliberately unbounded.** The plugin holds that
  request open for as long as ffmpeg runs, which on this hardware is
  minutes; a 5s abort would report "the render did not start" about a
  render that started perfectly, and aborting the fetch would not stop the
  encode anyway. Nothing in the UI takes its truth from that promise — the
  banner and progress bar are cleared by `notify_timelapse_event`.

Every fetch on the timelapse path was enumerated: the frames read and the
job-queue read already had deadlines; the settings read/write already had
theirs; `moonraker.listFiles()` is unbounded but is only used by Files.tsx
with `root=gcodes`, off this path and out of scope.

### Gates — all green, full runs

`lint` 0 · `test` 0 · `build` 0 · `test:e2e` 0, **247 passed** (baseline
246 plus the new regression: a list request that never resolves must end
in the stated failure with a way out, not a skeleton).

### Deploy

`./deploy.sh` only, exit **0**, on a printer confirmed idle by two samples
~10s apart (`standby`, both targets 0, toolhead position byte-identical).
No print was started.

- **Rollback anchor (pre-deploy)**: live `index.html` SHA-256 `08423b98…`
- **Live now**: `index.html` SHA-256 `b42fbe4e…`, byte-for-byte the local
  `dist/index.html`
- **Rollback armed**: `fluidd.previous/index.html` is `08423b98…` — exactly
  the pre-deploy build. Persistent backup also taken (28 files, 5 retained).
  Rollback command:
  `PRINTER_HOST=<printer-host> PRINTER_PASSWORD=<printer-password> ./deploy.sh --rollback`

### On-device verification, 1280x800 and 800x480

Dashboard healthy (READY · standby, live thermals ticking, square dials
segmented, LINK READY, Connected). Timelapses renders; no overflow at
either width. The Render action is present and **enabled**, which is
correct: the gate keys on offline / busy / queued jobs / already-rendering,
and the printer was idle with an empty queue. The disabled-with-reason
state could not be exercised on-device without starting a print, which is
forbidden — it stays covered by e2e.

The shipped fix was proven against the **deployed bundle** by stalling only
the timelapse list at a local proxy (client-side only; the printer was
never touched). Both widths: no skeleton left behind, no false "No
timelapses yet", the stated failure and the **Try again** affordance
present. Zero console errors attributable to the app — the only errors were
`ERR_CONNECTION_REFUSED` from `CameraStream`'s `http://<host>:8080` stream,
an artifact of proxying through localhost, and it degrades honestly to
"Camera unavailable. Retrying…".

**Device state survived the deploy** (read-only check, before and after):
`autorender: false` and `extraoutputparams: "-threads 1"` both intact. The
printer was left in `standby`, idle, with both heaters at target 0.

## Host-health guard — the starvation that masquerades as hardware · 2026-08-12, `1b57891` + `686bfc5`

Built entirely locally while an 8-hour print ran: **zero printer contact,
no deploy** (deploy.sh's idle gate would refuse anyway, and it was not
asked). Owner's ask: "ensure we further run tests to stabilize the system
and prevent this from happening in the future through improvements and
optimizations."

### The two incidents this answers

1. **01:16 — autorender.** Recorded in full above: ffmpeg over 1873 frames
   on the 2-core SoC, load 2 → 30, and 28 s later
   `MCU 'rpi' shutdown: Rescheduled timer in the past`. Power cycle
   required. Root cause: unattended CPU-heavy work on the printing machine
   (a third-party default Regolith had not disarmed).
2. **17:54 — the probe that wasn't broken.** A job died with
   `Unable to obtain 'result_deal_avgs_prtouch' response` — which reads as
   a strain-gauge failure and cost a debugging session on hardware that
   was fine (probe triggered cleanly; MCU link showed 9 retransmit bytes
   in 11 MB). The measured condition underneath, **with no print
   running**: 68 of 127 MB swap in use, 25% iowait, 0% idle. Swap thrash
   on eMMC — the host could not run Klipper on time, and Klipper's error
   named the probe. Root cause: `tailscaled` in userspace-networking mode
   plus memory pressure; stopping it took swap 68 → 31 MB and iowait
   25% → 0%, and the same file then printed cleanly.

### The rule (paid for twice now)

**No unattended CPU-heavy work on a printing machine — and a
host-starvation error will masquerade as a hardware fault.** The error
names a timer, a digital-out event, or the probe; it never names the CPU.
Read every future "hardware" shutdown with that in mind before touching
hardware.

### What shipped

- **Host telemetry from what Moonraker genuinely exposes** —
  `notify_proc_stat_update` (`system_cpu_usage.cpu`, `system_memory`),
  which this client was ALREADY receiving ~1 Hz as its link heartbeat and
  discarding (`moonraker.ts`, the old "ignore — high frequency" branch).
  **Cadence: Moonraker's own ~1 Hz push. Zero new subscriptions, zero
  polling, zero HTTP — the guard adds a ≤130-entry ring and a browser-side
  median, nothing on the SoC.** Swap and load average are NOT exposed and
  are never claimed; because Moonraker folds iowait into CPU%, a thrashing
  host reads as a pegged CPU — the honest proxy, and every string says
  "host busy", never "swap".
- **HOST LOAD tell-tale** (`host-load`, warning severity, LATCHING) — lit
  on ≥85% median CPU over 60 s, or on the motion buffer
  (`toolhead.print_time − estimated_print_time`) collapsing below 0.5 s
  for 10 s while the head is actually moving (velocity-gated; implausible
  cross-clock figures are unknown, never verdicts). Latching is the point:
  the spike is over by the time the owner reads the error. Detail line
  carries the tripping number ("CPU 91% · 60s") — text channel, no
  colour-only state, forced-colors handling identical to the other lamps.
- **Pre-print advisory** in PrintDialog — median ≥60% over 30 s on an idle
  printer (≥45% when MemAvailable < 12%; strong wording at ≥85%). ADVISORY
  ONLY, same law as KAMP and timelapse: wired to nothing, dismissible, no
  extra click on the happy path, and e2e proves `printer.print.start`
  reaches the wire with the warning on screen. Unknown host = silence.
- **Shutdown legibility** — the highest-value item. When klippy is down
  and the message matches the scheduling/timeout wordings, HealthAlerts
  explains: timing fault, usually host CPU/IO starvation, not hardware —
  with host load FROZEN at the fault (or an honest "not recorded"). The
  prtouch wording gets "the probe is the messenger". The gcode-response
  arm matters: that string never appears in `state_message`.
  `Lost communication with MCU` is deliberately excluded (often a cable);
  the classifier is pinned by tests against misclassifying verify_heater,
  ADC faults, and M112.
- **`docs/load-shedding.md`** — the runbook both surfaces link to: what to
  stop before a long print, the tailscaled/watchdog-cron order of
  operations, the explicit restore path, and what Regolith deliberately
  cannot do (no service-stop button; instructions for a human).

### Calibration debt (stated, not hidden)

Every threshold is **provisional**, derived from the incidents' shape, not
from a measured healthy-idle baseline — Moonraker's CPU% was not in the
forensics (they recorded `sysload`/`memavail`). After the current print
finishes: log `notify_proc_stat_update` for 30 min idle + 30 min printing
and re-fit the constants in `src/lib/hostHealth.ts` (they are named and
commented as provisional).

### Gates — all green, full runs, no deploy

Commit `1b57891` (telemetry + lamp): lint/unit/build 0, e2e **249 passed**
(baseline 247 + 2). Commit `686bfc5` (advisory + explainer): lint/unit/
build 0, e2e **254 passed** (+5: advisory shows/dismisses/never blocks,
shutdown explainer renders, hardware faults never hijacked). The print-
start regression suite passed on every run. The printer was never
contacted.

---

## 2026-08-12 — Verification pass on the host-health guard: four defects, and a fifth found in the gate itself

The guard shipped in `1b57891`/`686bfc5` was measured rather than re-read.
Four defects in the feature, one in the harness that verifies it.

### The classifier claimed "not hardware" over hardware faults

`/unable to obtain '[^']*' response/i` matched ANY unanswered Klipper query.
`identify`, `get_uptime` and `get_clock` are the connect and keepalive
handshake queries — an unanswered one is the dead-board / bad-cable
signature, which is the exact class `lost communication with mcu` was
excluded for. The broad regex re-admitted through the back door what the
exclusion was written to keep out, and HealthAlerts then asserted
unconditionally that the string "means the strain-gauge probe asked Klipper
for a result".

The query NAME now decides: prtouch/probe family → starvation; handshake /
keepalive → "possible MCU communication fault", pointing at cabling;
anything else → **cause unclear**, claimed as neither. The probe sentence is
rendered only when the captured name is actually a probe query.

**The rule this buys:** a narrow confident classifier plus an explicit
unknown beats a broad one that misdirects. On a machine with 255 °C heaters,
naming the wrong subsystem costs more than admitting the gap — so `unclear`
is a first-class verdict with its own copy, not a silent fallthrough.

### Stale and user-authored log lines poisoned genuine faults

`moonraker.gcodeLog` is capped at 200 and was never cleared — not on
reconnect, not on firmware restart — carried no timestamps to the
classifier, and `recordCommand()` writes the owner's own typing into the
same ring. Measured: a genuine `ADC out of range` shutdown plus one
hours-old `Rescheduled timer in the past` line classified as starvation; and
a console line `// user asked: what does 'timer too close' mean?` defeated
the `lost communication` exclusion.

Three changes: lines carry `at`/`fromUser` and are filtered to a recency
window anchored on the FROZEN fault time (not render time, so the explainer
does not expire while it is being read); user-typed lines are never
evidence; and lines carry a link `epoch` that is retired on reconnect and on
firmware restart — the console still renders them, the classifier no longer
trusts them. `state_message` is now authoritative: when it names a specific
non-starvation cause, the gcode arm may corroborate but can never override.

### The frozen fault context dropped its most diagnostic figure

`trackHostHealth` ran the starvation reducer BEFORE the shutdown freeze, on
the same merged state. A real shutdown push flips `print_stats.state` off
`printing` and `live_velocity` to 0 in the same message, closing the gate,
so the snapshot recorded `null` — silently losing "motion buffer 0.1 s
(healthy is about 2 s)", and whether it appeared depended on the push's
shape. The snapshot now takes the PRE-fault reading, and `BufferStarvation`
carries `bufferAt` so the snapshot can police its own freshness.

**The rule:** a unit test that hands a reducer a literal cannot see an
ordering bug. `tests/hostFaultContext.test.ts` drives real
`notify_status_update` messages through `Moonraker` instead.

### The HOST LOAD lamp fired on an unknown host, and could never fire in Basic

Trigger B gated on `motion_report.live_velocity`, but `motion_report` is
CONDITIONALLY subscribed — claimed only by /control and the Dashboard's
EXPERT tile. In Basic mode the gate was permanently shut, so the "leading
indicator" could never fire for the app's stated target user. After one
visit to /control it was worse: `mergeState` only spreads and never deletes,
so the stale velocity persisted forever and a normal print warm-up latched a
warning in 10 s with `cpuMedian: null, sampleCount: 0` — a warning about a
host never sampled, breaking the module's own law.

Trigger B is **removed from the lamp**. Widening the subscription was the
wrong fix: `motion_report` streams at Moonraker's full batch cadence, so
subscribing it unconditionally to power a host-LOAD guard would make the
guard a source of the load it watches. The buffer figure survives where it
is honest and free — an omittable line in the frozen fault context. The
unsampled-host law is now an explicit guard, not an emergent property of
thresholds, and only a push that actually CARRIES `motion_report` counts as
a velocity observation.

### Invented data, again: a load average Moonraker does not expose

`Settings.tsx` read `ps.result?.system_load_avg ?? [0, 0, 0]` and rendered
`0.00 · 0.00 · 0.00`. Moonraker's `/machine/proc_stats` returns no load
average at all, so the page had been showing a fabricated reading of a
healthy machine. Row removed. Same class as the invented pressure-advance:
**a number with no source is worse than an absent row, because it is
believed.** The e2e fixture had been supplying `system_load_avg`, which let
the fabrication look correct in CI — a fixture that invents a field the real
API lacks will hide exactly this bug.

### THE BIG ONE: the e2e gate itself could contact the printer

Found while running the gate with the owner's 8-hour print live.

Vite's preview server INHERITS `server.proxy` when `preview.proxy` is unset.
`playwright.config.ts` runs `bun run preview` as its webServer. So every
`bun run test:e2e` booted a server holding live proxy routes — `/printer`,
`/server`, `/access`, `/machine`, `/api`, `/webcam`, and `/websocket` with
`ws: true` — pointed at the real machine. The run logged it:

    [vite] ws proxy error: connect EHOSTUNREACH <printer>:80

Real TCP attempts, made by the gate. They failed only because the printer
was unreachable from this Mac at that moment. `forge.local` resolves fine
now.

**Why the suite never caught it, and the durable lesson:** the specs seal at
the BROWSER — `page.route` + `routeWebSocket`, asserted by `assertSealed()`.
That is the right layer for "the app makes no unmocked calls" and it is one
layer too HIGH to be a containment guarantee. Anything reaching the preview
ORIGIN is forwarded by the server itself, entirely outside Playwright's
view. The suite has been reporting zero escaped requests all along while the
server beneath it could reach a live printer.

    A seal must sit at the outermost layer that can egress,
    not at the layer that is convenient to assert.

Fix: an explicit `preview.proxy` pointing every route at the discard port
(`127.0.0.1:9`). Routes are kept and sunk rather than deleted, so a leak
fails LOUDLY and locally with `ECONNREFUSED` in the preview log instead of
being absorbed by the SPA fallback and hiding the leaking spec. `vite dev`
keeps the real proxy — that is how a human drives a real machine on purpose.

**A leak must announce itself.** An empty `proxy: {}` would have been just
as safe for the printer and strictly worse as a diagnostic: the leaked
request falls through to `index.html`, returns 200, and looks like success.
Given two designs that are equally safe, take the one that cannot fail
silently. The sink proved its worth within one run — 519 sink hits across
11 endpoints on a half-suite, every one of which had previously been
forwarded toward the printer, none of which any spec had ever reported.

### The most dangerous comment in the codebase was a CORRECT one

`e2e/support/active-state-harness.ts:360` already said it, plainly:

> `vite preview` proxies every /server, /machine and /printer path at the
> real printer's address

That is the whole hazard, stated as a general property — and the very next
line scopes the remedy to "two reads the Timelapses page makes that MUST NOT
fall through." The author diagnosed the entire class correctly and then
fixed exactly the two members of it that had a VISIBLE symptom: a page stuck
in a loading skeleton in CI. Every other member of the class leaked silently
for as long as it stayed symptom-free — which was months.

**A correct diagnosis written next to a fix scoped to the symptom is not
partial protection; it is durable false assurance.** The comment is what
made the next reader — and there were several — believe the hazard was
handled. Prose that is MORE accurate than its own remedy is the dangerous
case, not the harmless one: it buys the credibility of a real analysis and
spends it on a fix that does not cover what the analysis describes.

The rule: when a comment describes a CLASS of hazard, the fix beside it must
close the class, or the comment must say in terms what it leaves open and
why. "Specs that care register their own route" was doing that job and could
not — nothing enforced it, and nothing failed when it did not happen.

Verified by inspection of the server, never by asking the printer:
`forge.local` resolves to the printer; all six HTTP routes return 502 with
`connect ECONNREFUSED 127.0.0.1:9` in the vite log; the `/websocket` upgrade
fails to connect; and `lsof` on the preview PID shows exactly one socket —
`127.0.0.1:4187 (LISTEN)` — with no outbound connection at all.

### The e2e port was hard-pinned, and the allowlists drifted from it

`127.0.0.1:4173` was hard-coded in `playwright.config.ts`, in six specs'
request allowlists, and in the harness. Two overlapping runs meant the second
`vite preview` could not bind, the suite attached to whatever already held
the port, and every request failed `ERR_BLOCKED_BY_CLIENT` — one session lost
all 254 tests to it. Host and port now come from `e2e/support/preview-origin.ts`
(env `REGOLITH_E2E_PORT`, default 4173), and every allowlist derives from the
same value, so the server and the allowlists cannot disagree again.

### Containment for the advisory

The pre-print advisory moved into `HostLoadAdvisory` behind a
`ChromeErrorBoundary` with a `CrashSeam`. `/print` is the only route that
starts a print and it renders inside the shared RouteErrorBoundary, so a
throw on this optional path blanked the page and took the Start button with
it. The hook and the verdict live INSIDE the boundary — a boundary around a
prop the parent computed would catch nothing. **An optional warning must
never be able to remove the control it is warning about.**

## Final gate validation — 2026-08-12, HEAD `8df4904`

An 8-hour print was running on the K1 Max for the whole of this pass.
**Zero printer contact**: no ssh, no request to the printer's LAN/tailnet
address, no browser automation against it, no deploy. All four gates ran
against local code, a local `vite preview`, and a mocked e2e harness only.

- **Gates, foreground, run to completion, real exit codes:**
  - `bun run lint` — clean, exit 0.
  - `bun run test` — 416 unit tests + 3862 `expect()` calls pass (`bun test
    tests`), plus 19 shell assertions across `deploy.test.sh` and
    `setup.test.sh` (no embedded secret, key-first auth, fail-closed
    preflight, verified rollback, etc.) — exit 0.
  - `bun run test:e2e` — **259/259 passed in 11.7m** (baseline 247 — grew,
    did not shrink). The first attempt was killed by the harness's own
    10-minute background-process timeout at test 118/259 (`SIGTERM`, not a
    test failure); the rerun used a fully detached process
    (`nohup … & disown`, stdin from `/dev/null`) so the run itself was never
    time-boxed, and it completed clean.
  - `bun run build` — `tsc -b && vite build` — clean, exit 0.
- **Tree and remote:** the working tree carried uncommitted work from
  concurrent sessions (classifier narrowing, e2e no-contact hardening, the
  advisory containment, the dispatch-time render re-gate) when this pass
  began. All four gates were run against that tree as staged; once stable
  across repeated `git status` checks and the owning agents confirmed no
  further edits, the 23 files were staged by explicit path (never
  `git add -A`) and committed as `8df4904`. `scripts/`, `.a5c/`, `.claude/`,
  `CLAUDE.md`, and the build/test caches were left untracked, as required.
  `main` is pushed and even with `origin/main` as of this entry (see push
  confirmation below).
- **Frozen files:** `git diff` against `HEAD~1` shows zero changes to
  `src/lib/safety.ts` or `deploy.sh`. `src/lib/printerActions.ts` was not
  touched this pass; `src/lib/moonraker.ts` was touched only for the
  console-epoch classifier fix and carries no change to any printer-action
  path. The print-start regression suite (`bun run test`, the 19
  `deploy.test.sh`/`setup.test.sh` assertions) passed after this commit.
- **Pre-print advisory cannot block a print:** `e2e/host-health.spec.ts`
  `Pre-print host advisory — advisory only, never a gate` — all three cases
  passed: the advisory warns on a loaded host and the print still starts,
  it is dismissible with a quiet host never warning, and a thrown error on
  the advisory's own path cannot take the Start button down with it. Source
  confirms this structurally: `PrintDialog.tsx`'s `start()` builds its
  `PrinterAction` from `guardPrinterAction` alone — `HostLoadAdvisory`'s
  verdict is never read by it.
- **Shutdown classifier:** `tests/hostStarvation.test.ts` covers all three
  real incident strings — `rescheduled timer in the past` /
  `missed scheduling of next` family, the mid-operation
  `Unable to obtain 'result_deal_avgs_prtouch' response` wording (the
  2026-08-12 incident), and the stale/user-typed `// user asked: what does
  'timer too close' mean?` line that must never be evidence — and separately
  asserts `adc out of range`, `thermistor`, `not heating at expected rate` /
  `verify_heater`, and a genuine fault sitting next to a stale starvation
  line are never overturned into "not a hardware fault." All pass.
- **Telemetry cadence:** unchanged from the existing design — `hostHealth`
  subscribes to Moonraker's own `notify_proc_stat_update` push, already
  arriving at ~1 Hz as the link heartbeat. No additional polling was added;
  `e2e/host-health.spec.ts` samples that same cadence to build its warn/latch
  windows.
- **Layout laws and floors:** `e2e/concentricity-law.spec.ts`,
  `button-law.spec.ts`, `swiss-grid.spec.ts`, `telemetry-rows.spec.ts`,
  `telemetry-density.spec.ts`, `segmented-instruments.spec.ts`,
  `console-clip.spec.ts` (reachability), and `light-control.spec.ts` are all
  in the 259-test green run above. `swiss-grid.spec.ts` sweeps every 16px
  from 320 to 2560 and separately asserts the floors hold exactly at 320,
  800x480 (K1 panel), 1280, and 2560.
- **Console hygiene:** `console-hygiene.spec.ts` and `console-clip.spec.ts`
  are in the green run; zero console errors during the e2e pass (harness
  fails a spec on any unexpected console error).
- **Secrets:** `grep` across the staged diff and the new untracked files
  (`preview-origin.ts`, `HostLoadAdvisory.tsx`, `hostFaultContext.test.ts`)
  for password/IP/tailnet/API-key patterns — zero matches. No printer
  password or LAN/tailnet address in any tracked file.

Deployment remains deliberately deferred until the owner's print finishes.
Nothing in this pass touched the printer.
