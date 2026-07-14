#!/usr/bin/env bash

# Read-only inspection for a local PostgreSQL custom-format archive.
#
# This script deliberately has no restore or database connection mode. It only:
#   1. validates a local archive path and PGDMP header,
#   2. captures the bytes into a private read-only local snapshot,
#   3. binds that snapshot's SHA-256 to pg_restore's metadata-only TOC, and
#   4. renders a sanitized metadata report.

set -euo pipefail
IFS=$'\n\t'
LC_ALL=C
export LC_ALL
umask 077

readonly SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -P -- "${SCRIPT_DIR}/../.." && pwd)"
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

die() {
  local message="$1"
  local code="${2:-1}"
  printf 'ERROR: %s\n' "$message" >&2
  exit "$code"
}

is_url_like() {
  local value="$1"
  [[ "$value" =~ ^[[:alpha:]][[:alnum:]+.-]*:// ]] ||
    [[ "$value" =~ ^(postgres|postgresql): ]]
}

reject_unsafe_path_text() {
  local label="$1"
  local value="$2"
  is_url_like "$value" && die "${label} must be a local filesystem path, not a URL or connection string"
  [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]] &&
    die "${label} must not contain newline characters"
  return 0
}

resolve_executable() {
  local override="$1"
  local default_name="$2"
  local label="$3"
  local resolved

  if [[ -n "$override" ]]; then
    [[ -x "$override" && ! -d "$override" ]] ||
      die "${label} executable is missing or not executable: ${override}" 3
    printf '%s\n' "$override"
    return
  fi

  resolved="$(command -v "$default_name" 2>/dev/null || true)"
  [[ -n "$resolved" && -x "$resolved" ]] ||
    die "required tool not found: ${default_name}" 3
  printf '%s\n' "$resolved"
}

dump_input=''
output_input=''
migrations_input="${REPO_ROOT}/supabase/migrations"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --migrations-dir)
      [[ $# -ge 2 ]] || die "--migrations-dir requires a directory path" 2
      migrations_input="$2"
      shift 2
      ;;
    --output)
      [[ $# -ge 2 ]] || die "--output requires a file path" 2
      output_input="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      [[ $# -eq 1 ]] || die "expected exactly one local dump file after --" 2
      dump_input="$1"
      shift
      ;;
    -*)
      die "unknown option: $1" 2
      ;;
    *)
      [[ -z "$dump_input" ]] || die "expected exactly one local dump file" 2
      dump_input="$1"
      shift
      ;;
  esac
done

[[ -n "$dump_input" ]] || die "a local dump file is required" 2
reject_unsafe_path_text "dump path" "$dump_input"
reject_unsafe_path_text "migrations directory" "$migrations_input"
[[ -z "$output_input" ]] || reject_unsafe_path_text "output path" "$output_input"

[[ -e "$dump_input" ]] || die "dump file does not exist" 2
[[ -f "$dump_input" ]] || die "dump path is not a regular file" 2
[[ -r "$dump_input" ]] || die "dump file is not readable" 2
[[ -s "$dump_input" ]] || die "dump file is empty" 2

readonly DUMP_DIR="$(cd -P -- "$(dirname -- "$dump_input")" && pwd)"
readonly DUMP_PATH="${DUMP_DIR}/$(basename -- "$dump_input")"
readonly INPUT_NAME="$(basename -- "$DUMP_PATH")"

archive_magic=''
IFS= read -r -n 5 archive_magic < "$DUMP_PATH" || true
[[ "$archive_magic" == 'PGDMP' ]] ||
  die "unsupported dump format: expected a PostgreSQL custom-format archive (PGDMP)" 4

[[ -d "$migrations_input" ]] || die "migrations directory does not exist" 2
readonly MIGRATIONS_DIR="$(cd -P -- "$migrations_input" && pwd)"

PG_RESTORE="$(resolve_executable "${PG_RESTORE_BIN:-}" pg_restore pg_restore)" || exit $?
PYTHON="$(resolve_executable "${PYTHON_BIN:-}" python3 python3)" || exit $?
readonly PG_RESTORE PYTHON
[[ -r "$REPORT_HELPER" ]] || die "report helper is missing: ${REPORT_HELPER}" 3

pg_restore_output=''
if ! pg_restore_output="$("$PG_RESTORE" --version 2>/dev/null)"; then
  die "pg_restore --version failed; install a working PostgreSQL client" 3
fi

if [[ ! "$pg_restore_output" =~ ^pg_restore[[:space:]]+\(PostgreSQL\)[[:space:]]+([0-9]+)(\.([0-9]+))? ]]; then
  die "pg_restore returned an unrecognized version string" 3
fi
readonly PG_RESTORE_VERSION="${BASH_REMATCH[1]}${BASH_REMATCH[2]:-}"

readonly WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lovable-dump-inspection.XXXXXX")"
cleanup() {
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT HUP INT TERM

readonly SNAPSHOT_PATH="${WORK_DIR}/archive.snapshot"
readonly TOC_FILE="${WORK_DIR}/archive.toc"
readonly PG_RESTORE_ERROR="${WORK_DIR}/pg_restore.stderr"
readonly REPORT_FILE="${WORK_DIR}/report.txt"

if ! cp -- "$DUMP_PATH" "$SNAPSHOT_PATH"; then
  die "could not capture a private archive snapshot" 4
fi
chmod 0400 "$SNAPSHOT_PATH" || die "could not make archive snapshot read-only" 4

sha256_file() {
  "$PYTHON" - "$1" <<'PY'
import hashlib
import pathlib
import sys

digest = hashlib.sha256()
with pathlib.Path(sys.argv[1]).open("rb") as source:
    while chunk := source.read(1024 * 1024):
        digest.update(chunk)
print(digest.hexdigest())
PY
}

snapshot_sha_before="$(sha256_file "$SNAPSHOT_PATH")" ||
  die "could not fingerprint captured archive snapshot" 4
readonly snapshot_sha_before

if ! "$PG_RESTORE" --list "$SNAPSHOT_PATH" >"$TOC_FILE" 2>"$PG_RESTORE_ERROR"; then
  die "pg_restore --list rejected the archive; it is corrupt or incompatible with pg_restore ${PG_RESTORE_VERSION}" 4
fi
[[ -s "$TOC_FILE" ]] || die "pg_restore --list returned an empty archive TOC" 4

snapshot_sha_after="$(sha256_file "$SNAPSHOT_PATH")" ||
  die "could not re-fingerprint captured archive snapshot" 4
readonly snapshot_sha_after
[[ "$snapshot_sha_before" == "$snapshot_sha_after" ]] ||
  die "archive snapshot changed during pg_restore --list; refusing unbound report" 4

if ! "$PYTHON" "$REPORT_HELPER" \
  --dump "$SNAPSHOT_PATH" \
  --toc "$TOC_FILE" \
  --pg-restore-version "$PG_RESTORE_VERSION" \
  --expected-sha256 "$snapshot_sha_after" \
  --input-name "$INPUT_NAME" \
  --migrations-dir "$MIGRATIONS_DIR" >"$REPORT_FILE"; then
  die "archive metadata inspection failed closed" 4
fi

if [[ -z "$output_input" ]]; then
  cat -- "$REPORT_FILE"
  exit 0
fi

readonly OUTPUT_DIR_INPUT="$(dirname -- "$output_input")"
readonly OUTPUT_NAME="$(basename -- "$output_input")"
[[ -d "$OUTPUT_DIR_INPUT" ]] || die "output parent directory does not exist" 2
readonly OUTPUT_DIR="$(cd -P -- "$OUTPUT_DIR_INPUT" && pwd)"
readonly OUTPUT_PATH="${OUTPUT_DIR}/${OUTPUT_NAME}"
[[ "$OUTPUT_PATH" != "$DUMP_PATH" ]] || die "output path must not replace the dump file" 2

# Publish with exclusive-create semantics. A preliminary existence check plus
# mv can clobber a file created by another process between those operations.
if "$PYTHON" - "$REPORT_FILE" "$OUTPUT_PATH" <<'PY'
import os
import pathlib
import shutil
import sys

source = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])
created = False
try:
    with source.open("rb") as input_handle, destination.open("xb") as output_handle:
        created = True
        shutil.copyfileobj(input_handle, output_handle, length=1024 * 1024)
        output_handle.flush()
        os.fsync(output_handle.fileno())
except FileExistsError:
    raise SystemExit(17)
except Exception:
    if created:
        destination.unlink(missing_ok=True)
    raise SystemExit(18)
PY
then
  :
else
  publish_status=$?
  if [[ "$publish_status" -eq 17 ]]; then
    die "output file already exists; refusing to overwrite it" 2
  fi
  die "could not publish metadata report" 4
fi
printf 'Metadata-only report written to %s\n' "$OUTPUT_PATH"
