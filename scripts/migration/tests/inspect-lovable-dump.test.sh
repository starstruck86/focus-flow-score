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
export TMPDIR="$TMP_ROOT"
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
    fail "$label (unexpected content present)"
  else
    pass "$label"
  fi
}

assert_helper_failure() {
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

diagnostic_json() {
  printf '{"diagnostic_version":1,"stage":"%s","reason":"%s"}' "$1" "$2"
}

assert_stage_failure() {
  local label="$1"
  local expected_stage="$2"
  local expected_reason="$3"
  shift 3
  local stdout_file="${TMP_ROOT}/${label// /_}.stdout"
  local stderr_file="${TMP_ROOT}/${label// /_}.stderr"
  local expected
  expected="$(diagnostic_json "$expected_stage" "$expected_reason")"

  if "$@" >"$stdout_file" 2>"$stderr_file"; then
    fail "$label (unexpected success)"
    return
  fi
  if [[ -s "$stdout_file" ]]; then
    fail "$label (failure wrote stdout)"
    return
  fi
  if [[ "$(<"$stderr_file")" != "$expected" ]] ||
    [[ "$(wc -l <"$stderr_file" | tr -d ' ')" != '1' ]]; then
    fail "$label (unexpected diagnostic bytes)"
    return
  fi
  if grep -Fq -- "$SECRET_SENTINEL" "$stderr_file" ||
    grep -Fq -- 'TOP_SECRET_TOC_COMMENT_MUST_NOT_APPEAR' "$stderr_file" ||
    grep -Fq -- "$HELPER_SECRET_SENTINEL" "$stderr_file" ||
    grep -Fq -- "$HELPER_ROW_SENTINEL" "$stderr_file" ||
    grep -Fq -- "$HELPER_PATH_SENTINEL" "$stderr_file" ||
    grep -Fq -- "$HELPER_OBJECT_SENTINEL" "$stderr_file" ||
    grep -Fq -- "$HELPER_TOC_SENTINEL" "$stderr_file" ||
    grep -Fq -- "$HELPER_SQL_SENTINEL" "$stderr_file" ||
    grep -Fq -- "$DUMP_FILE" "$stderr_file"; then
    fail "$label (unsafe content leaked into diagnostic)"
    return
  fi
  if [[ "$expected_stage" != 'cleanup_failed' ]] &&
    find "$TMP_ROOT" -maxdepth 1 -type d -name 'lovable-dump-inspection.*' \
      -print -quit | grep -q .; then
    fail "$label (private inspection workspace was retained)"
    return
  fi
  pass "$label"
}

verify_external_report_sha_match() {
  "$PYTHON" - "$1" "$2" "$3" <<'PY'
import pathlib
import re
import sys

digest_pattern = re.compile(r"[0-9a-f]{64}")
before_path, after_path, report_path = map(pathlib.Path, sys.argv[1:])

def read_external(path: pathlib.Path) -> str:
    value = path.read_text(encoding="ascii").strip()
    if not digest_pattern.fullmatch(value):
        raise SystemExit(f"invalid digest-only checksum file: {path}")
    return value

reported = re.findall(
    r"^sha256: ([0-9a-f]{64})$",
    report_path.read_text(encoding="utf-8"),
    re.MULTILINE,
)
if len(reported) != 1:
    raise SystemExit("inspector report must contain exactly one archive sha256 field")
if len({read_external(before_path), read_external(after_path), reported[0]}) != 1:
    raise SystemExit("external and reported archive SHA-256 evidence mismatch")
PY
}

readonly FAKE_PG_RESTORE="${TMP_ROOT}/fake pg_restore"
cat >"$FAKE_PG_RESTORE" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

if [[ "${FAKE_REQUIRE_HEADER:-0}" == '1' ]]; then
  header_files=("${FAKE_TMP_PARENT}"/lovable-dump-inspection.*/header.metadata)
  [[ "${#header_files[@]}" -eq 1 && -s "${header_files[0]}" ]] || {
    printf '%s\n' 'PG_RESTORE_CALLED_BEFORE_SAFE_HEADER_CAPTURE' >&2
    exit 97
  }
fi

case "${1:-}" in
  --version)
    printf '%s\n' '--version' >>"$FAKE_LOG"
    case "${FAKE_MODE:-ok}" in
      version-fail)
        printf '%s\n' 'TOP_SECRET_VERSION_FAILURE_MUST_NOT_APPEAR' >&2
        exit 9
        ;;
      version-malformed)
        printf 'TOP_SECRET_MALFORMED_VERSION_MUST_NOT_APPEAR\n'
        exit 0
        ;;
      version-bounded-timeout)
        printf '%s\n' '{"diagnostic_version":1,"reason":"timeout"}' >&2
        exit 1
        ;;
      *) printf 'pg_restore (PostgreSQL) 17.5 (synthetic)\n'; exit 0 ;;
    esac
    ;;
  --list)
    printf '%s|%s\n' '--list' "${2:-}" >>"$FAKE_LOG"
    [[ $# -eq 2 ]] || exit 8
    case "${FAKE_MODE:-ok}" in
      unsupported-version)
        printf 'pg_restore: error: unsupported version (1.99) in file header\n' >&2
        exit 1
        ;;
      invalid-archive)
        printf 'pg_restore: error: input file does not appear to be a valid archive\n' >&2
        exit 1
        ;;
      invalid-archive-too-short)
        printf 'pg_restore: error: input file does not appear to be a valid archive (too short?)\n' >&2
        exit 1
        ;;
      truncated-archive)
        printf 'pg_restore: error: input file is too short (read 5, expected 11)\n' >&2
        exit 1
        ;;
      bounded-timeout)
        printf '%s\n' '{"diagnostic_version":1,"reason":"timeout"}' >&2
        exit 1
        ;;
      bounded-output-cap)
        printf '%s\n' '{"diagnostic_version":1,"reason":"output_cap"}' >&2
        exit 1
        ;;
      bounded-invalid-json)
        printf '%s\n' '{"diagnostic_version":1,"reason":"not_applicable"}' >&2
        exit 1
        ;;
      other-nonzero)
        printf '%s\n' 'TOP_SECRET_PG_RESTORE_FAILURE_MUST_NOT_APPEAR' >&2
        exit 1
        ;;
      mixed-nonzero)
        printf 'pg_restore: error: unsupported version (1.99) in file header\n%s\n' \
          'TOP_SECRET_PG_RESTORE_FAILURE_MUST_NOT_APPEAR' >&2
        exit 1
        ;;
      empty-toc) exit 0 ;;
      mutate-snapshot)
        chmod u+w "$2"
        printf 'mutated-during-list\n' >>"$2"
        chmod 0400 "$2"
        ;;
    esac
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
readonly HELPER_SECRET_SENTINEL='HELPER_SECRET_VALUE_MUST_NOT_APPEAR'
readonly HELPER_ROW_SENTINEL='HELPER_ROW_PAYLOAD_MUST_NOT_APPEAR'
readonly HELPER_PATH_SENTINEL='/private/synthetic/helper/path/MUST_NOT_APPEAR'
readonly HELPER_OBJECT_SENTINEL='private_customer_object_MUST_NOT_APPEAR'
readonly HELPER_TOC_SENTINEL='999; 0 0 TABLE private forbidden_MUST_NOT_APPEAR owner'
readonly HELPER_SQL_SENTINEL='SELECT private_secret_MUST_NOT_APPEAR FROM auth.users'
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
  FAKE_REQUIRE_HEADER=1 \
  FAKE_TMP_PARENT="$TMP_ROOT" \
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

readonly BEFORE_SHA_FILE="${OUTPUT_DIR}/archive.sha256.before"
readonly AFTER_SHA_FILE="${OUTPUT_DIR}/archive.sha256.after"
printf '%s\n' "$expected_sha" >"$BEFORE_SHA_FILE"
printf '%s\n' "$expected_sha" >"$AFTER_SHA_FILE"

if verify_external_report_sha_match "$BEFORE_SHA_FILE" "$AFTER_SHA_FILE" "$REPORT_FILE"; then
  pass "external before/after SHA-256 exactly matches the report archive SHA-256"
else
  fail "external before/after SHA-256 exactly matches the report archive SHA-256"
fi

readonly MISMATCH_SHA_FILE="${OUTPUT_DIR}/archive.sha256.mismatch"
printf '%064d\n' 0 >"$MISMATCH_SHA_FILE"
assert_helper_failure \
  "rejects external-to-report SHA mismatch" \
  "external and reported archive SHA-256 evidence mismatch" \
  verify_external_report_sha_match \
    "$MISMATCH_SHA_FILE" "$AFTER_SHA_FILE" "$REPORT_FILE"

readonly DUPLICATE_SHA_REPORT="${OUTPUT_DIR}/duplicate archive sha report.txt"
cp "$REPORT_FILE" "$DUPLICATE_SHA_REPORT"
printf 'sha256: %s\n' "$expected_sha" >>"$DUPLICATE_SHA_REPORT"
assert_helper_failure \
  "rejects multiple report archive SHA fields" \
  "inspector report must contain exactly one archive sha256 field" \
  verify_external_report_sha_match \
    "$BEFORE_SHA_FILE" "$AFTER_SHA_FILE" "$DUPLICATE_SHA_REPORT"

report_file_sha="$($PYTHON - "$REPORT_FILE" <<'PY'
import hashlib
import pathlib
import sys

print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)"
if [[ "$report_file_sha" =~ ^[0-9a-f]{64}$ ]]; then
  pass "records a separate valid SHA-256 for the metadata report file"
else
  fail "records a separate valid SHA-256 for the metadata report file"
fi

assert_contains "$REPORT_FILE" "sha256: ${expected_sha}" "computes the exact archive SHA-256"
assert_contains "$REPORT_FILE" "archive_format: PostgreSQL custom archive (PGDMP)" "identifies custom archive format"
assert_contains "$REPORT_FILE" "archive_format_version: 1.14.0" "reports the archive format version"
assert_contains "$REPORT_FILE" "source_postgresql_version: REDACTED_UNSAFE_OR_UNRECOGNIZED" "redacts an unreviewed source PostgreSQL version shape"
assert_contains "$REPORT_FILE" "source_pg_dump_version: REDACTED_UNSAFE_OR_UNRECOGNIZED" "redacts an unreviewed pg_dump version shape"
assert_not_contains "$REPORT_FILE" "synthetic source build" "does not leak source-version trailing text"
assert_not_contains "$REPORT_FILE" "synthetic client build" "does not leak pg_dump-version trailing text"
assert_contains "$REPORT_FILE" "pg_restore_list_compatibility: PASS" "records pg_restore list compatibility"
assert_contains "$REPORT_FILE" "archive_snapshot_binding: PASS" "binds TOC and SHA to one captured snapshot"
assert_contains "$REPORT_FILE" "archive_format_version_bytes: 1,14,0" "captures the safe PGDMP version bytes before pg_restore"
assert_contains "$REPORT_FILE" "archive_integer_width_bytes: 4" "records the safe header integer width"
assert_contains "$REPORT_FILE" "archive_offset_width_bytes: 8" "records the safe header offset width"
assert_contains "$REPORT_FILE" "archive_format_code: 1" "records the safe header format code"
assert_contains "$REPORT_FILE" "archive_header_bound_sha256: ${expected_sha}" "binds safe header metadata to the snapshot SHA-256"
assert_contains "$REPORT_FILE" "expected_sha256_binding: not_supplied" "preserves direct inspector behavior without an expected SHA"
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
  grep -Eq -- '^--list\|.*/lovable-dump-inspection\.[^/]+/archive\.snapshot$' "$CALL_LOG" &&
  ! grep -Fq -- "--list|${CANONICAL_DUMP_FILE}" "$CALL_LOG"; then
  pass "invokes pg_restore only on the private captured snapshot"
else
  fail "invokes pg_restore only on the private captured snapshot"
fi

readonly EXPECTED_REPORT_FILE="${OUTPUT_DIR}/expected SHA inspection report.txt"
if env \
  PG_RESTORE_BIN="$FAKE_PG_RESTORE" \
  PYTHON_BIN="$PYTHON" \
  FAKE_TOC="${FIXTURES}/representative.toc" \
  FAKE_LOG="$CALL_LOG" \
  FAKE_REQUIRE_HEADER=1 \
  FAKE_TMP_PARENT="$TMP_ROOT" \
  bash "$SCRIPT" \
    --migrations-dir "$MIGRATIONS_DIR" \
    --expected-sha256 "$expected_sha" \
    --output "$EXPECTED_REPORT_FILE" \
    "$DUMP_FILE" >/dev/null 2>"${TMP_ROOT}/expected-success.stderr"; then
  if [[ ! -s "${TMP_ROOT}/expected-success.stderr" ]] &&
    grep -Fq 'expected_sha256_binding: PASS' "$EXPECTED_REPORT_FILE" &&
    grep -Fq "archive_header_bound_sha256: ${expected_sha}" "$EXPECTED_REPORT_FILE"; then
    pass "optional expected SHA binds the derived inner snapshot before pg_restore"
  else
    fail "optional expected SHA binds the derived inner snapshot before pg_restore"
  fi
else
  fail "optional expected SHA binds the derived inner snapshot before pg_restore"
fi

readonly UNRESOLVED_TOC="${TMP_ROOT}/recognized unresolved aggregate.toc"
readonly UNRESOLVED_REPORT="${OUTPUT_DIR}/recognized unresolved aggregate.txt"
readonly UNRESOLVED_NAME_SENTINEL='PRIVATE_OBJECT_NAME_WITH.PUNCTUATION_MUST_NOT_APPEAR'
readonly UNRESOLVED_SCHEMA_SENTINEL='private_schema_must_not_appear'
readonly UNRESOLVED_OWNER_SENTINEL='private_owner_must_not_appear'
readonly UNRESOLVED_SQL_SENTINEL='SELECT_PRIVATE_SQL_MUST_NOT_APPEAR'
printf '%s\n' \
  '; Dumped from database version: 17.5' \
  '; Dumped by pg_dump version: 17.5' \
  "; ${UNRESOLVED_SQL_SENTINEL}" \
  "1; 123456 789012 TABLE ${UNRESOLVED_SCHEMA_SENTINEL} ${UNRESOLVED_NAME_SENTINEL} ${UNRESOLVED_OWNER_SENTINEL}" \
  >"$UNRESOLVED_TOC"
: >"$CALL_LOG"
if env \
  PG_RESTORE_BIN="$FAKE_PG_RESTORE" \
  PYTHON_BIN="$PYTHON" \
  FAKE_TOC="$UNRESOLVED_TOC" \
  FAKE_LOG="$CALL_LOG" \
  bash "$SCRIPT" \
    --migrations-dir "$MIGRATIONS_DIR" \
    --expected-sha256 "$expected_sha" \
    --output "$UNRESOLVED_REPORT" \
    "$DUMP_FILE" >"${TMP_ROOT}/unresolved.stdout" 2>"${TMP_ROOT}/unresolved.stderr"; then
  if [[ ! -s "${TMP_ROOT}/unresolved.stderr" ]] &&
    grep -Fxq 'object_reference_analysis: INCOMPLETE' "$UNRESOLVED_REPORT" &&
    grep -Fxq 'migration_duplicate_analysis: INCOMPLETE' "$UNRESOLVED_REPORT" &&
    grep -Fxq 'restore_planning_gate: BLOCKED' "$UNRESOLVED_REPORT" &&
    grep -Fxq 'unresolved_known_toc_entries: 1' "$UNRESOLVED_REPORT" &&
    ! grep -Fq "$UNRESOLVED_NAME_SENTINEL" "$UNRESOLVED_REPORT" &&
    ! grep -Fq "$UNRESOLVED_SCHEMA_SENTINEL" "$UNRESOLVED_REPORT" &&
    ! grep -Fq "$UNRESOLVED_OWNER_SENTINEL" "$UNRESOLVED_REPORT" &&
    ! grep -Fq "$UNRESOLVED_SQL_SENTINEL" "$UNRESOLVED_REPORT" &&
    ! grep -Fq 'REVIEW FLAGS' "$UNRESOLVED_REPORT" &&
    ! grep -Fq 'POSSIBLE REPO MIGRATION DUPLICATES' "$UNRESOLVED_REPORT"; then
    pass "recognized unresolved TOC entry publishes aggregate-only blocked metadata"
  else
    fail "recognized unresolved TOC entry publishes aggregate-only blocked metadata"
  fi
  if [[ "$(wc -l <"$CALL_LOG" | tr -d ' ')" == '2' ]] &&
    grep -Fxq -- '--version' "$CALL_LOG" &&
    grep -Eq -- '^--list\|.*/lovable-dump-inspection\.[^/]+/archive\.snapshot$' "$CALL_LOG"; then
    pass "aggregate-only incomplete report preserves the exact pg_restore ledger"
  else
    fail "aggregate-only incomplete report preserves the exact pg_restore ledger"
  fi
else
  fail "recognized unresolved TOC entry publishes aggregate-only blocked metadata"
fi

: >"$CALL_LOG"
assert_stage_failure \
  "rejects a wrong expected SHA before pg_restore" \
  "snapshot_identity_changed" \
  "not_applicable" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    FAKE_TOC="${FIXTURES}/representative.toc" FAKE_LOG="$CALL_LOG" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" \
      --expected-sha256 "$(printf '%064d' 0)" "$DUMP_FILE"
if [[ ! -s "$CALL_LOG" ]]; then
  pass "wrong expected SHA prevents every pg_restore invocation"
else
  fail "wrong expected SHA prevents every pg_restore invocation"
fi

assert_stage_failure \
  "rejects URL input with an input-validation stage" \
  "input_validation_failed" "not_applicable" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    bash "$SCRIPT" 'postgresql://example.invalid/database'

readonly PLAIN_FILE="${TMP_ROOT}/plain.sql"
printf 'select 1;\n' >"$PLAIN_FILE"
assert_stage_failure \
  "rejects non-custom input without echoing its path" \
  "input_validation_failed" "not_applicable" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    bash "$SCRIPT" "$PLAIN_FILE"

assert_stage_failure \
  "reports dependency validation failure" \
  "dependency_validation_failed" "not_applicable" \
  env PG_RESTORE_BIN="${TMP_ROOT}/missing-pg_restore" PYTHON_BIN="$PYTHON" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

readonly MISSING_TMP_PARENT="${TMP_ROOT}/missing tmp parent"
assert_stage_failure \
  "reports private workspace setup failure" \
  "workspace_setup_failed" "not_applicable" \
  env TMPDIR="$MISSING_TMP_PARENT" PG_RESTORE_BIN="$FAKE_PG_RESTORE" \
    PYTHON_BIN="$PYTHON" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

readonly TRUNCATED_HEADER_FILE="${TMP_ROOT}/truncated-header.backup"
printf 'PGDMP' >"$TRUNCATED_HEADER_FILE"
assert_stage_failure \
  "rejects a truncated eleven-byte PGDMP header before pg_restore" \
  "pgdmp_header_failed" "not_applicable" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$TRUNCATED_HEADER_FILE"

: >"$CALL_LOG"
readonly INVALID_INTEGER_WIDTH_FILE="${TMP_ROOT}/invalid-integer-width.backup"
readonly INVALID_OFFSET_WIDTH_FILE="${TMP_ROOT}/invalid-offset-width.backup"
readonly INVALID_FORMAT_CODE_FILE="${TMP_ROOT}/invalid-format-code.backup"
printf 'PGDMP\001\016\000\003\010\001payload\n' >"$INVALID_INTEGER_WIDTH_FILE"
printf 'PGDMP\001\016\000\004\007\001payload\n' >"$INVALID_OFFSET_WIDTH_FILE"
printf 'PGDMP\001\016\000\004\010\002payload\n' >"$INVALID_FORMAT_CODE_FILE"

assert_stage_failure \
  "rejects an unsupported PGDMP integer width before pg_restore" \
  "pgdmp_header_failed" "not_applicable" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$INVALID_INTEGER_WIDTH_FILE"
assert_stage_failure \
  "rejects an unsupported PGDMP offset width before pg_restore" \
  "pgdmp_header_failed" "not_applicable" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$INVALID_OFFSET_WIDTH_FILE"
assert_stage_failure \
  "rejects an unsupported PGDMP format code before pg_restore" \
  "pgdmp_header_failed" "not_applicable" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$INVALID_FORMAT_CODE_FILE"
if [[ ! -s "$CALL_LOG" ]]; then
  pass "unsupported PGDMP header fields are rejected before pg_restore"
else
  fail "unsupported PGDMP header fields are rejected before pg_restore"
fi

readonly REAL_CP_BIN="$(command -v cp)"
readonly REAL_CHMOD_BIN="$(command -v chmod)"
readonly REAL_RM_BIN="$(command -v rm)"
readonly REAL_DIRNAME_BIN="$(command -v dirname)"
readonly SHIM_ROOT="${TMP_ROOT}/failure shims"
mkdir -p "$SHIM_ROOT/copy" "$SHIM_ROOT/permissions" "$SHIM_ROOT/cleanup" \
  "$SHIM_ROOT/internal"

cat >"$SHIM_ROOT/copy/cp" <<'SHIM'
#!/usr/bin/env bash
exit 70
SHIM
cat >"$SHIM_ROOT/permissions/chmod" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${*: -1}" == */archive.snapshot ]]; then
  exit 70
fi
exec "$REAL_CHMOD_BIN" "$@"
SHIM
cat >"$SHIM_ROOT/cleanup/rm" <<'SHIM'
#!/usr/bin/env bash
exit 70
SHIM
cat >"$SHIM_ROOT/internal/dirname" <<'SHIM'
#!/usr/bin/env bash
exit 70
SHIM
chmod 0700 "$SHIM_ROOT/copy/cp" "$SHIM_ROOT/permissions/chmod" \
  "$SHIM_ROOT/cleanup/rm" "$SHIM_ROOT/internal/dirname"

assert_stage_failure \
  "reports snapshot copy failure" \
  "snapshot_copy_failed" "not_applicable" \
  env PATH="$SHIM_ROOT/copy:$PATH" PG_RESTORE_BIN="$FAKE_PG_RESTORE" \
    PYTHON_BIN="$PYTHON" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

assert_stage_failure \
  "reports snapshot permission failure" \
  "snapshot_permissions_failed" "not_applicable" \
  env PATH="$SHIM_ROOT/permissions:$PATH" REAL_CHMOD_BIN="$REAL_CHMOD_BIN" \
    PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

readonly FAILING_PYTHON="${TMP_ROOT}/operation-selective-python"
cat >"$FAILING_PYTHON" <<'PYTHON_WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${*: -1}" == "${FAIL_PYTHON_OPERATION:-never}" ]]; then
  exit 71
fi
exec "$REAL_PYTHON_BIN" "$@"
PYTHON_WRAPPER
chmod 0700 "$FAILING_PYTHON"

assert_stage_failure \
  "reports snapshot hash-before failure" \
  "snapshot_hash_before_failed" "not_applicable" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$FAILING_PYTHON" \
    REAL_PYTHON_BIN="$PYTHON" FAIL_PYTHON_OPERATION=before \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

assert_stage_failure \
  "classifies pg_restore version nonzero without relaying stderr" \
  "pg_restore_version_failed" "other_nonzero" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    FAKE_MODE=version-fail FAKE_LOG="$CALL_LOG" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

assert_stage_failure \
  "classifies malformed pg_restore version output" \
  "pg_restore_version_failed" "invalid_output" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    FAKE_MODE=version-malformed FAKE_LOG="$CALL_LOG" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

assert_stage_failure \
  "classifies bounded pg_restore version timeout privately" \
  "pg_restore_version_failed" "timeout" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    FAKE_MODE=version-bounded-timeout FAKE_LOG="$CALL_LOG" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

for reason_case in \
  'unsupported-version|unsupported_archive_version' \
  'invalid-archive|invalid_archive' \
  'invalid-archive-too-short|invalid_archive' \
  'truncated-archive|truncated_archive' \
  'bounded-timeout|timeout' \
  'bounded-output-cap|output_cap' \
  'bounded-invalid-json|other_nonzero' \
  'other-nonzero|other_nonzero' \
  'mixed-nonzero|other_nonzero'; do
  IFS='|' read -r fake_mode expected_reason <<<"$reason_case"
  assert_stage_failure \
    "classifies private pg_restore failure ${fake_mode}" \
    "pg_restore_list_rejected" "$expected_reason" \
    env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
      FAKE_MODE="$fake_mode" FAKE_LOG="$CALL_LOG" \
      FAKE_TOC="${FIXTURES}/representative.toc" \
      bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"
done

assert_stage_failure \
  "reports an empty pg_restore TOC" \
  "pg_restore_list_empty" "not_applicable" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    FAKE_MODE=empty-toc FAKE_LOG="$CALL_LOG" \
    FAKE_TOC="${FIXTURES}/representative.toc" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

assert_stage_failure \
  "reports snapshot hash-after failure" \
  "snapshot_hash_after_failed" "not_applicable" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$FAILING_PYTHON" \
    REAL_PYTHON_BIN="$PYTHON" FAIL_PYTHON_OPERATION=after \
    FAKE_LOG="$CALL_LOG" FAKE_TOC="${FIXTURES}/representative.toc" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

assert_stage_failure \
  "rejects snapshot identity mutation during pg_restore list" \
  "snapshot_identity_changed" "not_applicable" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    FAKE_MODE=mutate-snapshot FAKE_LOG="$CALL_LOG" \
    FAKE_TOC="${FIXTURES}/representative.toc" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

assert_stage_failure \
  "fails closed on report-helper rejection without relaying TOC content" \
  "report_helper_failed" "unknown_toc_class" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    FAKE_LOG="$CALL_LOG" FAKE_TOC="${FIXTURES}/unknown-class.toc" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

readonly HELPER_DIAGNOSTIC_PYTHON="${TMP_ROOT}/helper-diagnostic-python"
cat >"$HELPER_DIAGNOSTIC_PYTHON" <<'PYTHON_WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${2:-}" == */lib/lovable_dump_report.py ]]; then
  printf '%s\n' \
    "$HELPER_SECRET_SENTINEL" \
    "$HELPER_ROW_SENTINEL" \
    "$HELPER_PATH_SENTINEL" \
    "$HELPER_OBJECT_SENTINEL" \
    "$HELPER_TOC_SENTINEL" \
    "$HELPER_SQL_SENTINEL"
  case "${FAKE_HELPER_DIAGNOSTIC_MODE:-empty}" in
    exact-*)
      reason="${FAKE_HELPER_DIAGNOSTIC_MODE#exact-}"
      printf '{"diagnostic_version":1,"reason":"%s"}\n' "$reason" >&2
      ;;
    empty) ;;
    multiline)
      printf '%s\n%s\n' \
        '{"diagnostic_version":1,"reason":"malformed_toc"}' \
        "$HELPER_SECRET_SENTINEL" >&2
      ;;
    oversized)
      "$REAL_PYTHON_BIN" -I - <<'PY' >&2
import sys
sys.stdout.write("A" * 300)
PY
      ;;
    non-ascii) printf '\377' >&2 ;;
    malformed) printf '%s\n' '{not-json}' >&2 ;;
    extra-key)
      printf '%s\n' \
        '{"diagnostic_version":1,"reason":"malformed_toc","extra":true}' >&2
      ;;
    wrong-version)
      printf '%s\n' \
        '{"diagnostic_version":2,"reason":"malformed_toc"}' >&2
      ;;
    unknown-reason)
      printf '%s\n' \
        '{"diagnostic_version":1,"reason":"private_detail"}' >&2
      ;;
    *) exit 99 ;;
  esac
  exit 4
fi
exec "$REAL_PYTHON_BIN" "$@"
PYTHON_WRAPPER
chmod 0700 "$HELPER_DIAGNOSTIC_PYTHON"

for helper_reason in \
  unknown_toc_class \
  unresolved_known_toc_entry \
  malformed_toc \
  duplicate_toc_id \
  conflicting_source_version \
  conflicting_pg_dump_version \
  migration_metadata_unreadable \
  other_nonzero; do
  helper_output="${OUTPUT_DIR}/helper-${helper_reason}.txt"
  assert_stage_failure \
    "accepts canonical private helper reason ${helper_reason}" \
    "report_helper_failed" "$helper_reason" \
    env PG_RESTORE_BIN="$FAKE_PG_RESTORE" \
      PYTHON_BIN="$HELPER_DIAGNOSTIC_PYTHON" \
      REAL_PYTHON_BIN="$PYTHON" \
      FAKE_HELPER_DIAGNOSTIC_MODE="exact-${helper_reason}" \
      HELPER_SECRET_SENTINEL="$HELPER_SECRET_SENTINEL" \
      HELPER_ROW_SENTINEL="$HELPER_ROW_SENTINEL" \
      HELPER_PATH_SENTINEL="$HELPER_PATH_SENTINEL" \
      HELPER_OBJECT_SENTINEL="$HELPER_OBJECT_SENTINEL" \
      HELPER_TOC_SENTINEL="$HELPER_TOC_SENTINEL" \
      HELPER_SQL_SENTINEL="$HELPER_SQL_SENTINEL" \
      FAKE_LOG="$CALL_LOG" FAKE_TOC="${FIXTURES}/representative.toc" \
      bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" \
        --output "$helper_output" "$DUMP_FILE"
  if [[ -e "$helper_output" ]]; then
    fail "canonical helper failure ${helper_reason} published a report"
  else
    pass "canonical helper failure ${helper_reason} publishes no report"
  fi
done

for malformed_helper_case in \
  empty multiline oversized non-ascii malformed extra-key wrong-version unknown-reason; do
  malformed_output="${OUTPUT_DIR}/helper-malformed-${malformed_helper_case}.txt"
  assert_stage_failure \
    "collapses malformed private helper output ${malformed_helper_case}" \
    "report_helper_failed" "other_nonzero" \
    env PG_RESTORE_BIN="$FAKE_PG_RESTORE" \
      PYTHON_BIN="$HELPER_DIAGNOSTIC_PYTHON" \
      REAL_PYTHON_BIN="$PYTHON" \
      FAKE_HELPER_DIAGNOSTIC_MODE="$malformed_helper_case" \
      HELPER_SECRET_SENTINEL="$HELPER_SECRET_SENTINEL" \
      HELPER_ROW_SENTINEL="$HELPER_ROW_SENTINEL" \
      HELPER_PATH_SENTINEL="$HELPER_PATH_SENTINEL" \
      HELPER_OBJECT_SENTINEL="$HELPER_OBJECT_SENTINEL" \
      HELPER_TOC_SENTINEL="$HELPER_TOC_SENTINEL" \
      HELPER_SQL_SENTINEL="$HELPER_SQL_SENTINEL" \
      FAKE_LOG="$CALL_LOG" FAKE_TOC="${FIXTURES}/representative.toc" \
      bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" \
        --output "$malformed_output" "$DUMP_FILE"
  if [[ -e "$malformed_output" ]]; then
    fail "malformed helper failure ${malformed_helper_case} published a report"
  else
    pass "malformed helper failure ${malformed_helper_case} publishes no report"
  fi
done

assert_stage_failure \
  "refuses report overwrite with a report-publish stage" \
  "report_publish_failed" "not_applicable" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    FAKE_LOG="$CALL_LOG" FAKE_TOC="${FIXTURES}/representative.toc" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" \
      --output "$REPORT_FILE" "$DUMP_FILE"

readonly PARTIAL_PUBLISH_REPORT="${OUTPUT_DIR}/partial publish report.txt"
assert_stage_failure \
  "removes a staged report when report publication setup fails" \
  "report_publish_failed" "not_applicable" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$FAILING_PYTHON" \
    REAL_PYTHON_BIN="$PYTHON" FAIL_PYTHON_OPERATION=stage \
    FAKE_LOG="$CALL_LOG" FAKE_TOC="${FIXTURES}/representative.toc" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" \
      --output "$PARTIAL_PUBLISH_REPORT" "$DUMP_FILE"
if [[ ! -e "$PARTIAL_PUBLISH_REPORT" ]] &&
  ! find "$OUTPUT_DIR" -maxdepth 1 -name '.lovable-metadata-report.*.pending' \
    -print -quit | grep -q .; then
  pass "report publication setup failure leaves no final or staged report"
else
  fail "report publication setup failure leaves no final or staged report"
fi

readonly NOTIFICATION_REPORT="${OUTPUT_DIR}/notification failure report.txt"
readonly NOTIFICATION_STDERR="${TMP_ROOT}/notification-failure.stderr"
if env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
  FAKE_LOG="$CALL_LOG" FAKE_TOC="${FIXTURES}/representative.toc" \
  bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" \
    --output "$NOTIFICATION_REPORT" "$DUMP_FILE" \
    1>&- 2>"$NOTIFICATION_STDERR"; then
  if [[ -f "$NOTIFICATION_REPORT" && ! -s "$NOTIFICATION_STDERR" ]] &&
    grep -Fq 'inspection_status: REVIEW_REQUIRED' "$NOTIFICATION_REPORT"; then
    pass "closed notification stdout cannot relabel a committed report as failure"
  else
    fail "closed notification stdout cannot relabel a committed report as failure"
  fi
else
  fail "closed notification stdout cannot relabel a committed report as failure"
fi

readonly INDETERMINATE_REPORT="${OUTPUT_DIR}/indeterminate publish report.txt"
assert_stage_failure \
  "marks the requested path indeterminate when post-link fsync and rollback unlink fail" \
  "report_publish_failed" "not_applicable" \
  env PG_RESTORE_BIN="$FAKE_PG_RESTORE" PYTHON_BIN="$PYTHON" \
    LOVABLE_INSPECTOR_TEST_PUBLISH_FAULT=post_link_fsync_and_rollback_unlink \
    FAKE_LOG="$CALL_LOG" FAKE_TOC="${FIXTURES}/representative.toc" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" \
      --output "$INDETERMINATE_REPORT" "$DUMP_FILE"
readonly INDETERMINATE_PAYLOAD='{"diagnostic_version":1,"inspection_status":"INDETERMINATE","reason":"report_publication_rollback_unproven"}'
indeterminate_mode=''
if [[ -f "$INDETERMINATE_REPORT" ]]; then
  indeterminate_mode="$($PYTHON -I - "$INDETERMINATE_REPORT" <<'PY'
import os
import stat
import sys

print(f"{stat.S_IMODE(os.stat(sys.argv[1], follow_symlinks=False).st_mode):04o}")
PY
)" || indeterminate_mode=''
fi
if [[ -f "$INDETERMINATE_REPORT" && "$indeterminate_mode" == '0400' ]] &&
  [[ "$(<"$INDETERMINATE_REPORT")" == "$INDETERMINATE_PAYLOAD" ]] &&
  ! grep -Fq 'inspection_status: REVIEW_REQUIRED' "$INDETERMINATE_REPORT" &&
  ! find "$OUTPUT_DIR" -maxdepth 1 -name '.lovable-metadata-report.*.pending' \
    -print -quit | grep -q .; then
  pass "combined durability and rollback failure cannot leave a normal-looking report"
else
  fail "combined durability and rollback failure cannot leave a normal-looking report"
fi

readonly CLEANUP_REPORT="${OUTPUT_DIR}/cleanup failure report.txt"
assert_stage_failure \
  "reports cleanup failure as the final authoritative stage" \
  "cleanup_failed" "not_applicable" \
  env PATH="$SHIM_ROOT/cleanup:$PATH" PG_RESTORE_BIN="$FAKE_PG_RESTORE" \
    PYTHON_BIN="$PYTHON" FAKE_LOG="$CALL_LOG" \
    FAKE_TOC="${FIXTURES}/representative.toc" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" \
      --output "$CLEANUP_REPORT" "$DUMP_FILE"
if [[ ! -e "$CLEANUP_REPORT" ]] &&
  ! find "$OUTPUT_DIR" -maxdepth 1 -name '.lovable-metadata-report.*.pending' \
    -print -quit | grep -q .; then
  pass "cleanup failure occurs before report publication and removes its stage"
else
  fail "cleanup failure occurs before report publication and removes its stage"
fi
cleanup_leftover="$(find "$TMP_ROOT" -maxdepth 1 -type d \
  -name 'lovable-dump-inspection.*' -print -quit)"
if [[ -n "$cleanup_leftover" ]]; then
  "$REAL_RM_BIN" -rf -- "$cleanup_leftover"
  pass "cleanup failure leaves only the private workspace for explicit quarantine"
else
  fail "cleanup failure leaves only the private workspace for explicit quarantine"
fi

assert_stage_failure \
  "unexpected bootstrap command failure maps to internal failure" \
  "internal_failure" "not_applicable" \
  env PATH="$SHIM_ROOT/internal:$PATH" PG_RESTORE_BIN="$FAKE_PG_RESTORE" \
    PYTHON_BIN="$PYTHON" REAL_DIRNAME_BIN="$REAL_DIRNAME_BIN" \
    bash "$SCRIPT" --migrations-dir "$MIGRATIONS_DIR" "$DUMP_FILE"

assert_not_contains "$CALL_LOG" "$SECRET_SENTINEL" \
  "pg_restore invocation ledger contains no row-payload sentinel"
assert_not_contains "$CALL_LOG" 'TOP_SECRET_VERSION_FAILURE_MUST_NOT_APPEAR' \
  "pg_restore invocation ledger contains no version-failure secret"
assert_not_contains "$CALL_LOG" 'TOP_SECRET_PG_RESTORE_FAILURE_MUST_NOT_APPEAR' \
  "pg_restore invocation ledger contains no list-failure secret"

printf '\n%s passed; %s failed\n' "$passes" "$failures"
[[ "$failures" -eq 0 ]]
