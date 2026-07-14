#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/migration-service-test.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

source "$ROOT/scripts/migration/tests/lib/postgres-test-safety.sh"

export PGHOST=${PGHOST:-/var/run/postgresql}
export PGPORT=${PGPORT:-5432}
export PGUSER=${PGUSER:-postgres}
export PGPASSWORD=${PGPASSWORD:-postgres}
export PGDATABASE=${PGDATABASE:-migration_verify_service}
export PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-5}

migration_verify_require_safe_target
migration_verify_require_command grep
migration_verify_require_command python3

for required_path in \
  "$ROOT/scripts/migration/tests/service-fixture.sql" \
  "$ROOT/scripts/migration/verification/supabase-service-counts.sql" \
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
expected_counts = {
    ("auth", "auth.users"): 2,
    ("auth", "auth.identities"): 3,
    ("storage", "storage.bucket:empty-private"): 0,
    ("storage", "storage.bucket:fixture-public"): 3,
    ("job", "cron.job:synthetic-job"): 1,
}
for key, expected in expected_counts.items():
    actual = items[key]["count"]
    if actual != expected:
        raise SystemExit(f"unexpected count for {key}: expected {expected}, got {actual}")
result = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
if not result["results"]:
    raise SystemExit("service comparison unexpectedly empty")
if not all(row["outcomes"] == ["Match"] for row in result["results"]):
    raise SystemExit("service comparison contained a non-Match outcome")
' "$TMP_DIR/source service manifest.json" "$TMP_DIR/service match.json"

migration_verify_assert_absent \
  -Fq 'SERVICE_COMMAND_SECRET_SENTINEL' \
  "service collector leaked a synthetic cron command sentinel" \
  "$TMP_DIR/source service.jsonl" \
  "$TMP_DIR/source service manifest.json"

echo "service verification integration: PASS"
