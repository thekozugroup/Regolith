#!/usr/bin/env bash
# Re-apply the host-starvation fixes that keep a Creality K1 Max printing.
#
# Every one of these fixes lives in a path a Creality firmware update wipes
# (/etc/init.d and /opt/etc on overlayfs) or that an S96wipe_data can clear.
# This script is the durable copy: run --check after a firmware update to see
# what came back broken, then --apply to put it back.
#
# Usage:
#   ./tools/harden-k1.sh                          # --check (default), changes nothing
#   ./tools/harden-k1.sh --check                  # report present/absent/partial
#   ./tools/harden-k1.sh --apply                  # re-apply the system fixes
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
CRON_FAST="${CRON_FAST:-/opt/etc/cron.1min}"             # busybox run-parts, 60s tier
CRON_SLOW="${CRON_SLOW:-/opt/etc/cron.5mins}"            # busybox run-parts, 5min tier
LIGHT_WD="${LIGHT_WD:-/usr/data/scripts/light-watchdog.sh}"
SWAP_INIT="${SWAP_INIT:-/etc/init.d/S98swap}"            # firmware init, overlayfs
USER_SCRIPTS_DIR="${USER_SCRIPTS_DIR:-/usr/data/scripts}"
HARDEN_BACKUP_DIR="${HARDEN_BACKUP_DIR:-/usr/data/regolith-harden-backups}"
# Glob that identifies the tailscale watchdog cron entry. Deliberately narrow:
# Regolith's own /opt/etc/cron.1min/regolith-tailscale status writer is a
# different thing and is never moved or rewritten by this script.
WATCHDOG_GLOB="${WATCHDOG_GLOB:-*tailscale*watchdog*}"
# ---------------------------------------------------------------------------
# END K1-SPECIFIC LAYOUT
# ---------------------------------------------------------------------------

MODE="check"
INCLUDE_USER_SCRIPTS=0
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
harden-k1.sh — re-apply the K1 Max host-starvation fixes.

  ./tools/harden-k1.sh                    report only (default), changes nothing
  ./tools/harden-k1.sh --check            same as above
  ./tools/harden-k1.sh --apply            re-apply the system fixes
  ./tools/harden-k1.sh --apply --include-user-scripts
                                          also repair owner-authored scripts
  ./tools/harden-k1.sh --help

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
for candidate_path in "$TS_INIT" "$CRON_FAST" "$CRON_SLOW" "$LIGHT_WD" "$SWAP_INIT" \
  "$USER_SCRIPTS_DIR" "$HARDEN_BACKUP_DIR"; do
  validate_absolute_path "$candidate_path" \
    || fail "Invalid target path: ${candidate_path}. Use an absolute path such as /etc/init.d/S98swap."
done
validate_glob "$WATCHDOG_GLOB" || fail "Invalid WATCHDOG_GLOB. Use a plain glob such as *tailscale*watchdog*."

# Hard refusal, independent of the validators: this tool has no business near
# Klipper configuration. A firmware fix that edits printer.cfg is a different
# and much more dangerous tool than this one.
for candidate_path in "$TS_INIT" "$LIGHT_WD" "$SWAP_INIT"; do
  case "$candidate_path" in
    *printer.cfg | */printer_data/config/*)
      fail "Refusing to target ${candidate_path}. This script never writes Klipper configuration."
      ;;
  esac
done

readonly PRINTER_USER TS_INIT CRON_FAST CRON_SLOW LIGHT_WD SWAP_INIT
readonly USER_SCRIPTS_DIR HARDEN_BACKUP_DIR WATCHDOG_GLOB
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
CRON_FAST='${CRON_FAST}'
CRON_SLOW='${CRON_SLOW}'
LIGHT_WD='${LIGHT_WD}'
SWAP_INIT='${SWAP_INIT}'
WATCHDOG_GLOB='${WATCHDOG_GLOB}'
USER_SCRIPTS_DIR='${USER_SCRIPTS_DIR}'
REMOTE_VARS
  cat <<'REMOTE_CHECK'
set -u
say() { printf '%s\n' "$*"; }

# Reported so the caller can decide ownership against the same canonical form
# it resolves symlinked cron targets to, rather than against a path that only
# looks different because something above it is a symlink.
canonical_user_dir="$(readlink -f "$USER_SCRIPTS_DIR" 2>/dev/null || true)"
say "USER_DIR_CANONICAL ${canonical_user_dir:-$USER_SCRIPTS_DIR}"

# --- Fix 1: tailscaled memory containment ---------------------------------
if [ ! -f "$TS_INIT" ]; then
  say "FIX1 missing-file"
else
  pre=0; lim=0; gogc=0
  grep -q '^PREARGS="nice -n 19 nohup"$' "$TS_INIT" && pre=1
  grep -q '^export GOMEMLIMIT=24MiB$' "$TS_INIT" && lim=1
  grep -q '^export GOGC=40$' "$TS_INIT" && gogc=1
  case "${pre}${lim}${gogc}" in
    111) say "FIX1 present" ;;
    000) say "FIX1 absent" ;;
    *) say "FIX1 partial" ;;
  esac
  if grep -q -- '--tun=userspace-networking' "$TS_INIT"; then
    say "FIX1_TUN present"
  else
    say "FIX1_TUN absent"
  fi
fi

# --- Fix 2: tailscale watchdog cost ---------------------------------------
entry=""
tier=""
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
      USER_DIR_CANONICAL) [ -n "$value" ] && USER_DIR_CANONICAL="$value" ;;
      ADVISORY_CLI) ADVISORIES+=("$value") ;;
      *) ;;
    esac
  done < "$report_file"

  if [ "$FIX2_STATE" != "skip" ] && [ "$FIX2_TIER" = "present" ] && [ "$FIX2_PROBE" = "present" ]; then
    FIX2_STATE="present"
  elif [ "$FIX2_STATE" != "skip" ]; then
    FIX2_STATE="absent"
  fi
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

  case "$FIX1_STATE" in
    present) ok "1. tailscaled containment (nice 19, GOMEMLIMIT=24MiB, GOGC=40) — present in ${TS_INIT}" ;;
    partial) warn "1. tailscaled containment — PARTIAL in ${TS_INIT}; some settings are missing" ;;
    absent) warn "1. tailscaled containment — ABSENT from ${TS_INIT}" ;;
    missing-file) warn "1. tailscaled containment — ${TS_INIT} does not exist (Entware tailscale not installed?)" ;;
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
backup_file() {
  target="$1"
  mkdir -p "$BACKUP_DIR"
  flat="$(printf '%s' "$target" | tr '/' '_')"
  dest="${BACKUP_DIR}/${flat}.${STAMP}"
  cp -p "$target" "$dest"
  printf 'BACKUP %s %s\n' "$target" "$dest"
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
    warn "Skipped: ${TS_INIT} has no --tun=userspace-networking. Repair that first;"
    warn "without it tailscaled cannot start on this box at all."
    return 1
  fi
  {
    backup_preamble
    cat <<REMOTE_VARS
TS_INIT='${TS_INIT}'
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
awk '
  /^# >>> regolith-harden/ { skip = 1; next }
  /^# <<< regolith-harden/ { skip = 0; next }
  skip == 1 { next }
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
    ok "tailscaled containment written to ${TS_INIT}"
    info "tailscaled picks this up on its next start: ${TS_INIT} restart (no reboot)"
    return 0
  fi
  warn "Failed to apply fix 1. ${TS_INIT} was not changed if a backup line is absent above."
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

step "Inspect the four host-starvation fixes"
run_check
outstanding=0
report_state || outstanding=$?

if [ "$MODE" = "check" ]; then
  printf '\n'
  if [ "$outstanding" -eq 0 ]; then
    printf 'All fixes present. Nothing to do.\n'
    exit 0
  fi
  printf '%d fix(es) need re-applying. Nothing was changed.\n' "$outstanding"
  printf 'Re-apply with: PRINTER_HOST=%s ./tools/harden-k1.sh --apply\n' "$PRINTER_HOST"
  exit 1
fi

if [ "$outstanding" -eq 0 ]; then
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
if [ "$verify_outstanding" -eq 0 ] && [ "$apply_failures" -eq 0 ]; then
  printf 'Hardening verified. Re-run --check after any firmware update.\n'
  printf 'Note: fix 1 needs a tailscaled restart to take effect. No reboot was performed.\n'
  exit 0
fi
printf '%d fix(es) still outstanding after apply.\n' "$verify_outstanding"
exit 1
