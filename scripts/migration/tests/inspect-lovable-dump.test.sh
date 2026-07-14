#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'
LC_ALL=C
export LC_ALL

readonly TEST_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT="$(cd -P -- "${TEST_DIR}/.." && pwd)/inspect-lovable-dump.sh"
readonly FIXTURES="${TEST_DIR}/fixtures"
readonly PYTHON="$(command -v python3)"
readonly TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/inspect-lovable-dump-test.XXXXXX")"
cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  rm -rf -- "$TMP_ROOT"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

passes=0
failures=0

pass() {
  passes=$((passes + 1))
  printf 'PASS: %s\n' "$1"
}

fail() {
  failures=$((failures + 1))
  printf 'FAIL: %s\n' "$1" >&2
}

assert_contains() {
  local file="$1"
  local expected="$2"
  local label="$3"
  if grep -Fq -- "$expected" "$file"; then
    pass "$label"
  else
    fail "$label (missing: $expected)"
  fi
}

assert_not_contains() {
  local file="$1"
  local unexpected="$2"
  local label="$3"
  if grep -Fq -- "$unexpected" "$file"; then
    fail "$label (unexpected: $unexpected)"
  else
    pass "$label"
  fi
}

assert_failure() {
  local label="$1"
  local expected="$2"
  shift 2
  local stdout_file="${TMP_ROOT}/${label// /_}.stdout"
  local stderr_file="${TMP_ROOT}/${label// /_}.stderr"

  if "$@" >"$stdout_file" 2>"$stderr_file"; then
    fail "$label (unexpected success)"
    return
  fi
  if grep -Fq -- "$expected" "$stderr_file"; then
    pass "$label"
  else
    fail "$label (missing error: $expected)"
  fi
}

readonly FAKE_PG_RESTORE="${TMP_ROOT}/fake pg_restore"
cat >"$FAKE_PG_RESTORE" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  --version)
    printf '%s\n' '--version' >>"$FAKE_LOG"
    case "${FAKE_MODE:-ok}" in
      version-fail) exit 9 ;;
      version-malformed) printf 'unexpected client build\n'; exit 0 ;;
      *) printf 'pg_restore (PostgreSQL) 17.5 (synthetic)\n'; exit 0 ;;
    esac
    ;;
  --list)
    printf '%s|%s\n' '--list' "${2:-}" >>"$FAKE_LOG"
    if [[ "${FAKE_MODE:-ok}" == 'incompatible' ]]; then
      printf 'pg_restore: error: unsupported version in file header\n' >&2
      exit 1
    fi
    [[ $# -eq 2 ]] || exit 8
    cat -- "$FAKE_TOC"
    ;;
  *)
    printf 'unexpected pg_restore invocation: %s\n' "$*" >&2
    exit 7
    ;;
esac
FAKE
chmod +x "$FAKE_PG_RESTORE"

readonly WORK_WITH_SPACES="${TMP_ROOT}/workspace with spaces"
readonly OUTPUT_DIR="${WORK_WITH_SPACES}/local-migration-artifacts"
readonly MIGRATIONS_DIR="${WORK_WITH_SPACES}/migrations with spaces"
mkdir -p "$OUTPUT_DIR" "$MIGRATIONS_DIR"
readonly DUMP_FILE="${WORK_WITH_SPACES}/synthetic lovable dump.backup"
readonly CANONICAL_DUMP_FILE="$(cd -P -- "$(dirname -- "$DUMP_FILE")" && pwd)/$(basename -- "$DUMP_FILE")"
readonly SECRET_SENTINEL='TOP_SECRET_ROW_VALUE_MUST_NOT_APPEAR'
printf 'PGDMP\001\016\000\004\010\001%s\n' "$SECRET_SENTINEL" >"$DUMP_FILE"
printf 'CREATE TABLE public.daily_digest_items (id uuid);\n' >"${MIGRATIONS_DIR}/0001 synthetic.sql"

readonly CALL_LOG="${TMP_ROOT}/pg_restore.calls"
: >"$CALL_LOG"
readonly REPORT_FILE="${OUTPUT_DIR}/inspection report.txt"

if ! env \
  PG_RESTORE_BIN="$FAKE_PG_RESTORE" \
  PYTHON_BIN="$PYTHON" \
  FAKE_TOC="${FIXTURES}/representative.toc" \
  FAKE_LOG="$CALL_LOG" \
  bash "$SCRIPT" \
    --migrations-dir "$MIGRATIONS_DIR" \
    --output "$REPORT_FILE" \
    "$DUMP_FILE" >"${TMP_ROOT}/happy.stdout" 2>"${TMP_ROOT}/happy.stderr"; then
  printf 'Happy-path invocation failed:\n' >&2
  sed -n '1,40p' "${TMP_ROOT}/happy.stdout" >&2
  sed -n '1,40p' "${TMP_ROOT}/happy.stderr" >&2
  exit 1
fi

expected_sha="$($PYTHON - "$DUMP_FILE" <<'PY'
import hashlib
import pathlib
import sys
print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)"

assert_contains "$REPORT_FILE" "sha256: ${expected_sha}" "computes the exact archive SHA-256"
assert_contains "$REPORT_FILE" "archive_format: PostgreSQL custom archive (PGDMP)" "identifies custom archive format"
assert_contains "$REPORT_FILE" "pg_restore_list_compatibility: PASS" "records pg_restore list compatibility"
assert_contains "$REPORT_FILE" "owner_metadata: PRESENT" "flags owner metadata"
assert_contains "$REPORT_FILE" "acl_metadata: PRESENT" "flags ACL metadata"
assert_contains "$REPORT_FILE" "role_references: PRESENT" "flags role references"
assert_contains "$REPORT_FILE" "extensions: PRESENT" "flags extensions"
assert_contains "$REPORT_FILE" "subscriptions: PRESENT" "flags subscriptions"
assert_contains "$REPORT_FILE" "event_triggers: PRESENT" "flags event triggers"
assert_contains "$REPORT_FILE" "publications: PRESENT" "flags publications"
assert_contains "$REPORT_FILE" "managed_schema_objects: PRESENT" "flags managed schemas"
assert_contains "$REPORT_FILE" "auth_schema_objects: PRESENT" "flags auth schema"
assert_contains "$REPORT_FILE" "storage_schema_objects: PRESENT" "flags storage schema"
assert_contains "$REPORT_FILE" "supabase_prefixed_objects: PRESENT" "flags supabase-prefixed metadata"
assert_contains "$REPORT_FILE" "TABLE public.daily_digest_items -> 0001 synthetic.sql" "flags a duplicate repo migration definition"
assert_contains "$REPORT_FILE" "row_payload_inspected: no" "states the row-data boundary"
assert_not_contains "$REPORT_FILE" "$SECRET_SENTINEL" "does not leak archive payload bytes"
assert_not_contains "$REPORT_FILE" 'TOP_SECRET_TOC_COMMENT_MUST_NOT_APPEAR' "does not leak TOC comments"

if [[ "$(wc -l <"$CALL_LOG" | tr -d ' ')" == '2' ]] &&
  grep -Fxq -- '--version' "$CALL_LOG" &&
  grep -Fxq -- "--list|${CANONICAL_DUMP_FILE}" "$CALL_LOG"; then
  pass "invokes pg_restore only for version and metadata listing"
else
  fail "invokes pg_restore only for version and metadata listing"
fi

assert_failure \
  "rejects URL input" \
  "must be a local filesystem path" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    bash "$SCRIPT" 'postgresql://example.invalid/database'

assert_failure \
  "rejects absent file" \
  "dump file does not exist" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    bash "$SCRIPT" "${TMP_ROOT}/does not exist.backup"

readonly PLAIN_FILE="${TMP_ROOT}/plain.sql"
printf 'select 1;\n' >"$PLAIN_FILE"
assert_failure \
  "rejects non-custom dump" \
  "expected a PostgreSQL custom-format archive" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    bash "$SCRIPT" "$PLAIN_FILE"

assert_failure \
  "reports missing pg_restore" \
  "pg_restore executable is missing or not executable" \
  env PG_RESTORE_BIN="${TMP_ROOT}/missing-pg_restore" PYTHON_BIN="$PYTHON" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

assert_failure \
  "reports missing python" \
  "python3 executable is missing or not executable" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="${TMP_ROOT}/missing-python" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

assert_failure \
  "reports pg_restore version failure" \
  "pg_restore --version failed" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    FAKE_MODE=version-fail FAKE_LOG="$CALL_LOG" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

assert_failure \
  "rejects malformed pg_restore version" \
  "unrecognized version string" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    FAKE_MODE=version-malformed FAKE_LOG="$CALL_LOG" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

assert_failure \
  "reports incompatible archive version" \
  "corrupt or incompatible with pg_restore 17.5" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    FAKE_MODE=incompatible FAKE_LOG="$CALL_LOG" FAKE_TOC="${FIXTURES}/representative.toc" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

assert_failure \
  "fails closed on unknown TOC class" \
  "archive metadata inspection failed closed" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    FAKE_LOG="$CALL_LOG" FAKE_TOC="${FIXTURES}/unknown-class.toc" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

assert_failure \
  "refuses report overwrite" \
  "output file already exists" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    FAKE_LOG="$CALL_LOG" FAKE_TOC="${FIXTURES}/representative.toc" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" --output "$REPORT_FILE" "$DUMP_FILE"

printf '\n%s passed; %s failed\n' "$passes" "$failures"
[[ "$failures" -eq 0 ]]
