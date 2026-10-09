# CPU diagnostic — October 9, 2026

Brief CPU spikes are real. Two avoidable workloads were observed: Regolith's
all-at-once file metadata requests, and the on-printer chamber-light watchdog's
minute-by-minute Python startup. Expert Settings also repeats information reads
unnecessarily. None requires removing a feature to optimize. This diagnostic
does **not** establish the cause of every spike the owner has seen.

## Scope and safety

- Read-only diagnostic of source `c05858c`. Live HTML SHA-256 still matches
  `e96a9cc796fc3dde87a28691c9fc182bbc602e5e484503fa74ef81a4e2c3ab3c`.
- Printer was ready, completed job, inactive SD, Idle, zero heater targets
  and power before and after. Final hotend 26.54°C, bed 24.77°C.
- No printer commands, print start, service restart, configuration changes,
  deployment, watchdog execution, or remote script modification by this work.
- One temporary browser session, explicit read-only HTTP allowlist and
  subscription-only WebSocket guard. Zero blocked/attempted writes. Closed
  afterward; final server snapshot showed zero WebSocket connections.
- Performance skill required measurements before recommendations. Independent
  source review distinguished browser work from printer work. No application
  implementation or performance improvement is claimed in this diagnostic.

## Observations

Times below use America/New_York (EDT). The printer's displayed local clock
was one hour behind; correlation used UTC/client timestamps instead.

| Workload | Observation |
| --- | --- |
| Six-minute process sample | 73 snapshots at five-second intervals. Excluding startup, aggregate busy median 29%, range 23–55%. Every sampled I/O-wait display rounded to 0%. |
| Home with camera, 45 seconds | 45 one-second push readings; CPU median 32.29%, maximum 60.42%. Exactly one camera request, no retry loop observed. |
| Expert Settings, ~61 seconds | 60 readings; CPU median 28.12%, maximum 93.47% at 10:50:02 EDT. Repeated four-endpoint polling confirmed: 13 cycles including initial load, approximately 48 repeated reads/minute. One final proc-stats read crossed into route navigation. |
| Files, ~21 seconds | 24 metadata requests issued within 12 ms, then 24 thumbnail requests. CPU reached 71.36%; Moonraker process CPU reached 91.47% of one core in that one-second window. |
| UI closed; passive telemetry only, ~80 seconds | 79 readings; CPU median 26.90%, peak 74.37% at 10:53:02 EDT. No outgoing RPC or camera stream from this collector. |
| Fine process sampling around next minute | `light-watchdog.py start` was the largest process in a burst: BusyBox top reported 26% for it, 71% aggregate busy, and 27% low-priority user CPU. This coincided with the next minute-boundary telemetry spike with no UI open. |

The 93% Settings-window spike is **not proven to be caused by Settings**:
Moonraker was only 12.03% of one core then. The minute-boundary timing and
subsequent watchdog observation implicate scheduled work as a contributor,
but the five-minute watchdog/logrotation tier also coincided with that peak.
No isolation experiment stopped services or automation.

Available memory remained above 111,444 kB during browser observations and
returned to 117,100 kB afterward. Swap in use stayed at 12,904 kB in the
initial/final reads. This is not evidence of sustained memory exhaustion.
The kernel did not expose the requested swap-in/out counters; exact swap
traffic is unknown. Low rounded I/O-wait alone is not proof of zero I/O stalls.

## Feature-preserving optimization order

1. **Smooth and deduplicate file metadata requests.** `Files.tsx:174` mounts
   `ListThumb` for every row, and `Files.tsx:356` immediately requests metadata
   even for off-screen rows. `useJobHistory.ts:95` caches completed results but
   has no per-file in-flight sharing. Use a bounded queue, prioritize visible
   and selected files, and share complete metadata reads. Keep every file,
   preview, selection, and refresh. Invalidate on changed file identity rather
   than caching forever by filename; never cache a transient failure forever.
2. **Reuse live telemetry in Settings.** `Settings.tsx:60–110` reads identity,
   versions, and process statistics every five seconds, even though memory and
   uptime already arrive over the WebSocket. Cache stable details with
   reconnect/restart invalidation; consume the existing live feed; bound and
   deduplicate fallback reads. Preserve freshness, honest unavailable states,
   notifications, and every safety check. Moonraker documents its existing
   [process-statistics notifications](https://moonraker.readthedocs.io/en/latest/external_api/jsonrpc_notifications/#moonraker-process-statistic-update).
3. **Reduce watchdog startup cost without changing its job.** The device's
   `/opt/etc/cron.1min/light-watchdog` invokes Python plus the standard HTTP
   import stack every minute. It already runs at nice 19. Profile a lighter
   one-shot implementation before considering a resident process, which would
   trade startup work for permanent RAM. Preserve the one-minute cadence,
   ten-minute idle timeout, motion/printing/paused/macro checks, bounded HTTP,
   persisted state, error handling, and the exact automatic-light behavior.
   This owner-authored helper must not be changed as a side effect of a UI
   release.

Verification for any implementation: repeated matched before/after workloads,
CPU peaks and sustained usage, memory/I/O, request counts, unchanged UI data,
same-name file replacement, failed/slow requests, reconnects, and unchanged
safety/notification behavior. No reduced camera resolution/frame rate, disabled
remote access, weakened alerts, or hidden CPU readings.

## What not to blame or change without evidence

- React rendering, chart medians, and animations run on the viewing device;
  they do not directly consume printer CPU when viewed from this Mac.
- Existing same-tab WebSocket connection/subscription deduplication works.
  The diagnostic observed one live connection at a time, not a socket storm.
- Tailscale status-file publisher is **not installed** here. It cannot explain
  these observations. Its existing watchdog already uses process liveness
  every five minutes and throttles the heavier CLI check to 30 minutes.
- Tailscaled containment and swappiness are still set as expected. There is
  no fresh justification for increasing its memory allowance or stopping it.
- The deployed Moonraker CPU calculation subtracts only idle time, so its CPU
  percentage includes I/O wait. Interpret process and aggregate percentages
  separately; Moonraker process usage is one-core-relative. General limits of
  kernel CPU accounting are described in the
  [Linux CPU-load documentation](https://www.kernel.org/doc/html/latest/admin-guide/cpu-load.html).

## Separate safety finding: existing hourly calibration job

Read-only inspection found `/opt/etc/cron.hourly/auto-optimize` invoking
`/usr/data/scripts/auto-optimize.py`. This device-only helper can home, probe,
calibrate, save configuration, and restart Klipper. Its recent logs report
weekly-cap skips, not an active calibration during this diagnostic.

The source claims a five-minute idle and queued-job gate, but the inspected
implementation merely accepts standby/complete plus non-Printing idle state:
`MIN_IDLE_SEC` is declared but unused, and no queue check is implemented.
Calibration completion is also inferred from print state, which is not proof
that a calibration macro has completed. It merits a separate safety review;
it was **not executed, disabled, edited, or blamed for the measured bursts**.

## Evidence and limits

Ignored local artifacts: `test-results/cpu-diagnostic-2026-10-09/` contains
browser/passive JSON observations, five-second and one-second process samples,
the read-only browser script, and screenshots. The fine top capture has a
documented output-truncation gap (74 complete CPU headers retained of 76
requested); the independently collected 79 telemetry readings are intact.

The browser harness's unconditional localStorage initializer raised one error
when closing into `about:blank`; this was a diagnostic-harness error, not a
Regolith page failure. The initializer is now HTTP-only. Collected evidence
retains that error honestly; no clean full rerun is claimed.

This was idle-printer observation, not an active-print benchmark or proof that
every intermittent spike is fixed. Diagnostic sampling itself adds some load;
the workloads were sequential, not randomized trials. No before/after
improvement percentage should be inferred. Application source and user-owned
watchdog files remain unchanged.
