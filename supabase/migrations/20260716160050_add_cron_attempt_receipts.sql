-- Durable, attempt-bound application receipts for reviewed cron receivers.
--
-- The private table contains correlation metadata only. It deliberately does
-- not store credentials, request/response bodies, business-row identifiers,
-- model material, or error text. The first atomic receiver is the stale task
-- reaper: its bounded set-based update and terminal receipt are one database
-- transaction because a PostgreSQL function call is one statement.

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
      'run-strategy-task-reaper',
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
      receiver = 'run-strategy-task-reaper'
      AND
      outcome_code = 'applied_success'
      AND effect_code = 'stale_pending_runs_reaped'
      AND exact_effect_count > 0
      AND receipt_at IS NOT NULL
    )
    OR
    (
      receiver = 'run-strategy-task-reaper'
      AND
      outcome_code = 'legitimate_noop'
      AND effect_code = 'no_eligible_stale_pending_runs'
      AND exact_effect_count = 0
      AND receipt_at IS NOT NULL
    )
    OR
    (
      receiver = 'run-strategy-task-reaper'
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

-- The receiver runs every minute. Bound the candidate ordering work to the
-- pending subset instead of relying on LIMIT to hide an unbounded scan/sort.
CREATE INDEX task_runs_pending_updated_at_id_idx
  ON public.task_runs (updated_at, id)
  WHERE status = 'pending';

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
    'run-strategy-task-reaper',
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

  IF v_receipt.receiver IS DISTINCT FROM 'run-strategy-task-reaper'
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

ALTER FUNCTION public.execute_strategy_task_reaper_attempt(
  uuid, integer, text, text, text
) OWNER TO postgres;

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
      'run-strategy-task-reaper'::text,
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
      v_receipt.receiver = 'run-strategy-task-reaper'
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
) OWNER TO postgres;

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
