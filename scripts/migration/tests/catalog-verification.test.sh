#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/migration-catalog-test.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

export PGHOST=${PGHOST:-127.0.0.1}
export PGPORT=${PGPORT:-5432}
export PGUSER=${PGUSER:-postgres}
export PGPASSWORD=${PGPASSWORD:-postgres}
export PGDATABASE=${PGDATABASE:-postgres}

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

psql_fixture -f - < "$ROOT/scripts/migration/tests/catalog-fixture.sql"
psql_fixture -f - < "$ROOT/scripts/migration/verification/catalog-and-counts.sql" \
  > "$TMP_DIR/source catalog.jsonl"

python3 "$ROOT/scripts/migration/catalog-jsonl-to-manifest.py" \
  "$TMP_DIR/source catalog.jsonl" \
  --output "$TMP_DIR/source manifest.json" \
  --label "synthetic PostgreSQL source" \
  --role source \
  --project-ref synthetic-source-pg17 \
  --artifact-source synthetic-postgresql-17-source

# Capture an unmodified target artifact first. This is the positive control:
# every component must compare as Match before the planted failure is added.
psql_fixture -f - < "$ROOT/scripts/migration/verification/catalog-and-counts.sql" \
  > "$TMP_DIR/baseline target catalog.jsonl"

python3 "$ROOT/scripts/migration/catalog-jsonl-to-manifest.py" \
  "$TMP_DIR/baseline target catalog.jsonl" \
  --output "$TMP_DIR/baseline target manifest.json" \
  --label "synthetic PostgreSQL baseline target" \
  --role target \
  --project-ref synthetic-target-pg17 \
  --artifact-source synthetic-postgresql-17-baseline-target

python3 "$ROOT/scripts/migration/compare-manifests.py" \
  "$TMP_DIR/source manifest.json" \
  "$TMP_DIR/baseline target manifest.json" \
  --format json > "$TMP_DIR/baseline match.json"

python3 -c '
import json, pathlib, sys
result = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
assert result["results"], "baseline comparison unexpectedly empty"
assert all(row["outcomes"] == ["Match"] for row in result["results"])
' "$TMP_DIR/baseline match.json"

psql_fixture -c \
  "ALTER TABLE verify_fixture.items ALTER COLUMN code SET DEFAULT 'planted-mismatch';"
psql_fixture -f - < "$ROOT/scripts/migration/verification/catalog-and-counts.sql" \
  > "$TMP_DIR/target catalog.jsonl"

python3 "$ROOT/scripts/migration/catalog-jsonl-to-manifest.py" \
  "$TMP_DIR/target catalog.jsonl" \
  --output "$TMP_DIR/target manifest.json" \
  --label "synthetic PostgreSQL target" \
  --role target \
  --project-ref synthetic-target-pg17 \
  --artifact-source synthetic-postgresql-17-target

python3 -c '
import json, pathlib, sys
manifest = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
items = {(item["kind"], item["key"]): item for item in manifest["components"]}
assert items[("table", "verify_fixture.items")]["count"] == 2
assert items[("sequence", "verify_fixture.external_counter")]["count"] is None
required = {
    ("column", "verify_fixture.items.code"),
    ("default_privilege", "postgres@verify_fixture:r"),
    ("enum", "verify_fixture.item_state"),
    ("domain", "verify_fixture.short_note"),
    ("function", "verify_fixture.touch_updated_at()"),
    ("publication", "verify_fixture_publication"),
    ("publication_table", "verify_fixture_publication:verify_fixture.items"),
    ("trigger", "verify_fixture.items.items_touch_updated_at"),
}
missing = sorted(required - set(items))
assert not missing, missing
' "$TMP_DIR/source manifest.json"

python3 -c '
import json, pathlib, sys
rows = [json.loads(line) for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()]
sequence = next(row for row in rows if row.get("component_kind") == "sequence" and row.get("key") == "verify_fixture.external_counter")
assert sequence["count"] is None
assert sequence["attributes"]["sequence_last_value"] == -50
assert sequence["attributes"]["sequence_min"] == -100
assert sequence["attributes"]["sequence_owned_by"] is None
' "$TMP_DIR/source catalog.jsonl"

set +e
python3 "$ROOT/scripts/migration/compare-manifests.py" \
  "$TMP_DIR/source manifest.json" \
  "$TMP_DIR/target manifest.json" \
  --format json > "$TMP_DIR/planted mismatch.json"
compare_status=$?
set -e

if [[ $compare_status -ne 2 ]]; then
  echo "expected planted catalog mismatch to exit 2, got $compare_status" >&2
  exit 1
fi

python3 -c '
import json, pathlib, sys
result = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
by_key = {row["key"]: row["outcomes"] for row in result["results"]}
outcomes = by_key.get("verify_fixture.items.code", [])
assert "Configuration mismatch" in outcomes, outcomes
' "$TMP_DIR/planted mismatch.json"

if rg -q 'primary_key_range|minimum_value|maximum_value' \
  "$TMP_DIR/source catalog.jsonl"; then
  echo "collector leaked forbidden PK-derived range evidence" >&2
  exit 1
fi

if rg -q \
  'CATALOG_SECRET_SENTINEL_(COLUMN|DOMAIN|FUNCTION)' \
  "$TMP_DIR/source catalog.jsonl" \
  "$TMP_DIR/source manifest.json"; then
  echo "collector leaked a synthetic metadata secret sentinel" >&2
  exit 1
fi

echo "catalog verification integration: PASS"
