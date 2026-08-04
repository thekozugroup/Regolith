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
# The mock matches exact remote paths. They are parameterised only so a case can
# assert that a retargeted printer layout reaches the remote shell intact; an
# unmatched command still fails loudly as an unhandled mock invocation.
data_root="${MOCK_DATA_ROOT:-/usr/data}"
webui_dir="${MOCK_WEBUI_DIR:-fluidd}"
live_dir="${data_root}/${webui_dir}"
upload_path="${data_root}/regolith-deploy.tgz"
command_text="${!#}"
printf 'SSH_TARGET %s\n' "${@: -2:1}" >> "$MOCK_LOG"
printf 'SSH %s\n' "$command_text" >> "$MOCK_LOG"
bash -n <<< "$command_text" || exit 93

if [ "$command_text" = "true" ]; then
  if [ "${MOCK_SCENARIO:-idle}" = "password" ] && [ "${MOCK_PASSWORD_AUTH:-0}" != "1" ]; then
    exit 255
  fi
  exit 0
fi
if [[ "$command_text" == *'REGOLITH_PREFLIGHT_OK'* ]]; then
  printf 'PREFLIGHT_ATTEMPT\n' >> "$MOCK_LOG"
  if [ "${MOCK_SCENARIO:-idle}" = "flaky_auth" ] && [ ! -f "$MOCK_TRANSPORT_FAILED" ]; then
    : > "$MOCK_TRANSPORT_FAILED"
    printf 'SSH_REFUSED\n' >> "$MOCK_LOG"
    exit 255
  fi
  if [ "${MOCK_SCENARIO:-idle}" = "preflight_fail" ]; then
    exit 1
  fi
  printf 'REGOLITH_PREFLIGHT_OK available_kb=1048576\n'
  exit 0
fi
if [[ "$command_text" == *"cat > ${upload_path}"* ]]; then
  printf 'WRITE_UPLOAD\n' >> "$MOCK_LOG"
  cat > "${MOCK_REMOTE}/regolith-deploy.tgz"
  exit 0
fi
if [[ "$command_text" == *"wc -c < ${upload_path}"* ]]; then
  wc -c < "${MOCK_REMOTE}/regolith-deploy.tgz"
  exit 0
fi
if [[ "$command_text" == *"sha256sum ${upload_path}"* ]]; then
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
if [[ "$command_text" == *"cd ${live_dir}.next"* ]]; then
  cd "${MOCK_REMOTE}/next"
  find . -type f -print | sed 's|^\./||' | LC_ALL=C sort
  exit 0
fi
if [[ "$command_text" == *"${webui_dir}-before-"* ]]; then
  printf 'WRITE_BACKUP\n' >> "$MOCK_LOG"
  if [[ "$command_text" == *'retention_keep=5'* ]]; then
    printf 'WRITE_RETENTION\n' >> "$MOCK_LOG"
  fi
  if [ "${MOCK_SCENARIO:-idle}" = "backup_refused" ]; then
    printf 'SSH_REFUSED\n' >> "$MOCK_LOG"
    exit 255
  fi
  if [ "${MOCK_SCENARIO:-idle}" = "backup_invalid" ]; then
    exit 1
  fi
  printf 'backup=%s/regolith-backups/%s-before-mock.tgz size=1024 sha256=mock files=2 retained=5 pruned=0\n' \
    "$data_root" "$webui_dir"
  exit 0
fi
if [[ "$command_text" == *'REGOLITH_SWAP_OK'* ]]; then
  printf 'WRITE_SWAP\n' >> "$MOCK_LOG"
  if [ "${MOCK_SCENARIO:-idle}" = "swap_refused" ]; then
    printf 'SSH_REFUSED\n' >> "$MOCK_LOG"
    exit 255
  fi
  exit 0
fi
if [[ "$command_text" == *'REGOLITH_ROLLBACK_OK'* ]]; then
  printf 'WRITE_ROLLBACK\n' >> "$MOCK_LOG"
  if [ "${MOCK_SCENARIO:-idle}" = "rollback_refused" ]; then
    printf 'SSH_REFUSED\n' >> "$MOCK_LOG"
    exit 255
  fi
  exit 0
fi
if [[ "$command_text" == *"test -d ${live_dir}.previous"* ]]; then
  exit 0
fi
if [[ "$command_text" == *"rm -f ${upload_path}"* ]] || \
   [[ "$command_text" == *"rm -rf ${live_dir}.next"* ]]; then
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
  TRANSPORT_FAILED_FILE="${CASE_DIR}/transport-failed"
  mkdir -p "$PROJECT_DIR" "$REMOTE_DIR"
  cp "${ROOT}/deploy.sh" "${PROJECT_DIR}/deploy.sh"
  chmod +x "${PROJECT_DIR}/deploy.sh"
  : > "$LOG_FILE"
}

invoke() {
  local scenario="$1"
  shift
  # Layout variables are passed only when a case sets them, so the unset case
  # exercises the script's own built-in defaults rather than the test's copy.
  local -a layout_env=()
  if [ -n "${TEST_PRINTER_USER:-}" ]; then
    layout_env+=("PRINTER_USER=${TEST_PRINTER_USER}")
  fi
  if [ -n "${TEST_FLUIDD_ROOT:-}" ]; then
    layout_env+=("FLUIDD_ROOT=${TEST_FLUIDD_ROOT}")
  fi
  if [ -n "${TEST_WEBUI_DIR:-}" ]; then
    layout_env+=("WEBUI_DIR=${TEST_WEBUI_DIR}")
  fi
  (
    cd "$PROJECT_DIR"
    env PATH="${MOCK_BIN}:$PATH" \
      MOCK_SCENARIO="$scenario" \
      MOCK_LOG="$LOG_FILE" \
      MOCK_PROJECT="$PROJECT_DIR" \
      MOCK_REMOTE="$REMOTE_DIR" \
      MOCK_HTTP_FAILED="$HTTP_FAILED_FILE" \
      MOCK_TRANSPORT_FAILED="$TRANSPORT_FAILED_FILE" \
      MOCK_DATA_ROOT="${TEST_FLUIDD_ROOT:-/usr/data}" \
      MOCK_WEBUI_DIR="${TEST_WEBUI_DIR:-fluidd}" \
      PRINTER_PASSWORD="${TEST_PASSWORD:-}" \
      PRINTER_HOST="${TEST_HOST:-forge.local}" \
      ${layout_env[@]+"${layout_env[@]}"} \
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

prepare_case default-layout
invoke idle --preflight || fail_test "default layout preflight succeeds"
grep -q '^SSH_TARGET root@forge.local$' "$LOG_FILE" \
  || fail_test "default SSH target is root@forge.local"
grep -Eq '^[[:space:]]*test -w /usr/data$' "$LOG_FILE" \
  || fail_test "default data root is /usr/data"
grep -Eq '^[[:space:]]*test -d /usr/data/fluidd$' "$LOG_FILE" \
  || fail_test "default live directory is /usr/data/fluidd"
if grep -q '^SSHPASS -e$' "$LOG_FILE"; then
  fail_test "working key auth still fell back to a password"
fi
pass_test "unset environment keeps the K1 Max defaults and key-first auth"

# The mock only answers the layout it is given, so a deploy that still carried a
# hardcoded /usr/data path anywhere would reach an unhandled mock command.
prepare_case custom-layout
TEST_PRINTER_USER='maker'
TEST_FLUIDD_ROOT='/opt/printer-data'
TEST_WEBUI_DIR='webui'
invoke idle || fail_test "custom printer layout deploys end to end"
grep -q '^SSH_TARGET maker@forge.local$' "$LOG_FILE" \
  || fail_test "PRINTER_USER override reached the SSH target"
grep -Eq '^[[:space:]]*test -w /opt/printer-data$' "$LOG_FILE" \
  || fail_test "FLUIDD_ROOT override composed the remote data root"
grep -Eq '^[[:space:]]*test -d /opt/printer-data/webui$' "$LOG_FILE" \
  || fail_test "WEBUI_DIR override composed the remote live directory"
grep -Fq 'cat > /opt/printer-data/regolith-deploy.tgz' "$LOG_FILE" \
  || fail_test "FLUIDD_ROOT override composed the upload path"
grep -Fq '/opt/printer-data/webui.next' "$LOG_FILE" \
  || fail_test "WEBUI_DIR override composed the staging slot"
grep -Fq '/opt/printer-data/regolith-backups/webui-before-' "$LOG_FILE" \
  || fail_test "FLUIDD_ROOT override composed the backup path"
grep -q '^WRITE_SWAP$' "$LOG_FILE" || fail_test "custom layout reached the atomic swap"
if grep -q '/usr/data' "$LOG_FILE"; then
  fail_test "custom layout still sent a hardcoded K1 Max path"
fi
pass_test "PRINTER_USER, FLUIDD_ROOT, and WEBUI_DIR retarget every remote path"
unset TEST_PRINTER_USER TEST_FLUIDD_ROOT TEST_WEBUI_DIR

prepare_case unsafe-root
TEST_FLUIDD_ROOT='/usr/data;touch-bad'
if invoke idle --preflight; then
  fail_test "unsafe FLUIDD_ROOT rejected"
fi
grep -q 'Invalid FLUIDD_ROOT' "$OUTPUT_FILE" || fail_test "unsafe FLUIDD_ROOT error is clear"
[ ! -s "$LOG_FILE" ] || fail_test "unsafe FLUIDD_ROOT reached command mocks"
unset TEST_FLUIDD_ROOT

prepare_case unsafe-webui-dir
TEST_WEBUI_DIR='../etc'
if invoke idle --preflight; then
  fail_test "unsafe WEBUI_DIR rejected"
fi
grep -q 'Invalid WEBUI_DIR' "$OUTPUT_FILE" || fail_test "unsafe WEBUI_DIR error is clear"
[ ! -s "$LOG_FILE" ] || fail_test "unsafe WEBUI_DIR reached command mocks"
unset TEST_WEBUI_DIR

prepare_case unsafe-user
TEST_PRINTER_USER='root maker'
if invoke idle --preflight; then
  fail_test "unsafe PRINTER_USER rejected"
fi
grep -q 'Invalid PRINTER_USER' "$OUTPUT_FILE" || fail_test "unsafe PRINTER_USER error is clear"
[ ! -s "$LOG_FILE" ] || fail_test "unsafe PRINTER_USER reached command mocks"
unset TEST_PRINTER_USER
pass_test "layout overrides are validated before any remote command"

prepare_case flaky-auth
invoke flaky_auth --preflight || fail_test "transient SSH refusal must recover"
grep -q '^SSH_REFUSED$' "$LOG_FILE" || fail_test "flaky transport scenario refused once"
grep -q 'SSH session refused' "$OUTPUT_FILE" || fail_test "retry of a refused session is reported"
grep -q 'Preflight passed. No remote files changed.' "$OUTPUT_FILE" \
  || fail_test "retry completed the read-only preflight"
preflight_attempts="$(grep -c '^PREFLIGHT_ATTEMPT$' "$LOG_FILE" | tr -d '[:space:]')"
[ "$preflight_attempts" = "2" ] \
  || fail_test "refused preflight should be retried exactly once here (attempts: ${preflight_attempts})"
pass_test "transient SSH transport refusal is retried and recovers"

prepare_case preflight-failure
if invoke preflight_fail --preflight; then
  fail_test "a failing remote preflight must fail the run"
fi
preflight_attempts="$(grep -c '^PREFLIGHT_ATTEMPT$' "$LOG_FILE" | tr -d '[:space:]')"
[ "$preflight_attempts" = "1" ] \
  || fail_test "a real remote failure must not be retried (attempts: ${preflight_attempts})"
grep -q 'Remote preflight failed' "$OUTPUT_FILE" || fail_test "remote preflight error is clear"
pass_test "a genuine remote failure fails closed on the first attempt"

prepare_case backup-refused
if invoke backup_refused; then
  fail_test "refused session on the backup step must fail the deployment"
fi
backup_attempts="$(grep -c '^WRITE_BACKUP$' "$LOG_FILE" | tr -d '[:space:]')"
[ "$backup_attempts" = "1" ] \
  || fail_test "mutating backup step must not be retried (attempts: ${backup_attempts})"
if grep -q '^WRITE_SWAP$' "$LOG_FILE"; then
  fail_test "refused backup reached the live swap"
fi
prepare_case swap-refused
if invoke swap_refused; then
  fail_test "refused session on the atomic swap must fail the deployment"
fi
swap_attempts="$(grep -c '^WRITE_SWAP$' "$LOG_FILE" | tr -d '[:space:]')"
[ "$swap_attempts" = "1" ] \
  || fail_test "atomic swap must not be retried (attempts: ${swap_attempts})"

prepare_case rollback-refused
if invoke rollback_refused --rollback; then
  fail_test "refused session on the rollback swap must fail"
fi
rollback_attempts="$(grep -c '^WRITE_ROLLBACK$' "$LOG_FILE" | tr -d '[:space:]')"
[ "$rollback_attempts" = "1" ] \
  || fail_test "rollback swap must not be retried (attempts: ${rollback_attempts})"
pass_test "refused session on a mutating step fails closed instead of retrying"

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
backup_attempts="$(grep -c '^WRITE_BACKUP$' "$LOG_FILE" | tr -d '[:space:]')"
[ "$backup_attempts" = "1" ] \
  || fail_test "mutating backup step must fail closed, not retry (attempts: ${backup_attempts})"
pass_test "invalid backup set blocks swap before retention without retrying"

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
if grep -Eq '^[[:space:]]*(export[[:space:]]+)?(PRINTER_PASSWORD|SSHPASS)=[^"$]' "${ROOT}/deploy.sh"; then
  fail_test "deployment script assigns a literal credential"
fi
pass_test "no embedded secret or insecure SSH flags"

grep -Fq 'PRINTER_USER="${PRINTER_USER:-root}"' "${ROOT}/deploy.sh" \
  || fail_test "PRINTER_USER default drifted from root"
grep -Fq 'FLUIDD_ROOT="${FLUIDD_ROOT:-/usr/data}"' "${ROOT}/deploy.sh" \
  || fail_test "FLUIDD_ROOT default drifted from /usr/data"
grep -Fq 'WEBUI_DIR="${WEBUI_DIR:-fluidd}"' "${ROOT}/deploy.sh" \
  || fail_test "WEBUI_DIR default drifted from fluidd"
env_line="$(grep -n 'FLUIDD_ROOT="${FLUIDD_ROOT:-' "${ROOT}/deploy.sh" | head -1 | cut -d: -f1)"
readonly_line="$(grep -n '^readonly PRINTER_USER FLUIDD_ROOT WEBUI_DIR$' "${ROOT}/deploy.sh" | head -1 | cut -d: -f1)"
[ -n "$env_line" ] && [ -n "$readonly_line" ] && [ "$env_line" -lt "$readonly_line" ] \
  || fail_test "layout environment must be resolved before it is made readonly"
pass_test "printer layout defaults are unchanged and env-resolved before readonly"

key_line="$(grep -n 'BatchMode=yes' "${ROOT}/deploy.sh" | head -1 | cut -d: -f1)"
password_line="$(grep -n 'sshpass -e ssh' "${ROOT}/deploy.sh" | head -1 | cut -d: -f1)"
[ -n "$key_line" ] && [ -n "$password_line" ] && [ "$key_line" -lt "$password_line" ] \
  || fail_test "key authentication must be attempted before the password fallback"
grep -q 'ssh-copy-id' "${ROOT}/deploy.sh" \
  || fail_test "key setup instructions missing from the auth path"
pass_test "key authentication is first and documented, password stays the fallback"

printf '1..%d\n' "$pass_count"
