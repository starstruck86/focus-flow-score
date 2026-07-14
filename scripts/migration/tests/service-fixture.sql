\set ON_ERROR_STOP on

DO $$
BEGIN
  IF pg_catalog.current_database() !~ '^migration_verify_' THEN
    RAISE EXCEPTION 'service fixture requires a disposable migration_verify_* database';
  END IF;
END
$$;

DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS storage CASCADE;
DROP SCHEMA IF EXISTS cron CASCADE;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id bigint PRIMARY KEY);
CREATE TABLE auth.identities (id bigint PRIMARY KEY);
INSERT INTO auth.users VALUES (1), (2);
INSERT INTO auth.identities VALUES (1), (2), (3);

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  public boolean NOT NULL,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id bigint PRIMARY KEY,
  bucket_id text NOT NULL REFERENCES storage.buckets(id)
);
INSERT INTO storage.buckets VALUES
  ('empty-private', false, NULL, NULL),
  ('fixture-public', true, 4096, ARRAY['image/png', 'text/plain']);
INSERT INTO storage.objects VALUES
  (1, 'fixture-public'),
  (2, 'fixture-public'),
  (3, 'fixture-public');

CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigint PRIMARY KEY,
  jobname text,
  schedule text NOT NULL,
  command text NOT NULL,
  nodename text NOT NULL,
  nodeport integer NOT NULL,
  database text NOT NULL,
  username text NOT NULL,
  active boolean NOT NULL
);
INSERT INTO cron.job VALUES (
  1,
  'synthetic-job',
  '0 3 * * *',
  'select ''SERVICE_COMMAND_SECRET_SENTINEL''',
  'localhost',
  5432,
  pg_catalog.current_database(),
  CURRENT_USER,
  false
);
