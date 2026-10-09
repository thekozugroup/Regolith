# Feature-preserving performance repair — October 9, 2026

Regolith now requests less duplicate information and spreads file-preview work
over a bounded queue. Every file, preview, control, notification and camera
setting remains available. Lower startup cost is measured for the chamber-light
helper. These changes do not establish that every printer CPU spike is fixed.

## Changes

- Files shares complete metadata between previews, selected details and job
  estimates. At most two requests run concurrently; selected files take priority
  over visible rows and background work. Off-screen previews load as they become
  visible; all filenames remain mounted and keyboard accessible. A revision-aware
  128-entry/five-minute cache, explicit refresh invalidation, failure retry and
  cancellation of abandoned queued reads prevent stale data and wasted work.
- Expert Settings reads stable identity/version details once per ready connection
  instead of every five seconds. Memory uses existing server notifications.
  This K1 firmware does not push uptime, so it checks fallback eligibility every
  15 seconds and skips reads while both channels remain fresh. Channels track
  freshness independently; partial notifications, lost
  connections, malformed/failed responses and delayed responses cannot erase or
  falsely relabel newer data. Basic mode still avoids these expert host reads.
- The light watchdog uses Python's standard `http.client`, avoiding the heavier
  request/typing imports. It remains one-shot with the same one-minute cadence,
  nice priority, ten-minute idle timeout, motion/print checks, state and LED-off
  behavior. Redirects and malformed HTTP framing fail closed. No resident daemon,
  dependency, camera reduction or service shutdown was introduced.

## Verification status

Application source: `e49ac1f`; helper and offline safety draft: `3bf0e22`.
Deployed commit: `41e1bc8` (same application/helper sources, updated handoff).
451 unit tests / 4,035 assertions, lint/build, all 291 browser tests, 19 deployment
cases, guided setup, 43 hardening cases, 10 light-helper equivalence groups and
42 offline calibration tests pass. Browser suite: 13.8 minutes, zero retries,
zero escaped/unmocked printer requests; its fresh armed ledger is retained.
Independent source review found no remaining release blocker in Files/Settings.
Matched live after-measurements and all 42 live route/mode/viewport views passed
with no blocked writes, page/console errors or horizontal overflow. The live
matrix covers seven routes, Basic/Expert, and 1280×800, 800×480 and 390×844.
Screenshots were inspected at desktop, phone and printer-panel sizes. This
does not claim every card fits above the fold in every print state.

Supplemental read-only checks verified real CPU/memory/uptime, scrolling to the
24th file, its embedded preview, UI-only selection, selection preserved through
refresh and its details preview. No Start/Print again control was clicked.
Two initial supplemental assertions were wrong: an exact text selector expected
the raw CPU value to be a standalone element, and an unscoped Refresh selector
matched both Files and History. Fixed the harness, retained the completed
42-view evidence and reran the supplemental checks; no application workaround.

The final camera soak showed six Live samples at 1280×720 and zero reconnects.
At 16:22 UTC the printer was ready/complete, inactive SD, Idle, hotend 26.82°C,
bed 25.04°C, targets/power zero, LED off, empty queue and zero WebSocket clients
after closing the QA browser. No physical print-quality test occurred.

All local browser tests must run against mocked printer endpoints with the
zero-egress guard. Live observations allow only explicit HTTP reads and object
subscriptions. No printer action is clicked or submitted.

## Static UI rollout

At 16:05 UTC the guarded installer rebuilt the committed runtime, reran all
local non-browser release gates, verified upload/staging and backed up the live
directory before its atomic swap. Fresh accepted identity and idle/cool/queue
checks passed before deployment; another check during local gates and the
post-deployment check also passed. No service or printer configuration changed.

All 24 HTTP-served build files match local SHA-256 values. Release archive:
287,107 bytes, SHA-256
`b116ec6dbbe34b77f1826e951aa828318cce73657d897e0e8fe68d38a0b1aecf`.

Persistent and off-device previous-UI backup:
`fluidd-before-20261009T160549Z.tgz`, 281,931 bytes, 27 entries, SHA-256
`cf3756965f7f30b3d3ee72cac1c53f420b1daeb19f946135d023992d5122c33b`.
The previous slot is also retained. Existing five-archive retention pruned
`fluidd-before-20260812T154159Z.tgz`; its off-device copy was verified first
(28 entries, SHA-256 `bb05461c218306f7f0c73fa2a2ec248514c91975769f94926400342a8ded0c3c`).
Thus the pruned archive remains recoverable. Static rollback uses the existing
guarded `deploy.sh --rollback` with a freshly validated printer target.

## Measurement method

Before/after browser workload: one Chromium client, Expert mode, 1280×800,
three visits each to Settings (60 seconds) and Files (20 seconds), followed by
a 30-second Home/camera observation. Each visit is a full navigation. Browser
requests and existing host notifications are recorded; no extra proc-stats
poller is used. Workloads are repeated sequentially, not randomized trials.
The baseline UI was `c05858c`; the baseline helper was the original version.

Baseline: each Settings visit made 53 host-information reads, including its
connection bootstrap; each Files visit made 24 metadata and 24 thumbnail reads.
The three Settings CPU medians were 28.72%, 30.00%, 30.16%; maxima 61.54%,
64.40%, 65.10%. Files medians were 32.98%, 30.41%, 28.95%; maxima 71.56%,
82.32%, 78.17%. The 30-second camera observation made one stream request.
Zero attempted writes or page errors were recorded.

### Matched post-deployment observations

Each of three new Settings visits made **7 host reads instead of 53** (about
87% fewer): one connection bootstrap, three stable details reads, and three
proc-stat fallbacks. Memory continued live, uptime remained available with an
honest age label, and the formerly empty CPU identity now correctly reads
`mips`. Stable detail reads did not repeat within a visit.

Each Files visit made **10 metadata and 10 thumbnail requests instead of
24 + 24** (about 58% fewer initial preview reads). These match visible rows plus
the small prefetch margin; the other filenames are still present. Offline
tests establish the two-request bound and selected-detail sharing; live
scroll/selection/refresh verification also passed against the deployed UI.

| Idle workload | Before: CPU median / maximum | After: CPU median / maximum |
| --- | --- | --- |
| Settings 1 | 28.72% / 61.54% | 26.70% / 63.21% |
| Settings 2 | 30.00% / 64.40% | 25.13% / 63.92% |
| Settings 3 | 30.16% / 65.10% | 25.65% / 62.69% |
| Files 1 | 32.98% / 71.56% | 26.84% / 63.87% |
| Files 2 | 30.41% / 82.32% | 28.12% / 59.64% |
| Files 3 | 28.95% / 78.17% | 28.06% / 50.00% |
| Home + camera | 33.33% / 68.56% | 32.09% / 69.39% |

The new workload recorded 270 samples versus 272 before; endpoints had no
extra diagnostic polling, and windows differed slightly at navigation edges.
Minimum reported available memory was 112,788 kB after versus 112,828 kB before.
Home still made exactly one camera request with no reconnect during its
30-second observation. No camera resolution/frame rate or functionality was cut.

Request reduction is direct evidence. Lower typical CPU and lower Files peaks
were observed in these trials, but both UI and helper changed, scheduled work
was not isolated, and the Home peak did not fall. Do not turn these numbers into
a guarantee about every peak, active prints or every workload.

Light-helper benchmark: five interleaved original/candidate pairs on the actual
printer, nice 19, with browser work closed. Source was loaded under a non-runtime
module name and only its status GET function called. No normal helper execution,
state/log update or LED command was part of this benchmark. All ten GETs passed.

| Median measurement | Original | Optimized |
| --- | --- | --- |
| Module import CPU | 0.4978 s | 0.3798 s |
| Instrumented process CPU | 0.8374 s | 0.6978 s |
| Peak resident memory | 10,580 kB | 9,432 kB |

The common harness contributes overhead. This shows about 17% less measured
process CPU and 11% less peak memory, not a 17% reduction in whole-printer CPU.

A separate 179-sample passive post-helper observation had median CPU 27.98%
and maximum 78.5%. Its duration differs from the earlier passive diagnostic, so
those maxima are not a matched improvement test. Peaks still coincided with
scheduled minute boundaries, particularly a five-minute boundary. They were
not accompanied by high Moonraker process CPU. Other scheduled/system work was
not disabled or attributed without isolation evidence.

## Safe helper rollout

At 15:52:46 UTC the exact tested light helper was atomically installed after
fresh DNS/accepted SSH identity, conclusive idle/cool state, empty queue and
LED-off checks. The original was copied and verified before replacement.

- Live helper: `/usr/data/scripts/light-watchdog.py`, root:root, mode 700.
- SHA-256: `84a8d0dc06ebf7c92c4a0094dbe72509700647248715b2f494516565e98401b5`.
- Persistent original: `/usr/data/regolith-backups/light-watchdog-before-20261009T155200Z.py`.
- Original SHA-256: `d150bd58cea24cce3f73aa8abf29aaf4fac1c90e017c4ceefd863ebf86679e7f`.
- Existing cron wrapper SHA-256 remained
  `eff9a0139a355eac61264391f1bfd33ea98f46352f446cbceee3aa58879e252d`.
- Natural ticks through 16:22 UTC updated state mtime. The already-off LED
  stayed off; no new LED-off log entry appeared. Final helper/original/wrapper
  hashes matched again; the calibration helper's original hash was unchanged.

Rollback requires fresh identity/safety checks, copying that exact verified
original to a staging file in `/usr/data/scripts`, preserving root:root/mode700,
verifying its hash, then atomic replacement of only `light-watchdog.py`.
No restart or cron edit is needed. Do not run the normal entry point as a test.

The local owner-authored `scripts/` files were preserved byte-for-byte. No print,
homing, motion, heat, calibration, configuration save or service restart occurred.

## Separate safety boundary

The existing hourly auto-calibration helper remains unchanged on the printer.
Its incomplete idle/queue/completion gates are documented in the original
diagnostic. A hardened offline draft and fault-injection tests exist in
`tools/printer/auto-optimize.py` and `docs/auto-calibration-safety.md`.

The draft requires explicit maintenance approval before movement because
software cannot establish that the bed is clear or exclude another controller.
That changes unattended automation policy: owner approval is required before
deployment. The draft may deliberately refuse this firmware's vendor macros or
incomplete pending-configuration contract. It is not physically certified, and
its maintenance mode must not be invoked as part of this performance work.

## Evidence locations and limits

Raw repeated workloads, helper timings, screenshots and original-helper copies
are in the ignored existing run's `artifacts/cpu/` directory. The original
diagnostic's older `test-results/` scratch artifacts were cleared by Playwright
cleanup; its committed summary remains, but those raw originals are not claimed
to be retained. All later test output uses dedicated run subdirectories.

This is idle-printer evidence. No active-print performance/quality or physical
automatic-light transition is certified. Do not hide CPU peaks, lower camera
quality, remove safeguards or disable a feature to improve a displayed number.
