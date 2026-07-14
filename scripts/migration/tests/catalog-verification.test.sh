#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/migration-catalog-test.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

source "$ROOT/scripts/migration/tests/lib/postgres-test-safety.sh"

export PGHOST=${PGHOST:-/var/run/postgresql}
export PGPORT=${PGPORT:-5432}
export PGUSER=${PGUSER:-postgres}
export PGPASSWORD=${PGPASSWORD:-postgres}
export PGDATABASE=${PGDATABASE:-migration_verify_catalog}
export PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-5}

migration_verify_require_safe_target
migration_verify_require_command grep
migration_verify_require_command python3

for required_path in \
  "$ROOT/scripts/migration/tests/catalog-fixture.sql" \
  "$ROOT/scripts/migration/verification/catalog-and-counts.sql" \
  "$ROOT/scripts/migration/catalog-jsonl-to-manifest.py" \
  "$ROOT/scripts/migration/compare-manifests.py"; do
  migration_verify_require_file "$required_path"
done

if [[ -n ${POSTGRES_CONTAINER:-} ]]; then
  migration_verify_require_command docker
  if ! docker_endpoint=$(docker context inspect --format \
    '{{ (index .Endpoints "docker").Host }}'); then
    echo "could not inspect the selected Docker context before fixture setup" >&2
    exit 2
  fi
  migration_verify_validate_docker_endpoint "$docker_endpoint"
  if ! container_test_label=$(docker inspect --format \
    '{{ index .Config.Labels "com.focus-flow.migration-verify" }}' \
    "$POSTGRES_CONTAINER"); then
    echo "could not inspect the PostgreSQL test container before fixture setup" >&2
    exit 2
  fi
  migration_verify_validate_container_label "$container_test_label"
  docker exec "$POSTGRES_CONTAINER" psql --version >/dev/null
else
  migration_verify_require_command psql
fi

python3 -c '
from pathlib import Path
import sys
for raw_path in sys.argv[1:]:
    path = Path(raw_path)
    compile(path.read_text(encoding="utf-8"), str(path), "exec")
' \
  "$ROOT/scripts/migration/catalog-jsonl-to-manifest.py" \
  "$ROOT/scripts/migration/compare-manifests.py"

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

if ! target_identity=$(psql_fixture -A -t -F '|' -c \
  "SELECT pg_catalog.current_database(),
          pg_catalog.current_setting('server_version_num')::integer / 10000,
          COALESCE(pg_catalog.inet_server_addr()::text, 'local-socket');"); then
  echo "database identity probe failed before fixture setup" >&2
  exit 2
fi
if [[ -n ${POSTGRES_CONTAINER:-} ]]; then
  migration_verify_validate_identity "$target_identity" container
else
  migration_verify_validate_identity "$target_identity" direct
fi

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
if not result["results"]:
    raise SystemExit("baseline comparison unexpectedly empty")
if not all(row["outcomes"] == ["Match"] for row in result["results"]):
    raise SystemExit("baseline comparison contained a non-Match outcome")
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
if items[("table", "verify_fixture.items")]["count"] != 2:
    raise SystemExit("fixture table count was not persisted")
if items[("sequence", "verify_fixture.external_counter")]["count"] is not None:
    raise SystemExit("sequence unexpectedly carried a table count")
required = {
    ("column", "verify_fixture.items.code"),
    ("enum", "verify_fixture.item_state"),
    ("domain", "verify_fixture.short_note"),
    ("function", "verify_fixture.touch_updated_at()"),
    ("publication", "verify_fixture_publication"),
    ("publication_table", "verify_fixture_publication:verify_fixture.items"),
    ("trigger", "verify_fixture.items.items_touch_updated_at"),
}
missing = sorted(required - set(items))
if missing:
    raise SystemExit(f"required catalog components missing: {missing}")
default_privileges = sorted(
    key for kind, key in items if kind == "default_privilege" and key.endswith("@verify_fixture:r")
)
if len(default_privileges) != 1:
    raise SystemExit(f"unexpected default privilege inventory: {default_privileges}")
' "$TMP_DIR/source manifest.json"

python3 -c '
import json, pathlib, sys
rows = [json.loads(line) for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()]
sequence = next(row for row in rows if row.get("component_kind") == "sequence" and row.get("key") == "verify_fixture.external_counter")
if sequence["count"] is not None:
    raise SystemExit("sequence unexpectedly carried a table count")
if sequence["attributes"]["sequence_last_value"] != -50:
    raise SystemExit("negative sequence last value was not preserved")
if sequence["attributes"]["sequence_min"] != -100:
    raise SystemExit("negative sequence minimum was not preserved")
if sequence["attributes"]["sequence_owned_by"] is not None:
    raise SystemExit("unowned sequence was reported as owned")
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
if "Configuration mismatch" not in outcomes:
    raise SystemExit(f"planted mismatch was not detected: {outcomes}")
' "$TMP_DIR/planted mismatch.json"

migration_verify_assert_absent \
  -Eq 'primary_key_range|minimum_value|maximum_value' \
  "collector leaked forbidden PK-derived range evidence" \
  "$TMP_DIR/source catalog.jsonl"

migration_verify_assert_absent \
  -Fq 'CATALOG_SECRET_SENTINEL_' \
  "collector leaked a synthetic metadata secret sentinel" \
  "$TMP_DIR/source catalog.jsonl" \
  "$TMP_DIR/source manifest.json"

echo "catalog verification integration: PASS"
