\set ON_ERROR_STOP on

-- REPOSITORY TEMPLATE ONLY. This file is deliberately outside
-- supabase/migrations and must not be consumed by an ordinary Lovable or
-- Supabase migration runner. It requires a separately authorized hosted
-- PostgreSQL 17 execution, an externally pre-provisioned exact executor role,
-- a reviewed all-file transaction, and empirical proof that the execution
-- actor can transfer function ownership without leaving a membership edge.
-- It never creates, alters, grants, or revokes a role or role membership.
-- Missing bindings deliberately fail before any receipt object is created.
\if :{?receipt_install_mutation_authorized}
\else
  SELECT 'receipt_install_guard_missing_authorization'::integer;
\endif
\if :{?receipt_install_expected_database}
\else
  SELECT 'receipt_install_guard_missing_database'::integer;
\endif
\if :{?receipt_install_expected_actor}
\else
  SELECT 'receipt_install_guard_missing_actor'::integer;
\endif
\if :{?receipt_install_expected_task_owner}
\else
  SELECT 'receipt_install_guard_missing_task_owner'::integer;
\endif
\if :{?receipt_install_expected_server_major}
\else
  SELECT 'receipt_install_guard_missing_server_major'::integer;
\endif
\if :{?receipt_install_expected_executor_oid}
\else
  SELECT 'receipt_install_guard_missing_executor_oid'::integer;
\endif

-- psql does not interpolate variables inside dollar-quoted PL/pgSQL bodies.
-- Bind the already-validated, non-secret execution expectations into this
-- session once, then read the same request-local values from every guard.
SELECT pg_catalog.set_config(
  'cron_receipt.install_mutation_authorized',
  :'receipt_install_mutation_authorized',
  false
);
SELECT pg_catalog.set_config(
  'cron_receipt.install_expected_database',
  :'receipt_install_expected_database',
  false
);
SELECT pg_catalog.set_config(
  'cron_receipt.install_expected_actor',
  :'receipt_install_expected_actor',
  false
);
SELECT pg_catalog.set_config(
  'cron_receipt.install_expected_task_owner',
  :'receipt_install_expected_task_owner',
  false
);
SELECT pg_catalog.set_config(
  'cron_receipt.install_expected_server_major',
  :'receipt_install_expected_server_major',
  false
);
SELECT pg_catalog.set_config(
  'cron_receipt.install_expected_executor_oid',
  :'receipt_install_expected_executor_oid',
  false
);

BEGIN;

-- Durable, attempt-bound application receipts for reviewed cron receivers.
--
-- The private table contains correlation metadata only. It deliberately does
-- not store credentials, request/response bodies, business-row identifiers,
-- model material, or error text. The first atomic receiver is the stale task
-- reaper: its bounded set-based update and terminal receipt are one database
-- transaction because a PostgreSQL function call is one statement.

-- This installer deliberately does not build an index on public.task_runs.
-- A routine transactional CREATE INDEX would block writes. The separately
-- authorized/rehearsed concurrent-index procedure must first provide one
-- valid, ready, exact index; otherwise this installer fails before creating
-- receipt objects.
DO $index_prerequisite$
DECLARE
  v_task_runs regclass := pg_catalog.to_regclass('public.task_runs');
  v_index_ready boolean;
  v_rls_enabled boolean;
BEGIN
  IF v_task_runs IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'cron_receipt_task_runs_missing';
  END IF;

  SELECT c.relrowsecurity
  INTO v_rls_enabled
  FROM pg_catalog.pg_class AS c
  WHERE c.oid = v_task_runs;

  SELECT pg_catalog.bool_or(
    i.indisvalid
    AND i.indisready
    AND i.indislive
    AND NOT i.indisunique
    AND NOT i.indisexclusion
    AND i.indnkeyatts = 2
    AND i.indnatts = 2
    AND am.amname = 'btree'
    AND pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) = 'updated_at'
    AND pg_catalog.pg_get_indexdef(i.indexrelid, 2, true) = 'id'
    AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) =
      '(status = ''pending''::text)'
  )
  INTO v_index_ready
  FROM pg_catalog.pg_index AS i
  JOIN pg_catalog.pg_class AS index_class ON index_class.oid = i.indexrelid
  JOIN pg_catalog.pg_am AS am ON am.oid = index_class.relam
  WHERE i.indrelid = v_task_runs;

  IF v_rls_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'cron_receipt_task_runs_rls_missing';
  END IF;

  IF v_index_ready IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'cron_receipt_task_runs_index_prerequisite_missing';
  END IF;
END
$index_prerequisite$;

DO $executor_precondition$
DECLARE
  v_executor_oid oid;
  v_task_owner text;
  v_acl_reference_count bigint;
  v_owned_dependency_count bigint;
BEGIN
  IF pg_catalog.current_setting(
      'cron_receipt.install_mutation_authorized'
    ) <> 'YES'
    OR pg_catalog.current_setting(
      'cron_receipt.install_expected_server_major'
    ) <> '17'
    OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17
    OR pg_catalog.current_database() <> pg_catalog.current_setting(
      'cron_receipt.install_expected_database'
    )
    OR current_user <> pg_catalog.current_setting(
      'cron_receipt.install_expected_actor'
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'receipt_install_guard_identity_rejected';
  END IF;

  SELECT task_owner.rolname
  INTO v_task_owner
  FROM pg_catalog.pg_class AS task_table
  JOIN pg_catalog.pg_roles AS task_owner ON task_owner.oid = task_table.relowner
  WHERE task_table.oid = pg_catalog.to_regclass('public.task_runs');

  IF v_task_owner IS DISTINCT FROM pg_catalog.current_setting(
    'cron_receipt.install_expected_task_owner'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'receipt_install_guard_task_owner_rejected';
  END IF;

  SELECT auth.oid
  INTO v_executor_oid
  FROM pg_catalog.pg_authid AS auth
  WHERE auth.rolname = 'cron_receipt_executor'
    AND NOT auth.rolsuper
    AND NOT auth.rolinherit
    AND NOT auth.rolcreaterole
    AND NOT auth.rolcreatedb
    AND NOT auth.rolcanlogin
    AND NOT auth.rolreplication
    AND NOT auth.rolbypassrls
    AND auth.rolconnlimit = -1
    AND auth.rolpassword IS NULL
    AND auth.rolvaliduntil IS NULL;

  IF v_executor_oid IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = 'cron_receipt_executor'
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'cron_receipt_executor_precondition_rejected';
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'cron_receipt_executor_missing';
  END IF;

  IF v_executor_oid::text <> pg_catalog.current_setting(
      'cron_receipt.install_expected_executor_oid'
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_db_role_setting AS setting
      WHERE setting.setrole = v_executor_oid
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      WHERE membership.roleid = v_executor_oid
        OR membership.member = v_executor_oid
        OR membership.grantor = v_executor_oid
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_default_acl AS defaults
      CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
      WHERE defaults.defaclrole = v_executor_oid
        OR acl.grantee = v_executor_oid
        OR acl.grantor = v_executor_oid
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'cron_receipt_executor_precondition_rejected';
  END IF;

  -- A pre-provisioned executor must begin with no ownership dependency and no
  -- direct ACL grant/grantor footprint. PUBLIC privileges are a separate
  -- database baseline and do not identify this role directly.
  SELECT pg_catalog.count(*)
  INTO v_owned_dependency_count
  FROM pg_catalog.pg_shdepend AS dependency
  WHERE dependency.refclassid = 'pg_catalog.pg_authid'::regclass
    AND dependency.refobjid = v_executor_oid
    AND dependency.deptype = 'o';

  SELECT pg_catalog.count(*)
  INTO v_acl_reference_count
  FROM (
    SELECT acl.grantor, acl.grantee
    FROM pg_catalog.pg_namespace AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.nspacl) AS acl
    WHERE object.nspacl IS NOT NULL
    UNION ALL
    SELECT acl.grantor, acl.grantee
    FROM pg_catalog.pg_class AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.relacl) AS acl
    WHERE object.relacl IS NOT NULL
    UNION ALL
    SELECT acl.grantor, acl.grantee
    FROM pg_catalog.pg_attribute AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.attacl) AS acl
    WHERE object.attacl IS NOT NULL
    UNION ALL
    SELECT acl.grantor, acl.grantee
    FROM pg_catalog.pg_proc AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.proacl) AS acl
    WHERE object.proacl IS NOT NULL
    UNION ALL
    SELECT acl.grantor, acl.grantee
    FROM pg_catalog.pg_type AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.typacl) AS acl
    WHERE object.typacl IS NOT NULL
    UNION ALL
    SELECT acl.grantor, acl.grantee
    FROM pg_catalog.pg_language AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.lanacl) AS acl
    WHERE object.lanacl IS NOT NULL
    UNION ALL
    SELECT acl.grantor, acl.grantee
    FROM pg_catalog.pg_database AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.datacl) AS acl
    WHERE object.datacl IS NOT NULL
    UNION ALL
    SELECT acl.grantor, acl.grantee
    FROM pg_catalog.pg_tablespace AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.spcacl) AS acl
    WHERE object.spcacl IS NOT NULL
    UNION ALL
    SELECT acl.grantor, acl.grantee
    FROM pg_catalog.pg_foreign_data_wrapper AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.fdwacl) AS acl
    WHERE object.fdwacl IS NOT NULL
    UNION ALL
    SELECT acl.grantor, acl.grantee
    FROM pg_catalog.pg_foreign_server AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.srvacl) AS acl
    WHERE object.srvacl IS NOT NULL
    UNION ALL
    SELECT acl.grantor, acl.grantee
    FROM pg_catalog.pg_largeobject_metadata AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.lomacl) AS acl
    WHERE object.lomacl IS NOT NULL
    UNION ALL
    SELECT acl.grantor, acl.grantee
    FROM pg_catalog.pg_parameter_acl AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.paracl) AS acl
    WHERE object.paracl IS NOT NULL
    UNION ALL
    SELECT acl.grantor, acl.grantee
    FROM pg_catalog.pg_init_privs AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.initprivs) AS acl
  ) AS direct_acl
  WHERE direct_acl.grantee = v_executor_oid
    OR direct_acl.grantor = v_executor_oid;

  IF v_owned_dependency_count <> 0 OR v_acl_reference_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'cron_receipt_executor_precondition_rejected';
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_table OR undefined_column THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'cron_receipt_executor_catalog_unreadable';
END
$executor_precondition$;

CREATE SCHEMA cron_receipt_private AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA cron_receipt_private
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE cron_receipt_private.cron_attempt_receipts (
  attempt_id uuid PRIMARY KEY,
  receiver text NOT NULL,
  protocol_version integer NOT NULL,
  environment text NOT NULL,
  project_ref text NOT NULL,
  request_fingerprint text NOT NULL,
  outcome_code text NOT NULL,
  effect_code text NOT NULL,
  exact_effect_count integer NOT NULL,
  created_at timestamptz NOT NULL,
  receipt_at timestamptz,
  CONSTRAINT cron_attempt_receipts_receiver_check CHECK (
    receiver IN (
      'daily-digest',
      'run-strategy-task-reaper-receipt-v1',
      'schedule-daily-plan'
    )
  ),
  CONSTRAINT cron_attempt_receipts_protocol_check CHECK (
    protocol_version = 1
  ),
  CONSTRAINT cron_attempt_receipts_environment_project_check CHECK (
    (environment = 'dynamic-staging' AND project_ref = 'uujkmcbqavsmzhnbqvmm')
    OR
    (environment = 'production' AND project_ref = 'odbjjklumdsuqdvkgwyv')
  ),
  CONSTRAINT cron_attempt_receipts_fingerprint_check CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT cron_attempt_receipts_effect_count_check CHECK (
    exact_effect_count >= 0
  ),
  CONSTRAINT cron_attempt_receipts_outcome_effect_check CHECK (
    (
      outcome_code = 'in_progress'
      AND effect_code = 'attempt_in_progress'
      AND exact_effect_count = 0
      AND receipt_at IS NULL
    )
    OR
    (
      receiver = 'run-strategy-task-reaper-receipt-v1'
      AND
      outcome_code = 'applied_success'
      AND effect_code = 'stale_pending_runs_reaped'
      AND exact_effect_count > 0
      AND receipt_at IS NOT NULL
    )
    OR
    (
      receiver = 'run-strategy-task-reaper-receipt-v1'
      AND
      outcome_code = 'legitimate_noop'
      AND effect_code = 'no_eligible_stale_pending_runs'
      AND exact_effect_count = 0
      AND receipt_at IS NOT NULL
    )
    OR
    (
      receiver = 'run-strategy-task-reaper-receipt-v1'
      AND
      outcome_code = 'known_failure_rolled_back'
      AND effect_code = 'execution_rolled_back'
      AND exact_effect_count = 0
      AND receipt_at IS NOT NULL
    )
    OR
    (
      outcome_code = 'indeterminate'
      AND effect_code = 'effect_indeterminate'
      AND exact_effect_count = 0
      AND receipt_at IS NULL
    )
  )
);

ALTER TABLE cron_receipt_private.cron_attempt_receipts OWNER TO postgres;

ALTER TABLE cron_receipt_private.cron_attempt_receipts
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE cron_receipt_private.cron_attempt_receipts
  FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public, cron_receipt_private TO cron_receipt_executor;

GRANT SELECT, INSERT, UPDATE
  ON TABLE cron_receipt_private.cron_attempt_receipts
  TO cron_receipt_executor;

CREATE POLICY cron_receipt_executor_receipt_select
  ON cron_receipt_private.cron_attempt_receipts
  FOR SELECT TO cron_receipt_executor
  USING (true);

CREATE POLICY cron_receipt_executor_receipt_insert
  ON cron_receipt_private.cron_attempt_receipts
  FOR INSERT TO cron_receipt_executor
  WITH CHECK (true);

CREATE POLICY cron_receipt_executor_receipt_update
  ON cron_receipt_private.cron_attempt_receipts
  FOR UPDATE TO cron_receipt_executor
  USING (true)
  WITH CHECK (true);

GRANT SELECT (id, status, progress_step, updated_at)
  ON TABLE public.task_runs
  TO cron_receipt_executor;

GRANT UPDATE (status, progress_step, error, completed_at, updated_at)
  ON TABLE public.task_runs
  TO cron_receipt_executor;

CREATE POLICY cron_receipt_executor_task_select
  ON public.task_runs
  FOR SELECT TO cron_receipt_executor
  USING (status IN ('pending', 'failed'));

CREATE POLICY cron_receipt_executor_task_update
  ON public.task_runs
  FOR UPDATE TO cron_receipt_executor
  USING (status = 'pending')
  WITH CHECK (
    status = 'failed'
    AND progress_step = 'failed'
    AND error LIKE 'stage_timeout:%'
    AND completed_at IS NOT NULL
  );

CREATE FUNCTION public.execute_strategy_task_reaper_attempt(
  p_attempt_id uuid,
  p_protocol_version integer,
  p_environment text,
  p_project_ref text,
  p_request_fingerprint text
)
RETURNS TABLE (
  receipt_version integer,
  receiver text,
  attempt_present boolean,
  terminal boolean,
  outcome_code text,
  effect_code text,
  receipt_at timestamptz,
  exact_effect_count integer,
  identity_consistent boolean,
  effect_consistent boolean,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_receipt cron_receipt_private.cron_attempt_receipts%ROWTYPE;
  v_inserted_rows integer;
  v_effect_count integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_attempt_id IS NULL
    OR p_protocol_version IS DISTINCT FROM 1
    OR p_environment IS NULL
    OR p_project_ref IS NULL
    OR p_request_fingerprint IS NULL
    OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
    OR NOT (
      (p_environment = 'dynamic-staging' AND p_project_ref = 'uujkmcbqavsmzhnbqvmm')
      OR
      (p_environment = 'production' AND p_project_ref = 'odbjjklumdsuqdvkgwyv')
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'cron_attempt_input_rejected';
  END IF;

  INSERT INTO cron_receipt_private.cron_attempt_receipts (
    attempt_id,
    receiver,
    protocol_version,
    environment,
    project_ref,
    request_fingerprint,
    outcome_code,
    effect_code,
    exact_effect_count,
    created_at,
    receipt_at
  )
  VALUES (
    p_attempt_id,
    'run-strategy-task-reaper-receipt-v1',
    p_protocol_version,
    p_environment,
    p_project_ref,
    p_request_fingerprint,
    'in_progress',
    'attempt_in_progress',
    0,
    v_now,
    NULL
  )
  ON CONFLICT (attempt_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;

  SELECT r.*
  INTO STRICT v_receipt
  FROM cron_receipt_private.cron_attempt_receipts AS r
  WHERE r.attempt_id = p_attempt_id
  FOR UPDATE;

  IF v_receipt.receiver IS DISTINCT FROM
    'run-strategy-task-reaper-receipt-v1'
    OR v_receipt.protocol_version IS DISTINCT FROM p_protocol_version
    OR v_receipt.environment IS DISTINCT FROM p_environment
    OR v_receipt.project_ref IS DISTINCT FROM p_project_ref
    OR v_receipt.request_fingerprint IS DISTINCT FROM p_request_fingerprint
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'cron_attempt_identity_conflict';
  END IF;

  IF v_inserted_rows = 0 THEN
    RETURN QUERY
    SELECT
      1,
      v_receipt.receiver,
      true,
      v_receipt.outcome_code IN (
        'applied_success',
        'legitimate_noop',
        'known_failure_rolled_back'
      ),
      v_receipt.outcome_code,
      v_receipt.effect_code,
      v_receipt.receipt_at,
      v_receipt.exact_effect_count,
      true,
      (
        (v_receipt.outcome_code = 'in_progress'
          AND v_receipt.effect_code = 'attempt_in_progress'
          AND v_receipt.exact_effect_count = 0
          AND v_receipt.receipt_at IS NULL)
        OR
        (v_receipt.outcome_code = 'applied_success'
          AND v_receipt.effect_code = 'stale_pending_runs_reaped'
          AND v_receipt.exact_effect_count > 0
          AND v_receipt.receipt_at IS NOT NULL)
        OR
        (v_receipt.outcome_code = 'legitimate_noop'
          AND v_receipt.effect_code = 'no_eligible_stale_pending_runs'
          AND v_receipt.exact_effect_count = 0
          AND v_receipt.receipt_at IS NOT NULL)
        OR
        (v_receipt.outcome_code = 'known_failure_rolled_back'
          AND v_receipt.effect_code = 'execution_rolled_back'
          AND v_receipt.exact_effect_count = 0
          AND v_receipt.receipt_at IS NOT NULL)
        OR
        (v_receipt.outcome_code = 'indeterminate'
          AND v_receipt.effect_code = 'effect_indeterminate'
          AND v_receipt.exact_effect_count = 0
          AND v_receipt.receipt_at IS NULL)
      ),
      true;
    RETURN;
  END IF;

  -- This nested block is a PostgreSQL subtransaction. Any business-effect or
  -- success-receipt failure rolls the entire block back before a fixed
  -- known-failure receipt is written. If that failure receipt cannot itself
  -- be written, the exception escapes and the outer attempt claim also rolls
  -- back, leaving no falsely terminal evidence.
  BEGIN
    -- Missing privilege or RLS-policy drift must not become a false no-op.
    -- Validate the fixed non-superuser execution contract before reading the
    -- candidate set. Any failure is caught by this subtransaction and becomes
    -- only the reviewed rollback-proven failure receipt.
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS executor_role
      JOIN pg_catalog.pg_class AS task_table
        ON task_table.oid = 'public.task_runs'::regclass
      WHERE executor_role.rolname = current_user
        AND executor_role.rolname = 'cron_receipt_executor'
        AND NOT executor_role.rolsuper
        AND NOT executor_role.rolinherit
        AND NOT executor_role.rolcreatedb
        AND NOT executor_role.rolcreaterole
        AND NOT executor_role.rolreplication
        AND NOT executor_role.rolbypassrls
        AND NOT executor_role.rolcanlogin
        AND task_table.relrowsecurity
        AND task_table.relowner <> executor_role.oid
    )
      OR NOT pg_catalog.has_column_privilege(
        current_user, 'public.task_runs', 'id', 'SELECT'
      )
      OR NOT pg_catalog.has_column_privilege(
        current_user, 'public.task_runs', 'status', 'SELECT'
      )
      OR NOT pg_catalog.has_column_privilege(
        current_user, 'public.task_runs', 'progress_step', 'SELECT'
      )
      OR NOT pg_catalog.has_column_privilege(
        current_user, 'public.task_runs', 'updated_at', 'SELECT'
      )
      OR NOT pg_catalog.has_column_privilege(
        current_user, 'public.task_runs', 'status', 'UPDATE'
      )
      OR NOT pg_catalog.has_column_privilege(
        current_user, 'public.task_runs', 'progress_step', 'UPDATE'
      )
      OR NOT pg_catalog.has_column_privilege(
        current_user, 'public.task_runs', 'error', 'UPDATE'
      )
      OR NOT pg_catalog.has_column_privilege(
        current_user, 'public.task_runs', 'completed_at', 'UPDATE'
      )
      OR NOT pg_catalog.has_column_privilege(
        current_user, 'public.task_runs', 'updated_at', 'UPDATE'
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_auth_members AS membership
        WHERE membership.roleid = current_user::regrole::oid
          OR membership.member = current_user::regrole::oid
      )
      OR pg_catalog.has_schema_privilege(
        current_user, 'public', 'CREATE'
      )
      OR pg_catalog.has_schema_privilege(
        current_user, 'cron_receipt_private', 'CREATE'
      )
      OR NOT pg_catalog.has_table_privilege(
        current_user,
        'cron_receipt_private.cron_attempt_receipts',
        'SELECT'
      )
      OR NOT pg_catalog.has_table_privilege(
        current_user,
        'cron_receipt_private.cron_attempt_receipts',
        'INSERT'
      )
      OR NOT pg_catalog.has_table_privilege(
        current_user,
        'cron_receipt_private.cron_attempt_receipts',
        'UPDATE'
      )
      OR pg_catalog.has_table_privilege(
        current_user,
        'cron_receipt_private.cron_attempt_receipts',
        'DELETE'
      )
      OR pg_catalog.has_table_privilege(
        current_user,
        'cron_receipt_private.cron_attempt_receipts',
        'TRUNCATE'
      )
      OR pg_catalog.has_table_privilege(
        current_user,
        'cron_receipt_private.cron_attempt_receipts',
        'REFERENCES'
      )
      OR pg_catalog.has_table_privilege(
        current_user,
        'cron_receipt_private.cron_attempt_receipts',
        'TRIGGER'
      )
      OR pg_catalog.has_table_privilege(
        current_user,
        'cron_receipt_private.cron_attempt_receipts',
        'MAINTAIN'
      )
      OR pg_catalog.has_table_privilege(
        current_user, 'public.task_runs', 'INSERT'
      )
      OR pg_catalog.has_table_privilege(
        current_user, 'public.task_runs', 'DELETE'
      )
      OR pg_catalog.has_table_privilege(
        current_user, 'public.task_runs', 'TRUNCATE'
      )
      OR pg_catalog.has_table_privilege(
        current_user, 'public.task_runs', 'REFERENCES'
      )
      OR pg_catalog.has_table_privilege(
        current_user, 'public.task_runs', 'TRIGGER'
      )
      OR pg_catalog.has_table_privilege(
        current_user, 'public.task_runs', 'MAINTAIN'
      )
      OR pg_catalog.has_any_column_privilege(
        current_user, 'public.task_runs', 'INSERT'
      )
      OR pg_catalog.has_any_column_privilege(
        current_user, 'public.task_runs', 'REFERENCES'
      )
      OR (
        SELECT pg_catalog.count(*)
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = 'public.task_runs'::regclass
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND pg_catalog.has_column_privilege(
            current_user,
            attribute.attrelid,
            attribute.attnum,
            'SELECT'
          )
      ) <> 4
      OR (
        SELECT pg_catalog.count(*)
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = 'public.task_runs'::regclass
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND pg_catalog.has_column_privilege(
            current_user,
            attribute.attrelid,
            attribute.attnum,
            'UPDATE'
          )
      ) <> 5
      OR (
        SELECT pg_catalog.count(*)
        FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = 'public.task_runs'::regclass
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
              AND pg_catalog.pg_get_expr(
                policy.polqual, policy.polrelid
              ) =
                '(status = ANY (ARRAY[''pending''::text, ''failed''::text]))'
              AND policy.polwithcheck IS NULL)
            OR
            (policy.polname = 'cron_receipt_executor_task_update'
              AND policy.polcmd = 'w'
              AND pg_catalog.pg_get_expr(
                policy.polqual, policy.polrelid
              ) = '(status = ''pending''::text)'
              AND pg_catalog.pg_get_expr(
                policy.polwithcheck, policy.polrelid
              ) = '((status = ''failed''::text) AND '
                || '(progress_step = ''failed''::text) AND '
                || '(error ~~ ''stage_timeout:%''::text) AND '
                || '(completed_at IS NOT NULL))')
          )
      ) <> 2
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = 'public.task_runs'::regclass
          AND (
            0::oid = ANY (policy.polroles)
            OR current_user::regrole::oid = ANY (policy.polroles)
          )
          AND policy.polname NOT IN (
            'cron_receipt_executor_task_select',
            'cron_receipt_executor_task_update'
          )
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = 'public.task_runs'::regclass
          AND NOT policy.polpermissive
          AND (
            0::oid = ANY (policy.polroles)
            OR current_user::regrole::oid = ANY (policy.polroles)
          )
      )
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'cron_receipt_executor_contract_rejected';
    END IF;

    -- Lock a deterministic, bounded candidate set. Different attempt IDs can
    -- execute concurrently, but each eligible row is updated at most once
    -- because the lock and the status predicate are inside this transaction.
    WITH candidates AS MATERIALIZED (
    SELECT tr.id
    FROM public.task_runs AS tr
    WHERE tr.status = 'pending'
      AND tr.updated_at < v_now - interval '5 minutes'
      AND (
        tr.updated_at < v_now - interval '14 minutes'
        OR (
          split_part(COALESCE(tr.progress_step, ''), ':', 1) = 'synthesis'
          AND tr.updated_at < v_now - interval '6 minutes'
        )
        OR (
          split_part(COALESCE(tr.progress_step, ''), ':', 1) = 'document_authoring'
          AND tr.updated_at < v_now - interval '9 minutes'
        )
        OR (
          split_part(COALESCE(tr.progress_step, ''), ':', 1)
            NOT IN ('synthesis', 'document_authoring')
          AND tr.updated_at < v_now - interval '7 minutes'
        )
      )
    ORDER BY tr.updated_at, tr.id
    LIMIT 200
    FOR UPDATE
    ), updated AS (
      UPDATE public.task_runs AS tr
      SET
        status = 'failed',
        progress_step = 'failed',
        error = 'stage_timeout:'
          || COALESCE(NULLIF(tr.progress_step, ''), 'unknown')
          || CASE
            WHEN split_part(COALESCE(tr.progress_step, ''), ':', 1)
              IN ('synthesis', 'document_authoring')
            THEN ' (no progress for '
            ELSE ' (generic pending watchdog after '
          END
          || round(extract(epoch FROM (v_now - tr.updated_at)))::bigint::text
          || 's)',
        completed_at = v_now,
        updated_at = v_now
      FROM candidates AS c
      WHERE tr.id = c.id
        AND tr.status = 'pending'
      RETURNING 1
    )
    SELECT count(*)::integer
    INTO v_effect_count
    FROM updated;

    UPDATE cron_receipt_private.cron_attempt_receipts AS r
    SET
      outcome_code = CASE
        WHEN v_effect_count > 0 THEN 'applied_success'
        ELSE 'legitimate_noop'
      END,
      effect_code = CASE
        WHEN v_effect_count > 0 THEN 'stale_pending_runs_reaped'
        ELSE 'no_eligible_stale_pending_runs'
      END,
      exact_effect_count = v_effect_count,
      receipt_at = clock_timestamp()
    WHERE r.attempt_id = p_attempt_id
    RETURNING r.* INTO STRICT v_receipt;
  EXCEPTION WHEN OTHERS THEN
    UPDATE cron_receipt_private.cron_attempt_receipts AS r
    SET
      outcome_code = 'known_failure_rolled_back',
      effect_code = 'execution_rolled_back',
      exact_effect_count = 0,
      receipt_at = clock_timestamp()
    WHERE r.attempt_id = p_attempt_id
    RETURNING r.* INTO STRICT v_receipt;

    RETURN QUERY
    SELECT
      1,
      v_receipt.receiver,
      true,
      true,
      v_receipt.outcome_code,
      v_receipt.effect_code,
      v_receipt.receipt_at,
      0,
      true,
      true,
      false;
    RETURN;
  END;

  RETURN QUERY
  SELECT
    1,
    v_receipt.receiver,
    true,
    true,
    v_receipt.outcome_code,
    v_receipt.effect_code,
    v_receipt.receipt_at,
    v_receipt.exact_effect_count,
    true,
    true,
    false;
END;
$function$;

-- ALTER OWNER requires the future owner to hold CREATE on the containing
-- schema. The dedicated NOLOGIN role receives it only across the two owner
-- changes and retains USAGE afterward.
GRANT CREATE ON SCHEMA public TO cron_receipt_executor;

ALTER FUNCTION public.execute_strategy_task_reaper_attempt(
  uuid, integer, text, text, text
) OWNER TO cron_receipt_executor;

CREATE FUNCTION public.read_strategy_task_reaper_receipt(
  p_attempt_id uuid,
  p_protocol_version integer,
  p_environment text,
  p_project_ref text,
  p_request_fingerprint text
)
RETURNS TABLE (
  receipt_version integer,
  receiver text,
  attempt_present boolean,
  terminal boolean,
  outcome_code text,
  effect_code text,
  receipt_at timestamptz,
  exact_effect_count integer,
  identity_consistent boolean,
  effect_consistent boolean,
  replayed boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_receipt cron_receipt_private.cron_attempt_receipts%ROWTYPE;
BEGIN
  IF p_attempt_id IS NULL
    OR p_protocol_version IS DISTINCT FROM 1
    OR p_environment IS NULL
    OR p_project_ref IS NULL
    OR p_request_fingerprint IS NULL
    OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
    OR NOT (
      (p_environment = 'dynamic-staging' AND p_project_ref = 'uujkmcbqavsmzhnbqvmm')
      OR
      (p_environment = 'production' AND p_project_ref = 'odbjjklumdsuqdvkgwyv')
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'cron_attempt_input_rejected';
  END IF;

  SELECT r.*
  INTO v_receipt
  FROM cron_receipt_private.cron_attempt_receipts AS r
  WHERE r.attempt_id = p_attempt_id;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      1,
      'run-strategy-task-reaper-receipt-v1'::text,
      false,
      false,
      'indeterminate'::text,
      'effect_indeterminate'::text,
      NULL::timestamptz,
      0,
      false,
      false,
      false;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    1,
    v_receipt.receiver,
    true,
    v_receipt.outcome_code IN (
      'applied_success',
      'legitimate_noop',
      'known_failure_rolled_back'
    ),
    v_receipt.outcome_code,
    v_receipt.effect_code,
    v_receipt.receipt_at,
    v_receipt.exact_effect_count,
    (
      v_receipt.receiver = 'run-strategy-task-reaper-receipt-v1'
      AND v_receipt.protocol_version = p_protocol_version
      AND v_receipt.environment = p_environment
      AND v_receipt.project_ref = p_project_ref
      AND v_receipt.request_fingerprint = p_request_fingerprint
    ),
    (
      (v_receipt.outcome_code = 'in_progress'
        AND v_receipt.effect_code = 'attempt_in_progress'
        AND v_receipt.exact_effect_count = 0
        AND v_receipt.receipt_at IS NULL)
      OR
      (v_receipt.outcome_code = 'applied_success'
        AND v_receipt.effect_code = 'stale_pending_runs_reaped'
        AND v_receipt.exact_effect_count > 0
        AND v_receipt.receipt_at IS NOT NULL)
      OR
      (v_receipt.outcome_code = 'legitimate_noop'
        AND v_receipt.effect_code = 'no_eligible_stale_pending_runs'
        AND v_receipt.exact_effect_count = 0
        AND v_receipt.receipt_at IS NOT NULL)
      OR
      (v_receipt.outcome_code = 'known_failure_rolled_back'
        AND v_receipt.effect_code = 'execution_rolled_back'
        AND v_receipt.exact_effect_count = 0
        AND v_receipt.receipt_at IS NOT NULL)
      OR
      (v_receipt.outcome_code = 'indeterminate'
        AND v_receipt.effect_code = 'effect_indeterminate'
        AND v_receipt.exact_effect_count = 0
        AND v_receipt.receipt_at IS NULL)
    ),
    true;
END;
$function$;

ALTER FUNCTION public.read_strategy_task_reaper_receipt(
  uuid, integer, text, text, text
) OWNER TO cron_receipt_executor;

REVOKE CREATE ON SCHEMA public FROM cron_receipt_executor;

REVOKE ALL ON FUNCTION public.execute_strategy_task_reaper_attempt(
  uuid, integer, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_strategy_task_reaper_receipt(
  uuid, integer, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.execute_strategy_task_reaper_attempt(
  uuid, integer, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_strategy_task_reaper_receipt(
  uuid, integer, text, text, text
) TO service_role;

DO $executor_postcondition$
DECLARE
  v_executor_oid oid;
  v_unexpected_acl_count bigint;
BEGIN
  SELECT auth.oid
  INTO v_executor_oid
  FROM pg_catalog.pg_authid AS auth
  WHERE auth.rolname = 'cron_receipt_executor'
    AND NOT auth.rolsuper
    AND NOT auth.rolinherit
    AND NOT auth.rolcreaterole
    AND NOT auth.rolcreatedb
    AND NOT auth.rolcanlogin
    AND NOT auth.rolreplication
    AND NOT auth.rolbypassrls
    AND auth.rolconnlimit = -1
    AND auth.rolpassword IS NULL
    AND auth.rolvaliduntil IS NULL;

  IF v_executor_oid IS NULL
    OR v_executor_oid::text <> pg_catalog.current_setting(
      'cron_receipt.install_expected_executor_oid'
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_db_role_setting AS setting
      WHERE setting.setrole = v_executor_oid
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      WHERE membership.roleid = v_executor_oid
        OR membership.member = v_executor_oid
        OR membership.grantor = v_executor_oid
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_default_acl AS defaults
      CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
      WHERE defaults.defaclrole = v_executor_oid
        OR acl.grantee = v_executor_oid
        OR acl.grantor = v_executor_oid
    )
    OR (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS function
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function.pronamespace
      WHERE function.proowner = v_executor_oid
        AND namespace.nspname = 'public'
        AND function.proname IN (
          'execute_strategy_task_reaper_attempt',
          'read_strategy_task_reaper_receipt'
        )
        AND pg_catalog.pg_get_function_identity_arguments(function.oid) =
          'p_attempt_id uuid, p_protocol_version integer, p_environment text, p_project_ref text, p_request_fingerprint text'
    ) <> 2
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_shdepend AS dependency
      WHERE dependency.refclassid = 'pg_catalog.pg_authid'::regclass
        AND dependency.refobjid = v_executor_oid
        AND dependency.deptype = 'o'
        AND NOT (
          dependency.dbid = (
            SELECT database.oid
            FROM pg_catalog.pg_database AS database
            WHERE database.datname = pg_catalog.current_database()
          )
          AND dependency.classid = 'pg_catalog.pg_proc'::regclass
          AND dependency.objid IN (
            'public.execute_strategy_task_reaper_attempt(uuid,integer,text,text,text)'::regprocedure::oid,
            'public.read_strategy_task_reaper_receipt(uuid,integer,text,text,text)'::regprocedure::oid
          )
        )
    )
    OR NOT pg_catalog.has_schema_privilege(
      'cron_receipt_executor', 'public', 'USAGE'
    )
    OR pg_catalog.has_schema_privilege(
      'cron_receipt_executor', 'public', 'CREATE'
    )
    OR NOT pg_catalog.has_schema_privilege(
      'cron_receipt_executor', 'cron_receipt_private', 'USAGE'
    )
    OR pg_catalog.has_schema_privilege(
      'cron_receipt_executor', 'cron_receipt_private', 'CREATE'
    )
    OR NOT pg_catalog.has_table_privilege(
      'cron_receipt_executor',
      'cron_receipt_private.cron_attempt_receipts',
      'SELECT'
    )
    OR NOT pg_catalog.has_table_privilege(
      'cron_receipt_executor',
      'cron_receipt_private.cron_attempt_receipts',
      'INSERT'
    )
    OR NOT pg_catalog.has_table_privilege(
      'cron_receipt_executor',
      'cron_receipt_private.cron_attempt_receipts',
      'UPDATE'
    )
    OR pg_catalog.has_table_privilege(
      'cron_receipt_executor',
      'cron_receipt_private.cron_attempt_receipts',
      'DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'
    )
    OR pg_catalog.has_table_privilege(
      'cron_receipt_executor',
      'public.task_runs',
      'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'
    )
    OR (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'public.task_runs'::regclass
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND pg_catalog.has_column_privilege(
          'cron_receipt_executor', attribute.attrelid,
          attribute.attnum, 'SELECT'
        )
    ) <> 4
    OR (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'public.task_runs'::regclass
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND pg_catalog.has_column_privilege(
          'cron_receipt_executor', attribute.attrelid,
          attribute.attnum, 'UPDATE'
        )
    ) <> 5
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'cron_receipt_executor_postcondition_rejected';
  END IF;

  -- Reject any executor ACL footprint beyond the exact reviewed schema,
  -- private-table, task-column, and wrapper ACLs. This checks grantee,
  -- grantor, and grant-option identity across every PostgreSQL 17 ACL-bearing
  -- catalog; zero memberships alone is not an ACL proof.
  SELECT pg_catalog.count(*)
  INTO v_unexpected_acl_count
  FROM (
    SELECT
      'namespace'::text AS catalog_name,
      object.oid AS object_oid,
      0::integer AS sub_id,
      acl.grantor,
      acl.grantee,
      acl.privilege_type,
      acl.is_grantable
    FROM pg_catalog.pg_namespace AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.nspacl) AS acl
    WHERE object.nspacl IS NOT NULL
    UNION ALL
    SELECT 'class', object.oid, 0::integer,
      acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
    FROM pg_catalog.pg_class AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.relacl) AS acl
    WHERE object.relacl IS NOT NULL
    UNION ALL
    SELECT 'attribute', object.attrelid, object.attnum,
      acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
    FROM pg_catalog.pg_attribute AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.attacl) AS acl
    WHERE object.attacl IS NOT NULL
    UNION ALL
    SELECT 'function', object.oid, 0::integer,
      acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
    FROM pg_catalog.pg_proc AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.proacl) AS acl
    WHERE object.proacl IS NOT NULL
    UNION ALL
    SELECT 'type', object.oid, 0::integer,
      acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
    FROM pg_catalog.pg_type AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.typacl) AS acl
    WHERE object.typacl IS NOT NULL
    UNION ALL
    SELECT 'language', object.oid, 0::integer,
      acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
    FROM pg_catalog.pg_language AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.lanacl) AS acl
    WHERE object.lanacl IS NOT NULL
    UNION ALL
    SELECT 'database', object.oid, 0::integer,
      acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
    FROM pg_catalog.pg_database AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.datacl) AS acl
    WHERE object.datacl IS NOT NULL
    UNION ALL
    SELECT 'tablespace', object.oid, 0::integer,
      acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
    FROM pg_catalog.pg_tablespace AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.spcacl) AS acl
    WHERE object.spcacl IS NOT NULL
    UNION ALL
    SELECT 'fdw', object.oid, 0::integer,
      acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
    FROM pg_catalog.pg_foreign_data_wrapper AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.fdwacl) AS acl
    WHERE object.fdwacl IS NOT NULL
    UNION ALL
    SELECT 'server', object.oid, 0::integer,
      acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
    FROM pg_catalog.pg_foreign_server AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.srvacl) AS acl
    WHERE object.srvacl IS NOT NULL
    UNION ALL
    SELECT 'largeobject', object.oid, 0::integer,
      acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
    FROM pg_catalog.pg_largeobject_metadata AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.lomacl) AS acl
    WHERE object.lomacl IS NOT NULL
    UNION ALL
    SELECT 'parameter', object.oid, 0::integer,
      acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
    FROM pg_catalog.pg_parameter_acl AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.paracl) AS acl
    WHERE object.paracl IS NOT NULL
    UNION ALL
    SELECT 'init_privs', object.objoid, object.objsubid,
      acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
    FROM pg_catalog.pg_init_privs AS object
    CROSS JOIN LATERAL pg_catalog.aclexplode(object.initprivs) AS acl
  ) AS direct_acl
  WHERE (direct_acl.grantee = v_executor_oid
      OR direct_acl.grantor = v_executor_oid)
    AND NOT (
      direct_acl.catalog_name = 'namespace'
      AND direct_acl.object_oid IN (
        'public'::regnamespace::oid,
        'cron_receipt_private'::regnamespace::oid
      )
      AND direct_acl.grantee = v_executor_oid
      AND direct_acl.privilege_type = 'USAGE'
      AND NOT direct_acl.is_grantable
      AND direct_acl.grantor = (
        SELECT namespace.nspowner
        FROM pg_catalog.pg_namespace AS namespace
        WHERE namespace.oid = direct_acl.object_oid
      )
    )
    AND NOT (
      direct_acl.catalog_name = 'class'
      AND direct_acl.object_oid =
        'cron_receipt_private.cron_attempt_receipts'::regclass::oid
      AND direct_acl.grantee = v_executor_oid
      AND direct_acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE')
      AND NOT direct_acl.is_grantable
      AND direct_acl.grantor = (
        SELECT relation.relowner
        FROM pg_catalog.pg_class AS relation
        WHERE relation.oid = direct_acl.object_oid
      )
    )
    AND NOT (
      direct_acl.catalog_name = 'attribute'
      AND direct_acl.object_oid = 'public.task_runs'::regclass::oid
      AND direct_acl.grantee = v_executor_oid
      AND NOT direct_acl.is_grantable
      AND direct_acl.grantor = (
        SELECT relation.relowner
        FROM pg_catalog.pg_class AS relation
        WHERE relation.oid = direct_acl.object_oid
      )
      AND (
        (direct_acl.privilege_type = 'SELECT' AND direct_acl.sub_id IN (
          SELECT attribute.attnum
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = 'public.task_runs'::regclass
            AND attribute.attname IN ('id', 'status', 'progress_step', 'updated_at')
        ))
        OR
        (direct_acl.privilege_type = 'UPDATE' AND direct_acl.sub_id IN (
          SELECT attribute.attnum
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = 'public.task_runs'::regclass
            AND attribute.attname IN (
              'status', 'progress_step', 'error', 'completed_at', 'updated_at'
            )
        ))
      )
    )
    AND NOT (
      direct_acl.catalog_name = 'function'
      AND direct_acl.object_oid IN (
        'public.execute_strategy_task_reaper_attempt(uuid,integer,text,text,text)'::regprocedure::oid,
        'public.read_strategy_task_reaper_receipt(uuid,integer,text,text,text)'::regprocedure::oid
      )
      AND direct_acl.grantor = v_executor_oid
      AND direct_acl.grantee IN (
        v_executor_oid,
        'service_role'::regrole::oid
      )
      AND direct_acl.privilege_type = 'EXECUTE'
      AND NOT direct_acl.is_grantable
    );

  IF v_unexpected_acl_count <> 0
    OR NOT pg_catalog.has_function_privilege(
      'service_role',
      'public.execute_strategy_task_reaper_attempt(uuid,integer,text,text,text)',
      'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'service_role',
      'public.read_strategy_task_reaper_receipt(uuid,integer,text,text,text)',
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'anon',
      'public.execute_strategy_task_reaper_attempt(uuid,integer,text,text,text)',
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'authenticated',
      'public.execute_strategy_task_reaper_attempt(uuid,integer,text,text,text)',
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'anon',
      'public.read_strategy_task_reaper_receipt(uuid,integer,text,text,text)',
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'authenticated',
      'public.read_strategy_task_reaper_receipt(uuid,integer,text,text,text)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'cron_receipt_executor_postcondition_rejected';
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_table OR undefined_column THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'cron_receipt_executor_catalog_unreadable';
END
$executor_postcondition$;

COMMIT;
