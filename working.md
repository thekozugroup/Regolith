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
- **Amendment 2026-08-03 — derived concentric radius system (SD1 plan R4/R5; supersedes the "6px panel geometry" prose above and this section's "consistent 12 px grouped-surface corners").** Radii are no longer hand-authored per surface. Exactly two radii are authored in `src/index.css`: `--radius-control` (0.25rem, every interior control) and `--radius-lamp` (1px, the signature lamp corner). Every container radius is derived as pad + inner — `--radius-panel` (14–20px fluid from `--card-pad`), `--radius-modal` (20px), `--radius-group` (8px) — and children consume the cascade via `rounded-inner` (`--radius-inner: max(0px, outer − pad)`), never a literal. Panel corners therefore soften from 6px to 14–20px; the hard-edged fallback is one line (`--radius-control: 0px`) and panel softness is an owner checkpoint at WP-VERIFY. Radius is paint, not metric: the 44px hit-target audits must show zero diff through this work.
- Unknown startup telemetry is neutral: the UI says Connecting, omits a false Klipper error, and shows unavailable temperatures as an em dash instead of `0.0 C`. The state becomes ready/real-valued after the first subscription response. This rule now also covers homing: the HOMED tell-tale renders absent toolhead telemetry as neutral dashes, never as a struck-through "not homed" claim.

## Amendment ledger — SD1 instrument cluster + Track A (2026-08-03)

Binding design amendments from the SD1/Track A workflow (`d37c24d`…`79e8a0a`, verification backlog cleared in the follow-up fix commit). Each entry supersedes any conflicting prose above it.

- **Neutral palette, Variant A (PROVISIONAL — owner checkpoint pending).** The chrome palette moved to the fully neutral C=0 tokens (`--color-bg` oklch(0.145 0 0) through `--color-border-strong` oklch(0.38 0 0)) — Variant A of the two candidates. This is provisional until the owner answers checkpoint (a) below; Variant B remains a token-only swap.
- **Derived concentric radius system (R4/R5).** Recorded in full under "UI and accessibility" above (2026-08-03 amendment): exactly two authored radii (`--radius-control`, `--radius-lamp`), every container radius derived as pad + inner, children consume `rounded-inner`. Supersedes the 6px-panel and 12px-corner prose. Two verified consequences: the system is concentric with respect to the PADDING box (a systematic, accepted +1.00px against the border box — do not "rediscover" it), and any surface whose real pad differs from its cascade default must override the pad token on the element (BrandLogo popover: `--modal-pad: 0.5rem`; re-check the HealthAlerts toast, same class of mismatch).
- **Tell-tale cluster (SD1 §3).** Eight lamps in severity order: THERMAL RUNAWAY, HEATER FAULT, FIRMWARE, LINK LOST, FAN FAULT, MCU HOT, MESH ACTIVE, HOMED XYZ. FILAMENT ships in code but the lamp exists only where the profile declares a physical sensor — the K1 Max base profile declares none, pending a live probe of the machine (an unlit lamp would promise monitoring that is not happening). MAINTENANCE is deferred (P2): no honest data source exists in push state. Every lamp carries three channels (shape, icon, always-visible 11px label); the unlit outline is `--color-gauge-tick` (4.071:1 on the cell well — the 3:1 non-text floor is e2e-pinned); MCU HOT's warning→error escalation carries a CRIT text affix, never color alone.
- **Collapsible sidebar.** Desk-only icon rail with persisted preference; the `desk` HEIGHT-GATE OUTRANKS THE PREFERENCE — the K1's 800x480 panel keeps touch chrome regardless of the stored collapse state (e2e-pinned). Above the dashboard shell's deliberate 2200px readability cap (viewports ≳2424px), collapsing the rail widens the centring margins rather than the dials — accepted trade, e2e-pinned, Sidebar docstring corrected.
- **ETA calibration + thermal slope heuristics are ON BY DEFAULT and are NOT labeled AI.** Both are arithmetic over data the printer already sends, run entirely on the client, and must never be described as AI or gated behind the assistant flags. Calibrated values render visibly non-measured (`~` prefix, muted, always-visible provenance text — never hover-only) and fail closed to the placeholder; the calibrated estimate is spent once the measured crossfade completes (never leaks past 100% progress).
- **AI gateway is OFF BY DEFAULT behind a build-failing lint fence.** `src/lib/ai/**` may be imported only by its allowlisted consumers (`no-restricted-imports` + `tests/aiImportFence.test.ts`); every feature requires an owner-supplied endpoint + key; the key never proxies through the printer. The settings panel itself is an Expert surface (Basic never shows the key/endpoint affordance). Bundle verified 2026-08-03: the gateway is code-split — it lands in the lazy `flags`/`explain` chunks loaded only with route chunks (~2.2 kB gz total), and the eager index chunk contains zero AI code (only Vite's preload manifest reference).
- **`--color-fg-subtle` is PROVISIONAL** at oklch(0.64 0 0) pending the WP-VERIFY contrast measurement pass; finalize from measurement, not taste.
- **Open owner checkpoints (unanswered as of this ledger):**
  - (a) Neutral palette Variant A vs Variant B.
  - (b) Warm vs neutral `--color-fg`.
  - (c) `--radius-control` 4px vs 0px (hard-edged fallback is the one-line change).
  - (d) Camera/vision default-off override: explicit acknowledgment required before any camera-vision feature ships (no camera/vision code exists in v1; default is OFF).
- **Still open:** rotate the historical printer password (see "Remaining issues" — unchanged, out of this workflow's scope, still recommended).

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
PRINTER_HOST=192.168.50.179 PRINTER_PASSWORD="$PRINTER_PASSWORD" ./deploy.sh --rollback
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
- `./deploy.sh` (repo script, `PRINTER_HOST=192.168.50.179`) exited 0 first try — no dropbear flake this run. Archive 162,458 bytes, SHA-256 `b3e55873051be9839d9ca238dedd39daa620fc90e03416842567d940a7fa1d83`; remote size/hash and staged file list matched before the swap. Atomic swap and required-asset HTTP verification passed; automatic rollback was not triggered.
- Live `index.html` moved `de1175ff35e8b1d6984a27a1bf14efccd56f10af1a55d668df75da858140de59` → `ffd9036110b76ae699160ee6e710aa030c93b1305112adee4f4ccb2726076609` (exact match with local `dist/index.html`). Live bundles: `index-DxjXKT4b.js` / `index-BRomDO5p.css` / `Dashboard-DAJTRcUl.js`.
- New verified backup `/usr/data/regolith-backups/fluidd-before-20260804T044640Z.tgz`, 143,065 bytes, SHA-256 `96d504b58589dd238241d59b2adc2094faf26567320d525d9291f70617ae5bc2`, 21 files; retention kept five and pruned the oldest (`20260802T174223Z`) only after the new archive verified.
- **Rollback is armed:** `/usr/data/fluidd.previous/index.html` is exactly the pre-deploy `7dd3c0d` build (`de1175ff…de59`). Note the previous slot now holds the `7dd3c0d`-era build, not `68181d0` — `68181d0`'s build (`7abea8ff…1919`) was rotated out of the slot by this swap but survives in backup `fluidd-before-20260803T204754Z.tgz`.

```sh
PRINTER_HOST=192.168.50.179 PRINTER_PASSWORD="$PRINTER_PASSWORD" ./deploy.sh --rollback
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

- `./deploy.sh --preflight` (`PRINTER_HOST=192.168.50.179`) exited 0 and changed
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
PRINTER_HOST=192.168.50.179 PRINTER_PASSWORD="$PRINTER_PASSWORD" ./deploy.sh --rollback
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
clean, even with `origin/main`) to the K1 Max at `192.168.50.179` via
`deploy.sh` only. Gate had reported SAFE TO DEPLOY: YES; standing owner
authorization. No config, service, or watchdog contact; no print started.

- **Preflight**: `PRINTER_HOST=192.168.50.179 PRINTER_PASSWORD=$PRINTER_PASSWORD
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
  `PRINTER_HOST=192.168.50.179 PRINTER_PASSWORD=$PRINTER_PASSWORD ./deploy.sh --rollback`.

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
`origin/main`, tracked tree clean) to 192.168.50.179 via `./deploy.sh` only.
Credentials supplied solely through `$PRINTER_PASSWORD` (never a literal).

- **Preflight**: `PRINTER_HOST=192.168.50.179 ./deploy.sh --preflight` exit 0
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
  `PRINTER_HOST=192.168.50.179 PRINTER_PASSWORD=$PRINTER_PASSWORD ./deploy.sh --rollback`.

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
