# Lower-startup light watchdog

No installer, cron edits, printer connections, or automatic deployment are
included. The owner-authored files under `scripts/` remain intact. The specific
guarded K1 Max installation on October 9 is recorded in `working.md`; copying
this repository does not install or enable a helper on another printer.

`light-watchdog.py` uses the standard `http.client.HTTPConnection` for the normal
loopback request, avoiding the heavy `urllib.request` and `typing` imports.
`http.client` itself still imports `urllib.parse`; it is not fully urllib-free.
Redirect responses fail closed rather than following another destination or
repeating an LED POST. HTTP parsing stays in Python's standard library; there is no custom
socket protocol, daemon, added dependency, or process-spawning code.

## Behavior retained

- One-shot execution; existing one-minute cron scheduling remains unchanged.
- 600-second idle threshold; printing, paused, `idle_timeout=Printing`, and
  three-decimal XYZ motion reset activity. Extruder-only motion does not.
- Same JSON state/log paths, log rotation, state writes, and LED-on checks.
- Same object query and exact `SET_PIN PIN=LED VALUE=0` LED-off command.
- Five-second socket timeout and next-tick retry on unavailable or invalid JSON.
- Failed LED writes log the same message and retain the original state behavior.

Deliberate transport hardening: HTTP redirects fail closed (no redirect is part
of the actual fixed loopback Moonraker API). The original urllib transport could
follow redirects. Neither normal mode nor read-only check leaves loopback or
repeats a command. Malformed HTTP framing additionally fails closed instead of escaping as an
uncaught HTTP-parser exception. Malformed object/state values retain the original
behavior, including original type/conversion errors; this is not a state-repair
or safety-policy rewrite. Five seconds is the socket timeout, **not** a new
whole-request deadline. No retries are added on the ordinary response path.

## Read-only live measurement mode

`python3 light-watchdog.py --check` (or `--dry-run`) performs only the object
query, with no state loads/writes, logs, or LED command. Exit code is 0 for a
nonempty parsed response and 1 for unavailable/empty data. It does not assert
that the printer is idle or safe to deploy. Running **without** either flag
retains the real automatic LED-off behavior and must not be used for read-only QA.

## Offline verification

```sh
python3 printer-helpers/test_light_watchdog.py
python3 printer-helpers/benchmark_startup.py 15
```

Tests fake both HTTP transports and compare original/candidate state, logs,
requests, and return/error outcomes. They cover the idle boundary, printing,
pause, macro execution, XYZ/extruder/sub-precision movement, initial/missing/
corrupt state, clock rollback, LED values, invalid/empty JSON, HTTP errors,
connection failure, slow body, LED failure, state/log I/O errors, redirect rejection,
parser failures, GET-only check mode, and static one-shot/command scope.

`fixtures/original-light-watchdog.py` is the unchanged owner-authored snapshot
used for clean-checkout equivalence; SHA-256
`d150bd58cea24cce3f73aa8abf29aaf4fac1c90e017c4ceefd863ebf86679e7f`.
Tests also confirm originals remain unchanged when the local `scripts/` files
exist. Real socket creation is prohibited throughout the offline test suite.

The benchmark alternates fresh processes and only imports modules; neither
watchdog's `main()` runs. Local timings cannot establish printer CPU peak
improvement. Device timing and exact deployed behavior remain separate gates.

Local Mac / Python 3.11.1, 15 alternating runs on October 9, 2026:

| Median | Original | Candidate |
| --- | --- | --- |
| Module import CPU | 26.911 ms | 19.249 ms |
| Module import wall time | 27.063 ms | 19.336 ms |
| Full subprocess wall time | 54.778 ms | 44.828 ms |

These local results show about 28% lower import CPU and 18% lower subprocess
wall time, not a measured reduction in printer CPU spikes.

Promoting this helper requires an explicit reversible cron-target switch or
script replacement while preserving the original wrapper, backups, permissions,
and one-minute cadence. This directory does not perform that promotion.

## K1 Max read-only measurements — October 9, 2026

Five interleaved original/candidate pairs on the printer's `/usr/bin/python3`,
nice 19, with browser workload closed. Exact source was sent through stdin,
loaded with a non-runtime module name, then only `http_get_json` was called.
No helper was installed or normal `main()` executed during this benchmark.
All ten loopback status GETs returned valid status. Median import CPU:
0.4978s → 0.3798s; instrumented process CPU: 0.8374s → 0.6978s (about 17%
lower); peak RSS: 10,580 → 9,432 kB (about 11% lower).

The identical timing harness contributes baseline overhead to both versions.
This supports lower startup cost, not elimination of every system CPU spike.
Raw results are retained in the ignored run's `artifacts/cpu/helper-benchmark.json`.

The exact tested helper was subsequently installed at 15:52:46 UTC, preserving
the existing wrapper, priority, one-minute schedule, state, permissions and
ten-minute timeout. The original is in a verified persistent rollback file.
Natural scheduled ticks were observed without changing the already-off light.
No physical print, motion, or automatic-light transition test was performed.
