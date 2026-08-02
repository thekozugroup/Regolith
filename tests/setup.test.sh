#!/usr/bin/env bash

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SETUP="$ROOT/Install Regolith.command"

output="$(bash "$SETUP" --help)"
printf '%s' "$output" | grep -q 'Read-only printer and computer readiness check'
printf '%s' "$output" | grep -q -- '--install'
printf '%s' "$output" | grep -q 'never saved'

if bash "$SETUP" --unknown >/dev/null 2>&1; then
  printf 'setup accepted an unknown option\n' >&2
  exit 1
fi

grep -q 'deploy.sh" --preflight' "$SETUP"
grep -q 'deploy.sh" --rollback' "$SETUP"
grep -q 'deploy.sh"$' "$SETUP"
grep -q 'ssh-keyscan -T 5 -t ecdsa' "$SETUP"
grep -q 'does not match the saved printer identity' "$SETUP"

if grep -Eqi '$PRINTER_PASSWORD|StrictHostKeyChecking=no|UserKnownHostsFile=/dev/null' "$SETUP"; then
  printf 'setup contains a secret or insecure SSH bypass\n' >&2
  exit 1
fi

printf 'guided setup checks passed\n'
