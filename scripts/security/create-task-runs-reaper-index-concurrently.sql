\set ON_ERROR_STOP on

-- REPOSITORY TEMPLATE ONLY. Do not run without separate database-mutation
-- authorization, a reviewed production catalog preflight, and an isolated
-- PostgreSQL 17 rehearsal. This statement must run outside a transaction.
-- It is deliberately not part of the ordinary migration chain.
-- All five non-secret psql bindings are mandatory and must come from the
-- separately approved execution record. Missing/mismatched bindings stop
-- before the DDL statement.
\if :{?receipt_index_mutation_authorized}
\else
  SELECT 'receipt_index_guard_missing_authorization'::integer;
\endif
\if :{?receipt_index_expected_database}
\else
  SELECT 'receipt_index_guard_missing_database'::integer;
\endif
\if :{?receipt_index_expected_actor}
\else
  SELECT 'receipt_index_guard_missing_actor'::integer;
\endif
\if :{?receipt_index_expected_task_owner}
\else
  SELECT 'receipt_index_guard_missing_task_owner'::integer;
\endif
\if :{?receipt_index_expected_server_major}
\else
  SELECT 'receipt_index_guard_missing_server_major'::integer;
\endif

SELECT
  :'receipt_index_mutation_authorized' = 'YES'
  AND :'receipt_index_expected_server_major' = '17'
  AND pg_catalog.current_setting('server_version_num')::integer / 10000 = 17
  AND pg_catalog.current_database() = :'receipt_index_expected_database'
  AND current_user = :'receipt_index_expected_actor'
  AND task_owner.rolname = :'receipt_index_expected_task_owner'
  AND task_table.relrowsecurity
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS candidate
    JOIN pg_catalog.pg_class AS candidate_class
      ON candidate_class.oid = candidate.indexrelid
    JOIN pg_catalog.pg_am AS candidate_access_method
      ON candidate_access_method.oid = candidate_class.relam
    WHERE candidate.indrelid = task_table.oid
      AND candidate.indisvalid
      AND candidate.indisready
      AND candidate.indislive
      AND NOT candidate.indisunique
      AND candidate.indnkeyatts = 2
      AND candidate.indnatts = 2
      AND candidate_access_method.amname = 'btree'
      AND pg_catalog.pg_get_indexdef(candidate.indexrelid, 1, true) =
        'updated_at'
      AND pg_catalog.pg_get_indexdef(candidate.indexrelid, 2, true) = 'id'
      AND pg_catalog.pg_get_expr(candidate.indpred, candidate.indrelid) =
        '(status = ''pending''::text)'
  ) AS receipt_index_guard_passed
FROM pg_catalog.pg_class AS task_table
JOIN pg_catalog.pg_roles AS task_owner ON task_owner.oid = task_table.relowner
WHERE task_table.oid = pg_catalog.to_regclass('public.task_runs')
\gset

\if :receipt_index_guard_passed
\else
  SELECT 'receipt_index_guard_identity_rejected'::integer;
\endif

SET lock_timeout = '5s';
SET statement_timeout = '30min';

CREATE INDEX CONCURRENTLY task_runs_pending_updated_at_id_idx
  ON public.task_runs USING btree (updated_at, id)
  WHERE status = 'pending';

-- A failed concurrent build can leave an invalid index. Stop and obtain a
-- separately reviewed repair authorization; do not retry or drop it ad hoc.
