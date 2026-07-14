\set ON_ERROR_STOP on
\pset pager off

-- Supabase service-schema counts. This file is intentionally separate from
-- catalog-and-counts.sql because auth/storage/cron access depends on the role.
-- It returns counts and identifiers only; it never returns user or object rows.
BEGIN TRANSACTION READ ONLY;

SELECT 'auth.users' AS component, count(*)::bigint AS exact_count
FROM auth.users
UNION ALL
SELECT 'auth.identities', count(*)::bigint
FROM auth.identities
ORDER BY 1;

SELECT 'storage.bucket:' || b.id AS component,
       count(o.id)::bigint AS exact_count
FROM storage.buckets AS b
LEFT JOIN storage.objects AS o ON o.bucket_id = b.id
GROUP BY b.id
ORDER BY b.id;

SELECT 'cron.job:' || jobid::text AS component,
       1::bigint AS exact_count,
       jobname,
       schedule,
       active,
       'md5:' || pg_catalog.md5(command) AS command_fingerprint
FROM cron.job
ORDER BY jobid;

COMMIT;
