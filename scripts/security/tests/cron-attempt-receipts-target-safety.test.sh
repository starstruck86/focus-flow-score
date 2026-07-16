#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/cron-receipt-target-safety.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

FAKE_BIN="$TMP_DIR/fake-bin"
mkdir -p "$FAKE_BIN"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\n" "$0 $*" >> "$SQL_SENTINEL"' \
  'cat >> "$SQL_SENTINEL"' \
  'exit 99' \
  > "$FAKE_BIN/psql"
chmod +x "$FAKE_BIN/psql"

pass_count=0

expect_guard_rejection() {
  local case_name=$1
  local expected_message=$2
  shift 2
  local output="$TMP_DIR/$case_name.out"
  local sentinel="$TMP_DIR/$case_name.sql"
  local status

  if env \
    PATH="$FAKE_BIN:$PATH" \
    SQL_SENTINEL="$sentinel" \
    PGPORT=5432 \
    PGUSER=synthetic_guard \
    PGPASSWORD=synthetic_guard \
    POSTGRES_CONTAINER= \
    "$@" \
    /bin/bash \
      "$ROOT/scripts/security/tests/cron-attempt-receipts.integration.sh" \
      > "$output" 2>&1; then
    echo "cron receipt target safety/$case_name unexpectedly succeeded" >&2
    exit 1
  else
    status=$?
  fi

  if [[ $status -ne 2 ]]; then
    echo "cron receipt target safety/$case_name exited $status, expected 2" >&2
    exit 1
  fi
  if [[ -e $sentinel ]]; then
    echo "cron receipt target safety/$case_name reached fixture SQL" >&2
    exit 1
  fi
  if ! grep -Fq "$expected_message" "$output"; then
    echo "cron receipt target safety/$case_name lacked expected rejection" >&2
    exit 1
  fi
  pass_count=$((pass_count + 1))
}

expect_guard_rejection \
  missing-opt-in \
  'MIGRATION_VERIFY_ALLOW_FIXTURE=1' \
  PGHOST=/var/run/postgresql \
  PGDATABASE=migration_verify_cron_receipts \
  MIGRATION_VERIFY_ALLOW_FIXTURE=0

expect_guard_rejection \
  remote-host \
  'canonical local PostgreSQL Unix socket' \
  PGHOST=database.example.invalid \
  PGDATABASE=migration_verify_cron_receipts \
  MIGRATION_VERIFY_ALLOW_FIXTURE=1

expect_guard_rejection \
  non-test-database \
  'migration_verify_* naming boundary' \
  PGHOST=/var/run/postgresql \
  PGDATABASE=postgres \
  MIGRATION_VERIFY_ALLOW_FIXTURE=1

echo "cron attempt receipt target safety: $pass_count passed"
