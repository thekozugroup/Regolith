# Approved hourly checks — October 14, 2026

The owner replied "Proceed" to the question about making hourly calibration
checks-only while retaining calibration through existing printer controls.
That resolves the policy decision. It does not authorize calibration, motion,
heating, printing, configuration saves or service restarts during development.

## Current result

Production candidate: `tools/printer/calibration-checks.py`.
Verified candidate SHA-256:
`75b02b23fd2678dcfbaf4a4f9dfe27f570d08d33daa129506d501c317361f2a1`.
Deployment target: `/usr/data/scripts/auto-optimize.py`, preserving the existing
hourly wrapper and cadence. The separate maintenance draft
`tools/printer/auto-optimize.py` is not the deployment candidate.

The candidate has only three literal GET paths on `127.0.0.1:80`: printer info,
selected printer-object status and queue status. It has no command-dispatch,
shell, configuration-save or calibration-state-write function. It performs at
most three requests, with a four-second total deadline for each, bounded
responses and no retries or redirects. Missing/malformed data is reported as
unknown. Vendor overrides, scheduled macros, pending configuration and absent
process identity are reported together rather than hiding later findings.

Normal invocation takes a persistent-inode flock and appends one report to the
existing independent regular `auto-optimize.log`. It refuses missing, linked
or changed log destinations. `--check` / `--dry-run` produces stdout only:
no lock, log or other file write. `--force` changes an age hint only;
maintenance arguments are rejected. Existing history/configuration are read
with a size limit and never modified. Unresolved attempts request operator
review and return a nonzero status; a weekly cap is an informational skip.
Exit 3 means a diagnostic limitation, not an attempted calibration failure.

Historic shaper/mesh/probe priorities, age thresholds and rolling seven-day
cap remain as advisory hints. File mtime is only a freshness estimate; it is
not proof of when a calibration occurred. An idle snapshot is not five minutes
of observed inactivity or proof of a clear bed. All reports state maintenance
is disabled and direct the operator to existing printer controls.

The source is locally verified but **not installed**. On October 14 DNS could
not resolve `forge.local`; HTTP/SSH to the previous `192.168.50.179` timed out,
and ICMP reported the host down. The Mac has a route on the expected LAN.
No authentication or remote write succeeded. October 9 printer state and
firmware evidence are historical and cannot authorize today's deployment.

## Validation

`bun run test:printer-helpers`: 22 checks-only cases, 46 offline maintenance
draft cases and 10 light-helper groups. All tests prohibit real printer
sockets. The checks-only tests inspect exact outgoing GET bytes and endpoint
refusal before socket creation, partial/error/redirect responses, slow-drip
deadlines, malformed/extreme JSON, unknown/busy/thermal/queue states, observed
K1 limitations, untouched history/configuration, concurrency, rejected
maintenance flags and missing/symlink/hardlink log destinations.

Independent review identified numeric/nesting failure handling, unresolved
history reporting and log-destination gaps; these were repaired and regression
tested before release. An initial cross-process test used a duplex pipe which
created a local socket and correctly tripped the network ban; changing it to
a one-way OS pipe preserved the ban and allowed the lock test to pass.
No UI runtime changed, so no new UI deployment or browser certification is
claimed. Previously shipped performance results remain recorded separately.
Independent re-review found no remaining source blocker and independently
reran all 22 checks-only and 46 maintenance-draft tests successfully. All 78
groups/cases also passed through the updated package command. This establishes
local readiness, not interpreter or runtime proof on the currently unreachable
printer. Stage-only `--check` acceptance is still required on that device.

## Installation gates when the printer returns

1. Resolve the current address and verify the accepted SSH ECDSA fingerprint
   `SHA256:43wgMSNzgWwHJt/gd9dfgLRYAZGh4XhYfQTaw/OaT2k`. A different identity
   requires resolving the mismatch. Use existing trusted host entries and
   secure authentication; never embed a password in source, arguments or logs.
2. Independently query live readiness, print/SD/pause/idle state, every reported
   heater and queue. Require ready, standby/complete, inactive SD, unpaused,
   Idle/Ready, targets/power zero, finite temperatures 0–50°C and empty
   ready/paused queue. Inspect processes read-only: no old calibration helper
   or wrapper may be running. Avoid the hourly launch boundary. Refuse unknown
   state. Never stop a process or restart a service to obtain a passing gate.
3. Verify exact regular-file targets, interpreter and wrapper arguments.
   Record original helper/wrapper hashes, ownership/modes and configuration,
   history and light-helper hashes. Do not rely on the October 9 originals.
4. Back up only the original helper to a dated unique file under
   `/usr/data/regolith-backups/auto-optimize-before-<UTC>.py`; preserve its mode
   and verify its hash against the original. Download a copy to the existing
   ignored run artifacts and compare hashes before replacing anything.
   The existing cron/wrapper, calibration history, configuration, pending
   buffer, logs and UI are not replacement targets.
5. With renewed idle/queue/process proof, upload the exact committed candidate
   to a unique staging filename in `/usr/data/scripts`. Set root:root, mode
   700; verify its SHA-256 against the local source. Run only this staged
   checks-only file with `/opt/bin/python3 -B <stage> --check`. Require a valid
   checks-only report; exit 3 is expected if it reports documented vendor
   limitations. Invalid output or unexpected effects refuse installation.
6. Recheck live gates, no old helper process, wrapper/original and protected
   file hashes. Atomically replace only `/usr/data/scripts/auto-optimize.py`
   with the verified stage. Do not edit cron or restart anything.
7. Verify installed hash/mode/owner; run its `--check` mode only, compare
   protected files and confirm live idle/cool/queue state. Observe a natural
   hourly tick to confirm a checks-only log report and unchanged history/
   configuration. Existing printer controls remain available.

## Rollback

Require fresh accepted identity, idle/cool/empty-queue state and no running
helper. Verify the dated original backup hash, copy that exact file to a
unique staging filename in `/usr/data/scripts`, preserve original ownership
and mode, verify again, then atomically replace only `auto-optimize.py`.
No scheduler/configuration/service changes are needed. Do not execute the
original helper as a rollback test: it can initiate calibration. Restoring it
also restores the earlier unattended behavior and its documented safety
defects; prefer leaving the checks-only file installed if rollback would
reintroduce that risk. No backup is pruned as part of this rollout.
