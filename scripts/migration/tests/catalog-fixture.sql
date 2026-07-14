\set ON_ERROR_STOP on

DROP PUBLICATION IF EXISTS verify_fixture_publication;
DROP SCHEMA IF EXISTS verify_fixture CASCADE;

CREATE SCHEMA verify_fixture;

ALTER DEFAULT PRIVILEGES IN SCHEMA verify_fixture
  GRANT SELECT ON TABLES TO PUBLIC;

CREATE TYPE verify_fixture.item_state AS ENUM ('new', 'ready');
CREATE DOMAIN verify_fixture.short_note AS text
  DEFAULT 'CATALOG_SECRET_SENTINEL_DOMAIN'
  CHECK (octet_length(VALUE) <= 64);

CREATE TABLE verify_fixture.items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text COLLATE "C" NOT NULL DEFAULT 'CATALOG_SECRET_SENTINEL_COLUMN',
  normalized text GENERATED ALWAYS AS (lower(code)) STORED,
  note verify_fixture.short_note,
  state verify_fixture.item_state NOT NULL DEFAULT 'new',
  updated_at timestamptz NOT NULL DEFAULT '2026-07-14 12:00:00+00'
);

ALTER TABLE verify_fixture.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE verify_fixture.items FORCE ROW LEVEL SECURITY;
ALTER TABLE verify_fixture.items REPLICA IDENTITY FULL;
GRANT SELECT ON verify_fixture.items TO PUBLIC;

CREATE POLICY fixture_read
  ON verify_fixture.items
  FOR SELECT
  TO PUBLIC
  USING (true);

CREATE INDEX items_state_idx ON verify_fixture.items (state, id);

CREATE FUNCTION verify_fixture.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, verify_fixture
AS $$
BEGIN
  PERFORM 'CATALOG_SECRET_SENTINEL_FUNCTION';
  NEW.updated_at := '2026-07-14 12:00:00+00'::timestamptz;
  RETURN NEW;
END;
$$;

CREATE TRIGGER items_touch_updated_at
BEFORE UPDATE ON verify_fixture.items
FOR EACH ROW
EXECUTE FUNCTION verify_fixture.touch_updated_at();

CREATE VIEW verify_fixture.item_codes
WITH (security_invoker = true)
AS SELECT id, code FROM verify_fixture.items;

CREATE SEQUENCE verify_fixture.external_counter
  START WITH -50 INCREMENT BY -5 MINVALUE -100 MAXVALUE -1;

INSERT INTO verify_fixture.items (code, note, state)
VALUES
  ('alpha', 'first synthetic row', 'new'),
  ('beta', 'second synthetic row', 'ready');

DO $$BEGIN
  PERFORM nextval('verify_fixture.external_counter');
END$$;

CREATE PUBLICATION verify_fixture_publication
  FOR TABLE verify_fixture.items (id, code)
  WHERE (id > 0);
