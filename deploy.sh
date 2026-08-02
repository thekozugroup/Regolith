#!/usr/bin/env bash
# Build, verify, and reversibly deploy Regolith static assets.
#
# Usage:
#   ./deploy.sh --preflight          # read-only readiness check
#   ./deploy.sh                      # validate, build, deploy, verify
#   ./deploy.sh --rollback           # swap live and previous builds
#
# Authentication prefers an existing SSH key. If key auth fails, set
# PRINTER_PASSWORD or run interactively for a silent prompt. Password auth
# requires sshpass and uses SSHPASS/sshpass -e so secrets never enter argv.

set -Eeuo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PRINTER_USER="root"
readonly LIVE_DIR="/usr/data/fluidd"
readonly NEXT_DIR="/usr/data/fluidd.next"
readonly PREVIOUS_DIR="/usr/data/fluidd.previous"
readonly UPLOAD_PATH="/usr/data/regolith-deploy.tgz"
readonly BACKUP_DIR="/usr/data/regolith-backups"

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
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
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

validate_host "$PRINTER_HOST" || fail "Invalid PRINTER_HOST. Use forge.local or a plain trusted LAN hostname/IP."
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

swap_live_previous() {
  remote '
    set -eu
    test -d /usr/data/fluidd
    test -d /usr/data/fluidd.previous
    rm -rf /usr/data/fluidd.rollback-candidate
    mv /usr/data/fluidd /usr/data/fluidd.rollback-candidate
    if mv /usr/data/fluidd.previous /usr/data/fluidd; then
      mv /usr/data/fluidd.rollback-candidate /usr/data/fluidd.previous
      chmod -R 755 /usr/data/fluidd
      echo REGOLITH_ROLLBACK_OK
    else
      mv /usr/data/fluidd.rollback-candidate /usr/data/fluidd
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
    remote 'rm -rf /usr/data/fluidd.next; rm -f /usr/data/regolith-deploy.tgz' >/dev/null 2>&1 || true
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
if ssh "${SSH_OPTIONS[@]}" -o BatchMode=yes "$TARGET" true >/dev/null 2>&1; then
  SSH_COMMAND=(ssh "${SSH_OPTIONS[@]}" -o BatchMode=yes)
  ok "SSH key authentication"
else
  if [ -z "${PRINTER_PASSWORD:-}" ]; then
    if [ -t 0 ]; then
      read -r -s -p "Printer password for ${TARGET}: " PRINTER_PASSWORD
      printf '\n'
    else
      fail "SSH key authentication failed. Set PRINTER_PASSWORD or run interactively."
    fi
  fi
  require_command sshpass
  export SSHPASS="$PRINTER_PASSWORD"
  unset PRINTER_PASSWORD
  SSH_COMMAND=(sshpass -e ssh "${SSH_OPTIONS[@]}")
  remote true >/dev/null 2>&1 || fail "Authentication failed for ${TARGET}."
  ok "Password authentication through sshpass -e"
fi
AUTH_READY=1

TEMP_DIR="$(mktemp -d /tmp/regolith-deploy.XXXXXX)"
ARCHIVE_PATH="${TEMP_DIR}/regolith-deploy.tgz"
INDEX_PATH="${TEMP_DIR}/index.html"

step "Read-only remote preflight"
remote '
  set -eu
  test -d /usr/data
  test -w /usr/data
  test -d /usr/data/fluidd
  command -v tar >/dev/null
  command -v sha256sum >/dev/null
  available_kb=$(df -Pk /usr/data | awk "NR==2 {print \$4}")
  test -n "$available_kb"
  test "$available_kb" -ge 32768
  printf "REGOLITH_PREFLIGHT_OK available_kb=%s\n" "$available_kb"
' >/dev/null || fail "Remote preflight failed. Need writable /usr/data, current /usr/data/fluidd, tar, sha256sum, and 32 MB free."

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
  remote 'test -d /usr/data/fluidd.previous' \
    || fail "No previous build exists at /usr/data/fluidd.previous."
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
remote 'umask 022; cat > /usr/data/regolith-deploy.tgz' < "$ARCHIVE_PATH" \
  || fail "Archive upload failed. Live UI was not changed."
remote_size="$(remote 'wc -c < /usr/data/regolith-deploy.tgz' | tr -d '[:space:]')"
remote_hash="$(remote 'sha256sum /usr/data/regolith-deploy.tgz | awk "{print \$1}"' | tr -d '[:space:]')"
[ "$remote_size" = "$local_size" ] \
  || fail "Archive size mismatch (local ${local_size}, remote ${remote_size})."
[ "$remote_hash" = "$local_hash" ] \
  || fail "Archive SHA-256 mismatch. Live UI was not changed."
ok "Remote size and SHA-256 match"

step "Extract isolated staging slot"
remote '
  set -eu
  if tar -tzf /usr/data/regolith-deploy.tgz | grep -Eq "(^/|(^|/)\.\.(/|$))"; then
    echo "Unsafe archive path" >&2
    exit 1
  fi
  rm -rf /usr/data/fluidd.next
  mkdir -p /usr/data/fluidd.next
  tar -xzf /usr/data/regolith-deploy.tgz -C /usr/data/fluidd.next
  test -f /usr/data/fluidd.next/index.html
  chmod -R 755 /usr/data/fluidd.next
  echo REGOLITH_STAGE_OK
' >/dev/null || fail "Staging extract failed. Live UI was not changed."

remote_files="$(remote 'cd /usr/data/fluidd.next && find . -type f -print | sed "s|^\./||" | LC_ALL=C sort')"
[ "$remote_files" = "$local_files" ] || fail "Staged file list differs from local dist. Live UI was not changed."
ok "Staged file list matches local dist"

step "Create persistent known-good backup"
backup_result="$(remote '
  set -eu
  mkdir -p /usr/data/regolith-backups
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup="/usr/data/regolith-backups/fluidd-before-${stamp}.tgz"
  tar -czf "$backup" -C /usr/data fluidd
  size=$(wc -c < "$backup" | tr -d "[:space:]")
  hash=$(sha256sum "$backup" | awk "{print \$1}")
  count=$(tar -tzf "$backup" | wc -l | tr -d "[:space:]")
  test "$size" -gt 0
  test "$count" -gt 0
  printf "backup=%s size=%s sha256=%s files=%s\n" "$backup" "$size" "$hash" "$count"
')" || fail "Could not create and verify persistent backup. Live UI was not changed."
ok "$backup_result"

step "Atomic static-asset swap"
remote '
  set -eu
  test -d /usr/data/fluidd
  test -f /usr/data/fluidd.next/index.html
  rm -rf /usr/data/fluidd.previous
  mv /usr/data/fluidd /usr/data/fluidd.previous
  if mv /usr/data/fluidd.next /usr/data/fluidd; then
    chmod -R 755 /usr/data/fluidd
    echo REGOLITH_SWAP_OK
  else
    mv /usr/data/fluidd.previous /usr/data/fluidd
    exit 1
  fi
' >/dev/null || fail "Atomic swap failed; previous live directory was restored."
SWAP_ACTIVE=1

step "Verify live HTML and every referenced asset"
http_verify || fail "Live HTTP verification failed."
remote 'rm -f /usr/data/regolith-deploy.tgz; rm -rf /usr/data/fluidd.next' >/dev/null \
  || fail "Post-deploy cleanup failed."
SWAP_ACTIVE=0
UPLOAD_STARTED=0

printf '\nDeploy verified: http://%s/\n' "$PRINTER_HOST"
printf 'Rollback: PRINTER_HOST=%q ./deploy.sh --rollback\n' "$PRINTER_HOST"
printf 'Persistent backup: %s\n' "$backup_result"
