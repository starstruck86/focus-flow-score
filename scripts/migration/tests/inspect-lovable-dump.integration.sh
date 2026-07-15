#!/usr/bin/env bash

# Real PostgreSQL 17 integration test. This script creates only a synthetic
# schema in an explicitly local test database, emits a custom-format archive,
# and inspects it without restoring it.

set -euo pipefail
IFS=$'\n\t'
LC_ALL=C
export LC_ALL

readonly TEST_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly INSPECTOR="$(cd -P -- "${TEST_DIR}/.." && pwd)/inspect-lovable-dump.sh"
readonly PYTHON="$(command -v python3)"
readonly PG_DUMP="$(command -v pg_dump)"
readonly PG_RESTORE="$(command -v pg_restore)"
readonly PSQL="$(command -v psql)"
readonly LOCAL_HOST="${PGHOST:-}"
readonly FIXTURE_SCHEMA="migration_dump_fixture"
readonly SECRET_SENTINEL="SYNTHETIC_ROW_VALUE_MUST_NOT_APPEAR_IN_REPORT"
readonly TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/lovable-dump-integration.XXXXXX")"
readonly ARCHIVE="${TMP_ROOT}/real custom archive.dump"
readonly REPORT="${TMP_ROOT}/metadata report.txt"
readonly MIGRATIONS="${TMP_ROOT}/migrations with spaces"

case "$LOCAL_HOST" in
  127.0.0.1|localhost|/var/run/postgresql|/private/tmp/*|/tmp/*) ;;
  *)
    printf 'ERROR: integration test requires an explicitly local PGHOST\n' >&2
    exit 2
    ;;
esac

for command_path in "$PYTHON" "$PG_DUMP" "$PG_RESTORE" "$PSQL"; do
  [[ -n "$command_path" && -x "$command_path" ]] || {
    printf 'ERROR: PostgreSQL 17 clients and python3 are required\n' >&2
    exit 2
  }
done

for tool in "$PG_DUMP" "$PG_RESTORE" "$PSQL"; do
  "$tool" --version | grep -Eq '\(PostgreSQL\) 17([. ]|$)' || {
    printf 'ERROR: integration test requires PostgreSQL 17 client tools\n' >&2
    exit 2
  }
done

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  "$PSQL" -X -v ON_ERROR_STOP=1 -qAt <<SQL >/dev/null 2>&1 || true
DROP SCHEMA IF EXISTS ${FIXTURE_SCHEMA} CASCADE;
SQL
  rm -rf -- "$TMP_ROOT"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

"$PSQL" -X -v ON_ERROR_STOP=1 -qAt <<SQL
DROP SCHEMA IF EXISTS ${FIXTURE_SCHEMA} CASCADE;
CREATE SCHEMA ${FIXTURE_SCHEMA};
CREATE TABLE ${FIXTURE_SCHEMA}.items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  note text NOT NULL
);
INSERT INTO ${FIXTURE_SCHEMA}.items (note)
VALUES ('${SECRET_SENTINEL}'), ('synthetic second row');
SQL

mkdir -p "$MIGRATIONS"
printf 'CREATE TABLE %s.items (id bigint, note text);\n' "$FIXTURE_SCHEMA" \
  >"${MIGRATIONS}/0001 synthetic fixture.sql"

"$PG_DUMP" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema="$FIXTURE_SCHEMA" \
  >"$ARCHIVE"

PG_RESTORE_BIN="$PG_RESTORE" \
PYTHON_BIN="$PYTHON" \
bash "$INSPECTOR" \
  --migrations-dir "$MIGRATIONS" \
  --output "$REPORT" \
  "$ARCHIVE" >/dev/null

grep -Fq 'archive_format: PostgreSQL custom archive (PGDMP)' "$REPORT"
grep -Fq 'archive_snapshot_binding: PASS' "$REPORT"
grep -Eq '^archive_format_version: [0-9]+\.[0-9]+\.[0-9]+$' "$REPORT"
grep -Eq '^archive_format_version_bytes: [0-9]+,[0-9]+,[0-9]+$' "$REPORT"
grep -Eq '^archive_integer_width_bytes: [0-9]+$' "$REPORT"
grep -Eq '^archive_offset_width_bytes: [0-9]+$' "$REPORT"
grep -Fxq 'archive_format_code: 1' "$REPORT"
grep -Eq '^archive_header_bound_sha256: [0-9a-f]{64}$' "$REPORT"
# Distribution-packaged PostgreSQL clients commonly append vendor text to
# these headers. The report may retain a bounded numeric PostgreSQL 17 value
# only when the whole value matches; otherwise it must use the fixed redaction.
grep -Eq '^source_postgresql_version: (17([.][0-9]{1,3}){0,3}|REDACTED_UNSAFE_OR_UNRECOGNIZED)$' "$REPORT"
grep -Eq '^source_pg_dump_version: (17([.][0-9]{1,3}){0,3}|REDACTED_UNSAFE_OR_UNRECOGNIZED)$' "$REPORT"
grep -Fxq 'inspection_status: REVIEW_REQUIRED' "$REPORT"
grep -Fxq 'object_reference_analysis: INCOMPLETE' "$REPORT"
grep -Fxq 'migration_duplicate_analysis: INCOMPLETE' "$REPORT"
grep -Fxq 'restore_planning_gate: BLOCKED' "$REPORT"
grep -Eq '^unresolved_known_toc_entries: [1-9][0-9]*$' "$REPORT"
grep -Eq '^CONSTRAINT: [1-9][0-9]*$' "$REPORT"
grep -Fxq 'restore_attempted: no' "$REPORT"
grep -Fxq 'database_connection_attempted: no' "$REPORT"
grep -Fxq 'row_payload_inspected: no' "$REPORT"
grep -Fxq 'pg_restore_list_compatibility: PASS' "$REPORT"
if grep -Fq 'POSSIBLE REPO MIGRATION DUPLICATES' "$REPORT"; then
  printf 'ERROR: incomplete object analysis emitted duplicate-name details\n' >&2
  exit 1
fi

report_sha_count="$(grep -Ec '^sha256: [0-9a-f]{64}$' "$REPORT")"
header_sha_count="$(grep -Ec '^archive_header_bound_sha256: [0-9a-f]{64}$' "$REPORT")"
if [[ "$report_sha_count" -ne 1 || "$header_sha_count" -ne 1 ]]; then
  printf 'ERROR: expected one report SHA and one header-bound SHA\n' >&2
  exit 1
fi
report_sha="$(grep -E '^sha256: [0-9a-f]{64}$' "$REPORT" | cut -d' ' -f2)"
header_sha="$(grep -E '^archive_header_bound_sha256: [0-9a-f]{64}$' "$REPORT" | cut -d' ' -f2)"
if [[ "$report_sha" != "$header_sha" ]]; then
  printf 'ERROR: archive header was not bound to the reported archive SHA\n' >&2
  exit 1
fi

if grep -Fq "$SECRET_SENTINEL" "$REPORT"; then
  printf 'ERROR: row payload leaked into metadata report\n' >&2
  exit 1
fi

printf 'PASS: real PostgreSQL 17 pg_dump -Fc / pg_restore --list inspection\n'
