#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/migration-target-safety-test.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

command -v grep >/dev/null 2>&1 || {
  echo "postgres target safety regression requires grep" >&2
  exit 127
}

FAKE_BIN="$TMP_DIR/fake bin"
NO_GREP_BIN="$TMP_DIR/no grep bin"
NO_PYTHON_BIN="$TMP_DIR/no python bin"
ERROR_GREP_BIN="$TMP_DIR/error grep bin"
mkdir -p "$FAKE_BIN" "$NO_GREP_BIN" "$NO_PYTHON_BIN" "$ERROR_GREP_BIN"

for command_name in dirname mktemp rm; do
  ln -s "$(command -v "$command_name")" "$NO_GREP_BIN/$command_name"
done
for command_name in dirname mktemp rm grep; do
  ln -s "$(command -v "$command_name")" "$NO_PYTHON_BIN/$command_name"
done

for command_name in psql; do
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'if [[ -n ${FAKE_PSQL_IDENTITY:-} ]]; then' \
    '  for argument in "$@"; do' \
    '    if [[ $argument == -c ]]; then' \
    '      printf "%s\n" "$FAKE_PSQL_IDENTITY"' \
    '      exit 0' \
    '    fi' \
    '  done' \
    'fi' \
    'printf "%s\n" "$0 $*" >> "$SQL_SENTINEL"' \
    'cat >> "$SQL_SENTINEL"' \
    'exit 99' \
    > "$FAKE_BIN/$command_name"
  chmod +x "$FAKE_BIN/$command_name"
done

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [[ ${1:-} == context && ${2:-} == inspect && -n ${FAKE_DOCKER_CONTEXT_ENDPOINT:-} ]]; then' \
  '  printf "%s\n" "$FAKE_DOCKER_CONTEXT_ENDPOINT"' \
  '  exit 0' \
  'fi' \
  'if [[ ${1:-} == inspect && ${FAKE_DOCKER_INSPECT:-} == 1 ]]; then' \
  '  printf "%s\n" "${FAKE_DOCKER_TEST_LABEL:-}"' \
  '  exit 0' \
  'fi' \
  'printf "%s\n" "$0 $*" >> "$SQL_SENTINEL"' \
  'cat >> "$SQL_SENTINEL"' \
  'exit 99' \
  > "$FAKE_BIN/docker"
chmod +x "$FAKE_BIN/docker"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'exit 2' \
  > "$ERROR_GREP_BIN/grep"
chmod +x "$ERROR_GREP_BIN/grep"

pass_count=0

expect_rejected_before_fixture_sql() {
  local script=$1
  local case_name=$2
  local expected_status=$3
  local expected_message=$4
  shift 4
  local output="$TMP_DIR/${script##*/}-$case_name.out"
  local sentinel="$TMP_DIR/${script##*/}-$case_name.sql"
  local status

  if env \
    PATH="$FAKE_BIN:$PATH" \
    SQL_SENTINEL="$sentinel" \
    PGPORT=5432 \
    PGUSER=synthetic_guard \
    PGPASSWORD=synthetic_guard \
    "$@" \
    /bin/bash "$ROOT/$script" > "$output" 2>&1; then
    echo "$script/$case_name unexpectedly succeeded" >&2
    exit 1
  else
    status=$?
  fi

  if [[ $status -ne $expected_status ]]; then
    echo "$script/$case_name exited $status, expected $expected_status" >&2
    sed -n '1,120p' "$output" >&2
    exit 1
  fi
  if [[ -e "$sentinel" ]]; then
    echo "$script/$case_name reached fixture SQL before rejection" >&2
    sed -n '1,120p' "$sentinel" >&2
    exit 1
  fi
  if ! grep -Fq "$expected_message" "$output"; then
    echo "$script/$case_name did not report the expected safety failure" >&2
    sed -n '1,120p' "$output" >&2
    exit 1
  fi
  pass_count=$((pass_count + 1))
}

for script in \
  scripts/migration/tests/catalog-verification.test.sh \
  scripts/migration/tests/service-verification.test.sh; do
  expect_rejected_before_fixture_sql \
    "$script" missing-opt-in 2 'MIGRATION_VERIFY_ALLOW_FIXTURE=1' \
    PGHOST=/var/run/postgresql PGDATABASE=migration_verify_guard \
    POSTGRES_CONTAINER= MIGRATION_VERIFY_ALLOW_FIXTURE=0

  expect_rejected_before_fixture_sql \
    "$script" remote-host 2 'canonical local PostgreSQL Unix socket' \
    PGHOST=db.example.invalid PGDATABASE=migration_verify_guard \
    POSTGRES_CONTAINER= MIGRATION_VERIFY_ALLOW_FIXTURE=1

  expect_rejected_before_fixture_sql \
    "$script" non-test-database 2 'migration_verify_* naming boundary' \
    PGHOST=/var/run/postgresql PGDATABASE=postgres \
    POSTGRES_CONTAINER= MIGRATION_VERIFY_ALLOW_FIXTURE=1

  expect_rejected_before_fixture_sql \
    "$script" unsafe-container 2 'explicit focus-flow-migration-verify-* test prefix' \
    PGHOST=/var/run/postgresql PGDATABASE=migration_verify_guard \
    POSTGRES_CONTAINER=production-postgres MIGRATION_VERIFY_ALLOW_FIXTURE=1

  expect_rejected_before_fixture_sql \
    "$script" remote-docker-host 2 'refuses non-local DOCKER_HOST' \
    PGHOST=/var/run/postgresql PGDATABASE=migration_verify_guard \
    POSTGRES_CONTAINER=focus-flow-migration-verify-pg17 \
    DOCKER_HOST=tcp://docker.example.invalid:2375 \
    MIGRATION_VERIFY_ALLOW_FIXTURE=1

  expect_rejected_before_fixture_sql \
    "$script" remote-docker-context 2 'not a single local Unix endpoint' \
    PGHOST=/var/run/postgresql PGDATABASE=migration_verify_guard \
    POSTGRES_CONTAINER=focus-flow-migration-verify-pg17 DOCKER_HOST= \
    FAKE_DOCKER_CONTEXT_ENDPOINT=tcp://docker.example.invalid:2375 \
    MIGRATION_VERIFY_ALLOW_FIXTURE=1

  expect_rejected_before_fixture_sql \
    "$script" unlabeled-test-container 2 'lacks required test-only label' \
    PGHOST=/var/run/postgresql PGDATABASE=migration_verify_guard \
    POSTGRES_CONTAINER=focus-flow-migration-verify-pg17 DOCKER_HOST= \
    FAKE_DOCKER_CONTEXT_ENDPOINT=unix:///tmp/synthetic-docker.sock \
    FAKE_DOCKER_INSPECT=1 FAKE_DOCKER_TEST_LABEL= \
    MIGRATION_VERIFY_ALLOW_FIXTURE=1

  expect_rejected_before_fixture_sql \
    "$script" identity-database-mismatch 2 'database identity mismatch' \
    PGHOST=/var/run/postgresql PGDATABASE=migration_verify_guard \
    POSTGRES_CONTAINER= MIGRATION_VERIFY_ALLOW_FIXTURE=1 \
    FAKE_PSQL_IDENTITY='migration_verify_other|17|local-socket'

  expect_rejected_before_fixture_sql \
    "$script" identity-version-mismatch 2 'received major 16' \
    PGHOST=/var/run/postgresql PGDATABASE=migration_verify_guard \
    POSTGRES_CONTAINER= MIGRATION_VERIFY_ALLOW_FIXTURE=1 \
    FAKE_PSQL_IDENTITY='migration_verify_guard|16|local-socket'

  expect_rejected_before_fixture_sql \
    "$script" identity-address-mismatch 2 'did not use its local Unix socket' \
    PGHOST=/var/run/postgresql PGDATABASE=migration_verify_guard \
    POSTGRES_CONTAINER= MIGRATION_VERIFY_ALLOW_FIXTURE=1 \
    FAKE_PSQL_IDENTITY='migration_verify_guard|17|127.0.0.1'

  expect_rejected_before_fixture_sql \
    "$script" missing-assertion-command 127 'missing required command' \
    PATH="$NO_GREP_BIN" \
    PGHOST=/var/run/postgresql PGDATABASE=migration_verify_guard \
    POSTGRES_CONTAINER= MIGRATION_VERIFY_ALLOW_FIXTURE=1 \
    FAKE_PSQL_IDENTITY='migration_verify_guard|17|local-socket'

  expect_rejected_before_fixture_sql \
    "$script" missing-python 127 'missing required command: python3' \
    PATH="$NO_PYTHON_BIN" \
    PGHOST=/var/run/postgresql PGDATABASE=migration_verify_guard \
    POSTGRES_CONTAINER= MIGRATION_VERIFY_ALLOW_FIXTURE=1 \
    FAKE_PSQL_IDENTITY='migration_verify_guard|17|local-socket'
done

assertion_output="$TMP_DIR/assertion-runtime-error.out"
if (
  PATH="$ERROR_GREP_BIN:$PATH"
  source "$ROOT/scripts/migration/tests/lib/postgres-test-safety.sh"
  migration_verify_require_command grep
  migration_verify_assert_absent \
    -Fq synthetic \
    'unexpected match' \
    "$ROOT/scripts/migration/tests/catalog-fixture.sql"
) > "$assertion_output" 2>&1; then
  echo "runtime assertion-command error was incorrectly treated as no-match" >&2
  exit 1
else
  status=$?
fi
if [[ $status -ne 2 ]]; then
  echo "runtime assertion-command error exited $status, expected 2" >&2
  sed -n '1,120p' "$assertion_output" >&2
  exit 1
fi
if ! grep -Fq 'assertion command failed with exit 2' "$assertion_output"; then
  echo "runtime assertion-command error was not reported" >&2
  sed -n '1,120p' "$assertion_output" >&2
  exit 1
fi
pass_count=$((pass_count + 1))

leak_fixture="$TMP_DIR/planted assertion leak.txt"
printf '%s\n' 'PLANTED_ASSERTION_LEAK' > "$leak_fixture"
leak_output="$TMP_DIR/assertion-leak.out"
if (
  source "$ROOT/scripts/migration/tests/lib/postgres-test-safety.sh"
  migration_verify_require_command grep
  migration_verify_assert_absent \
    -Fq PLANTED_ASSERTION_LEAK \
    'planted assertion leak detected' \
    "$leak_fixture"
) > "$leak_output" 2>&1; then
  echo "planted assertion leak was incorrectly accepted" >&2
  exit 1
else
  status=$?
fi
if [[ $status -ne 1 ]]; then
  echo "planted assertion leak exited $status, expected 1" >&2
  sed -n '1,120p' "$leak_output" >&2
  exit 1
fi
if ! grep -Fq 'planted assertion leak detected' "$leak_output"; then
  echo "planted assertion leak was not reported" >&2
  sed -n '1,120p' "$leak_output" >&2
  exit 1
fi
pass_count=$((pass_count + 1))

echo "postgres target safety regression: $pass_count passed"
