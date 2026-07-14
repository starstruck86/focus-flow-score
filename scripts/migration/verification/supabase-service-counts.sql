\set ON_ERROR_STOP on
\set QUIET 1
\pset pager off
\pset format unaligned
\pset tuples_only on

-- Read-only Supabase service inventory. Each stdout line is one JSON object
-- accepted by catalog-jsonl-to-manifest.py --evidence-kind service_inventory.
-- No user row, object name, cron command, or secret value is emitted. Access
-- errors are collection failures, never zero counts.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;

SELECT pg_catalog.jsonb_build_object(
  'record_version', 1,
  'record_kind', 'collection',
  'component_kind', 'collection',
  'key', 'database-catalog-snapshot',
  'parent', NULL,
  'count', NULL,
  'attributes', pg_catalog.jsonb_build_object(
    'boundary_kind', 'database_read_only_transaction',
    'boundary_value', pg_catalog.pg_current_snapshot()::text,
    'collected_at', pg_catalog.to_char(
      pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'isolation_level', pg_catalog.current_setting('transaction_isolation'),
    'read_only', pg_catalog.current_setting('transaction_read_only')::boolean
  )
)::text;

SELECT pg_catalog.jsonb_build_object(
  'record_version', 1,
  'record_kind', 'component',
  'component_kind', r.component_kind,
  'key', r.component_key,
  'parent', r.parent_key,
  'count', r.exact_count,
  'attributes', r.attributes
)::text
FROM (
  SELECT
    'auth'::text AS component_kind,
    'auth.users'::text AS component_key,
    'auth'::text AS parent_key,
    count(*)::bigint AS exact_count,
    pg_catalog.jsonb_build_object('entity', 'users') AS attributes
  FROM auth.users

  UNION ALL

  SELECT
    'auth',
    'auth.identities',
    'auth',
    count(*)::bigint,
    pg_catalog.jsonb_build_object('entity', 'identities')
  FROM auth.identities

  UNION ALL

  SELECT
    'storage',
    'storage.bucket:' || b.id,
    'storage',
    count(o.id)::bigint,
    pg_catalog.jsonb_build_object(
      'bucket_id', b.id,
      'public', b.public,
      'file_size_limit', b.file_size_limit,
      'allowed_mime_types', CASE WHEN b.allowed_mime_types IS NULL THEN NULL ELSE COALESCE((
        SELECT pg_catalog.jsonb_agg(mime_type ORDER BY mime_type)
        FROM pg_catalog.unnest(b.allowed_mime_types) AS mime_type
      ), '[]'::jsonb) END
    )
  FROM storage.buckets AS b
  LEFT JOIN storage.objects AS o ON o.bucket_id = b.id
  GROUP BY b.id, b.public, b.file_size_limit, b.allowed_mime_types

  UNION ALL

  SELECT
    'job',
    'cron.job:' || COALESCE(j.jobname, 'jobid-' || j.jobid::text),
    'cron',
    1::bigint,
    pg_catalog.jsonb_build_object(
      'job_name', j.jobname,
      'schedule', j.schedule,
      'active', j.active,
      'database', j.database,
      'username', j.username,
      'node_name', j.nodename,
      'node_port', j.nodeport,
      'command_fingerprint', 'sha256:' || pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(
            'focus-flow-score/cron-command/v1', 'UTF8'
          ) ||
          pg_catalog.decode('00', 'hex') ||
          pg_catalog.int8send(
            pg_catalog.octet_length(pg_catalog.convert_to(j.command, 'UTF8'))::bigint
          ) ||
          pg_catalog.convert_to(j.command, 'UTF8')
        ),
        'hex'
      )
    )
  FROM cron.job AS j
) AS r
ORDER BY r.component_kind, r.component_key;

COMMIT;
