#!/usr/bin/env bash
# Build, verify, and reversibly deploy Regolith static assets.
#
# Usage:
#   ./deploy.sh --preflight          # read-only readiness check
#   ./deploy.sh                      # validate, build, deploy, verify
#   ./deploy.sh --rollback           # swap live and previous builds
#
# Any Klipper printer that serves a static WebUI directory works. Defaults
# match a Creality K1 Max running Fluidd; override for another machine:
#   PRINTER_HOST   printer hostname or LAN address     (forge.local)
#   PRINTER_USER   SSH account on the printer          (root)
#   FLUIDD_ROOT    writable data root on the printer   (/usr/data)
#   WEBUI_DIR      served WebUI directory under it     (fluidd)
# Printer-specific behaviour (pins, limits, macros) belongs in a Regolith
# profile under src/profiles, not here.
#
# SSH keys are the supported way in. SSH into the printer once, then run
#   ssh-copy-id PRINTER_USER@PRINTER_HOST
# and every later deploy is passwordless. Without a key the script falls back
# to PRINTER_PASSWORD or a silent prompt through sshpass -e, so the secret
# never enters argv.

set -Eeuo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolved from the environment before anything below is made readonly.
PRINTER_USER="${PRINTER_USER:-root}"
FLUIDD_ROOT="${FLUIDD_ROOT:-/usr/data}"
WEBUI_DIR="${WEBUI_DIR:-fluidd}"

MODE="deploy"
PRINTER_HOST="${PRINTER_HOST:-forge.local}"
AUTH_READY=0
UPLOAD_STARTED=0
SWAP_ACTIVE=0
TEMP_DIR=""
ARCHIVE_PATH=""
INDEX_PATH=""
TARGET=""
declare -a SSH_COMMAND=()

step() { printf '\n==> %s\n' "$*"; }
ok() { printf '    OK  %s\n' "$*"; }
warn() { printf '    WARN  %s\n' "$*" >&2; }
fail() { printf '    ERROR  %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
}

for argument in "$@"; do
  case "$argument" in
    --preflight)
      [ "$MODE" = "deploy" ] || fail "Choose only one mode."
      MODE="preflight"
      ;;
    --rollback)
      [ "$MODE" = "deploy" ] || fail "Choose only one mode."
      MODE="rollback"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *) fail "Unknown option: $argument" ;;
  esac
done

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

validate_host "$PRINTER_HOST" || fail "Invalid PRINTER_HOST. Use forge.local or a plain trusted LAN hostname/IP."
validate_path_segment "$PRINTER_USER" || fail "Invalid PRINTER_USER. Use a plain account name such as root."
validate_absolute_path "$FLUIDD_ROOT" || fail "Invalid FLUIDD_ROOT. Use an absolute path such as /usr/data."
validate_path_segment "$WEBUI_DIR" || fail "Invalid WEBUI_DIR. Use one directory name such as fluidd."

# Every remote path is composed here and spliced into the remote scripts below,
# so the validators above are the only thing standing between an override and a
# remote shell. Keep them strict.
readonly PRINTER_USER FLUIDD_ROOT WEBUI_DIR
readonly LIVE_DIR="${FLUIDD_ROOT}/${WEBUI_DIR}"
readonly NEXT_DIR="${LIVE_DIR}.next"
readonly PREVIOUS_DIR="${LIVE_DIR}.previous"
readonly ROLLBACK_DIR="${LIVE_DIR}.rollback-candidate"
readonly UPLOAD_PATH="${FLUIDD_ROOT}/regolith-deploy.tgz"
readonly BACKUP_DIR="${FLUIDD_ROOT}/regolith-backups"
TARGET="${PRINTER_USER}@${PRINTER_HOST}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing $1. Install it, then retry."
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    fail "Missing SHA-256 tool (shasum or sha256sum)."
  fi
}

remote() {
  "${SSH_COMMAND[@]}" "$TARGET" "$@"
}

# ssh exits 255 only when it could not establish or authenticate the session.
# Dropbear on a memory-constrained printer occasionally refuses a mid-run auth;
# that is transient and safe to repeat. Every other status is the remote
# command's own exit code and is returned untouched, so real remote failures
# still fail closed on the first attempt.
#
# Usage: remote_retry <stdin-file|-> <remote command>
# Only use this for steps that are idempotent or read-only. Steps that mutate
# the live slot are called through plain remote() and stay failing-closed.
readonly REMOTE_ATTEMPTS=3
readonly SSH_TRANSPORT_STATUS=255

remote_retry() {
  local stdin_file="$1"
  shift
  local attempt=1
  local status
  while :; do
    status=0
    if [ "$stdin_file" = "-" ]; then
      remote "$@" || status=$?
    else
      # Reopened per attempt, and the remote redirect truncates, so a retry
      # rewrites the file rather than appending to a partial upload.
      remote "$@" < "$stdin_file" || status=$?
    fi
    if [ "$status" -eq 0 ]; then
      return 0
    fi
    if [ "$status" -ne "$SSH_TRANSPORT_STATUS" ] || [ "$attempt" -ge "$REMOTE_ATTEMPTS" ]; then
      return "$status"
    fi
    warn "SSH session refused by ${PRINTER_HOST} (attempt ${attempt}/${REMOTE_ATTEMPTS}). Retrying in ${attempt}s."
    sleep "$attempt"
    attempt=$((attempt + 1))
  done
}

# Deliberately never retried. A swap whose acknowledgement was lost must not be
# replayed, so this stays failing-closed; the guards below also refuse to run
# twice because the source directories no longer exist after a completed swap.
swap_live_previous() {
  remote '
    set -eu
    test -d '"$LIVE_DIR"'
    test -d '"$PREVIOUS_DIR"'
    rm -rf '"$ROLLBACK_DIR"'
    mv '"$LIVE_DIR"' '"$ROLLBACK_DIR"'
    if mv '"$PREVIOUS_DIR"' '"$LIVE_DIR"'; then
      mv '"$ROLLBACK_DIR"' '"$PREVIOUS_DIR"'
      chmod -R 755 '"$LIVE_DIR"'
      echo REGOLITH_ROLLBACK_OK
    else
      mv '"$ROLLBACK_DIR"' '"$LIVE_DIR"'
      exit 1
    fi
  '
}

http_verify() {
  local asset
  local assets
  local base="http://${PRINTER_HOST}"
  local cache_bust
  cache_bust="$(date +%s)"

  "$CURL_BIN" --fail --silent --show-error --connect-timeout 5 --max-time 12 \
    -H 'Cache-Control: no-cache' "${base}/?regolith_verify=${cache_bust}" \
    -o "$INDEX_PATH" || return 1
  grep -qi '<html' "$INDEX_PATH" || return 1

  assets="$(grep -oE 'href="[^"]+"|src="[^"]+"' "$INDEX_PATH" \
    | grep -oE '/[^" ]+' | sed 's/[?#].*$//' | LC_ALL=C sort -u || true)"
  [ -n "$assets" ] || return 1
  while IFS= read -r asset; do
    [ -n "$asset" ] || continue
    "$CURL_BIN" --fail --silent --show-error --connect-timeout 5 --max-time 12 \
      -H 'Cache-Control: no-cache' "${base}${asset}?regolith_verify=${cache_bust}" \
      -o /dev/null || return 1
  done <<< "$assets"
}

cleanup() {
  local status=$?
  trap - EXIT
  set +e

  if [ "$status" -ne 0 ] && [ "$SWAP_ACTIVE" -eq 1 ]; then
    warn "Post-swap verification failed. Restoring previous build automatically."
    if swap_live_previous >/dev/null 2>&1 && http_verify; then
      warn "Previous UI restored and HTTP recovery verified."
    else
      warn "Automatic rollback could not be verified. Do not operate printer through this UI."
    fi
  elif [ "$status" -ne 0 ] && [ "$UPLOAD_STARTED" -eq 1 ] && [ "$AUTH_READY" -eq 1 ]; then
    remote "rm -rf ${NEXT_DIR}; rm -f ${UPLOAD_PATH}" >/dev/null 2>&1 || true
  fi

  if [ -n "$TEMP_DIR" ] && [[ "$TEMP_DIR" == /tmp/regolith-deploy.* ]]; then
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
  warn "  ssh-copy-id ${TARGET}      # then deploys need no password"
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
AUTH_READY=1

TEMP_DIR="$(mktemp -d /tmp/regolith-deploy.XXXXXX)"
ARCHIVE_PATH="${TEMP_DIR}/regolith-deploy.tgz"
INDEX_PATH="${TEMP_DIR}/index.html"

step "Read-only remote preflight"
# Read-only, so a refused session is safe to retry.
remote_retry - '
  set -eu
  test -d '"$FLUIDD_ROOT"'
  test -w '"$FLUIDD_ROOT"'
  test -d '"$LIVE_DIR"'
  command -v tar >/dev/null
  command -v sha256sum >/dev/null
  available_kb=$(df -Pk '"$FLUIDD_ROOT"' | awk "NR==2 {print \$4}")
  test -n "$available_kb"
  test "$available_kb" -ge 32768
  printf "REGOLITH_PREFLIGHT_OK available_kb=%s\n" "$available_kb"
' >/dev/null || fail "Remote preflight failed. Need writable ${FLUIDD_ROOT}, current ${LIVE_DIR}, tar, sha256sum, and 32 MB free. Override FLUIDD_ROOT/WEBUI_DIR if this printer serves its WebUI elsewhere."

state_json="$($CURL_BIN --fail --silent --show-error --connect-timeout 5 --max-time 10 \
  "http://${PRINTER_HOST}/printer/objects/query?print_stats&idle_timeout&webhooks&virtual_sdcard")" \
  || fail "Moonraker state query failed. Deployment refuses unknown printer state."

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
')" || fail "Moonraker returned incomplete state. Deployment refuses unknown printer state."

IFS='|' read -r klipper_state print_state idle_state sd_active <<< "$printer_state"
[ "$klipper_state" = "ready" ] || fail "Klipper state is ${klipper_state}; expected ready."
case "$print_state" in
  standby|complete|cancelled) ;;
  *) fail "Print state is ${print_state}; deployment requires idle/standby." ;;
esac
case "$idle_state" in
  Idle|Ready) ;;
  *) fail "Printer activity is ${idle_state}; deployment requires idle." ;;
esac
[ "$sd_active" = "false" ] || fail "Virtual SD job is active; deployment blocked."
ok "Printer is conclusively idle (${print_state}, ${idle_state})"

if [ "$MODE" = "preflight" ]; then
  printf '\nPreflight passed. No remote files changed.\n'
  exit 0
fi

if [ "$MODE" = "rollback" ]; then
  step "Rollback to previous verified slot"
  remote_retry - "test -d ${PREVIOUS_DIR}" \
    || fail "No previous build exists at ${PREVIOUS_DIR}."
  swap_live_previous >/dev/null || fail "Rollback swap failed; live directory was preserved."
  SWAP_ACTIVE=1
  http_verify || fail "Rolled-back UI failed HTTP verification. Restoring original slot."
  SWAP_ACTIVE=0
  printf '\nRollback verified: http://%s/\n' "$PRINTER_HOST"
  exit 0
fi

step "Install dependencies and run local quality gates"
cd "$ROOT"
"$BUN_BIN" install --frozen-lockfile
"$BUN_BIN" run lint
"$BUN_BIN" run test
"$BUN_BIN" run build
[ -f dist/index.html ] || fail "Build completed without dist/index.html."

step "Create release archive"
require_command tar
COPYFILE_DISABLE=1 tar -czf "$ARCHIVE_PATH" -C dist .
local_size="$(wc -c < "$ARCHIVE_PATH" | tr -d '[:space:]')"
local_hash="$(sha256_file "$ARCHIVE_PATH")"
local_files="$(cd dist && find . -type f -print | sed 's|^\./||' | LC_ALL=C sort)"
[ -n "$local_files" ] || fail "dist contains no files."
ok "Archive ${local_size} bytes, SHA-256 ${local_hash}"

step "Upload and verify archive"
UPLOAD_STARTED=1
# Truncating write of a staging file outside the live slot: a retry rewrites it
# whole, and the size/SHA-256 comparison below still has to pass.
remote_retry "$ARCHIVE_PATH" "umask 022; cat > ${UPLOAD_PATH}" \
  || fail "Archive upload failed. Live UI was not changed."
remote_size="$(remote_retry - "wc -c < ${UPLOAD_PATH}" | tr -d '[:space:]')"
remote_hash="$(remote_retry - 'sha256sum '"$UPLOAD_PATH"' | awk "{print \$1}"' | tr -d '[:space:]')"
[ "$remote_size" = "$local_size" ] \
  || fail "Archive size mismatch (local ${local_size}, remote ${remote_size})."
[ "$remote_hash" = "$local_hash" ] \
  || fail "Archive SHA-256 mismatch. Live UI was not changed."
ok "Remote size and SHA-256 match"

step "Extract isolated staging slot"
# Self-cleaning (rm -rf first) and confined to the staging slot, so a refused
# session can be repeated without touching the live directory.
remote_retry - '
  set -eu
  if tar -tzf '"$UPLOAD_PATH"' | grep -Eq "(^/|(^|/)\.\.(/|$))"; then
    echo "Unsafe archive path" >&2
    exit 1
  fi
  rm -rf '"$NEXT_DIR"'
  mkdir -p '"$NEXT_DIR"'
  tar -xzf '"$UPLOAD_PATH"' -C '"$NEXT_DIR"'
  test -f '"$NEXT_DIR"'/index.html
  chmod -R 755 '"$NEXT_DIR"'
  echo REGOLITH_STAGE_OK
' >/dev/null || fail "Staging extract failed. Live UI was not changed."

remote_files="$(remote_retry - 'cd '"$NEXT_DIR"' && find . -type f -print | sed "s|^\./||" | LC_ALL=C sort')"
[ "$remote_files" = "$local_files" ] || fail "Staged file list differs from local dist. Live UI was not changed."
ok "Staged file list matches local dist"

step "Create persistent known-good backup and enforce retention"
# Deliberately not retried: this both creates an archive and prunes older ones,
# so a replay after a lost acknowledgement would write a second backup and evict
# an extra known-good archive. It stays failing-closed before the live swap.
backup_result="$(remote '
  set -eu
  retention_keep=5
  mkdir -p '"$BACKUP_DIR"'
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup="'"$BACKUP_DIR"'/'"$WEBUI_DIR"'-before-${stamp}.tgz"
  test ! -e "$backup"
  tar -czf "$backup" -C '"$FLUIDD_ROOT"' '"$WEBUI_DIR"'
  size=$(wc -c < "$backup" | tr -d "[:space:]")
  hash=$(sha256sum "$backup" | awk "{print \$1}")
  count=$(tar -tzf "$backup" | wc -l | tr -d "[:space:]")
  test "$size" -gt 0
  test "$count" -gt 0
  backups=$(find '"$BACKUP_DIR"' -type f -name "'"$WEBUI_DIR"'-before-*.tgz" | LC_ALL=C sort -r)
  test -n "$backups"
  total=0
  new_rank=0
  to_prune=""
  for candidate in $backups; do
    test -s "$candidate"
    tar -tzf "$candidate" >/dev/null
    total=$((total + 1))
    if [ "$candidate" = "$backup" ]; then
      new_rank=$total
    fi
    if [ "$total" -gt "$retention_keep" ]; then
      to_prune="$to_prune $candidate"
    fi
  done
  test "$new_rank" -ge 1
  test "$new_rank" -le "$retention_keep"
  pruned=0
  for candidate in $to_prune; do
    test "$candidate" != "$backup"
    rm -f "$candidate"
    test ! -e "$candidate"
    pruned=$((pruned + 1))
  done
  retained=$((total - pruned))
  test "$retained" -ge 1
  test "$retained" -le "$retention_keep"
  printf "backup=%s size=%s sha256=%s files=%s retained=%s pruned=%s\n" \
    "$backup" "$size" "$hash" "$count" "$retained" "$pruned"
')" || fail "Could not create and verify persistent backup. Live UI was not changed."
ok "$backup_result"

step "Atomic static-asset swap"
# Deliberately not retried: replaying a swap whose acknowledgement was lost
# could discard the real previous slot. It fails closed and the trap below
# restores the previous build.
remote '
  set -eu
  test -d '"$LIVE_DIR"'
  test -f '"$NEXT_DIR"'/index.html
  rm -rf '"$PREVIOUS_DIR"'
  mv '"$LIVE_DIR"' '"$PREVIOUS_DIR"'
  if mv '"$NEXT_DIR"' '"$LIVE_DIR"'; then
    chmod -R 755 '"$LIVE_DIR"'
    echo REGOLITH_SWAP_OK
  else
    mv '"$PREVIOUS_DIR"' '"$LIVE_DIR"'
    exit 1
  fi
' >/dev/null || fail "Atomic swap failed; previous live directory was restored."
SWAP_ACTIVE=1

step "Verify live HTML and every referenced asset"
http_verify || fail "Live HTTP verification failed."
# Removing staging leftovers is idempotent, so a refused session can be retried.
remote_retry - "rm -f ${UPLOAD_PATH}; rm -rf ${NEXT_DIR}" >/dev/null \
  || fail "Post-deploy cleanup failed."
SWAP_ACTIVE=0
UPLOAD_STARTED=0

rollback_env="$(printf 'PRINTER_HOST=%q' "$PRINTER_HOST")"
[ "$PRINTER_USER" = "root" ] || rollback_env="${rollback_env} $(printf 'PRINTER_USER=%q' "$PRINTER_USER")"
[ "$FLUIDD_ROOT" = "/usr/data" ] || rollback_env="${rollback_env} $(printf 'FLUIDD_ROOT=%q' "$FLUIDD_ROOT")"
[ "$WEBUI_DIR" = "fluidd" ] || rollback_env="${rollback_env} $(printf 'WEBUI_DIR=%q' "$WEBUI_DIR")"

printf '\nDeploy verified: http://%s/\n' "$PRINTER_HOST"
printf 'Rollback: %s ./deploy.sh --rollback\n' "$rollback_env"
printf 'Persistent backup: %s\n' "$backup_result"
