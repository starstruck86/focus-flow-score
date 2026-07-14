#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/migration-service-test.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

export PGHOST=${PGHOST:-127.0.0.1}
export PGPORT=${PGPORT:-5432}
export PGUSER=${PGUSER:-postgres}
export PGPASSWORD=${PGPASSWORD:-postgres}
export PGDATABASE=${PGDATABASE:-migration_verify_service}

[[ "$PGDATABASE" == migration_verify_* ]] || {
  echo "service verification requires a disposable migration_verify_* database" >&2
  exit 2
}

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

psql_fixture -f - < "$ROOT/scripts/migration/tests/service-fixture.sql"
psql_fixture -f - < "$ROOT/scripts/migration/verification/supabase-service-counts.sql" \
  > "$TMP_DIR/source service.jsonl"

python3 "$ROOT/scripts/migration/catalog-jsonl-to-manifest.py" \
  "$TMP_DIR/source service.jsonl" \
  --output "$TMP_DIR/source service manifest.json" \
  --label "synthetic service source" \
  --role source \
  --project-ref synthetic-service-source \
  --artifact-source synthetic-postgresql-17-service-source \
  --evidence-kind service_inventory

psql_fixture -f - < "$ROOT/scripts/migration/verification/supabase-service-counts.sql" \
  > "$TMP_DIR/target service.jsonl"

python3 "$ROOT/scripts/migration/catalog-jsonl-to-manifest.py" \
  "$TMP_DIR/target service.jsonl" \
  --output "$TMP_DIR/target service manifest.json" \
  --label "synthetic service target" \
  --role target \
  --project-ref synthetic-service-target \
  --artifact-source synthetic-postgresql-17-service-target \
  --evidence-kind service_inventory

python3 "$ROOT/scripts/migration/compare-manifests.py" \
  "$TMP_DIR/source service manifest.json" \
  "$TMP_DIR/target service manifest.json" \
  --format json > "$TMP_DIR/service match.json"

python3 -c '
import json, pathlib, sys
manifest = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
items = {(item["kind"], item["key"]): item for item in manifest["components"]}
assert items[("auth", "auth.users")]["count"] == 2
assert items[("auth", "auth.identities")]["count"] == 3
assert items[("storage", "storage.bucket:empty-private")]["count"] == 0
assert items[("storage", "storage.bucket:fixture-public")]["count"] == 3
assert items[("job", "cron.job:synthetic-job")]["count"] == 1
result = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
assert result["results"]
assert all(row["outcomes"] == ["Match"] for row in result["results"])
' "$TMP_DIR/source service manifest.json" "$TMP_DIR/service match.json"

if rg -q 'SERVICE_COMMAND_SECRET_SENTINEL' \
  "$TMP_DIR/source service.jsonl" \
  "$TMP_DIR/source service manifest.json"; then
  echo "service collector leaked a synthetic cron command sentinel" >&2
  exit 1
fi

echo "service verification integration: PASS"
