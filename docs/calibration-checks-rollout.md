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

**Installed at 20:48:38 UTC on October 14.** The printer returned at
`192.168.50.179`, with the accepted ECDSA identity. Staged and installed
`--check` runs passed on `/opt/bin/python3` 3.13.9. Configuration, history,
cron, wrappers, existing logs and previously deployed light helpers were
unchanged at installation and immediate verification.

**Natural hourly-run verification completed at 21:01:33 UTC.** The scheduled
run wrote an identical checks-only report to both logs at 21:01:02 UTC
(16:01:02 printer-local fixed EST). The original log prefixes and protected
configuration/history/cron/helper hashes remain unchanged. No normal helper
or wrapper invocation was manually triggered. The existing thread heartbeat
`finish-regolith-checks-only-rollout` is paused after documented completion;
do not redeploy this already installed candidate.

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
No UI runtime changed. A limited guarded live browser smoke now verifies
desktop Home/Settings and phone Home; it is not a new full UI release or
active-print certification. Previously shipped performance results remain
recorded separately.
Independent re-review found no remaining source blocker and independently
reran all 22 checks-only and 46 maintenance-draft tests successfully. All 78
groups/cases also passed through the updated package command. This establishes
local readiness. The live interpreter and read-only acceptance below now
establish installed compatibility. The natural scheduled run below completes
the approved live rollout acceptance, not physical maintenance certification.

## Live rollout evidence

- Source milestone: `8e508ee82747a958a21d419d8d7ab4da9e5b6568`;
  deployment checkout: `6f2c716bb1ef7ec64398ef6beea4c4ed9199312f`.
- Fresh authenticated session was created against a dedicated pinned ECDSA
  known-host entry with strict checking. No borrowed/generic SSH master was
  used for remote mutations. Password was provided interactively, not stored.
- Every write phase renewed ready/standby, inactive SD, unpaused Idle,
  exactly two heaters off/cool, empty paused queue, empty pending configuration
  and no old helper/wrapper process. Firmware was `09faed31-dirty`.
- Backup completed at 20:46:47 UTC. Exact target only:
  `/usr/data/regolith-backups/auto-optimize-before-20261014T204000Z.py`.
  Original/backup/off-device SHA-256:
  `f8ad75c8057b4dd4c2f1c3d9625653c139b4a618717e65ed723a16430a16fc51`;
  13,470 bytes, original root:root mode 700, off-device private mode 600.
- Stage: `/usr/data/scripts/.auto-optimize-checks-20261014T204000Z.py`.
  Its verified SHA-256 equals the candidate above; 14,819 bytes, root:root
  mode 700. Stage-only `--check` passed at 20:48:18 UTC. Atomic replacement
  consumed this stage; no staging file remains at that name.
- Installed `--check` passed at 20:49:04 UTC, with the same hash/owner/mode.
  Both reports had true idle/cool/empty-queue snapshots and exit 3, matching
  exactly four expected limitations: absent maintenance process identity,
  vendor homing override, vendor calibration macros and unproven scheduled
  macro inactivity. The rolling seven-day cap is an advisory scheduling hint.
  Maintenance is explicitly disabled; no physical action was attempted.
- Configuration/history and deployed performance helpers match original
  hashes. The legitimate light-cron symlink still points exactly to
  `/usr/data/scripts/light-watchdog.sh`; its target remains unchanged.
- Exact hourly wrapper command remains
  `/opt/bin/python3 /usr/data/scripts/auto-optimize.py >> /usr/data/auto-optimize.cron.log 2>&1`.
  Crontab contents read before/after replacement match; no cadence change.
- Read-only browser guard was installed before printer navigation, permitting
  only allowlisted GET/HEAD reads and object-subscription RPC. Three views
  passed with zero overflow, page/console errors, blocked requests or writes.
  Six 5-second camera samples stayed Live at 1280×720, zero reconnects.
  Browser was closed afterward. All 24 served files hash-match `dist`.
- Final pre-tick observation at 20:52:05 UTC: ready/standby, inactive SD,
  unpaused Idle, hotend 28.06°C / bed 26.26°C, targets/power zero, empty queue
  and empty pending configuration. Both existing logs remained byte-identical.
- Natural tick at 21:01:02 UTC: one identical 456-byte report was appended to
  both logs, explicitly `mode: checks-only` and maintenance disabled. It
  reported true idle/cool/empty-queue snapshots, the rolling seven-day advisory
  cap and the same four documented limitations. The pre-installation prefixes
  were verified independently by size and SHA-256.
- At 21:01:33 UTC the installed candidate, configuration/history, crontab,
  hourly wrapper and light helpers still matched. Printer remained ready/
  standby, inactive SD, unpaused Idle, hotend 28.08°C / bed 26.19°C, targets/
  power zero, empty paused queue, empty pending configuration and no helper
  or wrapper process. This is a checks-only rollout, not a physical print test.
- Generated artifacts and private original copy remain under ignored
  `.a5c/runs/01KZ1XHAFCKSDQB4AAD966MX1R/artifacts/cpu/`:
  `checks-rollout-{inspect,backup,stage,install,verify,tick}.json`,
  `checks-rollout-live-assets.json`, `checks-rollout-browser.txt`,
  `checks-rollout-*.png`, and the dated original `.py`.

Protected SHA-256 values (unchanged through immediate verification):

| File | SHA-256 |
| --- | --- |
| Hourly wrapper | `09a93e0aea7f9c80cd6305cd3d8bb6f73b226c84221bb19d1f8286ae56af44ae` |
| Crontab | `8fe99361db0997e77db117044d41a3b64c87f26407e949b81c249f1fb3f8ce63` |
| printer.cfg | `55d1533d8306b10f2c55eb5f01bd2af795e056e892c81d1d9a19a47769225fa6` |
| Calibration history | `4005a286c678fd072962ade23eaa4df6c33680cc5f678113d26f45feb7837a52` |
| Light Python helper | `84a8d0dc06ebf7c92c4a0094dbe72509700647248715b2f494516565e98401b5` |
| Light shell wrapper | `eff9a0139a355eac61264391f1bfd33ea98f46352f446cbceee3aa58879e252d` |
| Original helper-log prefix, 206,616 bytes | `45677e843661883c58043f0193ee78bb1cabf1a6a0a8728977f11dfb2df3e328` |
| Original cron-log prefix, 205,211 bytes | `0e86b916e7d4ca8004baea564871bff06031455342c3cf451850ac80f8274669` |
| Helper log after natural tick, 207,072 bytes | `27b067f05a360361922fc733c0524e888241b334d97e80abe8e487a089a06cb9` |
| Cron log after natural tick, 205,667 bytes | `c3ee4147ac6b9efbb80646a0a1c0f3b68bbe94a301fca5d8d0f43166fe1ee8a9` |

Deployment review tightened authenticated-session provenance, mandatory
off-device recovery, unknown-outcome handling, nested request timeouts,
strict report/exit-status validation and the expected issue allowlist. Final
independent transaction review found no structural deployment blocker. No
mutation was blindly retried. Earlier preflight corrected a long SSH command
and recognized the existing light-cron symlink without relaxing helper-file
guards. Browser smoke initially hit macOS's socket-path length limit; a shorter
isolated session name repaired the harness, with no application changes.

Independent natural-tick re-review found no remaining blocker. Its observer
never executes the helper/wrapper, requires nonempty matching appended
reports for completion, validates exact schema/disabled policy/boolean
snapshot fields, and keeps unknown identity/hash/schema/state failures hard.
Known busy/cooling/queued/pending/helper-running states return retry-later,
not verification; valid earlier busy reports are not mistaken for failure.
Eleven local report-validator and 22 mocked gate checks passed without network.

The live rollout is complete. Preserve the original
`checks-rollout-inspect.json`; do not rebaseline or repeat installation.
The follow-up is paused. Any future read-only verification still needs fresh
identity and honest state/error reporting; no new approval is required for
the same checks-only policy.

Update survival remains best-effort: the unchanged persistent path/cadence,
dated remote backup and off-device source help recovery, but firmware may
overwrite helpers, cron or `/usr/data`. Any later reinstallation needs fresh
identity, state and exact-target gates; never blindly restore the old helper.
This rollout does not prove that all whole-system CPU spikes are eliminated.

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
