#!/usr/bin/env bash

# Read-only inspection for a local PostgreSQL custom-format archive.
#
# The script has no restore or database connection mode. Failure stderr is one
# fixed JSON diagnostic containing only reviewed, allowlisted values. Child,
# tool, path, archive, and TOC text is never relayed on failure.

set -euo pipefail
IFS=$'\n\t'
LC_ALL=C
export LC_ALL
umask 077

failure_stage=''
failure_reason='not_applicable'
current_stage='internal_failure'
work_dir=''
staged_report=''

stage_is_allowed() {
  case "$1" in
    pg_restore_version_failed | \
      snapshot_copy_failed | \
      snapshot_permissions_failed | \
      snapshot_hash_before_failed | \
      pg_restore_list_rejected | \
      pg_restore_list_empty | \
      snapshot_hash_after_failed | \
      snapshot_identity_changed | \
      report_helper_failed | \
      report_publish_failed | \
      input_validation_failed | \
      dependency_validation_failed | \
      workspace_setup_failed | \
      pgdmp_header_failed | \
      cleanup_failed | \
      internal_failure)
      return 0
      ;;
    *) return 1 ;;
  esac
}

reason_is_allowed() {
  case "$1" in
    not_applicable | \
      unsupported_archive_version | \
      invalid_archive | \
      truncated_archive | \
      timeout | \
      output_cap | \
      invalid_output | \
      unknown_toc_class | \
      unresolved_known_toc_entry | \
      malformed_toc | \
      duplicate_toc_id | \
      conflicting_source_version | \
      conflicting_pg_dump_version | \
      migration_metadata_unreadable | \
      other_nonzero)
      return 0
      ;;
    *) return 1 ;;
  esac
}

fail() {
  local stage="$1"
  local reason="${2:-not_applicable}"
  local code="${3:-4}"
  if ! stage_is_allowed "$stage" || ! reason_is_allowed "$reason"; then
    failure_stage='internal_failure'
    failure_reason='invalid_output'
    exit 4
  fi
  failure_stage="$stage"
  failure_reason="$reason"
  exit "$code"
}

remove_work_dir() {
  [[ -n "$work_dir" ]] || return 0
  if ! rm -rf -- "$work_dir" >/dev/null 2>&1; then
    return 1
  fi
  work_dir=''
}

remove_staged_report() {
  [[ -n "$staged_report" ]] || return 0
  [[ -n "${PYTHON:-}" ]] || return 1
  if ! "$PYTHON" -I - "$staged_report" cleanup >/dev/null 2>&1 <<'PY'
import pathlib
import sys

try:
    pathlib.Path(sys.argv[1]).unlink(missing_ok=True)
except OSError:
    raise SystemExit(1)
PY
  then
    return 1
  fi
  staged_report=''
}

on_exit() {
  local status=$?
  local cleanup_status=0
  local stage reason
  trap - EXIT HUP INT TERM

  remove_staged_report || cleanup_status=1
  remove_work_dir || cleanup_status=1
  if [[ "$cleanup_status" -ne 0 ]]; then
    failure_stage='cleanup_failed'
    failure_reason='not_applicable'
    status=4
  fi

  if [[ "$status" -ne 0 ]]; then
    stage="${failure_stage:-$current_stage}"
    reason="${failure_reason:-not_applicable}"
    if ! stage_is_allowed "$stage" || ! reason_is_allowed "$reason"; then
      stage='internal_failure'
      reason='invalid_output'
      status=4
    fi
    printf '{"diagnostic_version":1,"stage":"%s","reason":"%s"}\n' \
      "$stage" "$reason" >&2 || true
  fi
  exit "$status"
}

on_signal() {
  failure_stage="${current_stage:-internal_failure}"
  failure_reason='not_applicable'
  exit "$1"
}

trap on_exit EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

current_stage='internal_failure'
if ! script_dir="$({ cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; } 2>/dev/null)"; then
  fail 'internal_failure'
fi
if ! repo_root="$({ cd -P -- "${script_dir}/../.." && pwd; } 2>/dev/null)"; then
  fail 'internal_failure'
fi
readonly SCRIPT_DIR="$script_dir"
readonly REPO_ROOT="$repo_root"
readonly REPORT_HELPER="${SCRIPT_DIR}/lib/lovable_dump_report.py"

usage() {
  cat <<'USAGE'
Usage:
  inspect-lovable-dump.sh [options] LOCAL_DUMP_FILE

Options:
  --migrations-dir DIR  Compare archive object metadata with SQL migrations.
                        Default: <repo>/supabase/migrations
  --output FILE         Write the metadata-only report to a new local file.
                        The parent directory must already exist. Existing files
                        are never overwritten. Without this option, print to stdout.
  --expected-sha256 HEX Require the private snapshot to equal this lowercase
                        SHA-256 before any pg_restore invocation.
  -h, --help            Show this help.

Safety boundary:
  * LOCAL_DUMP_FILE must be a readable, non-empty local regular file.
  * URLs and connection strings are rejected.
  * Only PostgreSQL custom-format archives (PGDMP) are accepted.
  * A private read-only byte snapshot binds pg_restore --list to the SHA-256.
  * pg_restore is invoked only with --version and --list.
  * No restore, SQL execution, database connection, or row-data extraction occurs.
  * Put local archives/reports under local-migration-artifacts/ (gitignored).
USAGE
}

is_url_like() {
  local value="$1"
  [[ "$value" =~ ^[[:alpha:]][[:alnum:]+.-]*:// ]] ||
    [[ "$value" =~ ^(postgres|postgresql): ]]
}

reject_unsafe_path_text() {
  local value="$1"
  if is_url_like "$value" || [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    fail 'input_validation_failed' 'not_applicable' 2
  fi
}

resolve_executable() {
  local output_name="$1"
  local override="$2"
  local default_name="$3"
  local resolved=''

  if [[ -n "$override" ]]; then
    [[ -x "$override" && ! -d "$override" ]] ||
      fail 'dependency_validation_failed' 'not_applicable' 3
    printf -v "$output_name" '%s' "$override"
    return 0
  fi

  if ! resolved="$(command -v "$default_name" 2>/dev/null)" ||
    [[ -z "$resolved" || ! -x "$resolved" || -d "$resolved" ]]; then
    fail 'dependency_validation_failed' 'not_applicable' 3
  fi
  printf -v "$output_name" '%s' "$resolved"
}

current_stage='input_validation_failed'
dump_input=''
output_input=''
expected_sha256=''
migrations_input="${REPO_ROOT}/supabase/migrations"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --migrations-dir)
      [[ $# -ge 2 ]] || fail 'input_validation_failed' 'not_applicable' 2
      migrations_input="$2"
      shift 2
      ;;
    --output)
      [[ $# -ge 2 ]] || fail 'input_validation_failed' 'not_applicable' 2
      output_input="$2"
      shift 2
      ;;
    --expected-sha256)
      [[ $# -ge 2 ]] || fail 'input_validation_failed' 'not_applicable' 2
      expected_sha256="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      [[ $# -eq 1 ]] || fail 'input_validation_failed' 'not_applicable' 2
      dump_input="$1"
      shift
      ;;
    -*) fail 'input_validation_failed' 'not_applicable' 2 ;;
    *)
      [[ -z "$dump_input" ]] || fail 'input_validation_failed' 'not_applicable' 2
      dump_input="$1"
      shift
      ;;
  esac
done

[[ -n "$dump_input" ]] || fail 'input_validation_failed' 'not_applicable' 2
reject_unsafe_path_text "$dump_input"
reject_unsafe_path_text "$migrations_input"
[[ -z "$output_input" ]] || reject_unsafe_path_text "$output_input"
if [[ -n "$expected_sha256" && ! "$expected_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  fail 'input_validation_failed' 'not_applicable' 2
fi

[[ -e "$dump_input" ]] || fail 'input_validation_failed' 'not_applicable' 2
[[ -f "$dump_input" ]] || fail 'input_validation_failed' 'not_applicable' 2
[[ -r "$dump_input" ]] || fail 'input_validation_failed' 'not_applicable' 2
[[ -s "$dump_input" ]] || fail 'input_validation_failed' 'not_applicable' 2

if ! dump_dir="$({ cd -P -- "$(dirname -- "$dump_input")" && pwd; } 2>/dev/null)"; then
  fail 'input_validation_failed' 'not_applicable' 2
fi
if ! input_name="$(basename -- "$dump_input" 2>/dev/null)" || [[ -z "$input_name" ]]; then
  fail 'input_validation_failed' 'not_applicable' 2
fi
readonly DUMP_DIR="$dump_dir"
readonly DUMP_PATH="${DUMP_DIR}/${input_name}"
readonly INPUT_NAME="$input_name"

archive_magic=''
{ IFS= read -r -n 5 archive_magic < "$DUMP_PATH" || true; } 2>/dev/null
[[ "$archive_magic" == 'PGDMP' ]] || fail 'input_validation_failed' 'not_applicable' 4

[[ -d "$migrations_input" ]] || fail 'input_validation_failed' 'not_applicable' 2
if ! migrations_dir="$({ cd -P -- "$migrations_input" && pwd; } 2>/dev/null)"; then
  fail 'input_validation_failed' 'not_applicable' 2
fi
readonly MIGRATIONS_DIR="$migrations_dir"

current_stage='dependency_validation_failed'
PG_RESTORE=''
PYTHON=''
resolve_executable PG_RESTORE "${PG_RESTORE_BIN:-}" pg_restore
resolve_executable PYTHON "${PYTHON_BIN:-}" python3
readonly PG_RESTORE PYTHON
case "${LOVABLE_PG_RESTORE_GUARD_IS_PYTHON:-0}" in
  0 | 1) ;;
  *) fail 'dependency_validation_failed' 'not_applicable' 3 ;;
esac
[[ -r "$REPORT_HELPER" ]] || fail 'dependency_validation_failed' 'not_applicable' 3

run_pg_restore() {
  if [[ "${LOVABLE_PG_RESTORE_GUARD_IS_PYTHON:-0}" == '1' ]]; then
    "$PYTHON" -I "$PG_RESTORE" "$@"
  else
    "$PG_RESTORE" "$@"
  fi
}

current_stage='workspace_setup_failed'
if ! work_dir="$(mktemp -d "${TMPDIR:-/tmp}/lovable-dump-inspection.XXXXXX" 2>/dev/null)" ||
  [[ -z "$work_dir" || ! -d "$work_dir" ]]; then
  work_dir=''
  fail 'workspace_setup_failed'
fi
readonly SNAPSHOT_PATH="${work_dir}/archive.snapshot"
readonly HEADER_METADATA_FILE="${work_dir}/header.metadata"
readonly TOC_FILE="${work_dir}/archive.toc"
readonly PG_RESTORE_ERROR="${work_dir}/pg_restore.stderr"
readonly PG_RESTORE_VERSION_OUTPUT="${work_dir}/pg_restore-version.stdout"
readonly PG_RESTORE_VERSION_ERROR="${work_dir}/pg_restore-version.stderr"
readonly REPORT_HELPER_ERROR="${work_dir}/report-helper.stderr"
readonly REPORT_FILE="${work_dir}/report.txt"

current_stage='snapshot_copy_failed'
if ! cp -- "$DUMP_PATH" "$SNAPSHOT_PATH" >/dev/null 2>&1; then
  fail 'snapshot_copy_failed'
fi

current_stage='snapshot_permissions_failed'
if ! chmod 0400 "$SNAPSHOT_PATH" >/dev/null 2>&1; then
  fail 'snapshot_permissions_failed'
fi
if ! { "$PYTHON" -I - "$SNAPSHOT_PATH" permissions <<'PY'
import os
import pathlib
import stat
import sys

path = pathlib.Path(sys.argv[1])
try:
    metadata = os.stat(path, follow_symlinks=False)
except OSError:
    raise SystemExit(1)
if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o400:
    raise SystemExit(1)
PY
} >/dev/null 2>/dev/null; then
  fail 'snapshot_permissions_failed'
fi

current_stage='snapshot_hash_before_failed'
header_status=0
if { "$PYTHON" -I - "$SNAPSHOT_PATH" before > "$HEADER_METADATA_FILE" <<'PY'
import hashlib
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
digest = hashlib.sha256()
header = b""
try:
    with path.open("rb") as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            if len(header) < 11:
                header += chunk[: 11 - len(header)]
            digest.update(chunk)
except OSError:
    raise SystemExit(40)
if len(header) < 11 or not header.startswith(b"PGDMP"):
    raise SystemExit(41)
print(
    "|".join(
        (
            digest.hexdigest(),
            str(header[5]),
            str(header[6]),
            str(header[7]),
            str(header[8]),
            str(header[9]),
            str(header[10]),
        )
    )
)
PY
} 2>/dev/null; then
  header_status=0
else
  header_status=$?
fi
if [[ "$header_status" -eq 41 ]]; then
  fail 'pgdmp_header_failed'
elif [[ "$header_status" -ne 0 ]]; then
  fail 'snapshot_hash_before_failed'
fi

header_record=''
if ! { IFS= read -r header_record < "$HEADER_METADATA_FILE"; } 2>/dev/null; then
  fail 'pgdmp_header_failed' 'invalid_output'
fi
header_record_without_separators="${header_record//|/}"
if [[ $((${#header_record} - ${#header_record_without_separators})) -ne 6 ]]; then
  fail 'pgdmp_header_failed' 'invalid_output'
fi
IFS='|' read -r snapshot_sha_before header_major header_minor header_revision \
  header_integer_size header_offset_size header_format extra_header_field <<< "$header_record"
if [[ -n "${extra_header_field:-}" ]] ||
  [[ ! "$snapshot_sha_before" =~ ^[0-9a-f]{64}$ ]] ||
  [[ ! "$header_major" =~ ^[0-9]{1,3}$ ]] ||
  [[ ! "$header_minor" =~ ^[0-9]{1,3}$ ]] ||
  [[ ! "$header_revision" =~ ^[0-9]{1,3}$ ]] ||
  [[ ! "$header_integer_size" =~ ^[0-9]{1,3}$ ]] ||
  [[ ! "$header_offset_size" =~ ^[0-9]{1,3}$ ]] ||
  [[ ! "$header_format" =~ ^[0-9]{1,3}$ ]]; then
  fail 'pgdmp_header_failed' 'invalid_output'
fi
if [[ "$header_integer_size" != '4' && "$header_integer_size" != '8' ]] ||
  [[ "$header_offset_size" != '4' && "$header_offset_size" != '8' ]] ||
  [[ "$header_format" != '1' ]]; then
  fail 'pgdmp_header_failed'
fi
readonly snapshot_sha_before header_major header_minor header_revision
readonly header_integer_size header_offset_size header_format

if [[ -n "$expected_sha256" && "$snapshot_sha_before" != "$expected_sha256" ]]; then
  fail 'snapshot_identity_changed'
fi

classify_pg_restore_failure() {
  local error_file="$1"
  local classified=''
  if ! classified="$({ "$PYTHON" -I - "$error_file" classify <<'PY'
import json
import pathlib
import re
import sys

try:
    data = pathlib.Path(sys.argv[1]).read_bytes()
except OSError:
    print("other_nonzero")
    raise SystemExit(0)
if len(data) > 65536:
    print("other_nonzero")
    raise SystemExit(0)
try:
    text = data.decode("ascii")
except UnicodeError:
    print("other_nonzero")
    raise SystemExit(0)
text = text.removesuffix("\n")
bounded_reasons = {
    "unsupported_archive_version",
    "invalid_archive",
    "truncated_archive",
    "timeout",
    "output_cap",
    "other_nonzero",
}
if re.fullmatch(
    r'\{"diagnostic_version":1,"reason":"[a-z_]+"\}',
    text,
):
    parsed = json.loads(text)
    reason = parsed.get("reason")
    print(reason if reason in bounded_reasons else "other_nonzero")
elif "\n" in text or "\r" in text:
    print("other_nonzero")
elif re.fullmatch(
    r"pg_restore(?:: error:|: \[archiver\]) unsupported version "
    r"\([0-9]+\.[0-9]+\) in file header",
    text,
):
    print("unsupported_archive_version")
elif text in {
    "pg_restore: error: input file does not appear to be a valid archive",
    "pg_restore: error: input file does not appear to be a valid archive (too short?)",
    "pg_restore: error: input file appears to be a text format dump. Please use psql.",
}:
    print("invalid_archive")
elif re.fullmatch(
    r"pg_restore: error: input file is too short \(read [0-9]+, expected [0-9]+\)",
    text,
) or text in {
    "pg_restore: error: could not read from input file: end of file",
    "pg_restore: error: unexpected end of file",
}:
    print("truncated_archive")
else:
    print("other_nonzero")
PY
} 2>/dev/null)" || ! reason_is_allowed "$classified"; then
    classified='other_nonzero'
  fi
  printf '%s' "$classified"
}

current_stage='pg_restore_version_failed'
if ! { run_pg_restore --version > "$PG_RESTORE_VERSION_OUTPUT" 2> "$PG_RESTORE_VERSION_ERROR"; } 2>/dev/null; then
  pg_restore_reason="$(classify_pg_restore_failure "$PG_RESTORE_VERSION_ERROR")"
  fail 'pg_restore_version_failed' "$pg_restore_reason" 3
fi
pg_restore_version=''
if ! pg_restore_version="$({ "$PYTHON" -I - "$PG_RESTORE_VERSION_OUTPUT" version <<'PY'
import pathlib
import re
import sys

try:
    data = pathlib.Path(sys.argv[1]).read_bytes()
except OSError:
    raise SystemExit(1)
if len(data) > 4096:
    raise SystemExit(1)
try:
    text = data.decode("ascii")
except UnicodeError:
    raise SystemExit(1)
match = re.fullmatch(
    r"pg_restore[ \t]+\(PostgreSQL\)[ \t]+([0-9]+(?:\.[0-9]+)?)[^\r\n]*\n?",
    text,
)
if match is None:
    raise SystemExit(1)
print(match.group(1))
PY
} 2>/dev/null)" || [[ ! "$pg_restore_version" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  fail 'pg_restore_version_failed' 'invalid_output' 3
fi
readonly PG_RESTORE_VERSION="$pg_restore_version"

current_stage='pg_restore_list_rejected'
if ! { run_pg_restore --list "$SNAPSHOT_PATH" > "$TOC_FILE" 2> "$PG_RESTORE_ERROR"; } 2>/dev/null; then
  pg_restore_reason="$(classify_pg_restore_failure "$PG_RESTORE_ERROR")"
  fail 'pg_restore_list_rejected' "$pg_restore_reason" 4
fi

current_stage='pg_restore_list_empty'
[[ -s "$TOC_FILE" ]] || fail 'pg_restore_list_empty'

current_stage='snapshot_hash_after_failed'
snapshot_sha_after=''
if ! snapshot_sha_after="$({ "$PYTHON" -I - "$SNAPSHOT_PATH" after <<'PY'
import hashlib
import pathlib
import sys

digest = hashlib.sha256()
try:
    with pathlib.Path(sys.argv[1]).open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
except OSError:
    raise SystemExit(1)
print(digest.hexdigest())
PY
} 2>/dev/null)" || [[ ! "$snapshot_sha_after" =~ ^[0-9a-f]{64}$ ]]; then
  fail 'snapshot_hash_after_failed'
fi
readonly snapshot_sha_after

current_stage='snapshot_identity_changed'
[[ "$snapshot_sha_before" == "$snapshot_sha_after" ]] ||
  fail 'snapshot_identity_changed'
if [[ -n "$expected_sha256" && "$snapshot_sha_after" != "$expected_sha256" ]]; then
  fail 'snapshot_identity_changed'
fi

current_stage='report_helper_failed'
if ! { "$PYTHON" -I "$REPORT_HELPER" \
  --dump "$SNAPSHOT_PATH" \
  --toc "$TOC_FILE" \
  --pg-restore-version "$PG_RESTORE_VERSION" \
  --expected-sha256 "$snapshot_sha_after" \
  --input-name "$INPUT_NAME" \
  --migrations-dir "$MIGRATIONS_DIR" > "$REPORT_FILE" 2> "$REPORT_HELPER_ERROR"; } 2>/dev/null; then
  helper_reason='other_nonzero'
  if ! helper_reason="$({ "$PYTHON" -I - "$REPORT_HELPER_ERROR" helper-diagnostic <<'PY'
import pathlib
import sys

allowed = (
    "unknown_toc_class",
    "unresolved_known_toc_entry",
    "malformed_toc",
    "duplicate_toc_id",
    "conflicting_source_version",
    "conflicting_pg_dump_version",
    "migration_metadata_unreadable",
    "other_nonzero",
)
try:
    with pathlib.Path(sys.argv[1]).open("rb") as source:
        data = source.read(257)
        overflow = source.read(1)
except OSError:
    data = b""
    overflow = b""

reason = "other_nonzero"
if not overflow and len(data) <= 256:
    for candidate in allowed:
        expected = (
            f'{{"diagnostic_version":1,"reason":"{candidate}"}}\n'.encode("ascii")
        )
        if data == expected:
            reason = candidate
            break
print(reason)
PY
} 2>/dev/null)" || ! reason_is_allowed "$helper_reason"; then
    helper_reason='other_nonzero'
  fi
  fail 'report_helper_failed' "$helper_reason"
fi

expected_binding='not_supplied'
[[ -z "$expected_sha256" ]] || expected_binding='PASS'
if ! { printf '%s\n' \
  '' \
  'PGDMP HEADER CAPTURE' \
  "archive_format_version_bytes: ${header_major},${header_minor},${header_revision}" \
  "archive_integer_width_bytes: ${header_integer_size}" \
  "archive_offset_width_bytes: ${header_offset_size}" \
  "archive_format_code: ${header_format}" \
  "archive_header_bound_sha256: ${snapshot_sha_after}" \
  "expected_sha256_binding: ${expected_binding}" >> "$REPORT_FILE"; } 2>/dev/null; then
  fail 'report_helper_failed' 'other_nonzero'
fi

current_stage='report_publish_failed'
if [[ -z "$output_input" ]]; then
  if ! exec 3< "$REPORT_FILE"; then
    fail 'report_publish_failed'
  fi
  if ! remove_work_dir; then
    exec 3<&- || true
    fail 'cleanup_failed'
  fi
  if ! cat <&3 2>/dev/null; then
    exec 3<&- || true
    fail 'report_publish_failed'
  fi
  exec 3<&- || true
  exit 0
fi

if ! output_dir_input="$(dirname -- "$output_input" 2>/dev/null)" ||
  ! output_name="$(basename -- "$output_input" 2>/dev/null)" ||
  [[ -z "$output_name" || ! -d "$output_dir_input" ]]; then
  fail 'report_publish_failed' 'not_applicable' 2
fi
if ! output_dir="$({ cd -P -- "$output_dir_input" && pwd; } 2>/dev/null)"; then
  fail 'report_publish_failed' 'not_applicable' 2
fi
readonly OUTPUT_PATH="${output_dir}/${output_name}"
[[ "$OUTPUT_PATH" != "$DUMP_PATH" ]] || fail 'report_publish_failed' 'not_applicable' 2

if ! staged_report="$({ "$PYTHON" -I - "$REPORT_FILE" "$output_dir" stage <<'PY'
import os
import pathlib
import shutil
import sys
import tempfile

source = pathlib.Path(sys.argv[1])
directory = pathlib.Path(sys.argv[2])
file_descriptor = -1
staged = None
try:
    file_descriptor, raw_path = tempfile.mkstemp(
        prefix=".lovable-metadata-report.",
        suffix=".pending",
        dir=directory,
    )
    staged = pathlib.Path(raw_path)
    os.fchmod(file_descriptor, 0o600)
    with source.open("rb") as input_handle, os.fdopen(
        file_descriptor, "wb", closefd=True
    ) as output_handle:
        file_descriptor = -1
        shutil.copyfileobj(input_handle, output_handle, length=1024 * 1024)
        output_handle.flush()
        os.fsync(output_handle.fileno())
    print(staged)
except Exception:
    if file_descriptor >= 0:
        os.close(file_descriptor)
    if staged is not None:
        staged.unlink(missing_ok=True)
    raise SystemExit(18)
PY
} 2>/dev/null)" || [[ -z "$staged_report" || ! -f "$staged_report" ]]; then
  staged_report=''
  fail 'report_publish_failed' 'not_applicable' 4
fi

if ! remove_work_dir; then
  fail 'cleanup_failed'
fi

publish_status=0
if { "$PYTHON" -I - "$staged_report" "$OUTPUT_PATH" publish <<'PY'
import os
import pathlib
import stat
import sys
import tempfile

source = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])
published = False
directory_fd = -1
source_identity = None
test_fault = os.environ.get("LOVABLE_INSPECTOR_TEST_PUBLISH_FAULT", "")
indeterminate_payload = (
    b'{"diagnostic_version":1,"inspection_status":"INDETERMINATE",'
    b'"reason":"report_publication_rollback_unproven"}\n'
)

def destination_identity():
    try:
        metadata = os.stat(destination, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if (
        not stat.S_ISREG(metadata.st_mode)
        or source_identity is None
        or (metadata.st_dev, metadata.st_ino) != source_identity
    ):
        raise OSError("published destination identity changed")
    return metadata

def mark_destination_indeterminate():
    flags = os.O_WRONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    created = False
    try:
        descriptor = os.open(destination, flags)
    except FileNotFoundError:
        descriptor = os.open(
            destination,
            flags | os.O_CREAT | os.O_EXCL,
            0o600,
        )
        created = True
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise OSError("indeterminate marker target is not regular")
        if not created and (
            source_identity is None
            or (metadata.st_dev, metadata.st_ino) != source_identity
        ):
            raise OSError("indeterminate marker target identity changed")
        os.ftruncate(descriptor, 0)
        offset = 0
        while offset < len(indeterminate_payload):
            written = os.write(descriptor, indeterminate_payload[offset:])
            if written <= 0:
                raise OSError("indeterminate marker write made no progress")
            offset += written
        os.fchmod(descriptor, 0o400)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.fsync(directory_fd)

def quarantine_destination():
    if destination_identity() is None:
        return
    quarantine_fd, quarantine_path = tempfile.mkstemp(
        prefix=".lovable-report.INSPECTION_INDETERMINATE.",
        suffix=".quarantine",
        dir=destination.parent,
    )
    os.close(quarantine_fd)
    try:
        os.replace(destination, quarantine_path)
        os.chmod(quarantine_path, 0o400)
        os.fsync(directory_fd)
    except Exception:
        pathlib.Path(quarantine_path).unlink(missing_ok=True)
        raise

try:
    source_metadata = os.stat(source, follow_symlinks=False)
    if not stat.S_ISREG(source_metadata.st_mode):
        raise OSError("staged report is not regular")
    source_identity = (source_metadata.st_dev, source_metadata.st_ino)
    os.link(source, destination, follow_symlinks=False)
    published = True
    directory_fd = os.open(
        destination.parent,
        os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
    )
    if test_fault == "post_link_fsync_and_rollback_unlink":
        raise OSError("planted post-link directory fsync failure")
    os.fsync(directory_fd)
    source.unlink()
    os.fsync(directory_fd)
except FileExistsError:
    raise SystemExit(17)
except Exception:
    rollback_proven = False
    if published:
        try:
            if test_fault == "post_link_fsync_and_rollback_unlink":
                raise OSError("planted rollback unlink failure")
            destination.unlink()
            if os.path.lexists(destination):
                raise OSError("published destination still exists after rollback")
            os.fsync(directory_fd)
            rollback_proven = True
        except Exception:
            rollback_proven = False
        if not rollback_proven:
            try:
                mark_destination_indeterminate()
            except Exception:
                try:
                    quarantine_destination()
                except Exception:
                    pass
    raise SystemExit(18)
finally:
    if directory_fd >= 0:
        os.close(directory_fd)
PY
} >/dev/null 2>/dev/null; then
  publish_status=0
else
  publish_status=$?
fi
if [[ "$publish_status" -ne 0 ]]; then
  if [[ "$publish_status" -eq 17 ]]; then
    fail 'report_publish_failed' 'not_applicable' 2
  fi
  fail 'report_publish_failed' 'not_applicable' 4
fi

staged_report=''
# The report is already durably committed. A best-effort human notification
# must not retroactively turn that committed success into a failure that leaves
# a normal report beside a failure diagnostic.
{ printf 'Metadata-only report written to %s\n' "$OUTPUT_PATH"; } 2>/dev/null || true
exit 0
