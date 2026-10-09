# Calibration helper safety draft — 2026-10-09

Status: offline implementation only. Not deployed. No printer contact or physical calibration occurred. Owner approval is still required before changing unattended behavior.

The hourly helper now reports eligibility without moving the printer. Calibration remains available only during an explicitly approved maintenance session. Idle does not mean the bed is clear.

## Preserved behavior

- Loopback Moonraker endpoint and existing `/usr/data` state/log/config locations.
- Shaper first, then mesh, then probe; at most one operation per tick.
- 90-day shaper and 30-day mesh freshness thresholds; weekly probe checks.
- Rolling seven-day cap of one attempt, including failed attempts. The original comment said calendar week but implementation was rolling seven days.
- Verified printer.cfg backups before shaper/mesh; ten retained copies.
- Hourly invocations remain usable for diagnostics. No scheduler was edited here.

## Changed safety behavior

- Default invocation and `--force` alone cannot issue G-code, move, heat, save configuration or restart Klipper.
- `--maintenance-approved` (alias `--maintenance`) asserts that the operator has cleared the bed, secured exclusive printer controls, and excluded external/scheduled macros for the entire run. Never add it to unattended cron. It is an operator assertion, not a sensor or authorization mechanism.
- `--force` bypasses age checks only. It cannot bypass maintenance approval, locking, heat, jobs, queue, unknown state, pending failure or weekly cap.
- Linux flock holds one persistent inode for the process lifetime. No check-then-write PID lock or stale-lock deletion race.
- Approved runs collect fresh observations every two seconds for at least 300 monotonic seconds before any G28/probe/shaper/mesh motion. Samples must arrive within bounded time, advance eventtime, and retain the same job/process/config/positions/SD identity. A busy/unknown/stale/gapped/changed sample aborts that attempt; a later run starts observation over.
- Readiness, print state, pause state, SD activity, queue, all enumerated heater targets/power/temperature and positions are mandatory. Targets/power must be zero; temperatures must be at most 50°C and cannot rise more than 2°C above the first idle observation. Slow backup/state writes invalidate consecutive observation. Missing queue support blocks maintenance rather than assuming no queue. Unknown extra heaters block unless safely reported.
- Any delayed_gcode configuration blocks maintenance because the API does not expose a reliable armed-timer idle flag. Overrides of G28, M400, calibration, profile-save or SAVE_CONFIG also block: their completion contract cannot be assumed. `homing_override` also replaces G28 and therefore blocks all maintenance motion.
- Before motion, `configfile.save_config_pending` must be exactly false and `save_config_pending_items` an empty object. Missing firmware fields block maintenance. After calibration, only the exact expected input_shaper or bed_mesh default keys and bounded values may be pending; removals, PID/probe/other changes and unknown schemas block every subsequent write. Probe accuracy must leave the pending buffer empty. The pending values must remain identical at each subsequent prewrite check. SAVE_CONFIG otherwise persists unrelated adjustments.
- Every prewrite observation must advance Klipper eventtime, including backup recheck, motion, profile save and SAVE_CONFIG; equal timestamps are stale and block the next write.
- Immediately recheck state before dispatch and before each save. Motion runs as one synchronous `G28`, calibration and `M400` script. No polling of print_stats is used as completion proof.
- HTTP success requires status 200, strict complete length/chunk framing, bounded body/headers, valid object JSON, no error field, and exact G-code result `ok`. Truncation, timeout, malformed chunking, duplicate fields/headers, unsupported encoding and unknown results fail closed. Total transport time is bounded; no retries occur.
- Persist a pending attempt before command dispatch, including its backup path. Timeout, crash, malformed response or any failed command leaves pending state and blocks future automatic attempts until operator review. Failure does not trigger SAVE_CONFIG, restart, retry or emergency-stop side effects. A timeout does not cancel an already accepted physical command.
- Probe check date advances only after acknowledged success. State is atomically replaced and fsynced.

## Completion contract and limits

[Moonraker's G-code API](https://moonraker.readthedocs.io/en/latest/external_api/printer/#run-a-gcode-command) documents that a request returns after its command series completes or errors, with success result `ok`. [Klipper's M400](https://www.klipper3d.org/G-Codes.html#g-code-commands) waits for current moves to finish. This is software acknowledgement, not physical motion or calibration-quality certification. A SAVE_CONFIG acknowledgement means the save/restart request completed; post-restart health and exact file changes still require operator verification.

[Klipper status](https://www.klipper3d.org/Status_Reference.html) provides readiness, idle, SD and heater fields, but no universal pending-G-code/macro lock and no bed-clear sensor. [Moonraker queue status](https://moonraker.readthedocs.io/en/latest/external_api/job_queue/#get-job-queue-status) exposes queued jobs and transitions; it does not atomically reserve the printer against another client.

Therefore polling cannot prove continuously absent transient activity between samples, exclude an external request arriving between the final check and dispatch, stop an accepted command when the local request times out, or establish a clear bed. Maintenance approval must secure exclusive controls physically/operationally. Unattended motion is not claimed safe. A future automatic-motion design needs a reviewed server-side admission interlock, tested firmware-specific macro contracts and trustworthy clear-bed proof; this draft does not implement them.

The current K1 firmware may use G28 macros/homing overrides, scheduled macros, or lack the pending-item status schema. Any such condition refuses maintenance; this draft is not a certification of K1 maintenance availability. Default diagnostics report a schedule candidate, then report refusal if safety capabilities are missing. Guards must not be weakened to make maintenance appear available.

Pending schema and operation allowlists were inspected in primary upstream source: [configfile autosave status and set](https://github.com/Klipper3d/klipper/blob/master/klippy/configfile.py), [shaper save_params](https://github.com/Klipper3d/klipper/blob/master/klippy/extras/shaper_calibrate.py), [bed-mesh profile serialization](https://github.com/Klipper3d/klipper/blob/master/klippy/extras/bed_mesh.py) and [homing override registration](https://github.com/Klipper3d/klipper/blob/master/klippy/extras/homing_override.py). Current upstream reserves `BED_MESH_PROFILE SAVE=default`; the retained firmware-era command may only acknowledge a warning/no-op. The calibration itself must already produce the complete validated default-profile pending buffer; otherwise no SAVE_CONFIG occurs. The exact vendor firmware still needs read-only compatibility review. Allowed bounds are conservative rejection limits, not proof that calibration quality is acceptable.

Pending failures are deliberately not auto-cleared. Operator must inspect printer state, console, saved configuration and backup, determine whether the command is still executing, and reconcile the `pending` entry only after resolution. No force/recovery flag silently clears it.

## Offline verification

Run `python3 -m unittest discover -s tests -p auto_optimize_test.py -v` on a development machine. Tests prohibit real sockets, use fake state/time and isolated temporary files, inject busy/unknown/heating/queued/failed/timeout conditions, and verify locks and no-save-after-failure. Do not execute the helper's runtime entry point against a printer during tests. Import is side-effect free except definitions; runtime execution remains under the main guard.
