#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/regolith-deploy-tests.XXXXXX)"
MOCK_BIN="${TEST_ROOT}/bin"
mkdir -p "$MOCK_BIN"

cleanup() {
  if [[ "$TEST_ROOT" == /tmp/regolith-deploy-tests.* ]]; then
    rm -rf "$TEST_ROOT"
  fi
}
trap cleanup EXIT

pass_count=0
fail_test() {
  printf 'not ok - %s\n' "$1" >&2
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
    print_error) printf 'ready|error|Ready|false' ;;
    unknown) exit 2 ;;
    *) printf 'ready|standby|Ready|false' ;;
  esac
  exit 0
fi
printf 'BUN %s\n' "$*" >> "$MOCK_LOG"
if [ "${1:-}" = "run" ] && [ "${2:-}" = "build" ]; then
  mkdir -p "${MOCK_PROJECT}/dist/assets"
  printf '<html><body><script src="/assets/app.js"></script></body></html>\n' \
    > "${MOCK_PROJECT}/dist/index.html"
  printf 'console.log("regolith")\n' > "${MOCK_PROJECT}/dist/assets/app.js"
fi
MOCK_BUN

cat > "${MOCK_BIN}/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -euo pipefail
output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      output="$2"
      shift 2
      ;;
    http://*)
      url="$1"
      shift
      ;;
    *) shift ;;
  esac
done
printf 'CURL %s\n' "$url" >> "$MOCK_LOG"
if [[ "$url" == *'/printer/objects/query?'* ]]; then
  case "${MOCK_SCENARIO:-idle}" in
    unknown) printf '{"result":{"status":{}}}' ;;
    busy) printf '{"result":{"status":{"webhooks":{"state":"ready"},"print_stats":{"state":"printing"},"idle_timeout":{"state":"Printing"},"virtual_sdcard":{"is_active":true}}}}' ;;
    print_error) printf '{"result":{"status":{"webhooks":{"state":"ready"},"print_stats":{"state":"error"},"idle_timeout":{"state":"Ready"},"virtual_sdcard":{"is_active":false}}}}' ;;
    *) printf '{"result":{"status":{"webhooks":{"state":"ready"},"print_stats":{"state":"standby"},"idle_timeout":{"state":"Ready"},"virtual_sdcard":{"is_active":false}}}}' ;;
  esac
  exit 0
fi

if [ "${MOCK_SCENARIO:-idle}" = "http_fail" ] && [ ! -f "$MOCK_HTTP_FAILED" ]; then
  : > "$MOCK_HTTP_FAILED"
  exit 22
fi

if [ -n "$output" ] && [ "$output" != "/dev/null" ]; then
  printf '<html><body><script src="/assets/app.js"></script></body></html>\n' > "$output"
fi
MOCK_CURL

cat > "${MOCK_BIN}/ssh" <<'MOCK_SSH'
#!/usr/bin/env bash
set -euo pipefail
command_text="${!#}"
printf 'SSH %s\n' "$command_text" >> "$MOCK_LOG"
bash -n <<< "$command_text" || exit 93

if [ "$command_text" = "true" ]; then
  if [ "${MOCK_SCENARIO:-idle}" = "password" ] && [ "${MOCK_PASSWORD_AUTH:-0}" != "1" ]; then
    exit 255
  fi
  exit 0
fi
if [[ "$command_text" == *'REGOLITH_PREFLIGHT_OK'* ]]; then
  printf 'REGOLITH_PREFLIGHT_OK available_kb=1048576\n'
  exit 0
fi
if [[ "$command_text" == *'cat > /usr/data/regolith-deploy.tgz'* ]]; then
  printf 'WRITE_UPLOAD\n' >> "$MOCK_LOG"
  cat > "${MOCK_REMOTE}/regolith-deploy.tgz"
  exit 0
fi
if [[ "$command_text" == *'wc -c < /usr/data/regolith-deploy.tgz'* ]]; then
  wc -c < "${MOCK_REMOTE}/regolith-deploy.tgz"
  exit 0
fi
if [[ "$command_text" == *'sha256sum /usr/data/regolith-deploy.tgz'* ]]; then
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${MOCK_REMOTE}/regolith-deploy.tgz" | awk '{print $1}'
  else
    sha256sum "${MOCK_REMOTE}/regolith-deploy.tgz" | awk '{print $1}'
  fi
  exit 0
fi
if [[ "$command_text" == *'REGOLITH_STAGE_OK'* ]]; then
  printf 'WRITE_STAGE\n' >> "$MOCK_LOG"
  rm -rf "${MOCK_REMOTE}/next"
  mkdir -p "${MOCK_REMOTE}/next"
  cp -R "${MOCK_PROJECT}/dist/." "${MOCK_REMOTE}/next/"
  exit 0
fi
if [[ "$command_text" == *'cd /usr/data/fluidd.next'* ]]; then
  cd "${MOCK_REMOTE}/next"
  find . -type f -print | sed 's|^\./||' | LC_ALL=C sort
  exit 0
fi
if [[ "$command_text" == *'fluidd-before-'* ]]; then
  printf 'WRITE_BACKUP\n' >> "$MOCK_LOG"
  if [[ "$command_text" == *'retention_keep=5'* ]]; then
    printf 'WRITE_RETENTION\n' >> "$MOCK_LOG"
  fi
  if [ "${MOCK_SCENARIO:-idle}" = "backup_invalid" ]; then
    exit 1
  fi
  printf 'backup=/usr/data/regolith-backups/fluidd-before-mock.tgz size=1024 sha256=mock files=2 retained=5 pruned=0\n'
  exit 0
fi
if [[ "$command_text" == *'REGOLITH_SWAP_OK'* ]]; then
  printf 'WRITE_SWAP\n' >> "$MOCK_LOG"
  exit 0
fi
if [[ "$command_text" == *'REGOLITH_ROLLBACK_OK'* ]]; then
  printf 'WRITE_ROLLBACK\n' >> "$MOCK_LOG"
  exit 0
fi
if [[ "$command_text" == *'test -d /usr/data/fluidd.previous'* ]]; then
  exit 0
fi
if [[ "$command_text" == *'rm -f /usr/data/regolith-deploy.tgz'* ]] || \
   [[ "$command_text" == *'rm -rf /usr/data/fluidd.next'* ]]; then
  printf 'WRITE_CLEANUP\n' >> "$MOCK_LOG"
  exit 0
fi

printf 'Unhandled mock SSH command: %s\n' "$command_text" >&2
exit 90
MOCK_SSH

cat > "${MOCK_BIN}/sshpass" <<'MOCK_SSHPASS'
#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" = "-e" ] || exit 91
printf 'SSHPASS -e\n' >> "$MOCK_LOG"
shift
[ "${1:-}" = "ssh" ] || exit 92
MOCK_PASSWORD_AUTH=1 exec "$@"
MOCK_SSHPASS

chmod +x "${MOCK_BIN}/bun" "${MOCK_BIN}/curl" "${MOCK_BIN}/ssh" "${MOCK_BIN}/sshpass"

prepare_case() {
  local name="$1"
  CASE_DIR="${TEST_ROOT}/${name}"
  PROJECT_DIR="${CASE_DIR}/project"
  REMOTE_DIR="${CASE_DIR}/remote"
  LOG_FILE="${CASE_DIR}/mock.log"
  OUTPUT_FILE="${CASE_DIR}/output.log"
  HTTP_FAILED_FILE="${CASE_DIR}/http-failed"
  mkdir -p "$PROJECT_DIR" "$REMOTE_DIR"
  cp "${ROOT}/deploy.sh" "${PROJECT_DIR}/deploy.sh"
  chmod +x "${PROJECT_DIR}/deploy.sh"
  : > "$LOG_FILE"
}

invoke() {
  local scenario="$1"
  shift
  (
    cd "$PROJECT_DIR"
    PATH="${MOCK_BIN}:$PATH" \
      MOCK_SCENARIO="$scenario" \
      MOCK_LOG="$LOG_FILE" \
      MOCK_PROJECT="$PROJECT_DIR" \
      MOCK_REMOTE="$REMOTE_DIR" \
      MOCK_HTTP_FAILED="$HTTP_FAILED_FILE" \
      PRINTER_PASSWORD="${TEST_PASSWORD:-}" \
      PRINTER_HOST="${TEST_HOST:-forge.local}" \
      bash ./deploy.sh "$@"
  ) > "$OUTPUT_FILE" 2>&1
}

prepare_case bad-host
TEST_HOST='forge.local;touch-bad'
if invoke idle --preflight; then
  fail_test "unsafe host rejected"
fi
grep -q 'Invalid PRINTER_HOST' "$OUTPUT_FILE" || fail_test "unsafe host error is clear"
[ ! -s "$LOG_FILE" ] || fail_test "unsafe host reached command mocks"
pass_test "unsafe host rejected before network"
unset TEST_HOST

prepare_case password
TEST_PASSWORD='runtime-only-secret'
invoke password --preflight || fail_test "password environment fallback succeeds"
grep -q '^SSHPASS -e$' "$LOG_FILE" || fail_test "password fallback did not use sshpass -e"
if grep -q 'runtime-only-secret' "$LOG_FILE"; then
  fail_test "password appeared in command log"
fi
pass_test "password fallback uses environment without argv exposure"
unset TEST_PASSWORD

prepare_case busy
if invoke busy --preflight; then
  fail_test "busy printer refused"
fi
grep -q 'Print state is printing' "$OUTPUT_FILE" || fail_test "busy state error is clear"
if grep -q '^WRITE_' "$LOG_FILE"; then
  fail_test "busy refusal performed remote write"
fi
pass_test "busy printer refused without writes"

prepare_case print-error
if invoke print_error --preflight; then
  fail_test "failed print state must refuse deployment"
fi
grep -q 'Print state is error' "$OUTPUT_FILE" || fail_test "failed print error is clear"
if grep -q '^WRITE_' "$LOG_FILE"; then
  fail_test "failed print refusal performed remote write"
fi
pass_test "failed print state refused without writes"

prepare_case unknown
if invoke unknown --preflight; then
  fail_test "unknown printer state refused"
fi
grep -q 'incomplete state' "$OUTPUT_FILE" || fail_test "unknown state error is clear"
if grep -q '^WRITE_' "$LOG_FILE"; then
  fail_test "unknown-state refusal performed remote write"
fi
pass_test "unknown printer state refused without writes"

prepare_case preflight
invoke idle --preflight || fail_test "read-only preflight succeeds"
grep -q 'Preflight passed. No remote files changed.' "$OUTPUT_FILE" \
  || fail_test "preflight reports no changes"
if grep -q '^WRITE_' "$LOG_FILE"; then
  fail_test "preflight performed remote write"
fi
pass_test "preflight is read-only"

prepare_case success
invoke idle || fail_test "successful deployment path"
grep -q '^WRITE_SWAP$' "$LOG_FILE" || fail_test "success path performed atomic swap"
grep -q '^WRITE_BACKUP$' "$LOG_FILE" || fail_test "success path created backup"
grep -q '^WRITE_RETENTION$' "$LOG_FILE" || fail_test "success path enforced retention"
if grep -q '^WRITE_ROLLBACK$' "$LOG_FILE"; then
  fail_test "success path rolled back"
fi
grep -q 'Deploy verified:' "$OUTPUT_FILE" || fail_test "success path verified HTTP"
pass_test "verified deployment succeeds"

prepare_case invalid-backup
if invoke backup_invalid; then
  fail_test "invalid backup set must block deployment"
fi
grep -q '^WRITE_BACKUP$' "$LOG_FILE" || fail_test "invalid-backup path attempted a new backup"
if grep -q '^WRITE_SWAP$' "$LOG_FILE"; then
  fail_test "invalid backup set reached live swap"
fi
grep -q 'Could not create and verify persistent backup' "$OUTPUT_FILE" \
  || fail_test "invalid backup error is clear"
pass_test "invalid backup set blocks swap before retention"

prepare_case http-failure
if invoke http_fail; then
  fail_test "failed HTTP must fail deployment"
fi
grep -q '^WRITE_SWAP$' "$LOG_FILE" || fail_test "HTTP failure occurred after swap"
grep -q '^WRITE_ROLLBACK$' "$LOG_FILE" || fail_test "HTTP failure triggered rollback"
grep -q 'Previous UI restored and HTTP recovery verified' "$OUTPUT_FILE" \
  || fail_test "rollback recovery was not verified"
pass_test "failed live HTTP auto-rolls back and verifies recovery"

prepare_case manual-rollback
invoke idle --rollback || fail_test "manual rollback succeeds"
grep -q '^WRITE_ROLLBACK$' "$LOG_FILE" || fail_test "manual rollback swapped slots"
grep -q 'Rollback verified:' "$OUTPUT_FILE" || fail_test "manual rollback verified HTTP"
pass_test "manual rollback is guarded and verified"

legacy_pass_assignment='PRINTER_'"PASS="
insecure_host_key='StrictHostKeyChecking='"no"
insecure_pass_arg='sshpass[[:space:]]+-'"p"
if grep -Eq "${legacy_pass_assignment}|${insecure_host_key}|${insecure_pass_arg}" "${ROOT}/deploy.sh" || \
   grep -Fq 'PRINTER_PASSWORD="${PRINTER_PASSWORD:-' "${ROOT}/deploy.sh"; then
  fail_test "deployment script contains insecure credential or SSH pattern"
fi
grep -q 'StrictHostKeyChecking=accept-new' "${ROOT}/deploy.sh" \
  || fail_test "accept-new host key policy missing"
grep -q 'sshpass -e' "${ROOT}/deploy.sh" \
  || fail_test "environment-only sshpass mode missing"
pass_test "no embedded secret or insecure SSH flags"

printf '1..%d\n' "$pass_count"
