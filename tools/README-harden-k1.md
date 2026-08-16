# harden-k1.sh — keeping the K1 Max stable across firmware updates

Nine fixes, in two sets. Six **stability** fixes stopped this printer from
killing prints with host starvation, filling its disk, and thrashing through
every boot. Three **policy** fixes are the de-Creality set: cloud daemons off,
plain-MQTT telemetry blocked. Every one of them lives in a path a Creality
firmware update wipes. Before this script existed, the only copy of them was a
chat log.

```sh
PRINTER_HOST=your-printer ./tools/harden-k1.sh                 # report only
PRINTER_HOST=your-printer ./tools/harden-k1.sh --apply         # stability fixes
PRINTER_HOST=your-printer ./tools/harden-k1.sh --apply --policy    # + de-Creality
PRINTER_HOST=your-printer ./tools/harden-k1.sh --apply --include-user-scripts
```

`--check` is the default. The script reports and exits non-zero if anything is
missing; it changes nothing unless you pass `--apply`. It refuses to do
anything at all — including `--check` — while a print is running, because the
whole point of these fixes is that this machine has no memory headroom to
spare, and a status report is not worth a page eviction.

The policy set (fixes 7–9) is opt-in by design: `--check` always *reports* it
(labelled `[policy]`), but only *counts* it toward the exit code with
`--policy`, and `--apply` never touches it without `--policy`. Stability
without de-Creality is a supported end state — a future owner who wants
Creality Cloud back keeps fixes 1–6 and simply never passes the flag.

Exit codes: `0` all present, `1` something missing or an apply failed, `2`
refused (printer busy, state unknown, bad input, no SSH).

## The failure being fixed

The K1 Max has 214 MB of usable RAM and two cores. Klipper's `klippy` process
is latency-critical: if its anonymous pages get evicted to swap, a page-in at
the wrong moment shows up as lost step timing and the print dies. It already
runs at `nice -20`, which never helped, because **the starvation was swap
page-in I/O, not CPU scheduling.** Every one of these four fixes reduces memory
pressure. None of them touches priority.

Measured on the printer, before and after all four:

| Metric | Before | After |
| --- | --- | --- |
| Load average | 25.06 | 2.04 |
| Swap in use | 117.3 MB | 30.0 MB |
| Available memory | 81 MB | 128 MB |
| `klippy` swapped out | 8.0 MB | 1.0 MB |

## The stability fixes

### 1. `/opt/etc/init.d/S06tailscaled` — contain the Go runtime

```sh
PREARGS="nice -n 19 nohup"
export GOMEMLIMIT=24MiB
export GOGC=40
```

`tailscaled` is the largest resident Go process on the box. `GOMEMLIMIT` makes
the Go runtime collect instead of growing into swap. **43.6 MB RSS + 29.2 MB
swap → 15.1 MB RSS + 0 swap.**

**Do not remove `--tun=userspace-networking` from `ARGS`.** This box has no
`/dev/net/tun` and no `modprobe`, so kernel-mode networking is not available at
all — tailscaled simply will not start without userspace networking. The script
checks for that flag and *refuses to apply fix 1* if it is missing, rather than
writing a containment block into an init script that cannot run.

### 2. The tailscale watchdog — stop paying for liveness

Moved from `/opt/etc/cron.1min` to `/opt/etc/cron.5mins`, and its per-tick
`tailscale status` replaced with `pidof`.

This was the real page-eviction driver, and it is the least obvious of the
four. The watchdog itself looked cheap. It was not: `tailscale status` forks a
*second* 15–20 MB Go binary, every 60 seconds, on a 214 MB machine. The daemon
being watched was never the problem — the watching was. `pidof` costs nothing.
The CLI probe still has real diagnostic value against a wedged-but-running
daemon, so it is kept and throttled to at most once per 30 minutes.

### 3. `/usr/data/scripts/light-watchdog.sh` — deprioritise the python tick

```sh
exec /usr/bin/python3 ...   ->   exec nice -n 19 /usr/bin/python3 ...
```

**This file belongs to the owner, not to Regolith.** `--check` reports whether
the wrapper is present. `--apply` alone will *not* touch it: it prints the
one-line change and stops. Rewriting it requires the additional explicit
`--include-user-scripts` flag, and even then the script prints a notice naming
the file as owner-authored before it writes.

The same rule covers the fix 2 watchdog body: anything under
`/usr/data/scripts` (`USER_SCRIPTS_DIR`) needs the opt-in. Without it, fix 2
still moves the cron entry — that lives in Entware's tree and is fair game —
but leaves the script it points at exactly as the owner wrote it.

### 4. `/etc/init.d/S98swap` — `vm.swappiness` 10 → 1

Keeps klippy's anonymous pages resident. This is the fix that directly
addresses the mechanism; the other three reduce the pressure that made the
kernel want to swap in the first place.

The init script only runs at boot, so editing it alone leaves the fix dormant.
`--apply` also writes `/proc/sys/vm/swappiness` live, which needs no reboot.

### 5. Log rotation — Entware `logrotate` on the 5-minute cron tier

`klippy.log` grows 10–12 MB a day and nothing on the stock firmware rotates
it. This came out of a disk audit that reclaimed **1.01 GB of `/usr/data`
(2.49 GB → 1.44 GB used, 39% → 22%)** — old Creality timelapse videos,
superseded OTA images, and a pile of unrotated logs. The one part of that
which grows back on its own is the logs, so fix 5 makes rotation permanent:
`opkg install logrotate`, a config at `/opt/etc/logrotate.d/regolith`
(`klippy.log` + `moonraker.log`, `size 10M`, `rotate 3`, `compress`,
`copytruncate`), and a trigger in `/opt/etc/cron.5mins` riding the existing
Entware run-parts tier — no new daemon on a 214 MB box.

`copytruncate` was verified safe on this firmware before it went in: both
klippy and moonraker hold their logs through `O_APPEND` descriptors (checked
via `/proc` fdinfo flags), so nothing is lost in the copy window and neither
daemon needs a signal.

### 6. `S06tailscaled` → `S99tailscaled` — boot-storm deferral

At power-on every service starts at once and the box swaps for minutes.
Profiling the boot window put tailscaled at the top of it — **223 cumulative
%CPU, the single largest boot-window consumer** — and it is the one big
consumer that is not on the print path (its own watchdog self-heals it later
regardless). Fix 6 renames the init to `S99tailscaled` (last in Entware rc
order) and adds a boot-once 90-second self-delay: on the first `start` of each
boot it sets a tmpfs flag (`/tmp/.regolith-ts-boot-done`, self-resetting at
power loss) and spawns a detached `sleep 90; start` instead of starting.

Two details are load-bearing. First, `rc.unslung` **sources** these init
scripts, so the wrapper contains no `exit` — an `exit` there would kill the
boot sequence itself. The tests assert this. Second, the tailscale watchdog
must be retargeted at the new name, or a crashed tailscaled would stay down
forever; the script rewrites that reference (with the usual owner-file opt-in
if the watchdog body lives under `/usr/data/scripts`) and treats a stale
reference as fix 6 being incomplete. If the watchdog fires inside the 90s
window it just starts tailscaled early — harmless, since `rc.func`
pidof-guards against a double run.

## The policy set (`--policy`) — de-Creality

These three are **choices, not repairs**. The printer prints identically with
or without them; they exist because of what a telemetry audit found. They are
grouped behind `--policy` so the stability set can outlive the opinion.

### 7. `S97webrtc` — Creality Cloud remote access, disabled

The webrtc daemon is Creality Cloud remote access/video (its strings reference
`api.crealitycloud.com`, a JWT join message, Google STUN). On this printer it
was dormant in every sample — it needs a cloud binding this device does not
have — and it has no local consumer: the camera tile is served by cam_app →
mjpg_streamer on :8080. The subtlety is *how* to disable it: Creality's
Monitor process resurrects it via `/etc/init.d/S97webrtc restart` — the script
itself — so killing the process or masking the binary is undone within
seconds. The guard therefore lives at the top of `start()` and returns 0 while
the flag file `/usr/data/regolith-disabled/webrtc` exists (the flag file's
content documents all of this). Observed on hardware: Monitor's restart
attempt hit the guard and webrtc stayed down through repeated cycles.

### 8. `S95fail2ban` — disabled

3 MB RSS plus 5.8 MB of swap guarding a dropbear that is reachable only from
the LAN and the tailnet — and with no iptables chains present on this
firmware, a ban could not even be enforced. `ENABLED=no` in the Entware init;
the daemon was pure cost.

### 9. `mqtt.crealitycloud.com` → `127.0.0.1` — the telemetry block

The finding that motivated the whole set: **app-server (a ThingsBoard IoT
client) held a persistent, plaintext MQTT session (port 1883, unencrypted) to
`mqtt.crealitycloud.com` (47.253.214.226, Alibaba Cloud) and its own log
showed active `Telemetry send` of bed/box/nozzle temperatures and feedrate,
plus `Attributes send` — on a device that is cloud-UNBOUND (`uid`/`tb_token`
null) and has `data_collect: 0`.** The opt-out did not stop the stream.

It is blocked in `/etc/hosts` rather than by disabling the daemon because
app-server cannot be cleanly disabled: Monitor execs `/usr/bin/app-server` by
direct path (`killall -9 app-server` and the binary path are in Monitor's
strings), so there is no init script to guard, and app-server may also serve
the Creality Print LAN protocol. The hosts entry survives Monitor's
resurrection cycle; after the block the daemon settled at a single stable pid
making ~2 quiet reconnect attempts a minute, no crash loop. `--apply --policy`
bounces app-server after writing the entry (Monitor restarts it within
seconds, now unable to resolve the broker).

Left unblocked, deliberately: `api.crealitycloud.com` (zero observed traffic;
blocking could confuse OTA/binding flows a future owner may want) and the
OTA/QR CDNs. They are documented rather than fought.

## What a firmware update wipes

- `/etc/init.d/` and `/etc/hosts` are on overlayfs. A firmware update restores
  the stock tree, so **fix 4, the fix 7 guard, and the fix 9 hosts block are
  gone.**
- `/opt` (Entware) survives an update, but only starts if `/etc/init.d/S50unslung`
  survives — and that is on overlayfs too. **Fixes 1, 2, 5, 6, and 8 are still
  on disk but may never run.**
- An `S96wipe_data` clears `/usr/data`, taking **fix 3**, the watchdog body,
  the `regolith-disabled` flag files, and the backups with it.

So after any firmware update: run `--check` (with `--policy` if you use the
policy set). It tells you which of the nine came back broken and in which way.

## The ironic failure mode

A firmware update can restore the *original broken* `S50unslung` — the one with
a literal `\n` in its shebang instead of a newline. That file is Entware's boot
hook. When it is broken, Entware never starts.

Which means: **the printer becomes accidentally healthy.** No tailscaled, no
watchdog cron, no Entware anything. Load drops, swap drops, prints stop dying.

This is worth naming because it is exactly the shape of result that ends an
investigation early. The symptom disappears, so the problem looks solved, and
what actually happened is that an entire subsystem was disabled by a typo. If
you ever see this machine get dramatically healthier after a firmware update
*without* anyone re-applying these fixes, check `S50unslung` first — you have
almost certainly masked this class of failure rather than fixed it, and it will
come back the moment Entware is repaired.

The repair is two lines:

```sh
printf '#!/bin/sh\n/opt/etc/init.d/rc.unslung "$1"\n' > /etc/init.d/S50unslung
chmod 755 /etc/init.d/S50unslung
```

Relatedly, `--check` prints an **advisory** for any *other* 60-second cron entry
that invokes the tailscale CLI — Regolith's own `regolith-tailscale` status
writer is the likely one — because that pays exactly the per-tick cost fix 2
removed. It is reported, never modified, and never fails the run.

## Safety properties

- **Idempotent.** Only fixes that inspection found missing are touched. A second
  `--apply` finds nothing to do and exits 0 without writing.
- **Backed up.** Every modified file is copied to
  `/usr/data/regolith-harden-backups/` with a timestamped suffix, and the exact
  `cp -p` restore command is printed for each. Backups deliberately do **not**
  sit beside the original: a stray `S06tailscaled.bak` in an `init.d` directory
  still matches the boot glob and would be executed at startup.
- **Syntax-checked.** Every rewrite is `sh -n`-validated before it replaces
  anything, and written through `cat >` so the original inode, mode, and owner
  survive.
- **Never touches `printer.cfg`.** Targeting it is refused outright.
- **Never reflashes, never reboots.**
- **No secrets.** Host and account come from `PRINTER_HOST` / `PRINTER_USER`.
  Key-based SSH first, `sshpass -e` fallback so nothing enters argv — the same
  contract as `deploy.sh`.

## Retargeting another printer

Everything K1-specific sits in one clearly marked block at the top of the
script and is overridable: `TS_INIT`, `TS_INIT_DEFERRED`, `CRON_FAST`,
`CRON_SLOW`, `LIGHT_WD`, `SWAP_INIT`, `USER_SCRIPTS_DIR`, `HARDEN_BACKUP_DIR`,
`WATCHDOG_GLOB`, `OPKG_BIN`, `LOGROTATE_BIN`, `LOGROTATE_CONF`,
`LOGROTATE_DROPIN_DIR`, `LOGROTATE_STATE`, `KLIPPER_LOG_DIR`, `WEBRTC_INIT`,
`F2B_INIT`, `HOSTS_FILE`, `DISABLED_DIR`. The detection and repair logic below
that block is generic. Paths are validated strictly before being spliced into
a remote shell.

## Tests

`tests/harden-k1.test.sh` (43 cases, wired into `bun run test`, or
`bun run test:harden` on its own). Its `ssh` mock does not pattern-match the
remote payload — it executes it, with `sh`, against a sandbox filesystem, so
the backups, rewrites, cron moves, and hosts edits under test are real (even
the fix 5 `opkg install` runs, against a fake opkg that drops the binary where
the real package would). It covers idempotency, both `--check` exit codes,
refusal while printing, backup creation and placement, the owner-file gate,
the `--tun` guard, the exit-free deferred-start wrapper, the policy-flag
separation (never applied, never counted, always reported without `--policy`),
and that every remote payload parses as POSIX `sh`.
