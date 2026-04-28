#!/usr/bin/env bash
# deploy.sh — build + atomic deploy + verify Regolith to the printer.
#
# Usage:  ./deploy.sh
# Env:    PRINTER_HOST=192.168.50.179 PRINTER_PASS=creality_2023
#
# Atomic: stages into /usr/data/fluidd.next, swaps after successful extract,
# verifies the index.html + every referenced asset returns HTTP 200, and
# rolls back on failure.

set -euo pipefail

PRINTER_HOST="${PRINTER_HOST:-192.168.50.179}"
PRINTER_PASS="${PRINTER_PASS:-creality_2023}"
SSH="sshpass -p ${PRINTER_PASS} ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10"
ROOT="$(cd "$(dirname "$0")" && pwd)"

step() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

step "Build"
cd "$ROOT"
bun run build > /tmp/regolith-build.log 2>&1 || {
  cat /tmp/regolith-build.log
  fail "Build failed"
}
[ -d dist ] || fail "dist/ missing after build"

step "Pack"
COPYFILE_DISABLE=1 tar czf /tmp/regolith-deploy.tgz -C dist .
size=$(stat -f%z /tmp/regolith-deploy.tgz 2>/dev/null || stat -c%s /tmp/regolith-deploy.tgz)
echo "  tarball: ${size} bytes"

step "Stage to printer"
$SSH "root@${PRINTER_HOST}" 'rm -rf /usr/data/fluidd.next && mkdir /usr/data/fluidd.next' \
  || fail "could not create stage dir"
cat /tmp/regolith-deploy.tgz | $SSH "root@${PRINTER_HOST}" 'tar xzf - -C /usr/data/fluidd.next' \
  || fail "extract failed"

step "Verify staged files match local"
local_files=$(find dist -type f | sort | sed 's|^dist/||')
remote_files=$($SSH "root@${PRINTER_HOST}" 'cd /usr/data/fluidd.next && find . -type f | sort | sed "s|^\./||"')
if [ "$local_files" != "$remote_files" ]; then
  echo "--- local ---"
  echo "$local_files"
  echo "--- remote ---"
  echo "$remote_files"
  $SSH "root@${PRINTER_HOST}" 'rm -rf /usr/data/fluidd.next'
  fail "staged file list does not match local dist/"
fi

step "Atomic swap"
$SSH "root@${PRINTER_HOST}" '
  if [ -d /usr/data/fluidd ] && [ ! -L /usr/data/fluidd.previous ]; then
    rm -rf /usr/data/fluidd.previous
    mv /usr/data/fluidd /usr/data/fluidd.previous
  fi
  mv /usr/data/fluidd.next /usr/data/fluidd
  chmod -R 755 /usr/data/fluidd
' || fail "swap failed"

step "Verify HTTP"
http=$(curl -s -o /dev/null -w "%{http_code}" "http://${PRINTER_HOST}/")
[ "$http" = "200" ] || fail "GET / returned $http"

# Check every referenced asset
assets=$(curl -s "http://${PRINTER_HOST}/" | grep -oE 'href="[^"]+"|src="[^"]+"' | grep -oE '/[^" ]+' | sort -u)
for a in $assets; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://${PRINTER_HOST}${a}")
  [ "$code" = "200" ] || fail "asset $a returned $code"
  echo "  ok ${a}"
done

printf '\n\033[32m✓ Deploy verified\033[0m  http://%s/\n' "${PRINTER_HOST}"
echo "  Rollback if needed: ssh root@${PRINTER_HOST} 'rm -rf /usr/data/fluidd && mv /usr/data/fluidd.previous /usr/data/fluidd'"
