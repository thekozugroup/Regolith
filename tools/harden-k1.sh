#!/usr/bin/env bash
# Re-apply the fixes that keep a Creality K1 Max printing — and, opted in,
# the de-Creality policy set.
#
# Every one of these fixes lives in a path a Creality firmware update wipes
# (/etc/init.d and /opt/etc on overlayfs) or that an S96wipe_data can clear.
# This script is the durable copy: run --check after a firmware update to see
# what came back broken, then --apply to put it back.
#
# Fixes 1-6 are STABILITY: memory containment, watchdog cost, swappiness,
# log rotation, boot-storm deferral. Fixes 7-9 are POLICY: disabling Creality
# cloud daemons and blocking plain-MQTT telemetry. Policy fixes are only ever
# applied with the explicit --policy flag, and their absence never fails a run
# without it — a future owner can keep the stability set and none of the rest.
#
# Usage:
#   ./tools/harden-k1.sh                          # --check (default), changes nothing
#   ./tools/harden-k1.sh --check                  # report present/absent/partial
#   ./tools/harden-k1.sh --check --policy         # also count the policy fixes
#   ./tools/harden-k1.sh --apply                  # re-apply the stability fixes
#   ./tools/harden-k1.sh --apply --policy         # also apply the de-Creality set
#   ./tools/harden-k1.sh --apply --include-user-scripts
#                                                 # also touch owner-authored scripts
#
# Environment (no host, address, or credential is baked into this file):
#   PRINTER_HOST   printer hostname or LAN address     (forge.local)
#   PRINTER_USER   SSH account on the printer          (root)
#
# SSH keys are the supported way in. SSH into the printer once, then run
#   ssh-copy-id PRINTER_USER@PRINTER_HOST
# and every later run is passwordless. Without a key this falls back to
# PRINTER_PASSWORD or a silent prompt through sshpass -e, so the secret never
# enters argv. Same contract as deploy.sh.
#
# This script never writes printer.cfg, never reflashes, never reboots, and
# refuses to do anything at all while a print is running.
#
# Exit codes:
#   0  every fix is present (--check), or applied and verified (--apply)
#   1  one or more fixes are absent, or an apply/verify failed
#   2  refused: printer busy, printer state unknown, bad input, no SSH

set -Eeuo pipefail

# Resolved from the environment before anything below is made readonly.
PRINTER_USER="${PRINTER_USER:-root}"
PRINTER_HOST="${PRINTER_HOST:-forge.local}"

# ---------------------------------------------------------------------------
# K1-SPECIFIC LAYOUT. Everything below this banner is Creality K1 / Entware
# geography and nothing else in this script hardcodes a path. To harden a
# different Klipper box, override these; the detection and repair logic is
# generic. Defaults match a K1 Max running Entware under /opt.
# ---------------------------------------------------------------------------
TS_INIT="${TS_INIT:-/opt/etc/init.d/S06tailscaled}"      # Entware tailscaled init
TS_INIT_DEFERRED="${TS_INIT_DEFERRED:-/opt/etc/init.d/S99tailscaled}"  # after the fix-6 rename
CRON_FAST="${CRON_FAST:-/opt/etc/cron.1min}"             # busybox run-parts, 60s tier
CRON_SLOW="${CRON_SLOW:-/opt/etc/cron.5mins}"            # busybox run-parts, 5min tier
LIGHT_WD="${LIGHT_WD:-/usr/data/scripts/light-watchdog.sh}"
SWAP_INIT="${SWAP_INIT:-/etc/init.d/S98swap}"            # firmware init, overlayfs
USER_SCRIPTS_DIR="${USER_SCRIPTS_DIR:-/usr/data/scripts}"
HARDEN_BACKUP_DIR="${HARDEN_BACKUP_DIR:-/usr/data/regolith-harden-backups}"
OPKG_BIN="${OPKG_BIN:-/opt/bin/opkg}"                    # Entware package manager
LOGROTATE_BIN="${LOGROTATE_BIN:-/opt/sbin/logrotate}"    # installed by fix 5
LOGROTATE_CONF="${LOGROTATE_CONF:-/opt/etc/logrotate.conf}"
LOGROTATE_DROPIN_DIR="${LOGROTATE_DROPIN_DIR:-/opt/etc/logrotate.d}"
LOGROTATE_STATE="${LOGROTATE_STATE:-/opt/var/logrotate.state}"
KLIPPER_LOG_DIR="${KLIPPER_LOG_DIR:-/usr/data/printer_data/logs}"
WEBRTC_INIT="${WEBRTC_INIT:-/etc/init.d/S97webrtc}"      # Creality Cloud webrtc, overlayfs
F2B_INIT="${F2B_INIT:-/opt/etc/init.d/S95fail2ban}"      # Entware fail2ban init
HOSTS_FILE="${HOSTS_FILE:-/etc/hosts}"
DISABLED_DIR="${DISABLED_DIR:-/usr/data/regolith-disabled}"  # self-documenting flag files
# Glob that identifies the tailscale watchdog cron entry. Deliberately narrow:
# Regolith's own /opt/etc/cron.1min/regolith-tailscale status writer is a
# different thing and is never moved or rewritten by this script.
WATCHDOG_GLOB="${WATCHDOG_GLOB:-*tailscale*watchdog*}"
# ---------------------------------------------------------------------------
# END K1-SPECIFIC LAYOUT
# ---------------------------------------------------------------------------

MODE="check"
INCLUDE_USER_SCRIPTS=0
INCLUDE_POLICY=0
TARGET=""
TEMP_DIR=""
declare -a SSH_COMMAND=()
declare -a RESTORE_COMMANDS=()

step() { printf '\n==> %s\n' "$*"; }
ok() { printf '    OK  %s\n' "$*"; }
info() { printf '    --  %s\n' "$*"; }
warn() { printf '    WARN  %s\n' "$*" >&2; }
fail() { printf '    ERROR  %s\n' "$*" >&2; exit 2; }

usage() {
  cat <<'USAGE'
harden-k1.sh — re-apply the K1 Max stability fixes, and optionally the
de-Creality policy set.

  ./tools/harden-k1.sh                    report only (default), changes nothing
  ./tools/harden-k1.sh --check            same as above
  ./tools/harden-k1.sh --check --policy   also count the policy fixes as missing
  ./tools/harden-k1.sh --apply            re-apply the stability fixes (1-6)
  ./tools/harden-k1.sh --apply --policy   also apply the de-Creality set (7-9)
  ./tools/harden-k1.sh --apply --include-user-scripts
                                          also repair owner-authored scripts
  ./tools/harden-k1.sh --help

Fixes 1-6 are stability (starvation, logs, boot storm); 7-9 are policy
(webrtc off, fail2ban off, Creality MQTT telemetry blocked). Without
--policy the policy fixes are reported but never applied and never counted.

Environment: PRINTER_HOST (forge.local), PRINTER_USER (root).
Exit 0 = all present, 1 = something missing or failed, 2 = refused.
See tools/README-harden-k1.md for what each fix does and why.
USAGE
}

for argument in "$@"; do
  case "$argument" in
    --check) MODE="check" ;;
    --apply) MODE="apply" ;;
    --include-user-scripts) INCLUDE_USER_SCRIPTS=1 ;;
    --policy) INCLUDE_POLICY=1 ;;
    --help | -h)
      usage
      exit 0
      ;;
    *) fail "Unknown option: $argument" ;;
  esac
done

# ---------------------------------------------------------------------------
# Input validation. Every remote path below is spliced into a remote shell, so
# these validators are the only thing between an override and root on the
# printer. Keep them strict. Same rules as deploy.sh.
# ---------------------------------------------------------------------------
validate_host() {
  local host="$1"
  local label
  local -a labels
  [ "${#host}" -le 253 ] || return 1
  [[ "$host" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || return 1
  [[ "$host" != *..* && "$host" != *.-* && "$host" != *-. && "$host" != *-.* ]] || return 1
  IFS='.' read -r -a labels <<< "$host"
  for label in "${labels[@]}"; do
    [ -n "$label" ] || return 1
    [ "${#label}" -le 63 ] || return 1
    [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || return 1
  done
}

validate_absolute_path() {
  local path="$1"
  [ "${#path}" -le 128 ] || return 1
  [[ "$path" =~ ^/[A-Za-z0-9._/-]+$ ]] || return 1
  [[ "$path" != *//* && "$path" != */ && "$path" != *..* ]] || return 1
}

validate_path_segment() {
  local segment="$1"
  [ "${#segment}" -le 64 ] || return 1
  [[ "$segment" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || return 1
  [[ "$segment" != *..* ]] || return 1
}

validate_glob() {
  local glob="$1"
  [ "${#glob}" -le 64 ] || return 1
  [[ "$glob" =~ ^[A-Za-z0-9.*_-]+$ ]] || return 1
}

validate_host "$PRINTER_HOST" || fail "Invalid PRINTER_HOST. Use forge.local or a plain trusted LAN hostname/IP."
validate_path_segment "$PRINTER_USER" || fail "Invalid PRINTER_USER. Use a plain account name such as root."
for candidate_path in "$TS_INIT" "$TS_INIT_DEFERRED" "$CRON_FAST" "$CRON_SLOW" \
  "$LIGHT_WD" "$SWAP_INIT" "$USER_SCRIPTS_DIR" "$HARDEN_BACKUP_DIR" \
  "$OPKG_BIN" "$LOGROTATE_BIN" "$LOGROTATE_CONF" "$LOGROTATE_DROPIN_DIR" \
  "$LOGROTATE_STATE" "$KLIPPER_LOG_DIR" "$WEBRTC_INIT" "$F2B_INIT" \
  "$HOSTS_FILE" "$DISABLED_DIR"; do
  validate_absolute_path "$candidate_path" \
    || fail "Invalid target path: ${candidate_path}. Use an absolute path such as /etc/init.d/S98swap."
done
validate_glob "$WATCHDOG_GLOB" || fail "Invalid WATCHDOG_GLOB. Use a plain glob such as *tailscale*watchdog*."

# Hard refusal, independent of the validators: this tool has no business near
# Klipper configuration. A firmware fix that edits printer.cfg is a different
# and much more dangerous tool than this one.
for candidate_path in "$TS_INIT" "$TS_INIT_DEFERRED" "$LIGHT_WD" "$SWAP_INIT" \
  "$WEBRTC_INIT" "$F2B_INIT" "$HOSTS_FILE" "$LOGROTATE_DROPIN_DIR" "$KLIPPER_LOG_DIR"; do
  case "$candidate_path" in
    *printer.cfg | */printer_data/config/*)
      fail "Refusing to target ${candidate_path}. This script never writes Klipper configuration."
      ;;
  esac
done

# Derived paths, and the one hostname this script exists to blackhole.
# mqtt.crealitycloud.com is Creality's telemetry broker, not anything of the
# owner's: app-server streams temperatures and feedrate there over plain MQTT
# even when the device is cloud-unbound with data_collect=0.
LOGROTATE_DROPIN="${LOGROTATE_DROPIN_DIR}/regolith"
LOGROTATE_TRIGGER="${CRON_SLOW}/logrotate-regolith"
MQTT_TELEMETRY_HOST="mqtt.crealitycloud.com"

readonly PRINTER_USER TS_INIT TS_INIT_DEFERRED CRON_FAST CRON_SLOW LIGHT_WD SWAP_INIT
readonly USER_SCRIPTS_DIR HARDEN_BACKUP_DIR WATCHDOG_GLOB
readonly OPKG_BIN LOGROTATE_BIN LOGROTATE_CONF LOGROTATE_DROPIN_DIR LOGROTATE_STATE
readonly KLIPPER_LOG_DIR WEBRTC_INIT F2B_INIT HOSTS_FILE DISABLED_DIR
readonly LOGROTATE_DROPIN LOGROTATE_TRIGGER MQTT_TELEMETRY_HOST
TARGET="${PRINTER_USER}@${PRINTER_HOST}"

STAMP="$(date +%Y%m%d-%H%M%S)"
[[ "$STAMP" =~ ^[0-9]{8}-[0-9]{6}$ ]] || fail "Could not build a timestamp suffix."
readonly STAMP

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing $1. Install it, then retry."
}

remote() {
  "${SSH_COMMAND[@]}" "$TARGET" "$@"
}

# shellcheck disable=SC2329  # invoked indirectly by the EXIT trap below.
cleanup() {
  local status=$?
  trap - EXIT
  set +e
  if [ -n "$TEMP_DIR" ] && [[ "$TEMP_DIR" == /tmp/regolith-harden.* ]]; then
    rm -rf "$TEMP_DIR"
  fi
  unset SSHPASS PRINTER_PASSWORD
  exit "$status"
}
trap cleanup EXIT

require_command ssh
require_command curl
CURL_BIN="$(command -v curl)"

SSH_OPTIONS=(
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=10
  -o ServerAliveInterval=10
  -o ServerAliveCountMax=3
)

step "Connect to ${PRINTER_HOST}"
# Key authentication is the primary path and is always tried first.
if ssh "${SSH_OPTIONS[@]}" -o BatchMode=yes "$TARGET" true >/dev/null 2>&1; then
  SSH_COMMAND=(ssh "${SSH_OPTIONS[@]}" -o BatchMode=yes)
  ok "SSH key authentication"
else
  warn "No usable SSH key for ${TARGET}. Keys are the supported path:"
  warn "  ssh ${TARGET}              # trust the printer once"
  warn "  ssh-copy-id ${TARGET}      # then every run needs no password"
  warn "Falling back to password authentication for this run only."
  if [ -z "${PRINTER_PASSWORD:-}" ]; then
    if [ -t 0 ]; then
      read -r -s -p "Printer password for ${TARGET}: " PRINTER_PASSWORD
      printf '\n'
    else
      fail "SSH key authentication failed. Run 'ssh-copy-id ${TARGET}', or set PRINTER_PASSWORD with sshpass installed."
    fi
  fi
  require_command sshpass
  export SSHPASS="$PRINTER_PASSWORD"
  unset PRINTER_PASSWORD
  SSH_COMMAND=(sshpass -e ssh "${SSH_OPTIONS[@]}")
  remote true >/dev/null 2>&1 || fail "Authentication failed for ${TARGET}. Check PRINTER_USER, or run 'ssh-copy-id ${TARGET}'."
  ok "Password authentication through sshpass -e (run ssh-copy-id to skip this)"
fi

TEMP_DIR="$(mktemp -d /tmp/regolith-harden.XXXXXX)"

# ---------------------------------------------------------------------------
# Print-safety guard. This runs in BOTH modes, not just --apply. The entire
# reason these fixes exist is that this box has 214MB of RAM and loses Klipper
# timing when something else evicts klippy's pages; an SSH session plus a
# handful of greps is small, but it is not zero, and no report is worth a
# ruined print. Check when the machine is idle.
# ---------------------------------------------------------------------------
step "Confirm the printer is idle"
state_json="$($CURL_BIN --fail --silent --show-error --connect-timeout 5 --max-time 10 \
  "http://${PRINTER_HOST}/printer/objects/query?print_stats&idle_timeout&webhooks&virtual_sdcard")" \
  || fail "Moonraker state query failed. Hardening refuses unknown printer state."

require_command bun
BUN_BIN="$(command -v bun)"
printer_state="$(printf '%s' "$state_json" | "$BUN_BIN" -e '
  try {
    const data = JSON.parse(await Bun.stdin.text());
    const status = data?.result?.status;
    const values = [
      status?.webhooks?.state,
      status?.print_stats?.state,
      status?.idle_timeout?.state,
      status?.virtual_sdcard?.is_active,
    ];
    if (typeof values[0] !== "string" || typeof values[1] !== "string" ||
        typeof values[2] !== "string" || typeof values[3] !== "boolean") {
      process.exit(2);
    }
    process.stdout.write(values.join("|"));
  } catch {
    process.exit(2);
  }
')" || fail "Moonraker returned incomplete state. Hardening refuses unknown printer state."

IFS='|' read -r klipper_state print_state idle_state sd_active <<< "$printer_state"
[ "$klipper_state" = "ready" ] || fail "Klipper state is ${klipper_state}; expected ready."
case "$print_state" in
  standby | complete | cancelled) ;;
  *) fail "Print state is ${print_state}; hardening requires idle/standby." ;;
esac
case "$idle_state" in
  Idle | Ready) ;;
  *) fail "Printer activity is ${idle_state}; hardening requires idle." ;;
esac
[ "$sd_active" = "false" ] || fail "Virtual SD job is active; hardening blocked."
ok "Printer is conclusively idle (${print_state}, ${idle_state})"

# ---------------------------------------------------------------------------
# Remote inspection. Emits one machine-readable line per finding and never
# writes anything. Parsed below into FIX*_STATE.
# ---------------------------------------------------------------------------
remote_check_script() {
  cat <<REMOTE_VARS
TS_INIT='${TS_INIT}'
TS_INIT_DEFERRED='${TS_INIT_DEFERRED}'
CRON_FAST='${CRON_FAST}'
CRON_SLOW='${CRON_SLOW}'
LIGHT_WD='${LIGHT_WD}'
SWAP_INIT='${SWAP_INIT}'
WATCHDOG_GLOB='${WATCHDOG_GLOB}'
USER_SCRIPTS_DIR='${USER_SCRIPTS_DIR}'
OPKG_BIN='${OPKG_BIN}'
LOGROTATE_BIN='${LOGROTATE_BIN}'
LOGROTATE_DROPIN='${LOGROTATE_DROPIN}'
LOGROTATE_TRIGGER='${LOGROTATE_TRIGGER}'
WEBRTC_INIT='${WEBRTC_INIT}'
F2B_INIT='${F2B_INIT}'
HOSTS_FILE='${HOSTS_FILE}'
DISABLED_DIR='${DISABLED_DIR}'
MQTT_HOST='${MQTT_TELEMETRY_HOST}'
REMOTE_VARS
  cat <<'REMOTE_CHECK'
set -u
say() { printf '%s\n' "$*"; }

# Reported so the caller can decide ownership against the same canonical form
# it resolves symlinked cron targets to, rather than against a path that only
# looks different because something above it is a symlink.
canonical_user_dir="$(readlink -f "$USER_SCRIPTS_DIR" 2>/dev/null || true)"
say "USER_DIR_CANONICAL ${canonical_user_dir:-$USER_SCRIPTS_DIR}"

# After fix 6 the tailscaled init lives under its deferred name. Fix 1 must
# inspect and repair whichever of the two actually exists.
TS_ACTIVE="$TS_INIT"
[ -f "$TS_INIT_DEFERRED" ] && TS_ACTIVE="$TS_INIT_DEFERRED"
say "TS_ACTIVE ${TS_ACTIVE}"

# --- Fix 1: tailscaled memory containment ---------------------------------
if [ ! -f "$TS_ACTIVE" ]; then
  say "FIX1 missing-file"
else
  pre=0; lim=0; gogc=0
  grep -q '^PREARGS="nice -n 19 nohup"$' "$TS_ACTIVE" && pre=1
  grep -q '^export GOMEMLIMIT=24MiB$' "$TS_ACTIVE" && lim=1
  grep -q '^export GOGC=40$' "$TS_ACTIVE" && gogc=1
  case "${pre}${lim}${gogc}" in
    111) say "FIX1 present" ;;
    000) say "FIX1 absent" ;;
    *) say "FIX1 partial" ;;
  esac
  if grep -q -- '--tun=userspace-networking' "$TS_ACTIVE"; then
    say "FIX1_TUN present"
  else
    say "FIX1_TUN absent"
  fi
fi

# --- Fix 2: tailscale watchdog cost ---------------------------------------
entry=""
tier=""
body=""
for dir in "$CRON_SLOW" "$CRON_FAST"; do
  [ -d "$dir" ] || continue
  for candidate in "$dir"/$WATCHDOG_GLOB; do
    [ -e "$candidate" ] || continue
    entry="$candidate"
    tier="$dir"
    break
  done
  [ -n "$entry" ] && break
done

if [ -z "$entry" ]; then
  say "FIX2 skip"
else
  say "FIX2_ENTRY ${entry}"
  if [ "$tier" = "$CRON_SLOW" ]; then
    say "FIX2_TIER present"
  else
    say "FIX2_TIER absent"
  fi
  body="$entry"
  if [ -L "$entry" ]; then
    resolved="$(readlink -f "$entry" 2>/dev/null || true)"
    [ -n "$resolved" ] && body="$resolved"
  fi
  say "FIX2_BODY ${body}"
  if [ ! -f "$body" ]; then
    say "FIX2_PROBE missing-file"
  elif grep -q 'regolith-harden: tailscale watchdog' "$body"; then
    say "FIX2_PROBE present"
  else
    say "FIX2_PROBE absent"
  fi
fi

# Advisory only, never a failure: any OTHER 60s-tier job that spawns the
# tailscale CLI pays the same 15-20MB-per-tick cost fix 2 removed.
if [ -d "$CRON_FAST" ]; then
  for candidate in "$CRON_FAST"/*; do
    [ -f "$candidate" ] || [ -L "$candidate" ] || continue
    case "$candidate" in
      $CRON_FAST/$WATCHDOG_GLOB) continue ;;
    esac
    target="$candidate"
    if [ -L "$candidate" ]; then
      resolved="$(readlink -f "$candidate" 2>/dev/null || true)"
      [ -n "$resolved" ] && target="$resolved"
    fi
    [ -f "$target" ] || continue
    if grep -q 'tailscale' "$target" 2>/dev/null; then
      say "ADVISORY_CLI ${candidate}"
    fi
  done
fi

# --- Fix 3: light watchdog scheduling priority (OWNER-AUTHORED FILE) -------
if [ ! -f "$LIGHT_WD" ]; then
  say "FIX3 missing-file"
elif ! grep -q 'python' "$LIGHT_WD"; then
  say "FIX3 no-python"
elif grep -qE 'nice[[:space:]]+-n[[:space:]]+19[[:space:]]+[^[:space:]]*python' "$LIGHT_WD"; then
  say "FIX3 present"
else
  say "FIX3 absent"
fi

# --- Fix 4: swappiness -----------------------------------------------------
if [ ! -f "$SWAP_INIT" ]; then
  say "FIX4 missing-file"
else
  value="$(grep -oE 'vm\.swappiness[[:space:]]*=[[:space:]]*[0-9]+|echo[[:space:]]+[0-9]+[[:space:]]*>[[:space:]]*/proc/sys/vm/swappiness' "$SWAP_INIT" 2>/dev/null \
    | grep -oE '[0-9]+' | tail -1)"
  if [ -z "$value" ]; then
    say "FIX4 no-setting"
  elif [ "$value" = "1" ]; then
    say "FIX4 present"
  else
    say "FIX4 absent"
  fi
  say "FIX4_VALUE ${value:-none}"
fi
if [ -r /proc/sys/vm/swappiness ]; then
  say "FIX4_LIVE $(cat /proc/sys/vm/swappiness)"
fi

# --- Fix 5: log rotation ---------------------------------------------------
if [ ! -x "$LOGROTATE_BIN" ] && [ ! -x "$OPKG_BIN" ]; then
  say "FIX5 no-entware"
else
  lr_bin=0; lr_conf=0; lr_trig=0
  [ -x "$LOGROTATE_BIN" ] && lr_bin=1
  [ -f "$LOGROTATE_DROPIN" ] && grep -q 'copytruncate' "$LOGROTATE_DROPIN" && lr_conf=1
  [ -x "$LOGROTATE_TRIGGER" ] && grep -q 'logrotate' "$LOGROTATE_TRIGGER" && lr_trig=1
  case "${lr_bin}${lr_conf}${lr_trig}" in
    111) say "FIX5 present" ;;
    000) say "FIX5 absent" ;;
    *) say "FIX5 partial" ;;
  esac
fi

# --- Fix 6: tailscaled deferred start (boot storm) -------------------------
if [ ! -f "$TS_INIT" ] && [ ! -f "$TS_INIT_DEFERRED" ]; then
  say "FIX6 missing-file"
else
  renamed=0; wrapped=0
  if [ -f "$TS_INIT_DEFERRED" ] && [ ! -f "$TS_INIT" ]; then renamed=1; fi
  [ -f "$TS_INIT_DEFERRED" ] && grep -q 'regolith-ts-boot-done' "$TS_INIT_DEFERRED" && wrapped=1
  case "${renamed}${wrapped}" in
    11) say "FIX6 present" ;;
    00) say "FIX6 absent" ;;
    *) say "FIX6 partial" ;;
  esac
fi
# The watchdog must start the init under its post-rename name, or a crashed
# tailscaled stays down. Compared by basename: the watchdog body references
# the real on-printer path even when this check runs against a sandbox.
ts_base="${TS_INIT##*/}"
ts_def_base="${TS_INIT_DEFERRED##*/}"
if [ -n "$body" ] && [ -f "$body" ] && grep -q "$ts_base" "$body"; then
  say "FIX6_WD stale"
elif [ -n "$body" ] && [ -f "$body" ] && grep -q "$ts_def_base" "$body"; then
  say "FIX6_WD present"
else
  say "FIX6_WD skip"
fi

# --- Fix 7 (policy): Creality webrtc disabled ------------------------------
if [ ! -f "$WEBRTC_INIT" ]; then
  say "FIX7 missing-file"
else
  guard=0; flag=0
  grep -q 'regolith-harden: webrtc' "$WEBRTC_INIT" && guard=1
  [ -f "${DISABLED_DIR}/webrtc" ] && flag=1
  case "${guard}${flag}" in
    11) say "FIX7 present" ;;
    00) say "FIX7 absent" ;;
    *) say "FIX7 partial" ;;
  esac
fi

# --- Fix 8 (policy): fail2ban disabled -------------------------------------
if [ ! -f "$F2B_INIT" ]; then
  say "FIX8 skip"
elif grep -q '^ENABLED=no' "$F2B_INIT"; then
  say "FIX8 present"
else
  say "FIX8 absent"
fi

# --- Fix 9 (policy): Creality MQTT telemetry blocked -----------------------
if [ -f "$HOSTS_FILE" ] && grep -q "$MQTT_HOST" "$HOSTS_FILE"; then
  say "FIX9 present"
else
  say "FIX9 absent"
fi

say "CHECK_DONE"
exit 0
REMOTE_CHECK
}

FIX1_STATE="unknown"
FIX1_TUN="unknown"
FIX2_STATE="unknown"
FIX2_TIER="unknown"
FIX2_PROBE="unknown"
FIX2_ENTRY=""
FIX2_BODY=""
FIX3_STATE="unknown"
FIX4_STATE="unknown"
FIX4_VALUE="none"
FIX4_LIVE="unknown"
FIX5_STATE="unknown"
FIX6_CORE="unknown"
FIX6_WD="skip"
FIX6_STATE="unknown"
FIX7_STATE="unknown"
FIX8_STATE="unknown"
FIX9_STATE="unknown"
TS_ACTIVE_PATH="$TS_INIT"
POLICY_AVAILABLE=0
USER_DIR_CANONICAL="$USER_SCRIPTS_DIR"
declare -a ADVISORIES=()

run_check() {
  local report_file="${TEMP_DIR}/check.txt"
  local key value
  FIX1_STATE="unknown"
  FIX1_TUN="unknown"
  FIX2_STATE="unknown"
  FIX2_TIER="unknown"
  FIX2_PROBE="unknown"
  FIX2_ENTRY=""
  FIX2_BODY=""
  FIX3_STATE="unknown"
  FIX4_STATE="unknown"
  FIX4_VALUE="none"
  FIX4_LIVE="unknown"
  FIX5_STATE="unknown"
  FIX6_CORE="unknown"
  FIX6_WD="skip"
  FIX6_STATE="unknown"
  FIX7_STATE="unknown"
  FIX8_STATE="unknown"
  FIX9_STATE="unknown"
  TS_ACTIVE_PATH="$TS_INIT"
  USER_DIR_CANONICAL="$USER_SCRIPTS_DIR"
  ADVISORIES=()

  remote "$(remote_check_script)" > "$report_file" 2>/dev/null \
    || fail "Remote inspection failed. Could not read printer state over SSH."
  grep -q '^CHECK_DONE$' "$report_file" \
    || fail "Remote inspection was truncated. Refusing to report a partial picture."

  while read -r key value; do
    case "$key" in
      FIX1) FIX1_STATE="$value" ;;
      FIX1_TUN) FIX1_TUN="$value" ;;
      FIX2) FIX2_STATE="$value" ;;
      FIX2_TIER) FIX2_TIER="$value" ;;
      FIX2_PROBE) FIX2_PROBE="$value" ;;
      FIX2_ENTRY) FIX2_ENTRY="$value" ;;
      FIX2_BODY) FIX2_BODY="$value" ;;
      FIX3) FIX3_STATE="$value" ;;
      FIX4) FIX4_STATE="$value" ;;
      FIX4_VALUE) FIX4_VALUE="$value" ;;
      FIX4_LIVE) FIX4_LIVE="$value" ;;
      FIX5) FIX5_STATE="$value" ;;
      FIX6) FIX6_CORE="$value" ;;
      FIX6_WD) FIX6_WD="$value" ;;
      FIX7) FIX7_STATE="$value" ;;
      FIX8) FIX8_STATE="$value" ;;
      FIX9) FIX9_STATE="$value" ;;
      TS_ACTIVE) TS_ACTIVE_PATH="$value" ;;
      USER_DIR_CANONICAL) [ -n "$value" ] && USER_DIR_CANONICAL="$value" ;;
      ADVISORY_CLI) ADVISORIES+=("$value") ;;
      *) ;;
    esac
  done < "$report_file"

  # The reported active init is spliced back into repair payloads, so it may
  # only ever be one of the two configured spellings. Anything else is a
  # compromised or confused remote and gets refused.
  case "$TS_ACTIVE_PATH" in
    "$TS_INIT" | "$TS_INIT_DEFERRED") ;;
    *) fail "Remote reported an unexpected tailscaled init path: ${TS_ACTIVE_PATH}" ;;
  esac

  if [ "$FIX2_STATE" != "skip" ] && [ "$FIX2_TIER" = "present" ] && [ "$FIX2_PROBE" = "present" ]; then
    FIX2_STATE="present"
  elif [ "$FIX2_STATE" != "skip" ]; then
    FIX2_STATE="absent"
  fi

  # Fix 6 is only truly done when the rename+wrapper are in place AND the
  # watchdog has been retargeted at the renamed init.
  case "$FIX6_CORE" in
    missing-file) FIX6_STATE="missing-file" ;;
    present)
      if [ "$FIX6_WD" = "stale" ]; then FIX6_STATE="partial"; else FIX6_STATE="present"; fi
      ;;
    *) FIX6_STATE="$FIX6_CORE" ;;
  esac
}

# Checked against both the configured and the canonical form of the scripts
# directory: a cron symlink resolves to a real path, and if anything above
# /usr/data is itself a symlink the two spellings differ. Getting this wrong
# in the permissive direction would rewrite an owner's file without consent,
# so it fails safe — either spelling matching means hands off.
is_user_owned() {
  case "$1" in
    "${USER_SCRIPTS_DIR}"/* | "${USER_DIR_CANONICAL}"/*) return 0 ;;
    *) return 1 ;;
  esac
}

# Exit status is the count of fixes that still need work, so callers can both
# branch on zero and see how much is outstanding.
report_state() {
  local outstanding=0
  POLICY_AVAILABLE=0

  case "$FIX1_STATE" in
    present) ok "1. tailscaled containment (nice 19, GOMEMLIMIT=24MiB, GOGC=40) — present in ${TS_ACTIVE_PATH}" ;;
    partial) warn "1. tailscaled containment — PARTIAL in ${TS_ACTIVE_PATH}; some settings are missing" ;;
    absent) warn "1. tailscaled containment — ABSENT from ${TS_ACTIVE_PATH}" ;;
    missing-file) warn "1. tailscaled containment — ${TS_ACTIVE_PATH} does not exist (Entware tailscale not installed?)" ;;
    *) warn "1. tailscaled containment — indeterminate" ;;
  esac
  [ "$FIX1_STATE" = "present" ] || outstanding=$((outstanding + 1))
  if [ "$FIX1_TUN" = "absent" ]; then
    warn "   --tun=userspace-networking is MISSING from ARGS. This box has no /dev/net/tun"
    warn "   and no modprobe; tailscaled cannot start without it. Fix that by hand first."
  fi

  case "$FIX2_STATE" in
    present) ok "2. tailscale watchdog — on the 5-minute tier with a free pidof probe (${FIX2_ENTRY})" ;;
    skip) info "2. tailscale watchdog — not installed; nothing to harden (a watchdog that does not exist costs nothing)" ;;
    *)
      warn "2. tailscale watchdog — needs work (${FIX2_ENTRY:-not found})"
      [ "$FIX2_TIER" = "absent" ] && warn "   still on the 60-second tier in ${CRON_FAST}"
      [ "$FIX2_PROBE" = "absent" ] && warn "   still spawns the tailscale CLI every tick (${FIX2_BODY})"
      [ "$FIX2_PROBE" = "missing-file" ] && warn "   cron entry points at a script that does not exist (${FIX2_BODY})"
      outstanding=$((outstanding + 1))
      ;;
  esac

  case "$FIX3_STATE" in
    present) ok "3. light watchdog nice wrapper — present in ${LIGHT_WD}" ;;
    absent)
      warn "3. light watchdog nice wrapper — ABSENT from ${LIGHT_WD} (owner-authored file)"
      outstanding=$((outstanding + 1))
      ;;
    missing-file) info "3. light watchdog — ${LIGHT_WD} does not exist; nothing to wrap" ;;
    no-python) info "3. light watchdog — ${LIGHT_WD} has no python invocation; nothing to wrap" ;;
    *)
      warn "3. light watchdog nice wrapper — indeterminate"
      outstanding=$((outstanding + 1))
      ;;
  esac

  case "$FIX4_STATE" in
    present) ok "4. vm.swappiness=1 — present in ${SWAP_INIT}" ;;
    absent)
      warn "4. vm.swappiness — ${SWAP_INIT} sets ${FIX4_VALUE}, expected 1"
      outstanding=$((outstanding + 1))
      ;;
    no-setting)
      warn "4. vm.swappiness — ${SWAP_INIT} sets no swappiness at all"
      outstanding=$((outstanding + 1))
      ;;
    missing-file)
      warn "4. vm.swappiness — ${SWAP_INIT} does not exist"
      outstanding=$((outstanding + 1))
      ;;
    *)
      warn "4. vm.swappiness — indeterminate"
      outstanding=$((outstanding + 1))
      ;;
  esac
  [ "$FIX4_LIVE" = "unknown" ] || info "   live /proc/sys/vm/swappiness is ${FIX4_LIVE}"

  case "$FIX5_STATE" in
    present) ok "5. log rotation — logrotate installed, config + 5-minute trigger present (${LOGROTATE_TRIGGER})" ;;
    no-entware) info "5. log rotation — no Entware opkg on this box; nothing to install with" ;;
    partial)
      warn "5. log rotation — PARTIAL; binary, config, or trigger is missing"
      outstanding=$((outstanding + 1))
      ;;
    absent)
      warn "5. log rotation — ABSENT (klippy.log grows ~10MB/day with nothing rotating it)"
      outstanding=$((outstanding + 1))
      ;;
    *)
      warn "5. log rotation — indeterminate"
      outstanding=$((outstanding + 1))
      ;;
  esac

  case "$FIX6_STATE" in
    present) ok "6. tailscaled deferred start — ${TS_INIT_DEFERRED##*/} with the boot-once 90s delay" ;;
    missing-file) info "6. tailscaled deferred start — no tailscaled init at all; nothing to defer" ;;
    *)
      warn "6. tailscaled deferred start — needs work"
      [ "$FIX6_CORE" = "present" ] \
        || warn "   init is still ${TS_INIT##*/}, or lacks the boot-once wrapper"
      [ "$FIX6_WD" = "stale" ] \
        && warn "   watchdog still starts ${TS_INIT##*/}, which stops existing after the rename (${FIX2_BODY})"
      outstanding=$((outstanding + 1))
      ;;
  esac

  # -------------------------------------------------------------------------
  # Policy fixes. These are de-Creality choices, not stability repairs. They
  # are always REPORTED, but only COUNTED (and only ever applied) when
  # --policy is given, so an owner who wants Creality Cloud back can keep the
  # stability set and cleanly skip everything below.
  # -------------------------------------------------------------------------
  case "$FIX7_STATE" in
    present) ok "7. [policy] webrtc disabled — guard in ${WEBRTC_INIT}, flag under ${DISABLED_DIR}" ;;
    missing-file) info "7. [policy] webrtc — ${WEBRTC_INIT} does not exist; nothing to disable" ;;
    *)
      if [ "$INCLUDE_POLICY" -eq 1 ]; then
        warn "7. [policy] webrtc — Creality Cloud remote-access daemon is not disabled (${FIX7_STATE})"
        outstanding=$((outstanding + 1))
      else
        info "7. [policy] webrtc — stock Creality Cloud remote access. Disable with --policy"
        POLICY_AVAILABLE=$((POLICY_AVAILABLE + 1))
      fi
      ;;
  esac

  case "$FIX8_STATE" in
    present) ok "8. [policy] fail2ban disabled — ENABLED=no in ${F2B_INIT}" ;;
    skip) info "8. [policy] fail2ban — not installed; nothing to disable" ;;
    *)
      if [ "$INCLUDE_POLICY" -eq 1 ]; then
        warn "8. [policy] fail2ban — still enabled (RAM+swap guarding a LAN-only dropbear, no iptables to enforce bans)"
        outstanding=$((outstanding + 1))
      else
        info "8. [policy] fail2ban — enabled. Disable with --policy"
        POLICY_AVAILABLE=$((POLICY_AVAILABLE + 1))
      fi
      ;;
  esac

  case "$FIX9_STATE" in
    present) ok "9. [policy] Creality MQTT telemetry — ${MQTT_TELEMETRY_HOST} blackholed in ${HOSTS_FILE}" ;;
    *)
      if [ "$INCLUDE_POLICY" -eq 1 ]; then
        warn "9. [policy] Creality MQTT telemetry — NOT blocked; app-server streams temps and feedrate to ${MQTT_TELEMETRY_HOST} over plain MQTT"
        outstanding=$((outstanding + 1))
      else
        info "9. [policy] Creality MQTT telemetry — not blocked. Block with --policy"
        POLICY_AVAILABLE=$((POLICY_AVAILABLE + 1))
      fi
      ;;
  esac

  local advisory
  for advisory in ${ADVISORIES[@]+"${ADVISORIES[@]}"}; do
    info "advisory: ${advisory} runs on the 60-second tier and invokes the tailscale CLI."
    info "          Same per-tick cost fix 2 removed. Not changed by this script."
  done

  return "$outstanding"
}

# ---------------------------------------------------------------------------
# Repairs. Every one backs the file up into HARDEN_BACKUP_DIR first — never
# alongside the original, because a stray S06tailscaled.bak in /opt/etc/init.d
# still matches the rc glob and would be executed at boot. Every rewrite is
# syntax-checked with sh -n before it replaces anything, and is written through
# `cat >` so the original inode, mode, and owner survive.
# ---------------------------------------------------------------------------
backup_preamble() {
  cat <<REMOTE_VARS
BACKUP_DIR='${HARDEN_BACKUP_DIR}'
STAMP='${STAMP}'
REMOTE_VARS
  cat <<'REMOTE_BACKUP'
set -eu
# First write wins within a run: when two repairs touch the same file (fix 1
# writes into the tailscaled init, then fix 6 renames it), the backup that
# survives is the file as it was BEFORE this run touched anything.
backup_file() {
  target="$1"
  mkdir -p "$BACKUP_DIR"
  flat="$(printf '%s' "$target" | tr '/' '_')"
  dest="${BACKUP_DIR}/${flat}.${STAMP}"
  if [ ! -e "$dest" ]; then
    cp -p "$target" "$dest"
    printf 'BACKUP %s %s\n' "$target" "$dest"
  fi
}
REMOTE_BACKUP
}

record_restore() {
  RESTORE_COMMANDS+=("$1")
}

# Parses BACKUP/APPLIED lines out of a repair's output and records the exact
# restore command for each file it touched.
consume_repair_output() {
  local output_file="$1"
  local key original backup
  while read -r key original backup; do
    if [ "$key" = "BACKUP" ]; then
      record_restore "ssh ${TARGET} 'cp -p ${backup} ${original}'"
      info "backed up ${original} -> ${backup}"
    fi
  done < "$output_file"
}

apply_fix1() {
  local output_file="${TEMP_DIR}/fix1.out"
  step "Apply fix 1: tailscaled memory containment"
  if [ "$FIX1_TUN" = "absent" ]; then
    warn "Skipped: ${TS_ACTIVE_PATH} has no --tun=userspace-networking. Repair that first;"
    warn "without it tailscaled cannot start on this box at all."
    return 1
  fi
  {
    backup_preamble
    cat <<REMOTE_VARS
TS_INIT='${TS_ACTIVE_PATH}'
REMOTE_VARS
    cat <<'REMOTE_FIX1'
backup_file "$TS_INIT"
tmp="${TS_INIT}.regolith-tmp.$$"
block="${TS_INIT}.regolith-block.$$"
cat > "$block" <<'BLOCK'
# >>> regolith-harden: host starvation containment >>>
# tailscaled is the largest resident Go process on a 214MB box. nice -n 19
# keeps it behind klippy under contention; GOMEMLIMIT makes the Go runtime
# collect instead of growing into swap. Measured on this printer:
# 43.6MB RSS + 29.2MB swap -> 15.1MB RSS + 0 swap.
# Do NOT remove --tun=userspace-networking from ARGS: this box has no
# /dev/net/tun and no modprobe, so kernel networking is not an option.
PREARGS="nice -n 19 nohup"
export GOMEMLIMIT=24MiB
export GOGC=40
# <<< regolith-harden <<<
BLOCK
# Strip only THIS fix's previous block; fix 6 keeps its own differently-titled
# block in the same file. If a marker mismatch ever puts the rc.func sourcing
# line inside the skipped region, it is preserved — losing that line would
# produce an init script that silently starts nothing.
awk '
  /^# >>> regolith-harden: host starvation containment/ { skip = 1; next }
  /^# <<< regolith-harden/ && skip == 1 { skip = 0; next }
  skip == 1 { if ($0 ~ /rc\.func/) print; next }
  /^PREARGS=/ { next }
  /^export GOMEMLIMIT=/ { next }
  /^export GOGC=/ { next }
  /^GOMEMLIMIT=/ { next }
  /^GOGC=/ { next }
  { print }
' "$TS_INIT" > "${tmp}.strip"
# The block must land before rc.func sources the launcher, or PREARGS is set
# too late to matter.
line="$(grep -nE '^[[:space:]]*\.[[:space:]]+.*rc\.func' "${tmp}.strip" | head -1 | cut -d: -f1)"
if [ -n "${line:-}" ]; then
  head -n "$((line - 1))" "${tmp}.strip" > "$tmp"
  cat "$block" >> "$tmp"
  tail -n "+${line}" "${tmp}.strip" >> "$tmp"
else
  cp "${tmp}.strip" "$tmp"
  cat "$block" >> "$tmp"
fi
sh -n "$tmp" || { rm -f "$tmp" "${tmp}.strip" "$block"; echo "SYNTAX_FAIL" >&2; exit 1; }
cat "$tmp" > "$TS_INIT"
rm -f "$tmp" "${tmp}.strip" "$block"
printf 'APPLIED fix1\n'
REMOTE_FIX1
  } > "${TEMP_DIR}/fix1.sh"

  if remote "$(cat "${TEMP_DIR}/fix1.sh")" > "$output_file" 2>&1; then
    consume_repair_output "$output_file"
    ok "tailscaled containment written to ${TS_ACTIVE_PATH}"
    info "tailscaled picks this up on its next start: ${TS_ACTIVE_PATH} restart (no reboot)"
    return 0
  fi
  warn "Failed to apply fix 1. ${TS_ACTIVE_PATH} was not changed if a backup line is absent above."
  return 1
}

apply_fix2() {
  local output_file="${TEMP_DIR}/fix2.out"
  local entry_name
  step "Apply fix 2: tailscale watchdog cost"

  if [ "$FIX2_PROBE" != "present" ] && is_user_owned "$FIX2_BODY"; then
    if [ "$INCLUDE_USER_SCRIPTS" -ne 1 ]; then
      warn "Skipped watchdog body: ${FIX2_BODY} is under ${USER_SCRIPTS_DIR}, which the owner authored."
      warn "Re-run with --include-user-scripts to have this script rewrite it."
      if [ "$FIX2_TIER" = "absent" ]; then
        warn "The cron tier move below is still safe to apply on its own."
      else
        return 1
      fi
    else
      warn "NOTICE: rewriting ${FIX2_BODY}, a file the owner authored, because"
      warn "--include-user-scripts was given. A timestamped backup is taken first"
      warn "and the exact restore command is printed at the end of this run."
    fi
  fi

  [ -n "$FIX2_ENTRY" ] || {
    warn "No watchdog cron entry to act on."
    return 1
  }
  entry_name="$(basename "$FIX2_ENTRY")"
  validate_path_segment "$entry_name" || {
    warn "Refusing to move ${FIX2_ENTRY}: unexpected cron entry name."
    return 1
  }

  local rewrite_body=0
  if [ "$FIX2_PROBE" != "present" ]; then
    if [ "$INCLUDE_USER_SCRIPTS" -eq 1 ] || ! is_user_owned "$FIX2_BODY"; then
      rewrite_body=1
    fi
  fi

  {
    backup_preamble
    cat <<REMOTE_VARS
CRON_FAST='${CRON_FAST}'
CRON_SLOW='${CRON_SLOW}'
ENTRY='${FIX2_ENTRY}'
BODY='${FIX2_BODY}'
ENTRY_NAME='${entry_name}'
REWRITE_BODY='${rewrite_body}'
TS_INIT_ORIG='${TS_INIT}'
TS_DEFERRED='${TS_INIT_DEFERRED}'
REMOTE_VARS
    cat <<'REMOTE_FIX2'
if [ "$REWRITE_BODY" = "1" ]; then
  [ -f "$BODY" ] && backup_file "$BODY"
  tmp="${BODY}.regolith-tmp.$$"
  cat > "$tmp" <<'WATCHDOG'
#!/bin/sh
# regolith-harden: tailscale watchdog
#
# Liveness is free. The previous version ran `tailscale status` every 60
# seconds, which forks a second 15-20MB Go binary on a 214MB machine — that
# per-tick allocation, not tailscaled itself, was the page-eviction driver
# that pushed klippy into swap and cost prints. pidof costs nothing.
#
# The CLI probe still has value (a wedged-but-running daemon), so it is kept
# and throttled to at most once per PROBE_INTERVAL seconds.
DAEMON=tailscaled
INIT=/opt/etc/init.d/S06tailscaled
TS_CLI=/opt/bin/tailscale
STAMP=/tmp/regolith-tailscale-probe
PROBE_INTERVAL=1800

if ! pidof "$DAEMON" >/dev/null 2>&1; then
  [ -x "$INIT" ] && "$INIT" start
  exit 0
fi

[ -x "$TS_CLI" ] || exit 0

now="$(date +%s)"
last=0
if [ -f "$STAMP" ]; then
  last="$(cat "$STAMP" 2>/dev/null || echo 0)"
fi
case "$last" in
  '' | *[!0-9]*) last=0 ;;
esac

[ "$((now - last))" -ge "$PROBE_INTERVAL" ] || exit 0
printf '%s\n' "$now" > "$STAMP"

"$TS_CLI" status >/dev/null 2>&1 || { [ -x "$INIT" ] && "$INIT" restart; }
exit 0
WATCHDOG
  sh -n "$tmp" || { rm -f "$tmp"; echo "SYNTAX_FAIL" >&2; exit 1; }
  if [ -f "$BODY" ]; then
    cat "$tmp" > "$BODY"
    rm -f "$tmp"
  else
    mv "$tmp" "$BODY"
  fi
  chmod 755 "$BODY"
  # If fix 6 already renamed the init, the template's INIT path is stale the
  # moment it lands; retarget it so the watchdog restarts what actually exists.
  if [ -f "$TS_DEFERRED" ] && [ ! -f "$TS_INIT_ORIG" ]; then
    ts_base="${TS_INIT_ORIG##*/}"
    ts_def_base="${TS_DEFERRED##*/}"
    tmp2="${BODY}.regolith-tmp2.$$"
    sed "s#${ts_base}#${ts_def_base}#g" "$BODY" > "$tmp2"
    sh -n "$tmp2" || { rm -f "$tmp2"; echo "SYNTAX_FAIL" >&2; exit 1; }
    cat "$tmp2" > "$BODY"
    rm -f "$tmp2"
  fi
  printf 'APPLIED fix2-body\n'
fi

# Tier move. Nothing is destroyed, so this needs no backup — the restore is
# the inverse mv, printed by the caller.
if [ "$ENTRY" != "${CRON_SLOW}/${ENTRY_NAME}" ]; then
  mkdir -p "$CRON_SLOW"
  mv "$ENTRY" "${CRON_SLOW}/${ENTRY_NAME}"
  printf 'APPLIED fix2-tier\n'
fi
REMOTE_FIX2
  } > "${TEMP_DIR}/fix2.sh"

  if remote "$(cat "${TEMP_DIR}/fix2.sh")" > "$output_file" 2>&1; then
    consume_repair_output "$output_file"
    if grep -q '^APPLIED fix2-tier$' "$output_file"; then
      record_restore "ssh ${TARGET} 'mv ${CRON_SLOW}/${entry_name} ${CRON_FAST}/${entry_name}'"
      ok "watchdog moved to the 5-minute tier: ${CRON_SLOW}/${entry_name}"
    fi
    grep -q '^APPLIED fix2-body$' "$output_file" && ok "watchdog body replaced with the pidof probe"
    return 0
  fi
  warn "Failed to apply fix 2."
  return 1
}

apply_fix3() {
  local output_file="${TEMP_DIR}/fix3.out"
  step "Apply fix 3: light watchdog scheduling priority"
  if [ "$INCLUDE_USER_SCRIPTS" -ne 1 ]; then
    warn "Skipped. ${LIGHT_WD} is a file the owner wrote, not something this script installed."
    warn "It will not be rewritten silently. To have this script wrap its python"
    warn "invocation in 'nice -n 19', re-run with:"
    warn "  ./tools/harden-k1.sh --apply --include-user-scripts"
    warn "Or make the one-line change by hand — that is the honest option:"
    warn "  exec /usr/bin/python3 ...   ->   exec nice -n 19 /usr/bin/python3 ..."
    return 1
  fi
  warn "NOTICE: modifying ${LIGHT_WD}, a file the owner authored."
  warn "A timestamped backup is taken first and the restore command is printed below."
  {
    backup_preamble
    cat <<REMOTE_VARS
LIGHT_WD='${LIGHT_WD}'
REMOTE_VARS
    cat <<'REMOTE_FIX3'
backup_file "$LIGHT_WD"
tmp="${LIGHT_WD}.regolith-tmp.$$"
# Only lines that actually invoke python and are not already niced. The
# substitution keeps everything before the interpreter (exec, env, redirects)
# and everything after it (script path, "$@") exactly as the owner wrote it.
# Deliberately BRE, not sed -E: busybox sed on this firmware is the consumer.
sed '/nice[[:space:]][[:space:]]*-n[[:space:]][[:space:]]*19/! s#\([^[:space:]]*python[0-9.]*\)\([[:space:]]\)#nice -n 19 \1\2#' \
  "$LIGHT_WD" > "$tmp"
sh -n "$tmp" || { rm -f "$tmp"; echo "SYNTAX_FAIL" >&2; exit 1; }
grep -qE 'nice[[:space:]]+-n[[:space:]]+19[[:space:]]+[^[:space:]]*python' "$tmp" \
  || { rm -f "$tmp"; echo "NO_PYTHON_MATCH" >&2; exit 1; }
cat "$tmp" > "$LIGHT_WD"
rm -f "$tmp"
printf 'APPLIED fix3\n'
REMOTE_FIX3
  } > "${TEMP_DIR}/fix3.sh"

  if remote "$(cat "${TEMP_DIR}/fix3.sh")" > "$output_file" 2>&1; then
    consume_repair_output "$output_file"
    ok "python invocation in ${LIGHT_WD} now runs at nice 19"
    return 0
  fi
  warn "Failed to apply fix 3. ${LIGHT_WD} was left as the owner wrote it."
  return 1
}

apply_fix4() {
  local output_file="${TEMP_DIR}/fix4.out"
  step "Apply fix 4: vm.swappiness 1"
  {
    backup_preamble
    cat <<REMOTE_VARS
SWAP_INIT='${SWAP_INIT}'
REMOTE_VARS
    cat <<'REMOTE_FIX4'
backup_file "$SWAP_INIT"
tmp="${SWAP_INIT}.regolith-tmp.$$"
# No backreferences: '\11' is ambiguous between BRE implementations, and both
# matched forms are short enough to just rewrite whole.
sed -e 's#vm\.swappiness[[:space:]]*=[[:space:]]*[0-9][0-9]*#vm.swappiness=1#g' \
    -e 's#echo[[:space:]][[:space:]]*[0-9][0-9]*[[:space:]]*>[[:space:]]*/proc/sys/vm/swappiness#echo 1 > /proc/sys/vm/swappiness#g' \
    "$SWAP_INIT" > "$tmp"
sh -n "$tmp" || { rm -f "$tmp"; echo "SYNTAX_FAIL" >&2; exit 1; }
cat "$tmp" > "$SWAP_INIT"
rm -f "$tmp"
printf 'APPLIED fix4\n'
# The init script only runs at boot, so the edit above is dormant until then.
# Writing the live value costs nothing and needs no reboot.
if [ -w /proc/sys/vm/swappiness ]; then
  echo 1 > /proc/sys/vm/swappiness
  printf 'LIVE %s\n' "$(cat /proc/sys/vm/swappiness)"
fi
REMOTE_FIX4
  } > "${TEMP_DIR}/fix4.sh"

  if remote "$(cat "${TEMP_DIR}/fix4.sh")" > "$output_file" 2>&1; then
    consume_repair_output "$output_file"
    ok "vm.swappiness set to 1 in ${SWAP_INIT}"
    if grep -q '^LIVE 1$' "$output_file"; then
      ok "live /proc/sys/vm/swappiness set to 1 (no reboot needed)"
    else
      info "live swappiness unchanged; the new value takes effect at next boot"
    fi
    return 0
  fi
  warn "Failed to apply fix 4. ${SWAP_INIT} was not changed."
  return 1
}

apply_fix5() {
  local output_file="${TEMP_DIR}/fix5.out"
  step "Apply fix 5: log rotation (logrotate + 5-minute trigger)"
  {
    backup_preamble
    cat <<REMOTE_VARS
OPKG_BIN='${OPKG_BIN}'
LOGROTATE_BIN='${LOGROTATE_BIN}'
LOGROTATE_CONF='${LOGROTATE_CONF}'
DROPIN='${LOGROTATE_DROPIN}'
TRIGGER='${LOGROTATE_TRIGGER}'
LR_STATE='${LOGROTATE_STATE}'
KLOG='${KLIPPER_LOG_DIR}'
REMOTE_VARS
    cat <<'REMOTE_FIX5'
if [ ! -x "$LOGROTATE_BIN" ]; then
  [ -x "$OPKG_BIN" ] || { echo "NO_OPKG" >&2; exit 1; }
  "$OPKG_BIN" install logrotate >/dev/null 2>&1 || { echo "OPKG_FAIL" >&2; exit 1; }
  [ -x "$LOGROTATE_BIN" ] || { echo "OPKG_FAIL" >&2; exit 1; }
  printf 'APPLIED fix5-opkg\n'
fi
[ -f "$DROPIN" ] && backup_file "$DROPIN"
mkdir -p "${DROPIN%/*}"
tmp="${DROPIN}.regolith-tmp.$$"
cat > "$tmp" <<CONF
# regolith-harden: rotate the only two logs on this box that actually grow.
# copytruncate is verified safe here: klippy and moonraker both hold their
# logs through O_APPEND descriptors (checked via /proc fdinfo flags), so
# nothing is lost in the copy window and neither daemon needs a signal.
${KLOG}/klippy.log ${KLOG}/moonraker.log {
    size 10M
    rotate 3
    compress
    copytruncate
    missingok
    notifempty
}
CONF
if [ -f "$DROPIN" ]; then
  cat "$tmp" > "$DROPIN"
  rm -f "$tmp"
else
  mv "$tmp" "$DROPIN"
fi
printf 'APPLIED fix5-conf\n'
[ -f "$TRIGGER" ] && backup_file "$TRIGGER"
mkdir -p "${TRIGGER%/*}"
tmp="${TRIGGER}.regolith-tmp.$$"
cat > "$tmp" <<TRIG
#!/bin/sh
# regolith-harden: logrotate trigger
# Runs from the existing Entware 5-minute run-parts tier -- no new daemon on
# a 214MB box. Rotation itself only happens once a log passes 10M.
[ -x ${LOGROTATE_BIN} ] || exit 0
exec ${LOGROTATE_BIN} -s ${LR_STATE} ${LOGROTATE_CONF}
TRIG
sh -n "$tmp" || { rm -f "$tmp"; echo "SYNTAX_FAIL" >&2; exit 1; }
if [ -f "$TRIGGER" ]; then
  cat "$tmp" > "$TRIGGER"
  rm -f "$tmp"
else
  mv "$tmp" "$TRIGGER"
fi
chmod 755 "$TRIGGER"
printf 'APPLIED fix5-trigger\n'
REMOTE_FIX5
  } > "${TEMP_DIR}/fix5.sh"

  if remote "$(cat "${TEMP_DIR}/fix5.sh")" > "$output_file" 2>&1; then
    consume_repair_output "$output_file"
    if grep -q '^APPLIED fix5-opkg$' "$output_file"; then
      record_restore "ssh ${TARGET} '${OPKG_BIN} remove logrotate; rm -f ${LOGROTATE_DROPIN} ${LOGROTATE_TRIGGER} ${LOGROTATE_STATE}'"
    else
      record_restore "ssh ${TARGET} 'rm -f ${LOGROTATE_DROPIN} ${LOGROTATE_TRIGGER} ${LOGROTATE_STATE}'"
    fi
    ok "logrotate config written (klippy+moonraker, size 10M, rotate 3, compressed)"
    ok "5-minute trigger installed: ${LOGROTATE_TRIGGER}"
    return 0
  fi
  if grep -q 'NO_OPKG' "$output_file"; then
    warn "Failed to apply fix 5: no opkg at ${OPKG_BIN} and no logrotate binary."
  else
    warn "Failed to apply fix 5."
  fi
  return 1
}

apply_fix6() {
  local output_file="${TEMP_DIR}/fix6.out"
  local rewrite_wd=0
  local result=0
  step "Apply fix 6: tailscaled deferred start (boot storm)"

  if [ "$FIX6_WD" = "stale" ]; then
    if is_user_owned "$FIX2_BODY" && [ "$INCLUDE_USER_SCRIPTS" -ne 1 ]; then
      warn "Watchdog ${FIX2_BODY} still starts ${TS_INIT##*/} but is owner-authored."
      warn "Re-run with --include-user-scripts to retarget it to ${TS_INIT_DEFERRED##*/}."
      result=1
      if [ "$FIX6_CORE" = "present" ]; then
        return 1
      fi
    else
      rewrite_wd=1
    fi
  fi

  {
    backup_preamble
    cat <<REMOTE_VARS
TS_INIT='${TS_INIT}'
TS_DEFERRED='${TS_INIT_DEFERRED}'
WD_BODY='${FIX2_BODY}'
REWRITE_WD='${rewrite_wd}'
REMOTE_VARS
    cat <<'REMOTE_FIX6'
did_rename=0
if [ -f "$TS_INIT" ]; then
  backup_file "$TS_INIT"
  if [ -f "$TS_DEFERRED" ]; then
    # Both names exist; two launchers for one daemon would both run at boot.
    # Keep the deferred one, drop the duplicate (its content is backed up).
    rm -f "$TS_INIT"
  else
    mv "$TS_INIT" "$TS_DEFERRED"
  fi
  did_rename=1
  printf 'APPLIED fix6-rename\n'
fi
[ -f "$TS_DEFERRED" ] || { echo "NO_INIT" >&2; exit 1; }
if ! grep -q 'regolith-ts-boot-done' "$TS_DEFERRED"; then
  [ "$did_rename" = "1" ] || backup_file "$TS_DEFERRED"
  line="$(grep -nE '^[[:space:]]*\.[[:space:]]+.*rc\.func' "$TS_DEFERRED" | head -1 | cut -d: -f1)"
  [ -n "${line:-}" ] || { echo "NO_RC_FUNC" >&2; exit 1; }
  tmp="${TS_DEFERRED}.regolith-tmp.$$"
  {
    head -n "$((line - 1))" "$TS_DEFERRED"
    printf '%s\n' \
      '# >>> regolith-harden: boot-once deferred start >>>' \
      '# At power-on everything starts at once and this 214MB box swaps for' \
      '# minutes. tailscaled was the biggest boot-window consumer that is not' \
      '# on the print path, so its first start of each boot is pushed back 90' \
      '# seconds. The flag lives on tmpfs and so resets itself at every boot.' \
      '# The watchdog cron stays the safety net: if it fires inside the 90s' \
      '# window it just starts tailscaled early, and rc.func pidof-guards' \
      '# against a double run.' \
      '# rc.unslung SOURCES this file, so there must be no exit in this' \
      '# wrapper -- an exit here would kill the boot sequence itself.' \
      'if [ "${1:-}" = "start" ] && [ ! -f /tmp/.regolith-ts-boot-done ]; then' \
      '  touch /tmp/.regolith-ts-boot-done' \
      "  nohup sh -c \"sleep 90; ${TS_DEFERRED} start\" >/dev/null 2>&1 &" \
      'else'
    sed -n "${line}p" "$TS_DEFERRED"
    printf '%s\n' 'fi' '# <<< regolith-harden <<<'
    tail -n "+$((line + 1))" "$TS_DEFERRED"
  } > "$tmp"
  sh -n "$tmp" || { rm -f "$tmp"; echo "SYNTAX_FAIL" >&2; exit 1; }
  cat "$tmp" > "$TS_DEFERRED"
  rm -f "$tmp"
  printf 'APPLIED fix6-wrap\n'
fi
ts_base="${TS_INIT##*/}"
ts_def_base="${TS_DEFERRED##*/}"
if [ "$REWRITE_WD" = "1" ] && [ -f "$WD_BODY" ] && grep -q "$ts_base" "$WD_BODY"; then
  backup_file "$WD_BODY"
  tmp="${WD_BODY}.regolith-tmp.$$"
  sed "s#${ts_base}#${ts_def_base}#g" "$WD_BODY" > "$tmp"
  sh -n "$tmp" || { rm -f "$tmp"; echo "SYNTAX_FAIL" >&2; exit 1; }
  cat "$tmp" > "$WD_BODY"
  rm -f "$tmp"
  printf 'APPLIED fix6-watchdog\n'
fi
REMOTE_FIX6
  } > "${TEMP_DIR}/fix6.sh"

  if remote "$(cat "${TEMP_DIR}/fix6.sh")" > "$output_file" 2>&1; then
    consume_repair_output "$output_file"
    if grep -q '^APPLIED fix6-rename$' "$output_file"; then
      # The cp printed above restores the pre-rename file under its old name;
      # completing the restore means also removing the renamed copy.
      record_restore "ssh ${TARGET} 'rm ${TS_INIT_DEFERRED}'"
      ok "renamed ${TS_INIT##*/} -> ${TS_INIT_DEFERRED##*/} (last in Entware rc order)"
    fi
    grep -q '^APPLIED fix6-wrap$' "$output_file" \
      && ok "boot-once 90s deferred-start wrapper installed (flag on tmpfs, no exit statements)"
    grep -q '^APPLIED fix6-watchdog$' "$output_file" \
      && ok "watchdog retargeted to ${TS_INIT_DEFERRED##*/}"
    return "$result"
  fi
  warn "Failed to apply fix 6."
  return 1
}

apply_fix7() {
  local output_file="${TEMP_DIR}/fix7.out"
  step "Apply policy fix 7: disable Creality webrtc"
  {
    backup_preamble
    cat <<REMOTE_VARS
WEBRTC_INIT='${WEBRTC_INIT}'
DISABLED_DIR='${DISABLED_DIR}'
REMOTE_VARS
    cat <<'REMOTE_FIX7'
mkdir -p "$DISABLED_DIR"
flag="${DISABLED_DIR}/webrtc"
if [ ! -f "$flag" ]; then
  {
    printf '%s\n' "Created by tools/harden-k1.sh --apply --policy."
    printf '%s\n' "While this file exists, start() in ${WEBRTC_INIT} returns without"
    printf '%s\n' "starting webrtc (Creality Cloud remote access; it needs a cloud"
    printf '%s\n' "binding this printer does not have, and the camera tile uses"
    printf '%s\n' "mjpg_streamer, not webrtc). Monitor resurrects webrtc through"
    printf '%s\n' "${WEBRTC_INIT} restart, which is exactly why the guard lives in"
    printf '%s\n' "start() rather than in a killed process."
    printf '%s\n' "To re-enable: delete this file, restore ${WEBRTC_INIT} from the"
    printf '%s\n' "harden backups, then run: ${WEBRTC_INIT} start"
  } > "$flag"
  printf 'APPLIED fix7-flag\n'
fi
if ! grep -q 'regolith-harden: webrtc' "$WEBRTC_INIT"; then
  backup_file "$WEBRTC_INIT"
  line="$(grep -nE '^start[[:space:]]*\(\)[[:space:]]*\{' "$WEBRTC_INIT" | head -1 | cut -d: -f1)"
  [ -n "${line:-}" ] || { echo "NO_START_FUNC" >&2; exit 1; }
  tmp="${WEBRTC_INIT}.regolith-tmp.$$"
  {
    head -n "$line" "$WEBRTC_INIT"
    printf '%s\n' \
      '    # >>> regolith-harden: webrtc disable guard >>>' \
      '    # Monitor restarts webrtc through this very script, so the guard' \
      '    # must live here: killing the process or unlinking the binary is' \
      '    # undone within seconds. The flag file documents itself.' \
      "    if [ -f \"${DISABLED_DIR}/webrtc\" ]; then" \
      '        return 0' \
      '    fi' \
      '    # <<< regolith-harden <<<'
    tail -n "+$((line + 1))" "$WEBRTC_INIT"
  } > "$tmp"
  sh -n "$tmp" || { rm -f "$tmp"; echo "SYNTAX_FAIL" >&2; exit 1; }
  cat "$tmp" > "$WEBRTC_INIT"
  rm -f "$tmp"
  printf 'APPLIED fix7-guard\n'
fi
"$WEBRTC_INIT" stop >/dev/null 2>&1 || true
printf 'APPLIED fix7-stop\n'
REMOTE_FIX7
  } > "${TEMP_DIR}/fix7.sh"

  if remote "$(cat "${TEMP_DIR}/fix7.sh")" > "$output_file" 2>&1; then
    consume_repair_output "$output_file"
    grep -q '^APPLIED fix7-flag$' "$output_file" \
      && record_restore "ssh ${TARGET} 'rm ${DISABLED_DIR}/webrtc'"
    ok "webrtc disabled: guard in ${WEBRTC_INIT} start(), flag at ${DISABLED_DIR}/webrtc"
    info "Monitor's next restart attempt hits the guard and webrtc stays down."
    return 0
  fi
  warn "Failed to apply fix 7. ${WEBRTC_INIT} was not changed if no backup line appears above."
  return 1
}

apply_fix8() {
  local output_file="${TEMP_DIR}/fix8.out"
  step "Apply policy fix 8: disable fail2ban"
  {
    backup_preamble
    cat <<REMOTE_VARS
F2B_INIT='${F2B_INIT}'
REMOTE_VARS
    cat <<'REMOTE_FIX8'
backup_file "$F2B_INIT"
"$F2B_INIT" stop >/dev/null 2>&1 || true
tmp="${F2B_INIT}.regolith-tmp.$$"
if grep -q '^ENABLED=' "$F2B_INIT"; then
  sed 's/^ENABLED=.*/ENABLED=no/' "$F2B_INIT" > "$tmp"
else
  { head -n 1 "$F2B_INIT"; printf 'ENABLED=no\n'; tail -n +2 "$F2B_INIT"; } > "$tmp"
fi
sh -n "$tmp" || { rm -f "$tmp"; echo "SYNTAX_FAIL" >&2; exit 1; }
cat "$tmp" > "$F2B_INIT"
rm -f "$tmp"
printf 'APPLIED fix8\n'
REMOTE_FIX8
  } > "${TEMP_DIR}/fix8.sh"

  if remote "$(cat "${TEMP_DIR}/fix8.sh")" > "$output_file" 2>&1; then
    consume_repair_output "$output_file"
    ok "fail2ban stopped and ENABLED=no written to ${F2B_INIT}"
    return 0
  fi
  warn "Failed to apply fix 8. ${F2B_INIT} was not changed if no backup line appears above."
  return 1
}

apply_fix9() {
  local output_file="${TEMP_DIR}/fix9.out"
  step "Apply policy fix 9: block Creality MQTT telemetry"
  {
    backup_preamble
    cat <<REMOTE_VARS
HOSTS_FILE='${HOSTS_FILE}'
MQTT_HOST='${MQTT_TELEMETRY_HOST}'
REMOTE_VARS
    cat <<'REMOTE_FIX9'
[ -f "$HOSTS_FILE" ] && backup_file "$HOSTS_FILE"
if ! grep -q "$MQTT_HOST" "$HOSTS_FILE" 2>/dev/null; then
  printf '127.0.0.1 %s  # regolith-harden: app-server streams temps/feedrate here over plain MQTT even when cloud-unbound\n' \
    "$MQTT_HOST" >> "$HOSTS_FILE"
  printf 'APPLIED fix9-hosts\n'
fi
# app-server holds its MQTT session open; bounce it so the block takes effect
# now. Monitor restarts it within seconds -- that resurrection is the reason
# a hosts-file block is used instead of disabling the daemon.
if [ -x /usr/bin/app-server ]; then
  killall app-server >/dev/null 2>&1 || true
  printf 'APPLIED fix9-bounce\n'
fi
printf 'APPLIED fix9-done\n'
REMOTE_FIX9
  } > "${TEMP_DIR}/fix9.sh"

  if remote "$(cat "${TEMP_DIR}/fix9.sh")" > "$output_file" 2>&1; then
    consume_repair_output "$output_file"
    ok "${MQTT_TELEMETRY_HOST} -> 127.0.0.1 in ${HOSTS_FILE}"
    if grep -q '^APPLIED fix9-bounce$' "$output_file"; then
      ok "app-server bounced; Monitor restarts it without the MQTT session"
    else
      info "app-server not present here; nothing to bounce"
    fi
    return 0
  fi
  warn "Failed to apply fix 9. ${HOSTS_FILE} was not changed if no backup line appears above."
  return 1
}

step "Inspect the hardening fixes (1-6 stability, 7-9 policy)"
run_check
outstanding=0
report_state || outstanding=$?

if [ "$MODE" = "check" ]; then
  printf '\n'
  if [ "$INCLUDE_POLICY" -eq 0 ] && [ "$POLICY_AVAILABLE" -gt 0 ]; then
    printf '%d policy fix(es) (de-Creality set) available but not requested; add --policy to include them.\n' "$POLICY_AVAILABLE"
  fi
  if [ "$outstanding" -eq 0 ]; then
    printf 'All fixes present. Nothing to do.\n'
    exit 0
  fi
  printf '%d fix(es) need re-applying. Nothing was changed.\n' "$outstanding"
  if [ "$INCLUDE_POLICY" -eq 1 ]; then
    printf 'Re-apply with: PRINTER_HOST=%s ./tools/harden-k1.sh --apply --policy\n' "$PRINTER_HOST"
  else
    printf 'Re-apply with: PRINTER_HOST=%s ./tools/harden-k1.sh --apply\n' "$PRINTER_HOST"
  fi
  exit 1
fi

if [ "$outstanding" -eq 0 ]; then
  if [ "$INCLUDE_POLICY" -eq 0 ] && [ "$POLICY_AVAILABLE" -gt 0 ]; then
    printf '\n%d policy fix(es) (de-Creality set) available but not requested; add --policy to include them.\n' "$POLICY_AVAILABLE"
  fi
  printf '\nAll fixes already present. Nothing to apply.\n'
  exit 0
fi

# Idempotency: only fixes that inspection found missing are touched at all, so
# a second --apply run reaches this point with outstanding=0 and exits above.
apply_failures=0
case "$FIX1_STATE" in
  present | missing-file) ;;
  *) apply_fix1 || apply_failures=$((apply_failures + 1)) ;;
esac
case "$FIX2_STATE" in
  present | skip) ;;
  *) apply_fix2 || apply_failures=$((apply_failures + 1)) ;;
esac
case "$FIX3_STATE" in
  absent) apply_fix3 || apply_failures=$((apply_failures + 1)) ;;
  *) ;;
esac
case "$FIX4_STATE" in
  present | missing-file) ;;
  *) apply_fix4 || apply_failures=$((apply_failures + 1)) ;;
esac
case "$FIX5_STATE" in
  present | no-entware) ;;
  *) apply_fix5 || apply_failures=$((apply_failures + 1)) ;;
esac
case "$FIX6_STATE" in
  present | missing-file) ;;
  *) apply_fix6 || apply_failures=$((apply_failures + 1)) ;;
esac
# The de-Creality set. Never applied without the explicit --policy opt-in.
if [ "$INCLUDE_POLICY" -eq 1 ]; then
  case "$FIX7_STATE" in
    present | missing-file) ;;
    *) apply_fix7 || apply_failures=$((apply_failures + 1)) ;;
  esac
  case "$FIX8_STATE" in
    present | skip) ;;
    *) apply_fix8 || apply_failures=$((apply_failures + 1)) ;;
  esac
  case "$FIX9_STATE" in
    present) ;;
    *) apply_fix9 || apply_failures=$((apply_failures + 1)) ;;
  esac
fi

step "Verify"
run_check
verify_outstanding=0
report_state || verify_outstanding=$?

if [ "${#RESTORE_COMMANDS[@]}" -gt 0 ]; then
  step "Restore commands (one per file changed)"
  for restore_command in "${RESTORE_COMMANDS[@]}"; do
    printf '    %s\n' "$restore_command"
  done
fi

printf '\n'
if [ "$INCLUDE_POLICY" -eq 0 ] && [ "$POLICY_AVAILABLE" -gt 0 ]; then
  printf '%d policy fix(es) (de-Creality set) available but not requested; add --policy to include them.\n' "$POLICY_AVAILABLE"
fi
if [ "$verify_outstanding" -eq 0 ] && [ "$apply_failures" -eq 0 ]; then
  printf 'Hardening verified. Re-run --check after any firmware update.\n'
  printf 'Note: fix 1 needs a tailscaled restart to take effect. No reboot was performed.\n'
  exit 0
fi
printf '%d fix(es) still outstanding after apply.\n' "$verify_outstanding"
exit 1
