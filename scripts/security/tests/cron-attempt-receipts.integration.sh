#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/cron-attempt-receipts.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

source "$ROOT/scripts/migration/tests/lib/postgres-test-safety.sh"

export PGHOST=${PGHOST:-/var/run/postgresql}
export PGPORT=${PGPORT:-5432}
export PGUSER=${PGUSER:-postgres}
export PGPASSWORD=${PGPASSWORD:-postgres}
export PGDATABASE=${PGDATABASE:-migration_verify_cron_receipts}
export PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-5}

MIGRATION="$ROOT/supabase/migrations/20260716160050_add_cron_attempt_receipts.sql"
INDEX_TEMPLATE="$ROOT/scripts/security/create-task-runs-reaper-index-concurrently.sql"
LATE_FAILURE_FIXTURE="$ROOT/scripts/security/tests/fixtures/cron-receipt-late-failure.sql"

migration_verify_require_safe_target
migration_verify_require_command grep
migration_verify_require_file "$MIGRATION"
migration_verify_require_file "$INDEX_TEMPLATE"
migration_verify_require_file "$LATE_FAILURE_FIXTURE"

if [[ -n ${POSTGRES_CONTAINER:-} ]]; then
  migration_verify_require_command docker
  if ! docker_endpoint=$(docker context inspect --format \
    '{{ (index .Endpoints "docker").Host }}'); then
    echo "could not inspect the selected Docker context before fixture setup" >&2
    exit 2
  fi
  migration_verify_validate_docker_endpoint "$docker_endpoint"
  if ! container_test_label=$(docker inspect --format \
    '{{ index .Config.Labels "com.focus-flow.migration-verify" }}' \
    "$POSTGRES_CONTAINER"); then
    echo "could not inspect the PostgreSQL test container before fixture setup" >&2
    exit 2
  fi
  migration_verify_validate_container_label "$container_test_label"
  docker exec "$POSTGRES_CONTAINER" psql --version >/dev/null
else
  migration_verify_require_command psql
fi

psql_fixture() {
  if [[ -n ${POSTGRES_CONTAINER:-} ]]; then
    docker exec -i \
      -e "PGPASSWORD=$PGPASSWORD" \
      "$POSTGRES_CONTAINER" \
      psql -X -q -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$PGDATABASE" "$@"
  else
    psql -X -q -v ON_ERROR_STOP=1 \
      -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  fi
}

if ! target_identity=$(psql_fixture -A -t -F '|' -c \
  "SELECT pg_catalog.current_database(),
          pg_catalog.current_setting('server_version_num')::integer / 10000,
          COALESCE(pg_catalog.inet_server_addr()::text, 'local-socket');"); then
  echo "database identity probe failed before fixture setup" >&2
  exit 2
fi
if [[ -n ${POSTGRES_CONTAINER:-} ]]; then
  migration_verify_validate_identity "$target_identity" container
else
  migration_verify_validate_identity "$target_identity" direct
fi

psql_fixture <<'SQL'
DO $fixture_roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'receipt_unauthorized'
  ) THEN
    CREATE ROLE receipt_unauthorized NOLOGIN;
  END IF;
END
$fixture_roles$;

DROP FUNCTION IF EXISTS public.execute_strategy_task_reaper_attempt(
  uuid, integer, text, text, text
) CASCADE;
DROP FUNCTION IF EXISTS public.read_strategy_task_reaper_receipt(
  uuid, integer, text, text, text
) CASCADE;
DROP FUNCTION IF EXISTS public.cron_receipt_test_task_trigger() CASCADE;
DROP SCHEMA IF EXISTS cron_receipt_private CASCADE;
DROP TABLE IF EXISTS public.task_runs CASCADE;
DROP TABLE IF EXISTS public.cron_receipt_effect_audit CASCADE;

DO $drop_fixture_roles$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'cron_receipt_executor'
  ) THEN
    EXECUTE 'DROP OWNED BY cron_receipt_executor';
    DROP ROLE cron_receipt_executor;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'receipt_fixture_task_owner'
  ) THEN
    EXECUTE 'DROP OWNED BY receipt_fixture_task_owner';
    DROP ROLE receipt_fixture_task_owner;
  END IF;
END
$drop_fixture_roles$;

CREATE ROLE receipt_fixture_task_owner
  NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

CREATE TABLE public.task_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  status text NOT NULL,
  progress_step text,
  error text,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL,
  business_payload text
);

ALTER TABLE public.task_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.cron_receipt_effect_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_run_id uuid NOT NULL
);

CREATE FUNCTION public.cron_receipt_test_task_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $trigger$
BEGIN
  IF pg_catalog.current_setting('cron_receipt_test.sleep', true) = 'on' THEN
    -- The advisory lock is an observer-visible barrier used to prove that the
    -- planted duplicate sessions overlap. It has no production analogue.
    PERFORM pg_catalog.pg_advisory_xact_lock(860716001);
    PERFORM pg_catalog.pg_sleep(4);
  END IF;
  IF pg_catalog.current_setting('cron_receipt_test.fail_task_id', true) = OLD.id::text THEN
    RAISE EXCEPTION USING MESSAGE = 'synthetic_task_dependency_failure';
  END IF;
  INSERT INTO public.cron_receipt_effect_audit (task_run_id) VALUES (OLD.id);
  RETURN NEW;
END
$trigger$;

CREATE TRIGGER cron_receipt_test_task_trigger
BEFORE UPDATE ON public.task_runs
FOR EACH ROW EXECUTE FUNCTION public.cron_receipt_test_task_trigger();

ALTER TABLE public.task_runs OWNER TO receipt_fixture_task_owner;
SQL

assert_receipt_installation_absent() {
  local label=$1
  local observed
  observed=$(psql_fixture -A -t -F '|' -c "
  SELECT
    pg_catalog.to_regnamespace('cron_receipt_private') IS NULL,
    pg_catalog.to_regprocedure(
      'public.execute_strategy_task_reaper_attempt(uuid,integer,text,text,text)'
    ) IS NULL,
    pg_catalog.to_regprocedure(
      'public.read_strategy_task_reaper_receipt(uuid,integer,text,text,text)'
    ) IS NULL,
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = 'cron_receipt_executor'
    );")
  if [[ $observed != 't|t|t|t' ]]; then
    echo "cron receipt integration left a partial installation after $label" >&2
    exit 1
  fi
}

# The receipt migration must fail before creating any receipt object when the
# write-safe index prerequisite has not been prepared.
if psql_fixture -1 -f - < "$MIGRATION" \
  > "$TMP_DIR/missing-index-prerequisite.out" 2>&1; then
  echo "cron receipt integration accepted a missing index prerequisite" >&2
  exit 1
fi
if ! grep -Fq 'cron_receipt_task_runs_index_prerequisite_missing' \
  "$TMP_DIR/missing-index-prerequisite.out"; then
  observed_index_stage=$(grep -Eo 'cron_receipt_[a-z_]+' \
    "$TMP_DIR/missing-index-prerequisite.out" | head -n 1 || true)
  echo "cron receipt integration returned the wrong missing-index failure: ${observed_index_stage:-unclassified}" >&2
  exit 1
fi
assert_receipt_installation_absent "index rejection"

# Exercise the separately reviewed nontransactional concurrent path. The
# production procedure remains blocked pending separate authorization.
if psql_fixture -f - < "$INDEX_TEMPLATE" \
  > "$TMP_DIR/index-missing-authorization.out" 2>&1; then
  echo "cron receipt integration accepted an unauthorized index build" >&2
  exit 1
fi
if ! grep -Fq 'receipt_index_guard_missing_authorization' \
  "$TMP_DIR/index-missing-authorization.out"; then
  echo "cron receipt integration returned the wrong index authorization stage" >&2
  exit 1
fi
if [[ $(psql_fixture -A -t -c "
  SELECT pg_catalog.to_regclass(
    'public.task_runs_pending_updated_at_id_idx'
  ) IS NULL;") != t ]]; then
  echo "cron receipt integration built an index before authorization" >&2
  exit 1
fi

if psql_fixture \
  -v receipt_index_mutation_authorized=YES \
  -v receipt_index_expected_database=wrong_migration_verify_database \
  -v "receipt_index_expected_actor=$PGUSER" \
  -v receipt_index_expected_task_owner=receipt_fixture_task_owner \
  -v receipt_index_expected_server_major=17 \
  -f - < "$INDEX_TEMPLATE" \
  > "$TMP_DIR/index-wrong-identity.out" 2>&1; then
  echo "cron receipt integration accepted a wrong index target identity" >&2
  exit 1
fi
if ! grep -Fq 'receipt_index_guard_identity_rejected' \
  "$TMP_DIR/index-wrong-identity.out"; then
  echo "cron receipt integration returned the wrong index identity stage" >&2
  exit 1
fi

if psql_fixture \
  -v receipt_index_mutation_authorized=YES \
  -v "receipt_index_expected_database=$PGDATABASE" \
  -v "receipt_index_expected_actor=$PGUSER" \
  -v receipt_index_expected_task_owner=receipt_fixture_task_owner \
  -v receipt_index_expected_server_major=18 \
  -f - < "$INDEX_TEMPLATE" \
  > "$TMP_DIR/index-wrong-version.out" 2>&1; then
  echo "cron receipt integration accepted a non-PostgreSQL-17 index target" >&2
  exit 1
fi
if ! grep -Fq 'receipt_index_guard_identity_rejected' \
  "$TMP_DIR/index-wrong-version.out"; then
  echo "cron receipt integration returned the wrong index version stage" >&2
  exit 1
fi

psql_fixture \
  -v receipt_index_mutation_authorized=YES \
  -v "receipt_index_expected_database=$PGDATABASE" \
  -v "receipt_index_expected_actor=$PGUSER" \
  -v receipt_index_expected_task_owner=receipt_fixture_task_owner \
  -v receipt_index_expected_server_major=17 \
  -f - < "$INDEX_TEMPLATE"

# Reject every pre-existing executor role, including one whose flags look safe
# but which already holds a payload-column privilege. This prevents inherited
# ACLs or memberships from being mistaken for the reviewed execution role.
psql_fixture -c "
CREATE ROLE cron_receipt_executor
  NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
GRANT SELECT (business_payload)
  ON public.task_runs TO cron_receipt_executor;
GRANT cron_receipt_executor TO receipt_unauthorized;"
if psql_fixture -1 -f - < "$MIGRATION" \
  > "$TMP_DIR/preexisting-executor.out" 2>&1; then
  echo "cron receipt integration accepted a pre-existing executor role" >&2
  exit 1
fi
if ! grep -Fq 'cron_receipt_executor_role_preexists' \
  "$TMP_DIR/preexisting-executor.out"; then
  echo "cron receipt integration returned the wrong role-precondition stage" >&2
  exit 1
fi
psql_fixture -c "
REVOKE cron_receipt_executor FROM receipt_unauthorized;
DROP OWNED BY cron_receipt_executor;
DROP ROLE cron_receipt_executor;"
assert_receipt_installation_absent "executor-role rejection"

# The receipt migration must be one transaction. A planted failure after its
# final statement rolls back the role, schema, functions, grants, policies,
# and temporary schema CREATE authority together.
if {
  sed -n '1,$p' "$MIGRATION"
  sed -n '1,$p' "$LATE_FAILURE_FIXTURE"
} | psql_fixture -1 -f - \
    > "$TMP_DIR/late-migration-failure.out" 2>&1; then
  echo "cron receipt integration accepted a planted late migration failure" >&2
  exit 1
fi
if ! grep -Fq 'synthetic_late_receipt_migration_failure' \
  "$TMP_DIR/late-migration-failure.out"; then
  echo "cron receipt integration did not reach the planted late failure" >&2
  exit 1
fi
assert_receipt_installation_absent "late transactional rollback"

psql_fixture -1 -f - < "$MIGRATION"

psql_fixture <<'SQL'
CREATE FUNCTION cron_receipt_private.cron_receipt_test_terminal_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $trigger$
BEGIN
  IF pg_catalog.current_setting('cron_receipt_test.fail_terminal', true) = 'on'
    AND OLD.outcome_code = 'in_progress'
    AND NEW.outcome_code <> 'in_progress'
  THEN
    RAISE EXCEPTION USING MESSAGE = 'synthetic_terminal_receipt_failure';
  END IF;
  RETURN NEW;
END
$trigger$;

CREATE TRIGGER cron_receipt_test_terminal_trigger
BEFORE UPDATE ON cron_receipt_private.cron_attempt_receipts
FOR EACH ROW EXECUTE FUNCTION cron_receipt_private.cron_receipt_test_terminal_trigger();
SQL

FINGERPRINT_A=$(printf 'a%.0s' {1..64})
FINGERPRINT_B=$(printf 'b%.0s' {1..64})
PROJECT_REF=odbjjklumdsuqdvkgwyv
ENVIRONMENT=production
USER_ID=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa

run_service_execute() {
  local attempt_id=$1
  local fingerprint=$2
  local output_path=$3
  local prelude=${4:-}
  psql_fixture -A -t -F '|' > "$output_path" <<SQL
SET ROLE service_role;
$prelude
SELECT outcome_code, effect_code, exact_effect_count, terminal,
       identity_consistent, effect_consistent, replayed
FROM public.execute_strategy_task_reaper_attempt(
  '$attempt_id'::uuid,
  1,
  '$ENVIRONMENT',
  '$PROJECT_REF',
  '$fingerprint'
);
SQL
}

run_service_execute_timestamped() {
  local attempt_id=$1
  local fingerprint=$2
  local output_path=$3
  local prelude=${4:-}
  psql_fixture -A -t -F '|' > "$output_path" <<SQL
SET ROLE service_role;
$prelude
SELECT outcome_code, effect_code, exact_effect_count, terminal,
       identity_consistent, effect_consistent, replayed, receipt_at::text
FROM public.execute_strategy_task_reaper_attempt(
  '$attempt_id'::uuid,
  1,
  '$ENVIRONMENT',
  '$PROJECT_REF',
  '$fingerprint'
);
SQL
}

assert_sql_true() {
  local description=$1
  local sql=$2
  local actual
  actual=$(psql_fixture -A -t -c "$sql")
  if [[ $actual != t ]]; then
    echo "cron receipt integration assertion failed: $description" >&2
    exit 1
  fi
}

wait_for_sql_true() {
  local description=$1
  local sql=$2
  local actual
  local attempt
  for attempt in $(seq 1 100); do
    actual=$(psql_fixture -A -t -c "$sql")
    if [[ $actual == t ]]; then
      return 0
    fi
    sleep 0.05
  done
  echo "cron receipt integration timed out: $description" >&2
  exit 1
}

expect_psql_failure() {
  local description=$1
  local output_path=$2
  local sql=$3
  if psql_fixture > "$output_path" 2>&1 <<SQL
$sql
SQL
  then
    echo "cron receipt integration expected rejection: $description" >&2
    exit 1
  fi
}

# Wrapper ownership, SECURITY DEFINER, fixed empty search_path, and ACLs.
assert_sql_true "reviewed wrapper security metadata" "
SELECT count(*) = 2
  AND bool_and(p.prosecdef)
  AND bool_and(p.proconfig = ARRAY['search_path=\"\"']::text[])
  AND bool_and(owner_role.rolname = 'cron_receipt_executor')
  AND bool_and(NOT owner_role.rolsuper)
  AND bool_and(NOT owner_role.rolbypassrls)
  AND bool_and(NOT owner_role.rolcanlogin)
  AND bool_and(NOT owner_role.rolinherit)
  AND bool_and(NOT owner_role.rolcreatedb)
  AND bool_and(NOT owner_role.rolcreaterole)
  AND bool_and(NOT owner_role.rolreplication)
  AND bool_and(p.prolang = (
    SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql'
  ))
  AND bool_and(p.proretset)
  AND bool_and(pg_catalog.pg_get_function_identity_arguments(p.oid) =
    'p_attempt_id uuid, p_protocol_version integer, p_environment text, p_project_ref text, p_request_fingerprint text')
  AND bool_and(CASE p.proname
    WHEN 'execute_strategy_task_reaper_attempt' THEN
      p.provolatile = 'v'
      AND pg_catalog.strpos(
        p.prosrc, 'INSERT INTO cron_receipt_private.cron_attempt_receipts'
      ) > 0
      AND pg_catalog.strpos(p.prosrc, 'UPDATE public.task_runs') > 0
      AND pg_catalog.strpos(
        p.prosrc, 'UPDATE cron_receipt_private.cron_attempt_receipts'
      ) > 0
    WHEN 'read_strategy_task_reaper_receipt' THEN
      p.provolatile = 's'
      AND pg_catalog.strpos(
        p.prosrc, 'FROM cron_receipt_private.cron_attempt_receipts'
      ) > 0
      AND pg_catalog.strpos(p.prosrc, 'UPDATE ') = 0
      AND pg_catalog.strpos(p.prosrc, 'INSERT ') = 0
    ELSE false
  END)
  AND bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
  AND bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
  AND bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  AND bool_and(NOT has_function_privilege(
    'receipt_unauthorized', p.oid, 'EXECUTE'
  ))
  AND bool_and(NOT EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) AS x
    WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE'
  ))
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = p.proowner
WHERE n.nspname = 'public'
  AND p.proname IN (
    'execute_strategy_task_reaper_attempt',
    'read_strategy_task_reaper_receipt'
  );"

assert_sql_true "private owner and direct privilege boundary" "
SELECT
  namespace_owner.rolname = 'postgres'
  AND table_owner.rolname = 'postgres'
  AND c.relrowsecurity
  AND NOT has_schema_privilege('anon', n.oid, 'USAGE')
  AND NOT has_schema_privilege('authenticated', n.oid, 'USAGE')
  AND NOT has_schema_privilege('service_role', n.oid, 'USAGE')
  AND NOT has_table_privilege(
    'anon', 'cron_receipt_private.cron_attempt_receipts', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'cron_receipt_private.cron_attempt_receipts', 'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role', 'cron_receipt_private.cron_attempt_receipts', 'SELECT'
  )
  AND has_table_privilege(
    'cron_receipt_executor',
    'cron_receipt_private.cron_attempt_receipts',
    'SELECT'
  )
  AND has_table_privilege(
    'cron_receipt_executor',
    'cron_receipt_private.cron_attempt_receipts',
    'INSERT'
  )
  AND has_table_privilege(
    'cron_receipt_executor',
    'cron_receipt_private.cron_attempt_receipts',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'cron_receipt_executor',
    'cron_receipt_private.cron_attempt_receipts',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'cron_receipt_executor',
    'cron_receipt_private.cron_attempt_receipts',
    'TRUNCATE'
  )
  AND NOT has_table_privilege(
    'cron_receipt_executor',
    'cron_receipt_private.cron_attempt_receipts',
    'REFERENCES'
  )
  AND NOT has_table_privilege(
    'cron_receipt_executor',
    'cron_receipt_private.cron_attempt_receipts',
    'TRIGGER'
  )
  AND NOT has_table_privilege(
    'cron_receipt_executor',
    'cron_receipt_private.cron_attempt_receipts',
    'MAINTAIN'
  )
FROM pg_catalog.pg_namespace AS n
JOIN pg_catalog.pg_roles AS namespace_owner ON namespace_owner.oid = n.nspowner
JOIN pg_catalog.pg_class AS c ON c.relnamespace = n.oid
JOIN pg_catalog.pg_roles AS table_owner ON table_owner.oid = c.relowner
WHERE n.nspname = 'cron_receipt_private'
  AND c.relname = 'cron_attempt_receipts';"

assert_sql_true "non-superuser task table ACL and RLS boundary" "
SELECT
  task_owner.rolname = 'receipt_fixture_task_owner'
  AND executor.rolname = 'cron_receipt_executor'
  AND task_owner.oid <> executor.oid
  AND NOT executor.rolsuper
  AND NOT executor.rolbypassrls
  AND NOT executor.rolcanlogin
  AND NOT executor.rolinherit
  AND NOT executor.rolcreatedb
  AND NOT executor.rolcreaterole
  AND NOT executor.rolreplication
  AND NOT has_schema_privilege('cron_receipt_executor', 'public', 'CREATE')
  AND NOT has_schema_privilege(
    'cron_receipt_executor', 'cron_receipt_private', 'CREATE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    WHERE membership.roleid = executor.oid
      OR membership.member = executor.oid
  )
  AND task_table.relrowsecurity
  AND NOT has_table_privilege(
    'cron_receipt_executor', 'public.task_runs', 'INSERT'
  )
  AND NOT has_table_privilege(
    'cron_receipt_executor', 'public.task_runs', 'DELETE'
  )
  AND NOT has_table_privilege(
    'cron_receipt_executor', 'public.task_runs', 'TRUNCATE'
  )
  AND NOT has_table_privilege(
    'cron_receipt_executor', 'public.task_runs', 'TRIGGER'
  )
  AND NOT has_table_privilege(
    'cron_receipt_executor', 'public.task_runs', 'REFERENCES'
  )
  AND NOT has_table_privilege(
    'cron_receipt_executor', 'public.task_runs', 'MAINTAIN'
  )
  AND NOT has_any_column_privilege(
    'cron_receipt_executor', 'public.task_runs', 'INSERT'
  )
  AND NOT has_any_column_privilege(
    'cron_receipt_executor', 'public.task_runs', 'REFERENCES'
  )
  AND NOT has_column_privilege(
    'cron_receipt_executor', 'public.task_runs', 'user_id', 'SELECT'
  )
  AND NOT has_column_privilege(
    'cron_receipt_executor', 'public.task_runs', 'business_payload', 'SELECT'
  )
  AND (
    SELECT count(*) = 4
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = task_table.oid
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND has_column_privilege(
        'cron_receipt_executor', task_table.oid, a.attnum, 'SELECT'
      )
  )
  AND (
    SELECT count(*) = 5
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = task_table.oid
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND has_column_privilege(
        'cron_receipt_executor', task_table.oid, a.attnum, 'UPDATE'
      )
  )
  AND (
    SELECT count(*) = 2
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = task_table.oid
      AND policy.polname IN (
        'cron_receipt_executor_task_select',
        'cron_receipt_executor_task_update'
      )
      AND policy.polpermissive
      AND policy.polroles = ARRAY[
        'cron_receipt_executor'::regrole::oid
      ]::oid[]
      AND (
        (policy.polname = 'cron_receipt_executor_task_select'
          AND policy.polcmd = 'r'
          AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) =
            '(status = ANY (ARRAY[''pending''::text, ''failed''::text]))'
          AND policy.polwithcheck IS NULL)
        OR
        (policy.polname = 'cron_receipt_executor_task_update'
          AND policy.polcmd = 'w'
          AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) =
            '(status = ''pending''::text)'
          AND pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) =
            '((status = ''failed''::text) AND '
            || '(progress_step = ''failed''::text) AND '
            || '(error ~~ ''stage_timeout:%''::text) AND '
            || '(completed_at IS NOT NULL))')
      )
  )
FROM pg_catalog.pg_class AS task_table
JOIN pg_catalog.pg_roles AS task_owner ON task_owner.oid = task_table.relowner
CROSS JOIN pg_catalog.pg_roles AS executor
WHERE task_table.oid = 'public.task_runs'::regclass
  AND executor.rolname = 'cron_receipt_executor';"

assert_sql_true "bounded pending-candidate index" "
SELECT
  i.indisvalid
  AND i.indisready
  AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(status = ''pending''::text)'
  AND pg_catalog.pg_get_indexdef(i.indexrelid) LIKE
    '%ON public.task_runs USING btree (updated_at, id)%'
FROM pg_catalog.pg_index AS i
JOIN pg_catalog.pg_class AS index_class ON index_class.oid = i.indexrelid
WHERE index_class.relname = 'task_runs_pending_updated_at_id_idx';"

expect_psql_failure \
  "anon cannot execute" \
  "$TMP_DIR/anon-execute.out" \
  "SET ROLE anon;
   SELECT * FROM public.read_strategy_task_reaper_receipt(
     '10000000-0000-4000-8000-000000000001', 1,
     '$ENVIRONMENT', '$PROJECT_REF', '$FINGERPRINT_A');"
expect_psql_failure \
  "authenticated cannot execute" \
  "$TMP_DIR/authenticated-execute.out" \
  "SET ROLE authenticated;
   SELECT * FROM public.read_strategy_task_reaper_receipt(
     '10000000-0000-4000-8000-000000000001', 1,
     '$ENVIRONMENT', '$PROJECT_REF', '$FINGERPRINT_A');"
expect_psql_failure \
  "service role cannot read private state" \
  "$TMP_DIR/service-private-read.out" \
  "SET ROLE service_role;
   SELECT count(*) FROM cron_receipt_private.cron_attempt_receipts;"
expect_psql_failure \
  "service role cannot mutate private state" \
  "$TMP_DIR/service-private-write.out" \
  "SET ROLE service_role;
   INSERT INTO cron_receipt_private.cron_attempt_receipts VALUES (
     '10000000-0000-4000-8000-000000000001',
     'run-strategy-task-reaper', 1, '$ENVIRONMENT', '$PROJECT_REF',
     '$FINGERPRINT_A', 'in_progress', 'attempt_in_progress', 0,
     clock_timestamp(), NULL
   );"

expect_psql_failure \
  "service role cannot delete private state" \
  "$TMP_DIR/service-private-delete.out" \
  "SET ROLE service_role;
   DELETE FROM cron_receipt_private.cron_attempt_receipts;"
expect_psql_failure \
  "executor cannot delete private state" \
  "$TMP_DIR/executor-private-delete.out" \
  "SET ROLE cron_receipt_executor;
   DELETE FROM cron_receipt_private.cron_attempt_receipts;"
assert_sql_true "active protocol exposes no pruning path" "
SELECT
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'cron_receipt_private')
      AND p.proname LIKE '%prun%receipt%'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid =
      'cron_receipt_private.cron_attempt_receipts'::regclass
      AND policy.polcmd = 'd'
  );"
if grep -Eqi 'cron\.(schedule|schedule_in_database)|DELETE[[:space:]]+FROM[[:space:]]+cron_receipt_private\.cron_attempt_receipts' \
  "$MIGRATION"; then
  echo "cron receipt integration found an active-protocol cleanup path" >&2
  exit 1
fi

# The SECURITY DEFINER owner is intentionally non-superuser and depends only
# on the reviewed task_runs columns. Removing any required SELECT/UPDATE grant
# must become a rollback-proven failure, never a false success or no-op.
privilege_case=0
for privilege_spec in \
  "SELECT:id" \
  "SELECT:status" \
  "SELECT:progress_step" \
  "SELECT:updated_at" \
  "UPDATE:status" \
  "UPDATE:progress_step" \
  "UPDATE:error" \
  "UPDATE:completed_at" \
  "UPDATE:updated_at"; do
  privilege_case=$((privilege_case + 1))
  privilege_type=${privilege_spec%%:*}
  privilege_column=${privilege_spec#*:}
  task_id=$(printf '22000000-0000-4000-8000-%012d' "$privilege_case")
  attempt_id=$(printf '32000000-0000-4000-8000-%012d' "$privilege_case")
  output_path="$TMP_DIR/missing-${privilege_type}-${privilege_column}.out"

  psql_fixture -c "
  INSERT INTO public.task_runs (
    id, user_id, status, progress_step, updated_at, business_payload
  ) VALUES (
    '$task_id', '$USER_ID', 'pending', 'synthesis',
    clock_timestamp() - interval '20 minutes',
    'PLANTED_REQUIRED_PRIVILEGE_SENTINEL'
  );
  REVOKE $privilege_type ($privilege_column)
    ON public.task_runs FROM cron_receipt_executor;"
  run_service_execute "$attempt_id" "$FINGERPRINT_A" "$output_path"
  psql_fixture -c "
  GRANT $privilege_type ($privilege_column)
    ON public.task_runs TO cron_receipt_executor;"

  if ! grep -Fxq \
    'known_failure_rolled_back|execution_rolled_back|0|t|t|t|f' \
    "$output_path"; then
    echo "cron receipt integration privilege removal did not fail closed" >&2
    exit 1
  fi
  assert_sql_true "privilege removal committed no task effect" "
  SELECT
    (SELECT status = 'pending' FROM public.task_runs WHERE id = '$task_id')
    AND NOT EXISTS (
      SELECT 1 FROM public.cron_receipt_effect_audit
      WHERE task_run_id = '$task_id'
    );"
  psql_fixture -c "DELETE FROM public.task_runs WHERE id = '$task_id';"
done

# Broader column-level INSERT/REFERENCES authority is not visible through the
# table-level checks and must also fail the runtime owner contract.
broad_privilege_case=30
for broad_privilege in INSERT REFERENCES; do
  broad_privilege_case=$((broad_privilege_case + 1))
  task_id=$(printf '22000000-0000-4000-8000-%012d' "$broad_privilege_case")
  attempt_id=$(printf '32000000-0000-4000-8000-%012d' "$broad_privilege_case")
  output_path="$TMP_DIR/extra-column-${broad_privilege}.out"
  psql_fixture -c "
  INSERT INTO public.task_runs (
    id, user_id, status, progress_step, updated_at, business_payload
  ) VALUES (
    '$task_id', '$USER_ID', 'pending', 'synthesis',
    clock_timestamp() - interval '20 minutes',
    'PLANTED_BROAD_COLUMN_PRIVILEGE_SENTINEL'
  );
  GRANT $broad_privilege (business_payload)
    ON public.task_runs TO cron_receipt_executor;"
  run_service_execute "$attempt_id" "$FINGERPRINT_A" "$output_path"
  psql_fixture -c "REVOKE $broad_privilege (business_payload)
    ON public.task_runs FROM cron_receipt_executor;"

  if ! grep -Fxq \
    'known_failure_rolled_back|execution_rolled_back|0|t|t|t|f' \
    "$output_path"; then
    echo "cron receipt integration broader column privilege did not fail closed" >&2
    exit 1
  fi
  assert_sql_true "broader column privilege committed no task effect" "
  SELECT
    (SELECT status = 'pending' FROM public.task_runs WHERE id = '$task_id')
    AND NOT EXISTS (
      SELECT 1 FROM public.cron_receipt_effect_audit
      WHERE task_run_id = '$task_id'
    );"
  psql_fixture -c "DELETE FROM public.task_runs WHERE id = '$task_id';"
done

# Membership in either direction violates the fixed NOLOGIN owner identity.
psql_fixture -c "CREATE ROLE receipt_executor_inherited NOLOGIN;"
membership_case=60
for membership_direction in inherits inherited_by; do
  membership_case=$((membership_case + 1))
  task_id=$(printf '22000000-0000-4000-8000-%012d' "$membership_case")
  attempt_id=$(printf '32000000-0000-4000-8000-%012d' "$membership_case")
  output_path="$TMP_DIR/membership-${membership_direction}.out"
  psql_fixture -c "
  INSERT INTO public.task_runs (
    id, user_id, status, progress_step, updated_at, business_payload
  ) VALUES (
    '$task_id', '$USER_ID', 'pending', 'synthesis',
    clock_timestamp() - interval '20 minutes',
    'PLANTED_MEMBERSHIP_SENTINEL'
  );"
  if [[ $membership_direction == inherits ]]; then
    psql_fixture -c "GRANT receipt_executor_inherited TO cron_receipt_executor;"
  else
    psql_fixture -c "GRANT cron_receipt_executor TO receipt_unauthorized;"
  fi
  run_service_execute "$attempt_id" "$FINGERPRINT_A" "$output_path"
  if [[ $membership_direction == inherits ]]; then
    psql_fixture -c "REVOKE receipt_executor_inherited FROM cron_receipt_executor;"
  else
    psql_fixture -c "REVOKE cron_receipt_executor FROM receipt_unauthorized;"
  fi

  if ! grep -Fxq \
    'known_failure_rolled_back|execution_rolled_back|0|t|t|t|f' \
    "$output_path"; then
    echo "cron receipt integration role membership did not fail closed" >&2
    exit 1
  fi
  assert_sql_true "role membership committed no task effect" "
  SELECT
    (SELECT status = 'pending' FROM public.task_runs WHERE id = '$task_id')
    AND NOT EXISTS (
      SELECT 1 FROM public.cron_receipt_effect_audit
      WHERE task_run_id = '$task_id'
    );"
  psql_fixture -c "DELETE FROM public.task_runs WHERE id = '$task_id';"
done
psql_fixture -c "DROP ROLE receipt_executor_inherited;"

# Every capability-bearing owner flag is part of the reviewed role identity.
role_flag_case=70
for role_flag in LOGIN INHERIT CREATEDB CREATEROLE REPLICATION BYPASSRLS SUPERUSER; do
  role_flag_case=$((role_flag_case + 1))
  task_id=$(printf '22000000-0000-4000-8000-%012d' "$role_flag_case")
  attempt_id=$(printf '32000000-0000-4000-8000-%012d' "$role_flag_case")
  output_path="$TMP_DIR/role-flag-${role_flag}.out"
  psql_fixture -c "
  INSERT INTO public.task_runs (
    id, user_id, status, progress_step, updated_at, business_payload
  ) VALUES (
    '$task_id', '$USER_ID', 'pending', 'synthesis',
    clock_timestamp() - interval '20 minutes',
    'PLANTED_ROLE_FLAG_SENTINEL'
  );
  ALTER ROLE cron_receipt_executor $role_flag;"
  run_service_execute "$attempt_id" "$FINGERPRINT_A" "$output_path"
  case $role_flag in
    LOGIN) reset_flag=NOLOGIN ;;
    INHERIT) reset_flag=NOINHERIT ;;
    CREATEDB) reset_flag=NOCREATEDB ;;
    CREATEROLE) reset_flag=NOCREATEROLE ;;
    REPLICATION) reset_flag=NOREPLICATION ;;
    BYPASSRLS) reset_flag=NOBYPASSRLS ;;
    SUPERUSER) reset_flag=NOSUPERUSER ;;
  esac
  psql_fixture -c "ALTER ROLE cron_receipt_executor $reset_flag;"

  if ! grep -Fxq \
    'known_failure_rolled_back|execution_rolled_back|0|t|t|t|f' \
    "$output_path"; then
    echo "cron receipt integration role-flag drift did not fail closed" >&2
    exit 1
  fi
  assert_sql_true "role-flag drift committed no task effect" "
  SELECT
    (SELECT status = 'pending' FROM public.task_runs WHERE id = '$task_id')
    AND NOT EXISTS (
      SELECT 1 FROM public.cron_receipt_effect_audit
      WHERE task_run_id = '$task_id'
    );"
  psql_fixture -c "DELETE FROM public.task_runs WHERE id = '$task_id';"
done

# The private-state privileges and private-schema usage are equally required.
# Their removal must abort the whole statement so neither an initial claim nor
# a business transition can survive without a terminalizable receipt path.
private_privilege_case=40
for private_privilege in SELECT INSERT UPDATE USAGE; do
  private_privilege_case=$((private_privilege_case + 1))
  task_id=$(printf '22000000-0000-4000-8000-%012d' "$private_privilege_case")
  attempt_id=$(printf '32000000-0000-4000-8000-%012d' "$private_privilege_case")
  output_path="$TMP_DIR/missing-private-${private_privilege}.out"
  psql_fixture -c "
  INSERT INTO public.task_runs (
    id, user_id, status, progress_step, updated_at, business_payload
  ) VALUES (
    '$task_id', '$USER_ID', 'pending', 'synthesis',
    clock_timestamp() - interval '20 minutes',
    'PLANTED_PRIVATE_PRIVILEGE_SENTINEL'
  );"
  if [[ $private_privilege == USAGE ]]; then
    psql_fixture -c "REVOKE USAGE ON SCHEMA cron_receipt_private
      FROM cron_receipt_executor;"
  else
    psql_fixture -c "REVOKE $private_privilege
      ON cron_receipt_private.cron_attempt_receipts
      FROM cron_receipt_executor;"
  fi

  if run_service_execute \
    "$attempt_id" "$FINGERPRINT_A" "$output_path" 2>/dev/null; then
    echo "cron receipt integration accepted a missing private privilege" >&2
    exit 1
  fi

  if [[ $private_privilege == USAGE ]]; then
    psql_fixture -c "GRANT USAGE ON SCHEMA cron_receipt_private
      TO cron_receipt_executor;"
  else
    psql_fixture -c "GRANT $private_privilege
      ON cron_receipt_private.cron_attempt_receipts
      TO cron_receipt_executor;"
  fi
  assert_sql_true "private privilege removal rolled back claim and effect" "
  SELECT
    (SELECT status = 'pending' FROM public.task_runs WHERE id = '$task_id')
    AND NOT EXISTS (
      SELECT 1 FROM public.cron_receipt_effect_audit
      WHERE task_run_id = '$task_id'
    )
    AND NOT EXISTS (
      SELECT 1 FROM cron_receipt_private.cron_attempt_receipts
      WHERE attempt_id = '$attempt_id'
    );"
  psql_fixture -c "DELETE FROM public.task_runs WHERE id = '$task_id';"
done

# Extra private-state mutation authority is also a runtime contract failure;
# it cannot silently create an online pruning path.
task_id='22000000-0000-4000-8000-000000000045'
attempt_id='32000000-0000-4000-8000-000000000045'
output_path="$TMP_DIR/extra-private-delete.out"
psql_fixture -c "
INSERT INTO public.task_runs (
  id, user_id, status, progress_step, updated_at, business_payload
) VALUES (
  '$task_id', '$USER_ID', 'pending', 'synthesis',
  clock_timestamp() - interval '20 minutes',
  'PLANTED_PRIVATE_DELETE_SENTINEL'
);
GRANT DELETE ON cron_receipt_private.cron_attempt_receipts
  TO cron_receipt_executor;"
run_service_execute "$attempt_id" "$FINGERPRINT_A" "$output_path"
psql_fixture -c "REVOKE DELETE
  ON cron_receipt_private.cron_attempt_receipts FROM cron_receipt_executor;"
if ! grep -Fxq \
  'known_failure_rolled_back|execution_rolled_back|0|t|t|t|f' \
  "$output_path"; then
  echo "cron receipt integration extra private privilege did not fail closed" >&2
  exit 1
fi
assert_sql_true "extra private privilege committed no task effect" "
SELECT
  (SELECT status = 'pending' FROM public.task_runs WHERE id = '$task_id')
  AND NOT EXISTS (
    SELECT 1 FROM public.cron_receipt_effect_audit
    WHERE task_run_id = '$task_id'
  );"
psql_fixture -c "DELETE FROM public.task_runs WHERE id = '$task_id';"

# Removing either fixed task_runs RLS policy must also fail closed instead of
# turning hidden or non-updatable eligible rows into a legitimate-noop receipt.
policy_case=10
for policy_kind in select update; do
  policy_case=$((policy_case + 1))
  task_id=$(printf '22000000-0000-4000-8000-%012d' "$policy_case")
  attempt_id=$(printf '32000000-0000-4000-8000-%012d' "$policy_case")
  output_path="$TMP_DIR/missing-${policy_kind}-policy.out"

  psql_fixture -c "
  INSERT INTO public.task_runs (
    id, user_id, status, progress_step, updated_at, business_payload
  ) VALUES (
    '$task_id', '$USER_ID', 'pending', 'synthesis',
    clock_timestamp() - interval '20 minutes',
    'PLANTED_REQUIRED_RLS_SENTINEL'
  );
  DROP POLICY cron_receipt_executor_task_${policy_kind} ON public.task_runs;"
  run_service_execute "$attempt_id" "$FINGERPRINT_A" "$output_path"

  if [[ $policy_kind == select ]]; then
    psql_fixture -c "
    CREATE POLICY cron_receipt_executor_task_select
      ON public.task_runs
      FOR SELECT TO cron_receipt_executor
      USING (status IN ('pending', 'failed'));"
  else
    psql_fixture -c "
    CREATE POLICY cron_receipt_executor_task_update
      ON public.task_runs
      FOR UPDATE TO cron_receipt_executor
      USING (status = 'pending')
      WITH CHECK (
        status = 'failed'
        AND progress_step = 'failed'
        AND error LIKE 'stage_timeout:%'
        AND completed_at IS NOT NULL
      );"
  fi

  if ! grep -Fxq \
    'known_failure_rolled_back|execution_rolled_back|0|t|t|t|f' \
    "$output_path"; then
    echo "cron receipt integration missing RLS policy did not fail closed" >&2
    exit 1
  fi
  assert_sql_true "missing RLS policy committed no task effect" "
  SELECT
    (SELECT status = 'pending' FROM public.task_runs WHERE id = '$task_id')
    AND NOT EXISTS (
      SELECT 1 FROM public.cron_receipt_effect_audit
      WHERE task_run_id = '$task_id'
    );"
  psql_fixture -c "DELETE FROM public.task_runs WHERE id = '$task_id';"
done

# Policy definitions are part of the execution identity, not just names.
# Expression, permissiveness, and extra executor/PUBLIC policy drift must
# fail before an eligible row can be mislabeled as a legitimate no-op.
policy_fault_case=20
for policy_fault in \
  select_false \
  update_false \
  select_restrictive \
  extra_executor \
  extra_public_permissive \
  extra_public_restrictive; do
  policy_fault_case=$((policy_fault_case + 1))
  task_id=$(printf '22000000-0000-4000-8000-%012d' "$policy_fault_case")
  attempt_id=$(printf '32000000-0000-4000-8000-%012d' "$policy_fault_case")
  output_path="$TMP_DIR/policy-drift-${policy_fault}.out"

  psql_fixture -c "
  INSERT INTO public.task_runs (
    id, user_id, status, progress_step, updated_at, business_payload
  ) VALUES (
    '$task_id', '$USER_ID', 'pending', 'synthesis',
    clock_timestamp() - interval '20 minutes',
    'PLANTED_POLICY_DRIFT_SENTINEL'
  );"
  case $policy_fault in
    select_false)
      psql_fixture -c "ALTER POLICY cron_receipt_executor_task_select
        ON public.task_runs USING (false);"
      ;;
    update_false)
      psql_fixture -c "ALTER POLICY cron_receipt_executor_task_update
        ON public.task_runs USING (false) WITH CHECK (false);"
      ;;
    select_restrictive)
      psql_fixture -c "
      DROP POLICY cron_receipt_executor_task_select ON public.task_runs;
      CREATE POLICY cron_receipt_executor_task_select
        ON public.task_runs AS RESTRICTIVE
        FOR SELECT TO cron_receipt_executor
        USING (status IN ('pending', 'failed'));"
      ;;
    extra_executor)
      psql_fixture -c "CREATE POLICY cron_receipt_executor_task_extra
        ON public.task_runs FOR SELECT TO cron_receipt_executor USING (true);"
      ;;
    extra_public_permissive)
      psql_fixture -c "CREATE POLICY cron_receipt_public_permissive_extra
        ON public.task_runs FOR SELECT TO PUBLIC USING (true);"
      ;;
    extra_public_restrictive)
      psql_fixture -c "CREATE POLICY cron_receipt_public_restrictive_extra
        ON public.task_runs AS RESTRICTIVE FOR SELECT TO PUBLIC USING (true);"
      ;;
  esac

  run_service_execute "$attempt_id" "$FINGERPRINT_A" "$output_path"

  case $policy_fault in
    select_false)
      psql_fixture -c "ALTER POLICY cron_receipt_executor_task_select
        ON public.task_runs USING (status IN ('pending', 'failed'));"
      ;;
    update_false)
      psql_fixture -c "ALTER POLICY cron_receipt_executor_task_update
        ON public.task_runs
        USING (status = 'pending')
        WITH CHECK (
          status = 'failed'
          AND progress_step = 'failed'
          AND error LIKE 'stage_timeout:%'
          AND completed_at IS NOT NULL
        );"
      ;;
    select_restrictive)
      psql_fixture -c "
      DROP POLICY cron_receipt_executor_task_select ON public.task_runs;
      CREATE POLICY cron_receipt_executor_task_select
        ON public.task_runs
        FOR SELECT TO cron_receipt_executor
        USING (status IN ('pending', 'failed'));"
      ;;
    extra_executor)
      psql_fixture -c "DROP POLICY cron_receipt_executor_task_extra
        ON public.task_runs;"
      ;;
    extra_public_permissive)
      psql_fixture -c "DROP POLICY cron_receipt_public_permissive_extra
        ON public.task_runs;"
      ;;
    extra_public_restrictive)
      psql_fixture -c "DROP POLICY cron_receipt_public_restrictive_extra
        ON public.task_runs;"
      ;;
  esac

  if ! grep -Fxq \
    'known_failure_rolled_back|execution_rolled_back|0|t|t|t|f' \
    "$output_path"; then
    echo "cron receipt integration policy drift did not fail closed" >&2
    exit 1
  fi
  assert_sql_true "policy drift committed no task effect" "
  SELECT
    (SELECT status = 'pending' FROM public.task_runs WHERE id = '$task_id')
    AND NOT EXISTS (
      SELECT 1 FROM public.cron_receipt_effect_audit
      WHERE task_run_id = '$task_id'
    );"
  psql_fixture -c "DELETE FROM public.task_runs WHERE id = '$task_id';"
done

psql_fixture -A -t -F '|' > "$TMP_DIR/absent.out" <<SQL
SET ROLE service_role;
SELECT attempt_present, terminal, outcome_code, effect_code,
       identity_consistent, effect_consistent, replayed
FROM public.read_strategy_task_reaper_receipt(
  '10000000-0000-4000-8000-000000000002', 1,
  '$ENVIRONMENT', '$PROJECT_REF', '$FINGERPRINT_A'
);
SQL
if ! grep -Fxq 'f|f|indeterminate|effect_indeterminate|f|f|f' \
  "$TMP_DIR/absent.out"; then
  echo "cron receipt integration did not return the safe absent representation" >&2
  exit 1
fi

# One stale effect, exact retry, and simulated lost HTTP response recovery.
psql_fixture -c "
INSERT INTO public.task_runs (
  id, user_id, status, progress_step, updated_at, business_payload
) VALUES (
  '20000000-0000-4000-8000-000000000001', '$USER_ID', 'pending',
  'PLANTED_ROW_PAYLOAD_SENTINEL', clock_timestamp() - interval '20 minutes',
  'PLANTED_CREDENTIAL_PATH_SQL_ERROR_SENTINEL'
);"
run_service_execute_timestamped \
  30000000-0000-4000-8000-000000000001 \
  "$FINGERPRINT_A" \
  "$TMP_DIR/applied.out"
if ! grep -Eq \
  '^applied_success\|stale_pending_runs_reaped\|1\|t\|t\|t\|f\|[^|]+$' \
  "$TMP_DIR/applied.out"; then
  echo "cron receipt integration did not return the applied terminal receipt" >&2
  exit 1
fi
applied_receipt_at=$(awk -F '|' '{print $8}' "$TMP_DIR/applied.out")
run_service_execute_timestamped \
  30000000-0000-4000-8000-000000000001 \
  "$FINGERPRINT_A" \
  "$TMP_DIR/retry-after-lost-response.out"
if ! grep -Eq \
  '^applied_success\|stale_pending_runs_reaped\|1\|t\|t\|t\|t\|[^|]+$' \
  "$TMP_DIR/retry-after-lost-response.out"; then
  echo "cron receipt integration did not replay the durable terminal receipt" >&2
  exit 1
fi
replayed_receipt_at=$(awk -F '|' '{print $8}' \
  "$TMP_DIR/retry-after-lost-response.out")
if [[ -z $applied_receipt_at || $replayed_receipt_at != "$applied_receipt_at" ]]; then
  echo "cron receipt integration replay changed the durable receipt identity" >&2
  exit 1
fi
assert_sql_true "exact retry produced one effect" \
  "SELECT count(*) = 1 FROM public.cron_receipt_effect_audit;"

# A changed fingerprint under the same attempt identity fails closed.
expect_psql_failure \
  "conflicting fingerprint" \
  "$TMP_DIR/conflicting-fingerprint.out" \
  "SET ROLE service_role;
   SELECT * FROM public.execute_strategy_task_reaper_attempt(
     '30000000-0000-4000-8000-000000000001', 1,
     '$ENVIRONMENT', '$PROJECT_REF', '$FINGERPRINT_B');"
assert_sql_true "conflict did not create another effect" \
  "SELECT count(*) = 1 FROM public.cron_receipt_effect_audit;"

# The global attempt identity cannot be reused across receiver slugs.
psql_fixture -c "
INSERT INTO cron_receipt_private.cron_attempt_receipts (
  attempt_id, receiver, protocol_version, environment, project_ref,
  request_fingerprint, outcome_code, effect_code, exact_effect_count,
  created_at, receipt_at
) VALUES (
  '30000000-0000-4000-8000-000000000009',
  'daily-digest', 1, '$ENVIRONMENT', '$PROJECT_REF', '$FINGERPRINT_A',
  'in_progress', 'attempt_in_progress', 0, clock_timestamp(), NULL
);"
expect_psql_failure \
  "conflicting receiver" \
  "$TMP_DIR/conflicting-receiver.out" \
  "SET ROLE service_role;
   SELECT * FROM public.execute_strategy_task_reaper_attempt(
     '30000000-0000-4000-8000-000000000009', 1,
     '$ENVIRONMENT', '$PROJECT_REF', '$FINGERPRINT_A');"
assert_sql_true "receiver conflict retained its original identity" "
SELECT receiver = 'daily-digest' AND outcome_code = 'in_progress'
FROM cron_receipt_private.cron_attempt_receipts
WHERE attempt_id = '30000000-0000-4000-8000-000000000009';"

# No eligible row is a terminal, distinguishable legitimate no-op.
run_service_execute \
  30000000-0000-4000-8000-000000000002 \
  "$FINGERPRINT_A" \
  "$TMP_DIR/noop.out"
if ! grep -Fxq \
  'legitimate_noop|no_eligible_stale_pending_runs|0|t|t|t|f' \
  "$TMP_DIR/noop.out"; then
  echo "cron receipt integration did not return the legitimate no-op receipt" >&2
  exit 1
fi

# Preserve the audited watchdog predicates and class-specific error semantics.
psql_fixture <<SQL
INSERT INTO public.task_runs (
  id, user_id, status, progress_step, updated_at, business_payload
) VALUES
  ('21000000-0000-4000-8000-000000000001', '$USER_ID', 'pending',
   'synthesis:phase_2', clock_timestamp() - interval '6 minutes 5 seconds', 'x'),
  ('21000000-0000-4000-8000-000000000002', '$USER_ID', 'pending',
   'document_authoring:batch_2', clock_timestamp() - interval '9 minutes 5 seconds', 'x'),
  ('21000000-0000-4000-8000-000000000003', '$USER_ID', 'pending',
   'other_stage', clock_timestamp() - interval '7 minutes 5 seconds', 'x'),
  ('21000000-0000-4000-8000-000000000004', '$USER_ID', 'pending',
   NULL, clock_timestamp() - interval '7 minutes 5 seconds', 'x'),
  ('21000000-0000-4000-8000-000000000005', '$USER_ID', 'pending',
   'synthesis:still_live', clock_timestamp() - interval '5 minutes 30 seconds', 'x'),
  ('21000000-0000-4000-8000-000000000006', '$USER_ID', 'pending',
   'document_authoring:still_live', clock_timestamp() - interval '8 minutes 30 seconds', 'x'),
  ('21000000-0000-4000-8000-000000000007', '$USER_ID', 'pending',
   'other_stage', clock_timestamp() - interval '6 minutes 30 seconds', 'x'),
  ('21000000-0000-4000-8000-000000000008', '$USER_ID', 'pending',
   NULL, clock_timestamp() - interval '6 minutes 30 seconds', 'x');
SQL
run_service_execute \
  30000000-0000-4000-8000-00000000000a \
  "$FINGERPRINT_A" \
  "$TMP_DIR/predicate-parity.out"
if ! grep -Fxq \
  'applied_success|stale_pending_runs_reaped|4|t|t|t|f' \
  "$TMP_DIR/predicate-parity.out"; then
  echo "cron receipt integration watchdog predicate parity failed" >&2
  exit 1
fi
assert_sql_true "watchdog predicate and message parity" "
SELECT
  (SELECT count(*) = 2 FROM public.task_runs
   WHERE id IN (
     '21000000-0000-4000-8000-000000000001',
     '21000000-0000-4000-8000-000000000002'
   )
     AND status = 'failed'
     AND error LIKE 'stage_timeout:% (no progress for %s)')
  AND
  (SELECT count(*) = 2 FROM public.task_runs
   WHERE id IN (
     '21000000-0000-4000-8000-000000000003',
     '21000000-0000-4000-8000-000000000004'
   )
     AND status = 'failed'
     AND error LIKE 'stage_timeout:% (generic pending watchdog after %s)')
  AND
  (SELECT count(*) = 4 FROM public.task_runs
   WHERE id IN (
     '21000000-0000-4000-8000-000000000005',
     '21000000-0000-4000-8000-000000000006',
     '21000000-0000-4000-8000-000000000007',
     '21000000-0000-4000-8000-000000000008'
   ) AND status = 'pending');"
psql_fixture -c "DELETE FROM public.task_runs
WHERE id BETWEEN
  '21000000-0000-4000-8000-000000000001'::uuid
  AND '21000000-0000-4000-8000-000000000008'::uuid;"

# A committed nonterminal claim remains visibly nonterminal and cannot pass.
psql_fixture -c "
INSERT INTO cron_receipt_private.cron_attempt_receipts (
  attempt_id, receiver, protocol_version, environment, project_ref,
  request_fingerprint, outcome_code, effect_code, exact_effect_count,
  created_at, receipt_at
) VALUES (
  '30000000-0000-4000-8000-000000000003',
  'run-strategy-task-reaper', 1, '$ENVIRONMENT', '$PROJECT_REF',
  '$FINGERPRINT_A', 'in_progress', 'attempt_in_progress', 0,
  clock_timestamp() - interval '1 hour', NULL
);"
psql_fixture -A -t -F '|' > "$TMP_DIR/in-progress.out" <<SQL
SET ROLE service_role;
SELECT attempt_present, terminal, outcome_code, effect_code,
       identity_consistent, effect_consistent
FROM public.read_strategy_task_reaper_receipt(
  '30000000-0000-4000-8000-000000000003', 1,
  '$ENVIRONMENT', '$PROJECT_REF', '$FINGERPRINT_A'
);
SQL
if ! grep -Fxq 't|f|in_progress|attempt_in_progress|t|t' \
  "$TMP_DIR/in-progress.out"; then
  echo "cron receipt integration did not preserve nonterminal visibility" >&2
  exit 1
fi

# Concurrent identical delivery blocks on the attempt key and applies once.
psql_fixture <<SQL
TRUNCATE public.cron_receipt_effect_audit;
INSERT INTO public.task_runs (
  id, user_id, status, progress_step, updated_at, business_payload
) VALUES (
  '20000000-0000-4000-8000-000000000002', '$USER_ID', 'pending',
  'synthesis', clock_timestamp() - interval '20 minutes',
  'PLANTED_CONCURRENT_PAYLOAD_SENTINEL'
);
SQL
run_service_execute_timestamped \
  30000000-0000-4000-8000-000000000004 \
  "$FINGERPRINT_A" \
  "$TMP_DIR/concurrent-a.out" \
  "SET application_name = 'cron_receipt_concurrent_first';
   SET cron_receipt_test.sleep = 'on';" &
concurrent_a_pid=$!
wait_for_sql_true "first duplicate did not enter the planted business effect" "
SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_stat_activity AS a
  JOIN pg_catalog.pg_locks AS l ON l.pid = a.pid
  WHERE a.application_name = 'cron_receipt_concurrent_first'
    AND l.locktype = 'advisory'
    AND l.granted
);"
run_service_execute_timestamped \
  30000000-0000-4000-8000-000000000004 \
  "$FINGERPRINT_A" \
  "$TMP_DIR/concurrent-b.out" \
  "SET application_name = 'cron_receipt_concurrent_second';" &
concurrent_b_pid=$!
wait_for_sql_true "second duplicate did not block while the first was active" "
SELECT
  count(*) = 2
  AND bool_or(
    application_name = 'cron_receipt_concurrent_first'
    AND state = 'active'
  )
  AND bool_or(
    application_name = 'cron_receipt_concurrent_second'
    AND state = 'active'
    AND wait_event_type = 'Lock'
  )
FROM pg_catalog.pg_stat_activity
WHERE application_name IN (
  'cron_receipt_concurrent_first',
  'cron_receipt_concurrent_second'
);"
wait "$concurrent_a_pid"
wait "$concurrent_b_pid"
assert_sql_true "concurrent duplicate produced one effect" \
  "SELECT count(*) = 1 FROM public.cron_receipt_effect_audit;"
concurrent_original_count=0
concurrent_replay_count=0
for concurrent_output in \
  "$TMP_DIR/concurrent-a.out" \
  "$TMP_DIR/concurrent-b.out"; do
  if grep -Eq \
    '^applied_success\|stale_pending_runs_reaped\|1\|t\|t\|t\|f\|[^|]+$' \
    "$concurrent_output"; then
    concurrent_original_count=$((concurrent_original_count + 1))
  fi
  if grep -Eq \
    '^applied_success\|stale_pending_runs_reaped\|1\|t\|t\|t\|t\|[^|]+$' \
    "$concurrent_output"; then
    concurrent_replay_count=$((concurrent_replay_count + 1))
  fi
done
if [[ $concurrent_original_count -ne 1 ]]; then
  echo "cron receipt integration expected one original concurrent result" >&2
  exit 1
fi
if [[ $concurrent_replay_count -ne 1 ]]; then
  echo "cron receipt integration expected one replayed concurrent result" >&2
  exit 1
fi
concurrent_a_receipt_at=$(awk -F '|' '{print $8}' "$TMP_DIR/concurrent-a.out")
concurrent_b_receipt_at=$(awk -F '|' '{print $8}' "$TMP_DIR/concurrent-b.out")
if [[ -z $concurrent_a_receipt_at || \
  $concurrent_b_receipt_at != "$concurrent_a_receipt_at" ]]; then
  echo "cron receipt integration concurrent replay changed the receipt" >&2
  exit 1
fi

# Two distinct attempts targeting the same eligible row serialize on the
# business row: exactly one transition succeeds and the other commits a
# legitimate no-op. Neither result is a replay of the other attempt identity.
psql_fixture <<SQL
TRUNCATE public.cron_receipt_effect_audit;
INSERT INTO public.task_runs (
  id, user_id, status, progress_step, updated_at, business_payload
) VALUES (
  '20000000-0000-4000-8000-00000000000b', '$USER_ID', 'pending',
  'synthesis', clock_timestamp() - interval '20 minutes',
  'PLANTED_DISTINCT_ATTEMPT_RACE_SENTINEL'
);
SQL
run_service_execute_timestamped \
  30000000-0000-4000-8000-00000000000b \
  "$FINGERPRINT_A" \
  "$TMP_DIR/distinct-race-a.out" \
  "SET application_name = 'cron_receipt_distinct_first';
   SET cron_receipt_test.sleep = 'on';" &
distinct_a_pid=$!
wait_for_sql_true "first distinct attempt did not enter the planted effect" "
SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_stat_activity AS a
  JOIN pg_catalog.pg_locks AS l ON l.pid = a.pid
  WHERE a.application_name = 'cron_receipt_distinct_first'
    AND l.locktype = 'advisory'
    AND l.granted
);"
run_service_execute_timestamped \
  30000000-0000-4000-8000-00000000000c \
  "$FINGERPRINT_A" \
  "$TMP_DIR/distinct-race-b.out" \
  "SET application_name = 'cron_receipt_distinct_second';" &
distinct_b_pid=$!
wait_for_sql_true "second distinct attempt did not wait on the business row" "
SELECT
  count(*) = 2
  AND bool_or(
    application_name = 'cron_receipt_distinct_first'
    AND state = 'active'
  )
  AND bool_or(
    application_name = 'cron_receipt_distinct_second'
    AND state = 'active'
    AND wait_event_type = 'Lock'
  )
FROM pg_catalog.pg_stat_activity
WHERE application_name IN (
  'cron_receipt_distinct_first',
  'cron_receipt_distinct_second'
);"
wait "$distinct_a_pid"
wait "$distinct_b_pid"

distinct_applied_count=0
distinct_noop_count=0
for distinct_output in \
  "$TMP_DIR/distinct-race-a.out" \
  "$TMP_DIR/distinct-race-b.out"; do
  if grep -Eq \
    '^applied_success\|stale_pending_runs_reaped\|1\|t\|t\|t\|f\|[^|]+$' \
    "$distinct_output"; then
    distinct_applied_count=$((distinct_applied_count + 1))
  fi
  if grep -Eq \
    '^legitimate_noop\|no_eligible_stale_pending_runs\|0\|t\|t\|t\|f\|[^|]+$' \
    "$distinct_output"; then
    distinct_noop_count=$((distinct_noop_count + 1))
  fi
done
if [[ $distinct_applied_count -ne 1 || $distinct_noop_count -ne 1 ]]; then
  echo "cron receipt integration distinct attempts lacked exact success/no-op split" >&2
  exit 1
fi
assert_sql_true "distinct attempts produced one exact business transition" "
SELECT
  (SELECT count(*) = 1 FROM public.cron_receipt_effect_audit
   WHERE task_run_id = '20000000-0000-4000-8000-00000000000b')
  AND
  (SELECT status = 'failed' FROM public.task_runs
   WHERE id = '20000000-0000-4000-8000-00000000000b')
  AND
  (SELECT count(*) = 2
   AND count(*) FILTER (
     WHERE outcome_code = 'applied_success'
       AND effect_code = 'stale_pending_runs_reaped'
       AND exact_effect_count = 1
   ) = 1
   AND count(*) FILTER (
     WHERE outcome_code = 'legitimate_noop'
       AND effect_code = 'no_eligible_stale_pending_runs'
       AND exact_effect_count = 0
   ) = 1
   FROM cron_receipt_private.cron_attempt_receipts
   WHERE attempt_id IN (
     '30000000-0000-4000-8000-00000000000b',
     '30000000-0000-4000-8000-00000000000c'
   ));"

# Failure after the row effect but before terminal receipt publication rolls
# back both the row update and the initial in-progress insert.
psql_fixture -c "
INSERT INTO public.task_runs (
  id, user_id, status, progress_step, updated_at, business_payload
) VALUES (
  '20000000-0000-4000-8000-000000000003', '$USER_ID', 'pending',
  'synthesis', clock_timestamp() - interval '20 minutes',
  'PLANTED_EFFECT_RECEIPT_GAP_SENTINEL'
);"
expect_psql_failure \
  "terminal receipt trigger rollback" \
  "$TMP_DIR/terminal-trigger-failure.out" \
  "BEGIN;
   SET LOCAL cron_receipt_test.fail_terminal = 'on';
   SET ROLE service_role;
   SELECT * FROM public.execute_strategy_task_reaper_attempt(
     '30000000-0000-4000-8000-000000000005', 1,
     '$ENVIRONMENT', '$PROJECT_REF', '$FINGERPRINT_A');
   COMMIT;"
assert_sql_true "terminal failure rolled back effect and receipt" "
SELECT
  (SELECT status = 'pending' FROM public.task_runs
   WHERE id = '20000000-0000-4000-8000-000000000003')
  AND NOT EXISTS (
    SELECT 1 FROM cron_receipt_private.cron_attempt_receipts
    WHERE attempt_id = '30000000-0000-4000-8000-000000000005'
  );"

# A partial dependency failure in a multi-row batch rolls back every effect
# before committing one fixed known-failure receipt. It cannot be mistaken for
# success and a retry reads the same durable rollback proof.
psql_fixture <<SQL
INSERT INTO public.task_runs (
  id, user_id, status, progress_step, updated_at, business_payload
) VALUES
  (
    '20000000-0000-4000-8000-000000000004', '$USER_ID', 'pending',
    'synthesis', clock_timestamp() - interval '20 minutes',
    'PLANTED_PARTIAL_DEPENDENCY_SENTINEL_A'
  ),
  (
    '20000000-0000-4000-8000-000000000005', '$USER_ID', 'pending',
    'synthesis', clock_timestamp() - interval '20 minutes',
    'PLANTED_PARTIAL_DEPENDENCY_SENTINEL_B'
  );
SQL
run_service_execute_timestamped \
  30000000-0000-4000-8000-000000000006 \
  "$FINGERPRINT_A" \
  "$TMP_DIR/partial-dependency-failure.out" \
  "SET cron_receipt_test.fail_task_id =
     '20000000-0000-4000-8000-000000000005';"
if ! grep -Eq \
  '^known_failure_rolled_back\|execution_rolled_back\|0\|t\|t\|t\|f\|[^|]+$' \
  "$TMP_DIR/partial-dependency-failure.out"; then
  echo "cron receipt integration lacked the durable rollback receipt" >&2
  exit 1
fi
failure_receipt_at=$(awk -F '|' '{print $8}' \
  "$TMP_DIR/partial-dependency-failure.out")
run_service_execute_timestamped \
  30000000-0000-4000-8000-000000000006 \
  "$FINGERPRINT_A" \
  "$TMP_DIR/partial-dependency-retry.out"
if ! grep -Eq \
  '^known_failure_rolled_back\|execution_rolled_back\|0\|t\|t\|t\|t\|[^|]+$' \
  "$TMP_DIR/partial-dependency-retry.out"; then
  echo "cron receipt integration did not replay the rollback receipt" >&2
  exit 1
fi
replayed_failure_receipt_at=$(awk -F '|' '{print $8}' \
  "$TMP_DIR/partial-dependency-retry.out")
if [[ -z $failure_receipt_at || $replayed_failure_receipt_at != "$failure_receipt_at" ]]; then
  echo "cron receipt integration replay changed the rollback receipt" >&2
  exit 1
fi
assert_sql_true "partial dependency failure committed only rollback proof" "
SELECT
  (SELECT count(*) = 2 FROM public.task_runs
   WHERE id IN (
     '20000000-0000-4000-8000-000000000004',
     '20000000-0000-4000-8000-000000000005'
   ) AND status = 'pending')
  AND EXISTS (
    SELECT 1 FROM cron_receipt_private.cron_attempt_receipts
    WHERE attempt_id = '30000000-0000-4000-8000-000000000006'
      AND outcome_code = 'known_failure_rolled_back'
      AND effect_code = 'execution_rolled_back'
      AND exact_effect_count = 0
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.cron_receipt_effect_audit
    WHERE task_run_id IN (
      '20000000-0000-4000-8000-000000000004',
      '20000000-0000-4000-8000-000000000005'
    )
  );"

# An explicit caller rollback models a crash before commit: no receipt or
# business effect becomes durable.
psql_fixture -c "
INSERT INTO public.task_runs (
  id, user_id, status, progress_step, updated_at, business_payload
) VALUES (
  '20000000-0000-4000-8000-000000000006', '$USER_ID', 'pending',
  'synthesis', clock_timestamp() - interval '20 minutes',
  'PLANTED_PRECOMMIT_CRASH_SENTINEL'
);"
psql_fixture > "$TMP_DIR/precommit-rollback.out" <<SQL
BEGIN;
SET ROLE service_role;
SELECT outcome_code FROM public.execute_strategy_task_reaper_attempt(
  '30000000-0000-4000-8000-000000000007', 1,
  '$ENVIRONMENT', '$PROJECT_REF', '$FINGERPRINT_A'
);
ROLLBACK;
SQL
assert_sql_true "precommit rollback left no success or effect" "
SELECT
  (SELECT status = 'pending' FROM public.task_runs
   WHERE id = '20000000-0000-4000-8000-000000000006')
  AND NOT EXISTS (
    SELECT 1 FROM cron_receipt_private.cron_attempt_receipts
    WHERE attempt_id = '30000000-0000-4000-8000-000000000007'
  );"

# Malformed identity dimensions fail before any receipt or business effect.
invalid_case_number=0
for invalid_case in \
  "2, '$ENVIRONMENT', '$PROJECT_REF', '$FINGERPRINT_A'" \
  "1, 'unknown', '$PROJECT_REF', '$FINGERPRINT_A'" \
  "1, '$ENVIRONMENT', 'uujkmcbqavsmzhnbqvmm', '$FINGERPRINT_A'" \
  "1, '$ENVIRONMENT', '$PROJECT_REF', 'not-a-fingerprint'"; do
  invalid_case_number=$((invalid_case_number + 1))
  expect_psql_failure \
    "invalid attempt identity" \
    "$TMP_DIR/invalid-identity-${invalid_case_number}.out" \
    "SET ROLE service_role;
     SELECT * FROM public.execute_strategy_task_reaper_attempt(
       '30000000-0000-4000-8000-000000000008', $invalid_case);"
done
assert_sql_true "invalid identities persisted no receipt" \
  "SELECT NOT EXISTS (
     SELECT 1 FROM cron_receipt_private.cron_attempt_receipts
     WHERE attempt_id = '30000000-0000-4000-8000-000000000008'
   );"

migration_verify_assert_absent \
  -Eq 'PLANTED_[A-Z0-9_]*SENTINEL' \
  "cron receipt integration leaked planted material" \
  "$TMP_DIR"/*.out

echo "cron attempt receipt PostgreSQL 17 integration: PASS"
