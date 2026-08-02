#!/usr/bin/env bash

set -Eeuo pipefail

readonly REGOLITH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DEFAULT_PRINTER_HOST="forge.local"
KEY_SCAN_FILE=""
KNOWN_KEY_FILE=""

cleanup() {
  if [ -n "$KEY_SCAN_FILE" ] && [[ "$KEY_SCAN_FILE" == /tmp/regolith-key-scan.* ]]; then
    rm -f "$KEY_SCAN_FILE"
  fi
  if [ -n "$KNOWN_KEY_FILE" ] && [[ "$KNOWN_KEY_FILE" == /tmp/regolith-known-key.* ]]; then
    rm -f "$KNOWN_KEY_FILE"
  fi
}
trap cleanup EXIT

usage() {
  cat <<'EOF'
Regolith guided setup

Double-click this file on macOS, or run:
  bash "Install Regolith.command"

Options:
  --check      Read-only printer and computer readiness check
  --install    Validate, back up, and install/update the static WebUI
  --rollback   Restore the previous verified WebUI slot
  --help       Show this help

Set PRINTER_HOST to use a trusted address other than forge.local.
The printer password is requested silently when needed and is never saved.
EOF
}

require_local_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '\nMissing required tool: %s\n' "$1" >&2
    if [ "$1" = "bun" ]; then
      printf 'Install Bun from https://bun.sh/ and run this setup again.\n' >&2
    fi
    exit 1
  fi
}

fingerprint_from_file() {
  local details
  local remainder
  details="$(ssh-keygen -lf "$1" -E sha256)" || return 1
  remainder="${details#* }"
  printf '%s' "${remainder%% *}"
}

verify_printer_identity() {
  local host="$1"
  local scanned_fingerprint
  local known_details

  KEY_SCAN_FILE="$(mktemp /tmp/regolith-key-scan.XXXXXX)"
  if ! ssh-keyscan -T 5 -t ecdsa "$host" >"$KEY_SCAN_FILE" 2>/dev/null; then
    printf 'Could not discover an ECDSA SSH identity for %s. No connection was trusted.\n' "$host" >&2
    exit 1
  fi
  scanned_fingerprint="$(fingerprint_from_file "$KEY_SCAN_FILE")" || {
    printf 'Could not read the discovered SSH identity. No connection was trusted.\n' >&2
    exit 1
  }

  printf 'Discovered printer fingerprint: %s\n' "$scanned_fingerprint"
  KNOWN_KEY_FILE="$(mktemp /tmp/regolith-known-key.XXXXXX)"
  if ssh-keygen -F "$host" >"$KNOWN_KEY_FILE" 2>/dev/null; then
    known_details="$(ssh-keygen -lf "$KNOWN_KEY_FILE" -E sha256)" || {
      printf 'The saved SSH identity could not be verified. Stop and inspect known_hosts.\n' >&2
      exit 1
    }
    case "$known_details" in
      *"$scanned_fingerprint"*)
        printf 'Identity matches the saved known host.\n'
        return
        ;;
      *)
        printf 'STOP: the discovered fingerprint does not match the saved printer identity.\n' >&2
        exit 1
        ;;
    esac
  fi

  printf 'This printer identity is not saved yet. Confirm it belongs to your printer.\n'
  [ -t 0 ] || {
    printf 'First-time trust requires an interactive terminal.\n' >&2
    exit 1
  }
  read -r -p 'Trust this printer identity? [y/N]: ' trust_choice
  case "$trust_choice" in
    y|Y|yes|YES) ;;
    *)
      printf 'Printer identity was not trusted. Nothing changed.\n'
      exit 1
      ;;
  esac
}

run_mode() {
  local mode="$1"
  local host="${PRINTER_HOST:-$DEFAULT_PRINTER_HOST}"

  printf '\nPrinter: %s\n' "$host"
  verify_printer_identity "$host"
  case "$mode" in
    check)
      printf 'Check is read-only. It will not change printer files or hardware state.\n\n'
      PRINTER_HOST="$host" "$REGOLITH_ROOT/deploy.sh" --preflight
      ;;
    install)
      printf 'Install changes static WebUI files only after idle checks, tests, and a verified backup.\n'
      printf 'It does not send G-code, move, home, heat, extrude, or restart the printer.\n\n'
      PRINTER_HOST="$host" "$REGOLITH_ROOT/deploy.sh"
      ;;
    rollback)
      printf 'Roll Back swaps to the previous verified WebUI. Printer state must be idle.\n\n'
      PRINTER_HOST="$host" "$REGOLITH_ROOT/deploy.sh" --rollback
      ;;
    *)
      printf 'Unknown setup mode: %s\n' "$mode" >&2
      exit 2
      ;;
  esac
}

case "${1:-}" in
  --help|-h)
    usage
    exit 0
    ;;
  --check)
    selected_mode="check"
    ;;
  --install)
    selected_mode="install"
    ;;
  --rollback)
    selected_mode="rollback"
    ;;
  "")
    selected_mode=""
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

require_local_tool ssh
require_local_tool ssh-keygen
require_local_tool ssh-keyscan
require_local_tool curl
require_local_tool bun

cd "$REGOLITH_ROOT"

if [ -z "$selected_mode" ]; then
  [ -t 0 ] || {
    printf 'Interactive setup needs a terminal. Use --check, --install, or --rollback.\n' >&2
    exit 2
  }

  printf '\nRegolith Setup\n'
  printf 'Safe, reversible WebUI setup for a Klipper printer.\n\n'
  printf '  1. Check only   Recommended first; changes nothing\n'
  printf '  2. Install      Back up and install/update Regolith\n'
  printf '  3. Roll Back    Restore the previous verified WebUI\n'
  printf '  q. Quit\n\n'
  read -r -p 'Choose [1]: ' choice
  case "${choice:-1}" in
    1) selected_mode="check" ;;
    2) selected_mode="install" ;;
    3) selected_mode="rollback" ;;
    q|Q) exit 0 ;;
    *)
      printf 'Choose 1, 2, 3, or q.\n' >&2
      exit 2
      ;;
  esac
fi

run_mode "$selected_mode"
