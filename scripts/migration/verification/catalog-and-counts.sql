\set ON_ERROR_STOP on
\set QUIET 1
\pset pager off
\pset format unaligned
\pset tuples_only on

-- Read-only PostgreSQL catalog collector. Each stdout line is one JSON object;
-- it never emits table row values. Run with psql -X so user startup files
-- cannot alter the output. The companion catalog-jsonl-to-manifest.py parser
-- rejects non-JSON, unknown, duplicate, orphaned, or incomplete records.
--
-- Exact counts scan selected user tables and may be expensive. They are meant
-- for an approved quiet-window rehearsal/cutover, not casual production use.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;

-- This record is consumed as collection provenance, not as a component. The
-- converter derives boundary/time from the database snapshot instead of
-- accepting operator-supplied assertions.
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
    'database'::text AS component_kind,
    'postgresql-server'::text AS component_key,
    NULL::text AS parent_key,
    NULL::bigint AS exact_count,
    pg_catalog.jsonb_build_object(
      'server_version', pg_catalog.current_setting('server_version'),
      'server_version_num', pg_catalog.current_setting('server_version_num')::integer,
      'owner', pg_catalog.pg_get_userbyid(d.datdba),
      'acl', CASE WHEN d.datacl IS NULL THEN NULL ELSE COALESCE((
        SELECT pg_catalog.jsonb_agg(a.acl_text ORDER BY a.acl_text)
        FROM (
          SELECT acl::text AS acl_text
          FROM pg_catalog.unnest(d.datacl) AS acl
        ) AS a
      ), '[]'::jsonb) END,
      'encoding', pg_catalog.pg_encoding_to_char(d.encoding),
      'collation', d.datcollate,
      'character_type', d.datctype,
      'locale_provider', d.datlocprovider::text,
      'locale', d.datlocale,
      'icu_rules', d.daticurules,
      'collation_version', d.datcollversion,
      'connection_limit', d.datconnlimit,
      'is_template', d.datistemplate,
      'allow_connections', d.datallowconn,
      'has_login_event_triggers', d.dathasloginevt
    ) AS attributes
  FROM pg_catalog.pg_database AS d
  WHERE d.datname = pg_catalog.current_database()

  UNION ALL

  SELECT
    'schema',
    pg_catalog.format('%I', n.nspname),
    NULL,
    NULL,
    pg_catalog.jsonb_build_object(
      'owner', pg_catalog.pg_get_userbyid(n.nspowner),
      'acl', CASE WHEN n.nspacl IS NULL THEN NULL ELSE COALESCE((
        SELECT pg_catalog.jsonb_agg(a.acl_text ORDER BY a.acl_text)
        FROM (
          SELECT acl::text AS acl_text
          FROM pg_catalog.unnest(n.nspacl) AS acl
        ) AS a
      ), '[]'::jsonb) END
    )
  FROM pg_catalog.pg_namespace AS n
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_toast'
    AND n.nspname !~ '^pg_temp'

  UNION ALL

  SELECT
    CASE c.relkind
      WHEN 'r' THEN 'table'
      WHEN 'p' THEN 'table'
      WHEN 'v' THEN 'view'
      WHEN 'm' THEN 'materialized_view'
      WHEN 'S' THEN 'sequence'
      WHEN 'f' THEN 'foreign_table'
    END,
    pg_catalog.format('%I.%I', n.nspname, c.relname),
    pg_catalog.format('%I', n.nspname),
    NULL::bigint,
    pg_catalog.jsonb_build_object(
      'relation_kind', CASE c.relkind
        WHEN 'r' THEN 'ordinary_table'
        WHEN 'p' THEN 'partitioned_table'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized_view'
        WHEN 'S' THEN 'sequence'
        WHEN 'f' THEN 'foreign_table'
      END,
      'owner', pg_catalog.pg_get_userbyid(c.relowner),
      'acl', CASE WHEN c.relacl IS NULL THEN NULL ELSE COALESCE((
        SELECT pg_catalog.jsonb_agg(a.acl_text ORDER BY a.acl_text)
        FROM (
          SELECT acl::text AS acl_text
          FROM pg_catalog.unnest(c.relacl) AS acl
        ) AS a
      ), '[]'::jsonb) END,
      'persistence', c.relpersistence::text,
      'row_security', c.relrowsecurity,
      'force_row_security', c.relforcerowsecurity,
      'replica_identity', CASE c.relreplident
        WHEN 'd' THEN 'default'
        WHEN 'n' THEN 'nothing'
        WHEN 'f' THEN 'full'
        WHEN 'i' THEN 'index'
      END,
      'replica_identity_index', (
        SELECT pg_catalog.format('%I.%I', ni.nspname, ci.relname)
        FROM pg_catalog.pg_index AS xi
        JOIN pg_catalog.pg_class AS ci ON ci.oid = xi.indexrelid
        JOIN pg_catalog.pg_namespace AS ni ON ni.oid = ci.relnamespace
        WHERE xi.indrelid = c.oid AND xi.indisreplident
      ),
      'is_partition', c.relispartition,
      'partition_bound_fingerprint', CASE
        WHEN c.relispartition THEN 'sha256:' || pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to('focus-flow-score/catalog-text/v1/partition-bound', 'UTF8') ||
          pg_catalog.decode('00', 'hex') ||
          pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(
            pg_catalog.pg_get_expr(c.relpartbound, c.oid, true), 'UTF8'
          ))::bigint) ||
          pg_catalog.convert_to(pg_catalog.pg_get_expr(c.relpartbound, c.oid, true), 'UTF8')
        ), 'hex')
        ELSE NULL
      END,
      'partition_key_fingerprint', CASE
        WHEN c.relkind = 'p' THEN 'sha256:' || pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to('focus-flow-score/catalog-text/v1/partition-key', 'UTF8') ||
          pg_catalog.decode('00', 'hex') ||
          pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(
            pg_catalog.pg_get_partkeydef(c.oid), 'UTF8'
          ))::bigint) ||
          pg_catalog.convert_to(pg_catalog.pg_get_partkeydef(c.oid), 'UTF8')
        ), 'hex')
        ELSE NULL
      END,
      'access_method', am.amname,
      'options_fingerprints', CASE WHEN c.reloptions IS NULL THEN NULL ELSE COALESCE((
        SELECT pg_catalog.jsonb_agg(o.option_fingerprint ORDER BY o.option_fingerprint)
        FROM (
          SELECT 'sha256:' || pg_catalog.encode(pg_catalog.sha256(
            pg_catalog.convert_to('focus-flow-score/catalog-text/v1/relation-option', 'UTF8') ||
            pg_catalog.decode('00', 'hex') ||
            pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(option_text, 'UTF8'))::bigint) ||
            pg_catalog.convert_to(option_text, 'UTF8')
          ), 'hex') AS option_fingerprint
          FROM pg_catalog.unnest(c.reloptions) AS option_text
        ) AS o
      ), '[]'::jsonb) END,
      'view_definition_fingerprint', CASE
        WHEN c.relkind IN ('v', 'm') THEN 'sha256:' || pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to('focus-flow-score/catalog-text/v1/view-definition', 'UTF8') ||
          pg_catalog.decode('00', 'hex') ||
          pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(
            pg_catalog.pg_get_viewdef(c.oid, true), 'UTF8'
          ))::bigint) ||
          pg_catalog.convert_to(pg_catalog.pg_get_viewdef(c.oid, true), 'UTF8')
        ), 'hex')
        ELSE NULL
      END,
      'sequence_start', seq.seqstart,
      'sequence_increment', seq.seqincrement,
      'sequence_min', seq.seqmin,
      'sequence_max', seq.seqmax,
      'sequence_cache', seq.seqcache,
      'sequence_cycle', seq.seqcycle,
      'sequence_last_value', CASE WHEN c.relkind = 'S'
        THEN pg_catalog.pg_sequence_last_value(c.oid::pg_catalog.regclass)
        ELSE NULL
      END,
      'sequence_owned_by', CASE WHEN c.relkind = 'S' THEN (
        SELECT pg_catalog.format('%I.%I.%I', own_ns.nspname, own_table.relname, own_col.attname)
        FROM pg_catalog.pg_depend AS dep
        JOIN pg_catalog.pg_class AS own_table ON own_table.oid = dep.refobjid
        JOIN pg_catalog.pg_namespace AS own_ns ON own_ns.oid = own_table.relnamespace
        JOIN pg_catalog.pg_attribute AS own_col
          ON own_col.attrelid = dep.refobjid AND own_col.attnum = dep.refobjsubid
        WHERE dep.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
          AND dep.objid = c.oid
          AND dep.objsubid = 0
          AND dep.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
          AND dep.deptype IN ('a', 'i')
        ORDER BY dep.deptype
        LIMIT 1
      ) ELSE NULL END,
      'foreign_server', fs.srvname,
      'foreign_options_fingerprints', CASE WHEN ft.ftoptions IS NULL THEN NULL ELSE COALESCE((
        SELECT pg_catalog.jsonb_agg(o.option_fingerprint ORDER BY o.option_fingerprint)
        FROM (
          SELECT 'sha256:' || pg_catalog.encode(pg_catalog.sha256(
            pg_catalog.convert_to('focus-flow-score/catalog-text/v1/foreign-table-option', 'UTF8') ||
            pg_catalog.decode('00', 'hex') ||
            pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(option_text, 'UTF8'))::bigint) ||
            pg_catalog.convert_to(option_text, 'UTF8')
          ), 'hex') AS option_fingerprint
          FROM pg_catalog.unnest(ft.ftoptions) AS option_text
        ) AS o
      ), '[]'::jsonb) END
    )
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_am AS am ON am.oid = c.relam
  LEFT JOIN pg_catalog.pg_sequence AS seq ON seq.seqrelid = c.oid
  LEFT JOIN pg_catalog.pg_foreign_table AS ft ON ft.ftrelid = c.oid
  LEFT JOIN pg_catalog.pg_foreign_server AS fs ON fs.oid = ft.ftserver
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_toast'
    AND n.nspname !~ '^pg_temp'

  UNION ALL

  SELECT
    'column',
    pg_catalog.format('%I.%I.%I', n.nspname, c.relname, a.attname),
    pg_catalog.format('%I.%I', n.nspname, c.relname),
    NULL,
    pg_catalog.jsonb_build_object(
      'ordinal', a.attnum,
      'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
      'type_schema', tn.nspname,
      'type_name', typ.typname,
      'nullable', NOT a.attnotnull,
      'default_fingerprint', CASE WHEN d.oid IS NULL THEN NULL ELSE
        'sha256:' || pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to('focus-flow-score/catalog-text/v1/column-default', 'UTF8') ||
          pg_catalog.decode('00', 'hex') ||
          pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(
            pg_catalog.pg_get_expr(d.adbin, d.adrelid, true), 'UTF8'
          ))::bigint) ||
          pg_catalog.convert_to(pg_catalog.pg_get_expr(d.adbin, d.adrelid, true), 'UTF8')
        ), 'hex')
      END,
      'generated', CASE a.attgenerated
        WHEN '' THEN 'none'
        WHEN 's' THEN 'stored'
        WHEN 'v' THEN 'virtual'
        ELSE 'unknown:' || a.attgenerated::text
      END,
      'identity', CASE a.attidentity
        WHEN '' THEN 'none'
        WHEN 'a' THEN 'always'
        WHEN 'd' THEN 'by_default'
        ELSE 'unknown:' || a.attidentity::text
      END,
      'collation', CASE
        WHEN a.attcollation = 0 THEN NULL
        ELSE pg_catalog.format('%I.%I', cn.nspname, coll.collname)
      END,
      'acl', CASE WHEN a.attacl IS NULL THEN NULL ELSE COALESCE((
        SELECT pg_catalog.jsonb_agg(x.acl_text ORDER BY x.acl_text)
        FROM (
          SELECT acl::text AS acl_text
          FROM pg_catalog.unnest(a.attacl) AS acl
        ) AS x
      ), '[]'::jsonb) END
    )
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_type AS typ ON typ.oid = a.atttypid
  JOIN pg_catalog.pg_namespace AS tn ON tn.oid = typ.typnamespace
  LEFT JOIN pg_catalog.pg_attrdef AS d
    ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  LEFT JOIN pg_catalog.pg_collation AS coll ON coll.oid = a.attcollation
  LEFT JOIN pg_catalog.pg_namespace AS cn ON cn.oid = coll.collnamespace
  WHERE a.attnum > 0
    AND NOT a.attisdropped
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_toast'
    AND n.nspname !~ '^pg_temp'

  UNION ALL

  SELECT
    'index',
    pg_catalog.format('%I.%I', n.nspname, i.relname),
    pg_catalog.format('%I.%I', n.nspname, t.relname),
    NULL,
    pg_catalog.jsonb_build_object(
      'definition_fingerprint', 'sha256:' || pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.convert_to('focus-flow-score/catalog-text/v1/index-definition', 'UTF8') ||
        pg_catalog.decode('00', 'hex') ||
        pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(
          pg_catalog.pg_get_indexdef(i.oid), 'UTF8'
        ))::bigint) ||
        pg_catalog.convert_to(pg_catalog.pg_get_indexdef(i.oid), 'UTF8')
      ), 'hex'),
      'owner', pg_catalog.pg_get_userbyid(i.relowner),
      'acl', CASE WHEN i.relacl IS NULL THEN NULL ELSE COALESCE((
        SELECT pg_catalog.jsonb_agg(a.acl_text ORDER BY a.acl_text)
        FROM (
          SELECT acl::text AS acl_text
          FROM pg_catalog.unnest(i.relacl) AS acl
        ) AS a
      ), '[]'::jsonb) END,
      'valid', x.indisvalid,
      'ready', x.indisready,
      'unique', x.indisunique,
      'primary', x.indisprimary,
      'exclusion', x.indisexclusion,
      'replica_identity', x.indisreplident
    )
  FROM pg_catalog.pg_class AS i
  JOIN pg_catalog.pg_namespace AS n ON n.oid = i.relnamespace
  JOIN pg_catalog.pg_index AS x ON x.indexrelid = i.oid
  JOIN pg_catalog.pg_class AS t ON t.oid = x.indrelid
  WHERE i.relkind IN ('i', 'I')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_toast'
    AND n.nspname !~ '^pg_temp'

  UNION ALL

  SELECT
    'constraint',
    CASE
      WHEN con.conrelid <> 0
        THEN pg_catalog.format('%I.%I.%I', rn.nspname, rc.relname, con.conname)
      ELSE pg_catalog.format('%I.%I.%I', tn.nspname, typ.typname, con.conname)
    END,
    CASE
      WHEN con.conrelid <> 0
        THEN pg_catalog.format('%I.%I', rn.nspname, rc.relname)
      ELSE pg_catalog.format('%I.%I', tn.nspname, typ.typname)
    END,
    NULL,
    pg_catalog.jsonb_build_object(
      'constraint_type', con.contype::text,
      'definition_fingerprint', 'sha256:' || pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.convert_to('focus-flow-score/catalog-text/v1/constraint-definition', 'UTF8') ||
        pg_catalog.decode('00', 'hex') ||
        pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(
          pg_catalog.pg_get_constraintdef(con.oid, true), 'UTF8'
        ))::bigint) ||
        pg_catalog.convert_to(pg_catalog.pg_get_constraintdef(con.oid, true), 'UTF8')
      ), 'hex'),
      'validated', con.convalidated,
      'deferrable', con.condeferrable,
      'initially_deferred', con.condeferred,
      'no_inherit', con.connoinherit
    )
  FROM pg_catalog.pg_constraint AS con
  LEFT JOIN pg_catalog.pg_class AS rc ON rc.oid = con.conrelid
  LEFT JOIN pg_catalog.pg_namespace AS rn ON rn.oid = rc.relnamespace
  LEFT JOIN pg_catalog.pg_type AS typ ON typ.oid = con.contypid
  LEFT JOIN pg_catalog.pg_namespace AS tn ON tn.oid = typ.typnamespace
  WHERE (
      con.conrelid <> 0
      AND rn.nspname NOT IN ('pg_catalog', 'information_schema')
      AND rn.nspname !~ '^pg_toast'
      AND rn.nspname !~ '^pg_temp'
    ) OR (
      con.contypid <> 0
      AND tn.nspname NOT IN ('pg_catalog', 'information_schema')
      AND tn.nspname !~ '^pg_toast'
      AND tn.nspname !~ '^pg_temp'
    )

  UNION ALL

  SELECT
    CASE t.typtype WHEN 'e' THEN 'enum' WHEN 'd' THEN 'domain' END,
    pg_catalog.format('%I.%I', n.nspname, t.typname),
    pg_catalog.format('%I', n.nspname),
    NULL,
    pg_catalog.jsonb_build_object(
      'owner', pg_catalog.pg_get_userbyid(t.typowner),
      'acl', CASE WHEN t.typacl IS NULL THEN NULL ELSE COALESCE((
        SELECT pg_catalog.jsonb_agg(a.acl_text ORDER BY a.acl_text)
        FROM (
          SELECT acl::text AS acl_text
          FROM pg_catalog.unnest(t.typacl) AS acl
        ) AS a
      ), '[]'::jsonb) END,
      'enum_labels', CASE WHEN t.typtype = 'e' THEN COALESCE((
        SELECT pg_catalog.jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
        FROM pg_catalog.pg_enum AS e
        WHERE e.enumtypid = t.oid
      ), '[]'::jsonb) ELSE NULL END,
      'base_type', CASE
        WHEN t.typtype = 'd' THEN pg_catalog.format_type(t.typbasetype, t.typtypmod)
        ELSE NULL
      END,
      'not_null', CASE WHEN t.typtype = 'd' THEN t.typnotnull ELSE NULL END,
      'default_fingerprint', CASE WHEN t.typtype = 'd' AND t.typdefault IS NOT NULL THEN
        'sha256:' || pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to('focus-flow-score/catalog-text/v1/domain-default', 'UTF8') ||
          pg_catalog.decode('00', 'hex') ||
          pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(t.typdefault, 'UTF8'))::bigint) ||
          pg_catalog.convert_to(t.typdefault, 'UTF8')
        ), 'hex')
        ELSE NULL
      END,
      'collation', CASE
        WHEN t.typtype = 'd' AND t.typcollation <> 0
          THEN pg_catalog.format('%I.%I', cn.nspname, coll.collname)
        ELSE NULL
      END
    )
  FROM pg_catalog.pg_type AS t
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
  LEFT JOIN pg_catalog.pg_collation AS coll ON coll.oid = t.typcollation
  LEFT JOIN pg_catalog.pg_namespace AS cn ON cn.oid = coll.collnamespace
  WHERE t.typtype IN ('e', 'd')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_toast'
    AND n.nspname !~ '^pg_temp'

  UNION ALL

  SELECT
    'function',
    pg_catalog.format(
      '%I.%I(%s)', n.nspname, p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid)
    ),
    pg_catalog.format('%I', n.nspname),
    NULL,
    pg_catalog.jsonb_build_object(
      'definition_fingerprint', 'sha256:' || pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.convert_to('focus-flow-score/catalog-text/v1/function-definition', 'UTF8') ||
        pg_catalog.decode('00', 'hex') ||
        pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(
          pg_catalog.pg_get_functiondef(p.oid), 'UTF8'
        ))::bigint) ||
        pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid), 'UTF8')
      ), 'hex'),
      'owner', pg_catalog.pg_get_userbyid(p.proowner),
      'acl', CASE WHEN p.proacl IS NULL THEN NULL ELSE COALESCE((
        SELECT pg_catalog.jsonb_agg(a.acl_text ORDER BY a.acl_text)
        FROM (
          SELECT acl::text AS acl_text
          FROM pg_catalog.unnest(p.proacl) AS acl
        ) AS a
      ), '[]'::jsonb) END,
      'object_type', CASE p.prokind
        WHEN 'f' THEN 'function'
        WHEN 'p' THEN 'procedure'
      END,
      'language', l.lanname,
      'security_definer', p.prosecdef,
      'leakproof', p.proleakproof,
      'volatility', p.provolatile::text,
      'parallel', p.proparallel::text,
      'configuration_fingerprints', CASE WHEN p.proconfig IS NULL THEN NULL ELSE COALESCE((
        SELECT pg_catalog.jsonb_agg(o.option_fingerprint ORDER BY o.option_fingerprint)
        FROM (
          SELECT 'sha256:' || pg_catalog.encode(pg_catalog.sha256(
            pg_catalog.convert_to('focus-flow-score/catalog-text/v1/function-configuration', 'UTF8') ||
            pg_catalog.decode('00', 'hex') ||
            pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(option_text, 'UTF8'))::bigint) ||
            pg_catalog.convert_to(option_text, 'UTF8')
          ), 'hex') AS option_fingerprint
          FROM pg_catalog.unnest(p.proconfig) AS option_text
        ) AS o
      ), '[]'::jsonb) END
    )
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
  WHERE p.prokind IN ('f', 'p')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_toast'
    AND n.nspname !~ '^pg_temp'

  UNION ALL

  SELECT
    'trigger',
    pg_catalog.format('%I.%I.%I', n.nspname, c.relname, t.tgname),
    pg_catalog.format('%I.%I', n.nspname, c.relname),
    NULL,
    pg_catalog.jsonb_build_object(
      'definition_fingerprint', 'sha256:' || pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.convert_to('focus-flow-score/catalog-text/v1/trigger-definition', 'UTF8') ||
        pg_catalog.decode('00', 'hex') ||
        pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(
          pg_catalog.pg_get_triggerdef(t.oid, true), 'UTF8'
        ))::bigint) ||
        pg_catalog.convert_to(pg_catalog.pg_get_triggerdef(t.oid, true), 'UTF8')
      ), 'hex'),
      'enabled', t.tgenabled::text
    )
  FROM pg_catalog.pg_trigger AS t
  JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_toast'
    AND n.nspname !~ '^pg_temp'

  UNION ALL

  SELECT
    'policy',
    pg_catalog.format('%I.%I.%I', p.schemaname, p.tablename, p.policyname),
    pg_catalog.format('%I.%I', p.schemaname, p.tablename),
    NULL,
    pg_catalog.jsonb_build_object(
      'permissive', p.permissive,
      'roles', COALESCE((
        SELECT pg_catalog.jsonb_agg(role_name ORDER BY role_name)
        FROM pg_catalog.unnest(p.roles) AS role_name
      ), '[]'::jsonb),
      'command', p.cmd,
      'using_fingerprint', CASE WHEN p.qual IS NULL THEN NULL ELSE
        'sha256:' || pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to('focus-flow-score/catalog-text/v1/policy-using', 'UTF8') ||
          pg_catalog.decode('00', 'hex') ||
          pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(p.qual, 'UTF8'))::bigint) ||
          pg_catalog.convert_to(p.qual, 'UTF8')
        ), 'hex')
      END,
      'with_check_fingerprint', CASE WHEN p.with_check IS NULL THEN NULL ELSE
        'sha256:' || pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to('focus-flow-score/catalog-text/v1/policy-with-check', 'UTF8') ||
          pg_catalog.decode('00', 'hex') ||
          pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(p.with_check, 'UTF8'))::bigint) ||
          pg_catalog.convert_to(p.with_check, 'UTF8')
        ), 'hex')
      END
    )
  FROM pg_catalog.pg_policies AS p

  UNION ALL

  SELECT
    'extension',
    e.extname,
    pg_catalog.format('%I', n.nspname),
    NULL,
    pg_catalog.jsonb_build_object(
      'version', e.extversion,
      'schema', n.nspname,
      'owner', pg_catalog.pg_get_userbyid(e.extowner),
      'relocatable', e.extrelocatable
    )
  FROM pg_catalog.pg_extension AS e
  JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace

  UNION ALL

  SELECT
    'publication',
    p.pubname,
    NULL,
    NULL,
    pg_catalog.jsonb_build_object(
      'owner', pg_catalog.pg_get_userbyid(p.pubowner),
      'all_tables', p.puballtables,
      'insert', p.pubinsert,
      'update', p.pubupdate,
      'delete', p.pubdelete,
      'truncate', p.pubtruncate,
      'via_partition_root', p.pubviaroot
    )
  FROM pg_catalog.pg_publication AS p

  UNION ALL

  SELECT
    'publication_table',
    pg_catalog.format('%I:%I.%I', p.pubname, p.schemaname, p.tablename),
    p.pubname,
    NULL,
    pg_catalog.jsonb_build_object(
      'table', pg_catalog.format('%I.%I', p.schemaname, p.tablename),
      'columns', to_jsonb(p.attnames),
      'row_filter_fingerprint', CASE WHEN p.rowfilter IS NULL THEN NULL ELSE
        'sha256:' || pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to('focus-flow-score/catalog-text/v1/publication-row-filter', 'UTF8') ||
          pg_catalog.decode('00', 'hex') ||
          pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(p.rowfilter, 'UTF8'))::bigint) ||
          pg_catalog.convert_to(p.rowfilter, 'UTF8')
        ), 'hex')
      END
    )
  FROM pg_catalog.pg_publication_tables AS p

  UNION ALL

  SELECT
    'default_privilege',
    pg_catalog.format(
      '%I@%s:%s',
      pg_catalog.pg_get_userbyid(d.defaclrole),
      COALESCE(pg_catalog.format('%I', n.nspname), '*'),
      d.defaclobjtype::text
    ),
    CASE WHEN n.oid IS NULL THEN NULL ELSE pg_catalog.format('%I', n.nspname) END,
    NULL,
    pg_catalog.jsonb_build_object(
      'owner', pg_catalog.pg_get_userbyid(d.defaclrole),
      'schema', n.nspname,
      'object_type', CASE d.defaclobjtype
        WHEN 'r' THEN 'table'
        WHEN 'S' THEN 'sequence'
        WHEN 'f' THEN 'function'
        WHEN 'T' THEN 'type'
        WHEN 'n' THEN 'schema'
        WHEN 'L' THEN 'large_object'
        ELSE 'unknown:' || d.defaclobjtype::text
      END,
      'acl', CASE WHEN d.defaclacl IS NULL THEN NULL ELSE COALESCE((
        SELECT pg_catalog.jsonb_agg(a.acl_text ORDER BY a.acl_text)
        FROM (
          SELECT acl::text AS acl_text
          FROM pg_catalog.unnest(d.defaclacl) AS acl
        ) AS a
      ), '[]'::jsonb) END
    )
  FROM pg_catalog.pg_default_acl AS d
  LEFT JOIN pg_catalog.pg_namespace AS n ON n.oid = d.defaclnamespace
) AS r
ORDER BY r.component_kind, r.component_key, r.parent_key;

-- Add exact counts to every non-system table component. A permission error is
-- a failed collection, never an implicit zero or an omitted component. No PK
-- values or min/max row-derived evidence is emitted.
SELECT pg_catalog.format(
  'SELECT pg_catalog.jsonb_build_object(' ||
  '%L, 1, %L, %L, %L, %L, %L, %L, %L, %L, %L, count(*)::bigint, %L, %L::jsonb)::text ' ||
  'FROM %I.%I;',
  'record_version',
  'record_kind', 'count',
  'component_kind', 'table',
  'key', pg_catalog.format('%I.%I', n.nspname, c.relname),
  'parent', pg_catalog.format('%I', n.nspname),
  'count',
  'attributes', '{}',
  n.nspname, c.relname
)
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('information_schema', 'pg_catalog')
  AND n.nspname !~ '^pg_toast'
  AND n.nspname !~ '^pg_temp'
ORDER BY n.nspname, c.relname
\gexec

COMMIT;
