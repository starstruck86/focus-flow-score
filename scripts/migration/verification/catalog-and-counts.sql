\set ON_ERROR_STOP on
\pset pager off

-- Read-only catalog and exact-count collector for a deliberately selected
-- source or target database. It emits metadata/counts only, never row values.
-- Run it only after reviewing the connection target and capturing the command
-- in an approved rehearsal/cutover checklist.
BEGIN TRANSACTION READ ONLY;

SELECT 'server_version' AS record_type,
       current_setting('server_version') AS object_name,
       NULL::text AS parent_name,
       NULL::bigint AS exact_count,
       NULL::text AS minimum_value,
       NULL::text AS maximum_value,
       NULL::text AS fingerprint
UNION ALL
SELECT 'schema', n.nspname, NULL, NULL, NULL, NULL, NULL
FROM pg_catalog.pg_namespace AS n
WHERE n.nspname !~ '^pg_toast'
  AND n.nspname !~ '^pg_temp'
UNION ALL
SELECT CASE c.relkind
         WHEN 'r' THEN 'table'
         WHEN 'p' THEN 'partitioned_table'
         WHEN 'v' THEN 'view'
         WHEN 'm' THEN 'materialized_view'
         WHEN 'S' THEN 'sequence'
         WHEN 'f' THEN 'foreign_table'
       END,
       pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname),
       NULL,
       NULL,
       NULL,
       NULL,
       CASE
         WHEN c.relkind IN ('v', 'm')
           THEN 'md5:' || pg_catalog.md5(pg_catalog.pg_get_viewdef(c.oid, true))
         ELSE NULL
       END
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_toast'
  AND n.nspname !~ '^pg_temp'
UNION ALL
SELECT 'index',
       pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(i.relname),
       pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(t.relname),
       NULL,
       NULL,
       NULL,
       'md5:' || pg_catalog.md5(pg_catalog.pg_get_indexdef(i.oid))
FROM pg_catalog.pg_class AS i
JOIN pg_catalog.pg_namespace AS n ON n.oid = i.relnamespace
JOIN pg_catalog.pg_index AS x ON x.indexrelid = i.oid
JOIN pg_catalog.pg_class AS t ON t.oid = x.indrelid
WHERE i.relkind = 'i'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_toast'
  AND n.nspname !~ '^pg_temp'
UNION ALL
SELECT 'constraint',
       pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(con.conname),
       pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname),
       NULL,
       NULL,
       NULL,
       'md5:' || pg_catalog.md5(pg_catalog.pg_get_constraintdef(con.oid, true))
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_toast'
  AND n.nspname !~ '^pg_temp'
UNION ALL
SELECT CASE t.typtype WHEN 'e' THEN 'enum' WHEN 'd' THEN 'domain' END,
       pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(t.typname),
       NULL,
       NULL,
       NULL,
       NULL,
       CASE
         WHEN t.typtype = 'e' THEN 'md5:' || pg_catalog.md5(
           COALESCE((
             SELECT pg_catalog.string_agg(e.enumlabel, '|' ORDER BY e.enumsortorder)
             FROM pg_catalog.pg_enum AS e
             WHERE e.enumtypid = t.oid
           ), '')
         )
         ELSE 'md5:' || pg_catalog.md5(
           pg_catalog.concat_ws(
             '|', pg_catalog.format_type(t.typbasetype, t.typtypmod),
             t.typnotnull, t.typdefault
           )
         )
       END
FROM pg_catalog.pg_type AS t
JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
WHERE t.typtype IN ('e', 'd')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_toast'
  AND n.nspname !~ '^pg_temp'
UNION ALL
SELECT 'function',
       pg_catalog.quote_ident(n.nspname) || '.' ||
         pg_catalog.quote_ident(p.proname) || '(' ||
         pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
       NULL,
       NULL,
       NULL,
       NULL,
       'md5:' || pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE p.prokind IN ('f', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_toast'
  AND n.nspname !~ '^pg_temp'
UNION ALL
SELECT 'trigger',
       pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(t.tgname),
       pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname),
       NULL,
       NULL,
       NULL,
       'md5:' || pg_catalog.md5(pg_catalog.pg_get_triggerdef(t.oid, true))
FROM pg_catalog.pg_trigger AS t
JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
UNION ALL
SELECT 'policy',
       pg_catalog.quote_ident(schemaname) || '.' || pg_catalog.quote_ident(policyname),
       pg_catalog.quote_ident(schemaname) || '.' || pg_catalog.quote_ident(tablename),
       NULL,
       NULL,
       NULL,
       'md5:' || pg_catalog.md5(
         pg_catalog.concat_ws('|', permissive, roles::text, cmd, qual, with_check)
       )
FROM pg_catalog.pg_policies
UNION ALL
SELECT 'extension', e.extname, n.nspname, NULL, NULL, NULL, e.extversion
FROM pg_catalog.pg_extension AS e
JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
UNION ALL
SELECT 'publication', p.pubname, NULL, NULL, NULL, NULL,
       'md5:' || pg_catalog.md5(
         pg_catalog.concat_ws('|', p.puballtables, p.pubinsert, p.pubupdate, p.pubdelete, p.pubtruncate)
       )
FROM pg_catalog.pg_publication AS p
UNION ALL
SELECT 'publication_table',
       pg_catalog.quote_ident(p.schemaname) || '.' || pg_catalog.quote_ident(p.tablename),
       p.pubname,
       NULL,
       NULL,
       NULL,
       NULL
FROM pg_catalog.pg_publication_tables AS p
ORDER BY 1, 2, 3;

-- Exact counts for ordinary and partitioned user tables. The generated
-- statements contain table identifiers and count(*) only.
SELECT pg_catalog.format(
  'SELECT %L AS record_type, %L AS object_name, NULL::text AS parent_name, count(*)::bigint AS exact_count, NULL::text AS minimum_value, NULL::text AS maximum_value, NULL::text AS fingerprint FROM %I.%I;',
  'table_count', n.nspname || '.' || c.relname, n.nspname, c.relname
)
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN (
    'auth', 'cron', 'extensions', 'graphql', 'graphql_public',
    'information_schema', 'pg_catalog', 'pgsodium', 'pgsodium_masks',
    'realtime', 'storage', 'supabase_functions', 'supabase_migrations', 'vault'
  )
  AND n.nspname !~ '^pg_toast'
  AND n.nspname !~ '^pg_temp'
ORDER BY n.nspname, c.relname
\gexec

-- Min/max only for single-column primary keys with deliberately allowed,
-- orderable types. Composite and unsupported keys are reported by the catalog
-- inventory but omitted here rather than guessed.
SELECT pg_catalog.format(
  'SELECT %L AS record_type, %L AS object_name, %L AS parent_name, NULL::bigint AS exact_count, (SELECT %I::text FROM %I.%I WHERE %I IS NOT NULL ORDER BY %I ASC LIMIT 1) AS minimum_value, (SELECT %I::text FROM %I.%I WHERE %I IS NOT NULL ORDER BY %I DESC LIMIT 1) AS maximum_value, NULL::text AS fingerprint;',
  'primary_key_range',
  n.nspname || '.' || c.relname || '.' || a.attname,
  n.nspname || '.' || c.relname,
  a.attname,
  n.nspname,
  c.relname,
  a.attname,
  a.attname,
  a.attname,
  n.nspname,
  c.relname,
  a.attname,
  a.attname
)
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute AS a
  ON a.attrelid = c.oid AND a.attnum = con.conkey[1]
JOIN pg_catalog.pg_type AS typ ON typ.oid = a.atttypid
WHERE con.contype = 'p'
  AND pg_catalog.array_length(con.conkey, 1) = 1
  AND typ.typname IN (
    'date', 'int2', 'int4', 'int8', 'numeric', 'text', 'timestamp',
    'timestamptz', 'uuid', 'varchar'
  )
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname
\gexec

SELECT 'sequence_value' AS record_type,
       pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname) AS object_name,
       NULL::text AS parent_name,
       pg_catalog.pg_sequence_last_value(c.oid::pg_catalog.regclass)::bigint AS exact_count,
       NULL::text AS minimum_value,
       NULL::text AS maximum_value,
       NULL::text AS fingerprint
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind = 'S'
ORDER BY 2;

SELECT 'rls_state' AS record_type,
       pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname) AS object_name,
       CASE
         WHEN c.relrowsecurity AND c.relforcerowsecurity THEN 'enabled_forced'
         WHEN c.relrowsecurity THEN 'enabled'
         ELSE 'disabled'
       END AS parent_name,
       NULL::bigint AS exact_count,
       NULL::text AS minimum_value,
       NULL::text AS maximum_value,
       NULL::text AS fingerprint
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY 2;

COMMIT;
