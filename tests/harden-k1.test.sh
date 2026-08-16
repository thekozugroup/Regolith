#!/usr/bin/env bash
# Exercises tools/harden-k1.sh against a sandbox filesystem.
#
# The ssh mock does not pattern-match remote commands the way deploy.test.sh
# does — it executes them, with sh, against a fake printer root under /tmp.
# Every target path in harden-k1.sh is an override, so pointing them at the
# sandbox makes the repairs real: backups are really written, files are really
# rewritten, and idempotency is really the second run finding nothing to do.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/regolith-harden-tests.XXXXXX)"
MOCK_BIN="${TEST_ROOT}/bin"
mkdir -p "$MOCK_BIN"

cleanup() {
  if [[ "$TEST_ROOT" == /tmp/regolith-harden-tests.* ]]; then
    rm -rf "$TEST_ROOT"
  fi
}
trap cleanup EXIT

pass_count=0
fail_test() {
  printf 'not ok - %s\n' "$1" >&2
  printf '%s\n' '--- last output ---' >&2
  [ -n "${OUTPUT_FILE:-}" ] && [ -f "${OUTPUT_FILE:-}" ] && cat "$OUTPUT_FILE" >&2
  exit 1
}
pass_test() {
  pass_count=$((pass_count + 1))
  printf 'ok %d - %s\n' "$pass_count" "$1"
}

cat > "${MOCK_BIN}/bun" <<'MOCK_BUN'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "-e" ]; then
  cat >/dev/null
  case "${MOCK_SCENARIO:-idle}" in
    busy) printf 'ready|printing|Printing|true' ;;
    paused) printf 'ready|paused|Printing|true' ;;
    unknown) exit 2 ;;
    *) printf 'ready|standby|Ready|false' ;;
  esac
  exit 0
fi
exit 0
MOCK_BUN

cat > "${MOCK_BIN}/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -euo pipefail
url=""
for argument in "$@"; do
  case "$argument" in
    http://*) url="$argument" ;;
    *) ;;
  esac
done
printf 'CURL %s\n' "$url" >> "$MOCK_LOG"
if [ "${MOCK_SCENARIO:-idle}" = "moonraker_down" ]; then
  exit 22
fi
case "${MOCK_SCENARIO:-idle}" in
  unknown) printf '{"result":{"status":{}}}' ;;
  busy) printf '{"result":{"status":{"webhooks":{"state":"ready"},"print_stats":{"state":"printing"},"idle_timeout":{"state":"Printing"},"virtual_sdcard":{"is_active":true}}}}' ;;
  paused) printf '{"result":{"status":{"webhooks":{"state":"ready"},"print_stats":{"state":"paused"},"idle_timeout":{"state":"Printing"},"virtual_sdcard":{"is_active":true}}}}' ;;
  *) printf '{"result":{"status":{"webhooks":{"state":"ready"},"print_stats":{"state":"standby"},"idle_timeout":{"state":"Ready"},"virtual_sdcard":{"is_active":false}}}}' ;;
esac
MOCK_CURL

# Executes the remote payload for real. The paths inside it are sandbox paths,
# so this is the closest thing to the printer that does not involve the printer.
cat > "${MOCK_BIN}/ssh" <<'MOCK_SSH'
#!/usr/bin/env bash
set -uo pipefail
command_text="${!#}"
printf 'SSH_TARGET %s\n' "${@: -2:1}" >> "$MOCK_LOG"
printf 'SSH_INVOKE\n' >> "$MOCK_LOG"
# Everything harden-k1.sh sends must be POSIX sh a busybox printer can parse.
sh -n <<< "$command_text" || exit 93
if [ "$command_text" = "true" ]; then
  exit 0
fi
printf 'SSH_EXEC\n' >> "$MOCK_LOG"
sh -c "$command_text"
MOCK_SSH

chmod +x "${MOCK_BIN}/bun" "${MOCK_BIN}/curl" "${MOCK_BIN}/ssh"

CASE_DIR=""
FAKE_ROOT=""
LOG_FILE=""
OUTPUT_FILE=""
TS_INIT_PATH=""
CRON_FAST_PATH=""
CRON_SLOW_PATH=""
LIGHT_WD_PATH=""
SWAP_INIT_PATH=""
USER_SCRIPTS_PATH=""
BACKUP_PATH=""

# --- Fixtures --------------------------------------------------------------
write_ts_init() {
  local tun_args="$1"
  cat > "$TS_INIT_PATH" <<TSINIT
#!/bin/sh

ENABLED=yes
PROCS=tailscaled
ARGS="--state=/opt/var/lib/tailscale/tailscaled.state ${tun_args}"
PREARGS="nohup"
DESC=\$PROCS
PATH=/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin

. /opt/etc/init.d/rc.func
TSINIT
  chmod 755 "$TS_INIT_PATH"
}

write_swap_init() {
  local form="${1:-sysctl}"
  if [ "$form" = "echo" ]; then
    cat > "$SWAP_INIT_PATH" <<'SWAPINIT'
#!/bin/sh
case "$1" in
  start)
    swapon /usr/data/swapfile
    echo 10 > /proc/sys/vm/swappiness
    ;;
esac
SWAPINIT
  else
    cat > "$SWAP_INIT_PATH" <<'SWAPINIT'
#!/bin/sh
case "$1" in
  start)
    swapon /usr/data/swapfile
    sysctl -w vm.swappiness=10
    ;;
esac
SWAPINIT
  fi
  chmod 755 "$SWAP_INIT_PATH"
}

write_light_watchdog() {
  cat > "$LIGHT_WD_PATH" <<'LIGHTWD'
#!/bin/sh
# light-watchdog — runs every 1 min via /opt/etc/cron.1min
exec /usr/bin/python3 /usr/data/scripts/light-watchdog.py "$@"
LIGHTWD
  chmod 755 "$LIGHT_WD_PATH"
}

write_tailscale_watchdog() {
  local tier="$1"
  cat > "${USER_SCRIPTS_PATH}/tailscale-watchdog.sh" <<'TSWD'
#!/bin/sh
# Original: spawns a second Go binary on every single tick.
if ! pidof tailscaled >/dev/null 2>&1; then
  /opt/etc/init.d/S06tailscaled start
  exit 0
fi
tailscale status >/dev/null 2>&1 || /opt/etc/init.d/S06tailscaled restart
exit 0
TSWD
  chmod 755 "${USER_SCRIPTS_PATH}/tailscale-watchdog.sh"
  ln -sf "${USER_SCRIPTS_PATH}/tailscale-watchdog.sh" "${tier}/tailscale-watchdog"
}

write_regolith_tailscale_cron() {
  cat > "${USER_SCRIPTS_PATH}/regolith-tailscale.sh" <<'RTS'
#!/bin/sh
/opt/bin/tailscale status --json > /usr/data/printer_data/config/regolith-tailscale.json
RTS
  chmod 755 "${USER_SCRIPTS_PATH}/regolith-tailscale.sh"
  ln -sf "${USER_SCRIPTS_PATH}/regolith-tailscale.sh" "${CRON_FAST_PATH}/regolith-tailscale"
}

prepare_case() {
  local name="$1"
  CASE_DIR="${TEST_ROOT}/${name}"
  FAKE_ROOT="${CASE_DIR}/root"
  LOG_FILE="${CASE_DIR}/mock.log"
  OUTPUT_FILE="${CASE_DIR}/output.log"
  TS_INIT_PATH="${FAKE_ROOT}/opt/etc/init.d/S06tailscaled"
  CRON_FAST_PATH="${FAKE_ROOT}/opt/etc/cron.1min"
  CRON_SLOW_PATH="${FAKE_ROOT}/opt/etc/cron.5mins"
  LIGHT_WD_PATH="${FAKE_ROOT}/usr/data/scripts/light-watchdog.sh"
  SWAP_INIT_PATH="${FAKE_ROOT}/etc/init.d/S98swap"
  USER_SCRIPTS_PATH="${FAKE_ROOT}/usr/data/scripts"
  BACKUP_PATH="${FAKE_ROOT}/usr/data/harden-backups"
  mkdir -p "${FAKE_ROOT}/opt/etc/init.d" "$CRON_FAST_PATH" "$CRON_SLOW_PATH" \
    "$USER_SCRIPTS_PATH" "${FAKE_ROOT}/etc/init.d"
  : > "$LOG_FILE"
}

invoke() {
  local scenario="$1"
  shift
  set +e
  (
    cd "$ROOT"
    env PATH="${MOCK_BIN}:$PATH" \
      MOCK_SCENARIO="$scenario" \
      MOCK_LOG="$LOG_FILE" \
      PRINTER_HOST="${TEST_HOST:-forge.local}" \
      PRINTER_USER="${TEST_USER:-root}" \
      TS_INIT="$TS_INIT_PATH" \
      CRON_FAST="$CRON_FAST_PATH" \
      CRON_SLOW="$CRON_SLOW_PATH" \
      LIGHT_WD="$LIGHT_WD_PATH" \
      SWAP_INIT="$SWAP_INIT_PATH" \
      USER_SCRIPTS_DIR="$USER_SCRIPTS_PATH" \
      HARDEN_BACKUP_DIR="$BACKUP_PATH" \
      bash ./tools/harden-k1.sh "$@"
  ) > "$OUTPUT_FILE" 2>&1
  INVOKE_STATUS=$?
  set -e
  return 0
}

fingerprint() {
  (
    cd "$FAKE_ROOT"
    find . \( -type f -o -type l \) -print0 \
      | LC_ALL=C sort -z \
      | while IFS= read -r -d '' entry; do
        if [ -L "$entry" ]; then
          printf '%s -> %s\n' "$entry" "$(readlink "$entry")"
        else
          printf '%s %s\n' "$entry" "$(wc -c < "$entry" | tr -d ' ')"
        fi
      done
  )
}

backup_count() {
  if [ -d "$BACKUP_PATH" ]; then
    find "$BACKUP_PATH" -type f | wc -l | tr -d ' '
  else
    printf '0'
  fi
}

full_fixture() {
  write_ts_init '--tun=userspace-networking'
  write_swap_init sysctl
  write_light_watchdog
  write_tailscale_watchdog "$CRON_FAST_PATH"
}

# --- 1. static safety of the tracked script --------------------------------
bash -n "${ROOT}/tools/harden-k1.sh" || fail_test "harden-k1.sh does not parse"
pass_test "harden-k1.sh parses"

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck -s bash "${ROOT}/tools/harden-k1.sh" \
    || fail_test "harden-k1.sh is not shellcheck-clean"
  pass_test "harden-k1.sh is shellcheck-clean"
else
  pass_test "shellcheck unavailable; static analysis skipped"
fi

if grep -Eq '([0-9]{1,3}\.){3}[0-9]{1,3}|\.ts\.net|[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' "${ROOT}/tools/harden-k1.sh"; then
  fail_test "harden-k1.sh contains a literal address"
fi
if grep -Eq '^[[:space:]]*(export[[:space:]]+)?(PRINTER_PASSWORD|SSHPASS)=[^"$]' "${ROOT}/tools/harden-k1.sh"; then
  fail_test "harden-k1.sh assigns a literal credential"
fi
grep -q 'StrictHostKeyChecking=accept-new' "${ROOT}/tools/harden-k1.sh" \
  || fail_test "accept-new host key policy missing"
grep -q 'sshpass -e' "${ROOT}/tools/harden-k1.sh" \
  || fail_test "environment-only sshpass mode missing"
key_line="$(grep -n 'BatchMode=yes' "${ROOT}/tools/harden-k1.sh" | head -1 | cut -d: -f1)"
password_line="$(grep -n 'sshpass -e ssh' "${ROOT}/tools/harden-k1.sh" | head -1 | cut -d: -f1)"
[ -n "$key_line" ] && [ -n "$password_line" ] && [ "$key_line" -lt "$password_line" ] \
  || fail_test "key authentication must be attempted before the password fallback"
pass_test "no embedded address or credential; keys come before the password fallback"

# Comments and messages may say the word; nothing may run it. Match only
# command position: start of line, or just after a ; & | ( or a && / ||.
if grep -vE '^[[:space:]]*#' "${ROOT}/tools/harden-k1.sh" \
  | grep -Eq '(^|[;&|(]|&&|\|\|)[[:space:]]*(reboot|sysupgrade|flash_erase|mtd[[:space:]])'; then
  fail_test "harden-k1.sh runs a reboot or reflash command"
fi
pass_test "harden-k1.sh never reboots or reflashes"

# --- 2. --check is the default and never writes ----------------------------
prepare_case default-mode
full_fixture
before="$(fingerprint)"
invoke idle
[ "$INVOKE_STATUS" -eq 1 ] || fail_test "bare invocation must report missing fixes with exit 1"
[ "$(fingerprint)" = "$before" ] || fail_test "bare invocation modified the filesystem"
[ "$(backup_count)" = "0" ] || fail_test "bare invocation wrote a backup"
grep -q 'Nothing was changed' "$OUTPUT_FILE" || fail_test "bare invocation did not say it changed nothing"
pass_test "default mode is --check and changes nothing"

# --- 3. --check exit codes -------------------------------------------------
prepare_case check-missing
full_fixture
invoke idle --check
[ "$INVOKE_STATUS" -eq 1 ] || fail_test "--check on an unhardened box must exit 1"
grep -q '4 fix(es) need re-applying' "$OUTPUT_FILE" || fail_test "--check did not count the outstanding fixes"
pass_test "--check exits 1 and counts every absent fix"

# --- 4. refusal while a print is running -----------------------------------
for busy_scenario in busy paused; do
  prepare_case "busy-${busy_scenario}"
  full_fixture
  before="$(fingerprint)"
  invoke "$busy_scenario" --apply --include-user-scripts
  [ "$INVOKE_STATUS" -eq 2 ] || fail_test "--apply during a ${busy_scenario} print must exit 2"
  grep -q 'hardening requires idle' "$OUTPUT_FILE" \
    || fail_test "${busy_scenario} refusal message is not clear"
  [ "$(fingerprint)" = "$before" ] || fail_test "${busy_scenario} refusal still modified the filesystem"
  grep -q '^SSH_EXEC$' "$LOG_FILE" && fail_test "${busy_scenario} refusal still ran a remote payload"
  pass_test "refuses to run while a print is ${busy_scenario}, before any remote payload"
done

prepare_case busy-check
full_fixture
invoke busy --check
[ "$INVOKE_STATUS" -eq 2 ] || fail_test "--check during a print must also refuse"
pass_test "--check refuses during a print too (a report is not worth the page cache)"

prepare_case unknown-state
full_fixture
before="$(fingerprint)"
invoke unknown --apply
[ "$INVOKE_STATUS" -eq 2 ] || fail_test "unknown printer state must exit 2"
grep -q 'incomplete state' "$OUTPUT_FILE" || fail_test "unknown state message is not clear"
[ "$(fingerprint)" = "$before" ] || fail_test "unknown state still modified the filesystem"
pass_test "unknown Moonraker state refuses without writing"

prepare_case moonraker-down
full_fixture
invoke moonraker_down --apply
[ "$INVOKE_STATUS" -eq 2 ] || fail_test "unreachable Moonraker must exit 2"
pass_test "unreachable Moonraker refuses rather than assuming idle"

# --- 5. apply, verify, back up ---------------------------------------------
prepare_case apply-system
full_fixture
invoke idle --apply
[ "$INVOKE_STATUS" -eq 1 ] \
  || fail_test "--apply without --include-user-scripts must exit 1 while user files remain unfixed"

grep -q '^PREARGS="nice -n 19 nohup"$' "$TS_INIT_PATH" || fail_test "fix 1 PREARGS not written"
grep -q '^export GOMEMLIMIT=24MiB$' "$TS_INIT_PATH" || fail_test "fix 1 GOMEMLIMIT not written"
grep -q '^export GOGC=40$' "$TS_INIT_PATH" || fail_test "fix 1 GOGC not written"
grep -q -- '--tun=userspace-networking' "$TS_INIT_PATH" || fail_test "fix 1 destroyed the userspace-networking arg"
grep -c '^PREARGS=' "$TS_INIT_PATH" | grep -q '^1$' || fail_test "fix 1 left a duplicate PREARGS"
block_line="$(grep -n '^PREARGS=' "$TS_INIT_PATH" | head -1 | cut -d: -f1)"
func_line="$(grep -n 'rc\.func' "$TS_INIT_PATH" | head -1 | cut -d: -f1)"
[ "$block_line" -lt "$func_line" ] || fail_test "fix 1 block landed after rc.func and would never take effect"
sh -n "$TS_INIT_PATH" || fail_test "fix 1 produced an unparsable init script"
pass_test "fix 1 writes containment before rc.func and keeps userspace-networking"

grep -q 'vm.swappiness=1$' "$SWAP_INIT_PATH" || fail_test "fix 4 did not set swappiness to 1"
grep -q 'swappiness=10' "$SWAP_INIT_PATH" && fail_test "fix 4 left the old swappiness value"
sh -n "$SWAP_INIT_PATH" || fail_test "fix 4 produced an unparsable init script"
pass_test "fix 4 rewrites vm.swappiness to 1"

[ -L "${CRON_SLOW_PATH}/tailscale-watchdog" ] || fail_test "fix 2 did not move the watchdog to the 5-minute tier"
[ -e "${CRON_FAST_PATH}/tailscale-watchdog" ] && fail_test "fix 2 left the watchdog on the 60-second tier"
pass_test "fix 2 moves the watchdog cron from the 60-second to the 5-minute tier"

# The cron entry lives in Entware's tree and is fair game; the script it points
# at lives under the owner's scripts directory and is not.
grep -q 'regolith-harden' "${USER_SCRIPTS_PATH}/tailscale-watchdog.sh" \
  && fail_test "fix 2 rewrote an owner-authored script body without --include-user-scripts"
grep -q 'Skipped watchdog body' "$OUTPUT_FILE" \
  || fail_test "fix 2 did not say it was leaving the owner-authored body alone"
pass_test "fix 2 moves the cron entry but leaves the owner-authored body alone"

grep -q 'nice -n 19' "$LIGHT_WD_PATH" && fail_test "fix 3 modified an owner file without --include-user-scripts"
grep -q 'the owner wrote' "$OUTPUT_FILE" || fail_test "fix 3 skip did not name the file as owner-authored"
grep -q -- '--include-user-scripts' "$OUTPUT_FILE" || fail_test "fix 3 skip did not name the opt-in flag"
pass_test "owner-authored light-watchdog.sh is not rewritten without the explicit flag"

[ "$(backup_count)" -ge 2 ] || fail_test "apply did not write timestamped backups"
find "$BACKUP_PATH" -type f -name '*S98swap.[0-9]*-[0-9]*' | grep -q . \
  || fail_test "backup is missing its timestamped suffix"
grep -q "Restore commands" "$OUTPUT_FILE" || fail_test "apply did not print restore commands"
grep -qE "ssh root@forge.local 'cp -p .*S98swap\.[0-9]{8}-[0-9]{6} .*S98swap'" "$OUTPUT_FILE" \
  || fail_test "apply did not print an exact restore command per file"
pass_test "every modified file is backed up with a timestamp and an exact restore command"

# A stray S06tailscaled.bak inside /opt/etc/init.d still matches the rc glob
# and would be executed at boot. Backups must not live beside the original.
find "${FAKE_ROOT}/opt/etc/init.d" -name 'S06tailscaled.*' | grep -q . \
  && fail_test "a backup was left inside the init.d directory where rc would run it"
find "${FAKE_ROOT}/etc/init.d" -name 'S98swap.*' | grep -q . \
  && fail_test "a backup was left inside the init.d directory where rc would run it"
pass_test "backups never land beside an init script the boot glob would execute"

# --- 6. idempotency --------------------------------------------------------
before="$(fingerprint)"
backups_before="$(backup_count)"
invoke idle --apply
[ "$INVOKE_STATUS" -eq 1 ] || fail_test "second --apply must still report the untouched owner files"
[ "$(fingerprint)" = "$before" ] || fail_test "second --apply changed files that were already correct"
[ "$(backup_count)" = "$backups_before" ] || fail_test "second --apply wrote redundant backups"
grep -q 'Apply fix 1' "$OUTPUT_FILE" && fail_test "second --apply re-ran an already-present fix"
grep -q 'Apply fix 4' "$OUTPUT_FILE" && fail_test "second --apply re-ran an already-present fix"
pass_test "second --apply is a no-op for fixes already present"

invoke idle --check
[ "$INVOKE_STATUS" -eq 1 ] || fail_test "--check should still flag the untouched owner files"
grep -q '2 fix(es) need re-applying' "$OUTPUT_FILE" \
  || fail_test "--check should report exactly the two deliberately-skipped owner files"
pass_test "--check after apply reports exactly the deliberately-skipped owner files"

# --- 7. the user-owned file, with consent ----------------------------------
invoke idle --apply --include-user-scripts
[ "$INVOKE_STATUS" -eq 0 ] || fail_test "--apply --include-user-scripts must finish clean"
grep -q 'NOTICE' "$OUTPUT_FILE" || fail_test "modifying an owner file printed no notice"
grep -q 'a file the owner authored' "$OUTPUT_FILE" || fail_test "the notice does not say whose file it is"
grep -q '^exec nice -n 19 /usr/bin/python3 ' "$LIGHT_WD_PATH" \
  || fail_test "fix 3 did not wrap the python invocation in nice -n 19"
grep -q 'light-watchdog.py' "$LIGHT_WD_PATH" || fail_test "fix 3 lost the script argument"
sh -n "$LIGHT_WD_PATH" || fail_test "fix 3 produced an unparsable script"
find "$BACKUP_PATH" -type f -name '*light-watchdog.sh.[0-9]*' | grep -q . \
  || fail_test "the owner file was modified without a backup"
pass_test "--include-user-scripts wraps python in nice 19, with a notice and a backup"

invoke idle --apply --include-user-scripts
[ "$INVOKE_STATUS" -eq 0 ] || fail_test "fully hardened box must exit 0"
grep -q 'All fixes already present' "$OUTPUT_FILE" || fail_test "fully hardened apply is not a no-op"
pass_test "a fully hardened box applies nothing and exits 0"

invoke idle --check
[ "$INVOKE_STATUS" -eq 0 ] || fail_test "--check on a hardened box must exit 0"
grep -q 'All fixes present' "$OUTPUT_FILE" || fail_test "--check did not confirm a hardened box"
pass_test "--check exits 0 once every fix is present"

# --- 8. the watchdog body --------------------------------------------------
grep -q 'regolith-harden: tailscale watchdog' "${USER_SCRIPTS_PATH}/tailscale-watchdog.sh" \
  || fail_test "fix 2 did not install the hardened watchdog body"
grep -q 'pidof' "${USER_SCRIPTS_PATH}/tailscale-watchdog.sh" \
  || fail_test "hardened watchdog lost its free liveness probe"
grep -q 'PROBE_INTERVAL=1800' "${USER_SCRIPTS_PATH}/tailscale-watchdog.sh" \
  || fail_test "hardened watchdog does not throttle the CLI probe to 30 minutes"
sh -n "${USER_SCRIPTS_PATH}/tailscale-watchdog.sh" \
  || fail_test "hardened watchdog is not parsable by sh"
pass_test "hardened watchdog uses pidof and throttles the CLI probe to 30 minutes"

# --- 9. the userspace-networking guard -------------------------------------
prepare_case no-tun
write_ts_init '--socket=/var/run/tailscale/tailscaled.sock'
write_swap_init sysctl
write_light_watchdog
before_init="$(cat "$TS_INIT_PATH")"
invoke idle --apply
grep -q 'userspace-networking is MISSING' "$OUTPUT_FILE" \
  || fail_test "missing userspace-networking was not called out"
[ "$(cat "$TS_INIT_PATH")" = "$before_init" ] \
  || fail_test "fix 1 edited a tailscaled init that cannot start on this box"
[ "$INVOKE_STATUS" -eq 1 ] || fail_test "the tun guard must leave the run failing"
pass_test "fix 1 refuses to touch an init script missing --tun=userspace-networking"

# --- 10. the echo form of the swappiness setting ---------------------------
prepare_case swap-echo-form
write_ts_init '--tun=userspace-networking'
write_swap_init echo
write_light_watchdog
invoke idle --apply
grep -q 'echo 1 > /proc/sys/vm/swappiness' "$SWAP_INIT_PATH" \
  || fail_test "the echo form of the swappiness setting was not rewritten"
grep -q 'echo 10' "$SWAP_INIT_PATH" && fail_test "the old echo value survived"
sh -n "$SWAP_INIT_PATH" || fail_test "the echo-form rewrite is unparsable"
pass_test "fix 4 handles both the sysctl and the echo form"

# --- 11. absent subsystems are not failures --------------------------------
prepare_case no-watchdog
write_ts_init '--tun=userspace-networking'
write_swap_init sysctl
invoke idle --check
grep -q 'not installed; nothing to harden' "$OUTPUT_FILE" \
  || fail_test "an absent watchdog should be reported as nothing to do"
grep -q 'does not exist; nothing to wrap' "$OUTPUT_FILE" \
  || fail_test "an absent light-watchdog should be reported as nothing to do"
grep -q '2 fix(es) need re-applying' "$OUTPUT_FILE" \
  || fail_test "absent subsystems must not be counted as outstanding fixes"
pass_test "a subsystem that does not exist is not counted as a missing fix"

# --- 12. the advisory is advisory ------------------------------------------
prepare_case advisory
full_fixture
write_regolith_tailscale_cron
invoke idle --apply --include-user-scripts
grep -q 'advisory:' "$OUTPUT_FILE" \
  || fail_test "a 60-second job invoking the tailscale CLI was not flagged"
grep -q 'regolith-tailscale' "$OUTPUT_FILE" || fail_test "the advisory did not name the entry"
[ "$INVOKE_STATUS" -eq 0 ] || fail_test "the advisory must not fail the run"
[ -e "${CRON_FAST_PATH}/regolith-tailscale" ] \
  || fail_test "the advisory entry was moved; it must only be reported"
pass_test "an unrelated CLI-spawning cron entry is reported, never moved, never fatal"

# --- 13. input validation --------------------------------------------------
prepare_case bad-host
full_fixture
TEST_HOST='forge.local;touch-bad'
invoke idle --check
[ "$INVOKE_STATUS" -eq 2 ] || fail_test "an unsafe host must be rejected"
grep -q 'Invalid PRINTER_HOST' "$OUTPUT_FILE" || fail_test "unsafe host error is not clear"
[ ! -s "$LOG_FILE" ] || fail_test "unsafe host reached the command mocks"
unset TEST_HOST
pass_test "unsafe PRINTER_HOST is rejected before any network call"

prepare_case printer-cfg-guard
full_fixture
set +e
printer_cfg_output="$(
  cd "$ROOT"
  env PATH="${MOCK_BIN}:$PATH" MOCK_SCENARIO=idle MOCK_LOG="$LOG_FILE" \
    PRINTER_HOST=forge.local \
    SWAP_INIT=/usr/data/printer_data/config/printer.cfg \
    bash ./tools/harden-k1.sh --apply 2>&1
)"
printer_cfg_status=$?
set -e
[ "$printer_cfg_status" -eq 2 ] || fail_test "a printer.cfg target must be refused"
grep -q 'never writes Klipper configuration' <<< "$printer_cfg_output" \
  || fail_test "the printer.cfg refusal is not explicit"
pass_test "refuses outright to target printer.cfg"

# --- 14. the remote payload is POSIX sh ------------------------------------
prepare_case posix-payload
full_fixture
invoke idle --apply --include-user-scripts
grep -q '^SSH_EXEC$' "$LOG_FILE" || fail_test "no remote payload was executed"
# The ssh mock runs `sh -n` on every payload and exits 93 on a parse failure;
# reaching here without a 93 means each one is busybox-parsable.
[ "$INVOKE_STATUS" -ne 93 ] || fail_test "a remote payload was not POSIX sh"
pass_test "every remote payload parses as POSIX sh"

printf '1..%d\n' "$pass_count"
