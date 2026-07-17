#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
LC_ALL=C
export LC_ALL
umask 077

# Synthetic evidence only. PostgreSQL does not guarantee that output written by
# a newer pg_dump can be loaded into an older server, even when the source was
# older. A passing PostgreSQL 17 target below proves only the exact semantics
# asserted by this synthetic test.

readonly ROOT="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly LOCK_FILE="${ROOT}/scripts/migration/tests/postgres-cross-major-images.lock.json"
readonly LOCK_VALIDATOR="${ROOT}/scripts/migration/validate-postgres-image-lock.py"
readonly LABEL_KEY='com.focus-flow-score.fixture'
readonly LABEL_VALUE='postgres-cross-major-compatibility'
readonly LABEL="${LABEL_KEY}=${LABEL_VALUE}"
readonly PASSWORD='synthetic-cross-major-password'
readonly ROW_SENTINEL='SYNTHETIC_ROW_PAYLOAD_MUST_NOT_APPEAR_IN_TOC'
readonly TOC_CAP_BYTES=$((1024 * 1024))

stage='preflight'
workspace=''
network=''
source_container=''
client_container=''
target17_container=''
target18_container=''
source_container_id=''
client_container_id=''
target17_container_id=''
target18_container_id=''
network_id=''
docker_ready=0
cleanup_done=0
resource_cleanup_authorized=0
resource_ownership_indeterminate=0
python_residue_bound=0
python_residue_before=''
PLATFORM=''
PG17_IMAGE=''
PG18_IMAGE=''

fixed_failure() {
  printf '%s\n' "postgres_cross_major_failed:${stage}" >&2
}

container_probe() {
  local output
  if ! output="$(timeout 15s docker container ls --all --quiet --no-trunc \
    --filter "name=^/$1$" 2>/dev/null)"; then
    return 2
  fi
  if [[ -z "$output" ]]; then
    return 1
  fi
  [[ "$output" != *$'\n'* && "$output" =~ ^[0-9a-f]{64}$ ]] || return 2
  return 0
}

network_probe() {
  local output
  if ! output="$(timeout 15s docker network ls --quiet --no-trunc \
    --filter "name=^$1$" 2>/dev/null)"; then
    return 2
  fi
  if [[ -z "$output" ]]; then
    return 1
  fi
  [[ "$output" != *$'\n'* && "$output" =~ ^[0-9a-f]{64}$ ]] || return 2
  return 0
}

container_id_probe() {
  local id=$1
  local output
  if ! output="$(timeout 15s docker container ls --all --quiet --no-trunc \
    --filter "id=$id" 2>/dev/null)"; then
    return 2
  fi
  if [[ -z "$output" ]]; then
    return 1
  fi
  [[ "$output" != *$'\n'* && "$output" == "$id" ]] || return 2
  return 0
}

network_id_probe() {
  local id=$1
  local output
  if ! output="$(timeout 15s docker network ls --quiet --no-trunc \
    --filter "id=$id" 2>/dev/null)"; then
    return 2
  fi
  if [[ -z "$output" ]]; then
    return 1
  fi
  [[ "$output" != *$'\n'* && "$output" == "$id" ]] || return 2
  return 0
}

verify_container_binding() {
  local id=$1
  local name=$2
  local output
  if ! output="$(timeout 15s docker container inspect --format \
    "{{.Id}}|{{.Name}}|{{index .Config.Labels \"${LABEL_KEY}\"}}" \
    "$id" 2>/dev/null)"; then
    return 1
  fi
  [[ "$output" == "${id}|/${name}|${LABEL_VALUE}" ]]
}

verify_network_binding() {
  local id=$1
  local name=$2
  local output
  if ! output="$(timeout 15s docker network inspect --format \
    "{{.Id}}|{{.Name}}|{{index .Labels \"${LABEL_KEY}\"}}" \
    "$id" 2>/dev/null)"; then
    return 1
  fi
  [[ "$output" == "${id}|${name}|${LABEL_VALUE}" ]]
}

read_exact_resource_id() {
  local path=$1
  local id extra
  {
    IFS= read -r id || return 1
    if IFS= read -r extra; then
      return 1
    fi
  } <"$path"
  [[ "$id" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$id"
}

remove_bound_container_if_present() {
  local id=$1
  local name=$2
  local probe_status
  if container_id_probe "$id"; then
    verify_container_binding "$id" "$name" || return 1
    timeout 30s docker rm -f "$id" >/dev/null 2>&1 || return 1
  else
    probe_status=$?
    [[ $probe_status -eq 1 ]] || return 1
  fi
  if container_id_probe "$id"; then
    return 1
  else
    probe_status=$?
    [[ $probe_status -eq 1 ]]
  fi
}

remove_bound_network_if_present() {
  local id=$1
  local name=$2
  local probe_status
  if network_id_probe "$id"; then
    verify_network_binding "$id" "$name" || return 1
    timeout 30s docker network rm "$id" >/dev/null 2>&1 || return 1
  else
    probe_status=$?
    [[ $probe_status -eq 1 ]] || return 1
  fi
  if network_id_probe "$id"; then
    return 1
  else
    probe_status=$?
    [[ $probe_status -eq 1 ]]
  fi
}

authorize_resource_cleanup_after_absence() {
  local container
  local probe_status
  for container in \
    "$target18_container" \
    "$target17_container" \
    "$client_container" \
    "$source_container"; do
    if container_probe "$container"; then
      return 1
    else
      probe_status=$?
      [[ $probe_status -eq 1 ]] || return 1
    fi
  done
  if network_probe "$network"; then
    return 1
  else
    probe_status=$?
    [[ $probe_status -eq 1 ]] || return 1
  fi
  resource_cleanup_authorized=1
}

repository_python_residue_snapshot() {
  find \
    "$ROOT/scripts/migration" \
    "$ROOT/tests/migration" \
    \( -type d -name __pycache__ -o -type f \( -name '*.pyc' -o -name '*.pyo' \) \) \
    -print 2>/dev/null | LC_ALL=C sort
}

cleanup_resources() {
  local failed=0

  if [[ $docker_ready -eq 1 && $resource_cleanup_authorized -eq 1 ]]; then
    if ! timeout 15s docker info >/dev/null 2>&1; then
      failed=1
    else
      if [[ -n "$target18_container_id" ]] && ! remove_bound_container_if_present \
        "$target18_container_id" "$target18_container"; then
        failed=1
      fi
      if [[ -n "$target17_container_id" ]] && ! remove_bound_container_if_present \
        "$target17_container_id" "$target17_container"; then
        failed=1
      fi
      if [[ -n "$client_container_id" ]] && ! remove_bound_container_if_present \
        "$client_container_id" "$client_container"; then
        failed=1
      fi
      if [[ -n "$source_container_id" ]] && ! remove_bound_container_if_present \
        "$source_container_id" "$source_container"; then
        failed=1
      fi
      if [[ -n "$network_id" ]] && ! remove_bound_network_if_present \
        "$network_id" "$network"; then
        failed=1
      fi
    fi
  fi

  if [[ -n "$workspace" && -d "$workspace" ]]; then
    chmod -R u+rwX "$workspace" >/dev/null 2>&1 || failed=1
    rm -rf -- "$workspace" >/dev/null 2>&1 || failed=1
  fi
  if [[ -n "$workspace" && -e "$workspace" ]]; then
    failed=1
  fi
  if [[ $python_residue_bound -eq 1 ]]; then
    local python_residue_after
    if ! python_residue_after="$(repository_python_residue_snapshot)"; then
      failed=1
    elif [[ "$python_residue_after" != "$python_residue_before" ]]; then
      failed=1
    fi
  fi

  if [[ $resource_ownership_indeterminate -eq 1 ]]; then
    return 2
  fi
  [[ $failed -eq 0 ]] || return 1
  source_container=''
  client_container=''
  target17_container=''
  target18_container=''
  source_container_id=''
  client_container_id=''
  target17_container_id=''
  target18_container_id=''
  network_id=''
  network=''
  workspace=''
  resource_cleanup_authorized=0
  cleanup_done=1
}

on_exit() {
  local status=$?
  local cleanup_status=0
  trap - EXIT INT TERM HUP
  if [[ $cleanup_done -ne 1 ]]; then
    if cleanup_resources; then
      :
    else
      cleanup_status=$?
      if [[ $cleanup_status -eq 2 ]]; then
        stage='cleanup_indeterminate'
      else
        stage='cleanup_failed'
      fi
      status=1
    fi
  fi
  if [[ $status -ne 0 ]]; then
    fixed_failure
  fi
  exit "$status"
}

on_signal() {
  stage='signal_received'
  exit 1
}

trap on_exit EXIT
trap on_signal INT TERM HUP

require_tool() {
  command -v "$1" >/dev/null 2>&1
}

wait_for_server() {
  local container=$1
  local attempt
  for attempt in $(seq 1 90); do
    if timeout 5s docker exec "$container" \
      pg_isready -q -U postgres -d synthetic >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

assert_no_published_ports_or_volumes() {
  local container=$1
  local port_bindings mount_types
  port_bindings="$(timeout 15s docker inspect --format \
    '{{json .HostConfig.PortBindings}}' "$container" 2>/dev/null)"
  [[ "$port_bindings" == '{}' || "$port_bindings" == 'null' ]] || return 1
  mount_types="$(timeout 15s docker inspect --format \
    '{{range .Mounts}}{{println .Type}}{{end}}' "$container" 2>/dev/null)"
  if [[ -n "$mount_types" ]] && grep -Ev '^tmpfs$' <<<"$mount_types" >/dev/null; then
    return 1
  fi
}

start_server() {
  local name=$1
  local image=$2
  local binding_variable=$3
  local data_mount='/var/lib/postgresql/data'
  local candidate_id
  local id_file="${workspace}/${binding_variable}-private.id"
  if [[ "$image" == "$PG18_IMAGE" ]]; then
    data_mount='/var/lib/postgresql'
  fi
  if ! timeout 60s docker run --detach --rm \
    --platform "$PLATFORM" \
    --name "$name" \
    --network "$network" \
    --label "$LABEL" \
    --tmpfs "$data_mount:rw,nosuid,nodev,noexec,size=512m" \
    --env POSTGRES_PASSWORD="$PASSWORD" \
    --env POSTGRES_DB=synthetic \
    "$image" >"$id_file" 2>"$workspace/docker-private.log"; then
    resource_ownership_indeterminate=1
    return 1
  fi
  if ! candidate_id="$(read_exact_resource_id "$id_file")"; then
    resource_ownership_indeterminate=1
    return 1
  fi
  if ! verify_container_binding "$candidate_id" "$name"; then
    resource_ownership_indeterminate=1
    return 1
  fi
  printf -v "$binding_variable" '%s' "$candidate_id"
  assert_no_published_ports_or_volumes "$candidate_id" || return 1
  wait_for_server "$candidate_id" || return 1
}

verify_exact_tested_semantics() {
  local container=$1
  local expected_version=$2
  local output=$3

  timeout 30s docker exec "$container" postgres --version \
    >"${output}.version" 2>&1
  grep -Eq "^postgres \\(PostgreSQL\\) ${expected_version//./\\.} " \
    "${output}.version"

  timeout 30s docker exec --interactive \
    --env PGPASSWORD="$PASSWORD" \
    "$container" \
    psql -X --set=ON_ERROR_STOP=1 --tuples-only --no-align \
      --username postgres --dbname synthetic \
    >"$output" 2>&1 <<'SQL'
SELECT
  (SELECT count(*) = 3
     AND count(*) FILTER (
       WHERE id = 1 AND state = 'queued' AND note = 'synthetic-alpha'
         AND updated_at = '2026-01-01T00:00:00Z'::timestamptz
     ) = 1
     AND count(*) FILTER (
       WHERE id = 2 AND state = 'done' AND note = 'synthetic-beta'
         AND updated_at = '2026-01-02T00:00:00Z'::timestamptz
     ) = 1
     AND count(*) FILTER (
       WHERE id = 3
         AND state = 'done'
         AND note = 'SYNTHETIC_ROW_PAYLOAD_MUST_NOT_APPEAR_IN_TOC'
         AND updated_at = '2026-01-03T00:00:00Z'::timestamptz
     ) = 1
   FROM public.synthetic_items)
  AND (SELECT count(*) = 2 FROM public.synthetic_done)
  AND public.synthetic_count() = 3
  AND (SELECT attidentity = 'a'
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.synthetic_items'::regclass
         AND attname = 'id')
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.synthetic_items'::regclass AND contype = 'p'
  )
  AND (SELECT array_agg(enumlabel::text ORDER BY enumsortorder) = ARRAY['queued', 'done']
       FROM pg_catalog.pg_enum
       WHERE enumtypid = 'public.synthetic_state'::regtype)
  AND (SELECT last_value = 3 AND is_called
       FROM public.synthetic_items_id_seq);
SQL
  [[ $(tr -d '[:space:]' <"$output") == 't' ]]
}

export PYTHONDONTWRITEBYTECODE=1

for required_tool in docker python3 grep timeout seq sleep tr wc mktemp chmod rm find sort; do
  require_tool "$required_tool" || exit 1
done

if ! python_residue_before="$(repository_python_residue_snapshot)"; then
  exit 1
fi
python_residue_bound=1

workspace="$(mktemp -d "${TMPDIR:-/tmp}/focus-flow-pg-cross-major.XXXXXXXX" \
  2>/dev/null)" || exit 1
chmod 0700 "$workspace" >/dev/null 2>&1 || exit 1

stage='lock_contract'
if ! python3 -B -I "$LOCK_VALIDATOR" "$LOCK_FILE" \
  --emit-runtime-bindings >"$workspace/lock-bindings-private" \
  2>"$workspace/lock-private.log"; then
  exit 1
fi
{
  IFS= read -r PLATFORM
  IFS= read -r PG17_IMAGE
  IFS= read -r PG18_IMAGE
  if IFS= read -r _unexpected_binding; then
    exit 1
  fi
} <"$workspace/lock-bindings-private"
[[ -n "$PLATFORM" && -n "$PG17_IMAGE" && -n "$PG18_IMAGE" ]] || exit 1
readonly PLATFORM PG17_IMAGE PG18_IMAGE

stage='docker_context'
case "${DOCKER_HOST:-}" in
  ''|unix:///*) ;;
  *) exit 1 ;;
esac
context_endpoint="$(timeout 15s docker context inspect --format \
  '{{(index .Endpoints "docker").Host}}' \
  2>"$workspace/context-private.err")"
[[ "$context_endpoint" != *$'\n'* && "$context_endpoint" == unix:///* ]] || exit 1
timeout 15s docker info >"$workspace/docker-info-private.log" 2>&1
docker_ready=1

network="focus-flow-pg-cross-major-$$"
source_container="focus-flow-pg17-source-$$"
client_container="focus-flow-pg18-client-$$"
target17_container="focus-flow-pg17-target-$$"
target18_container="focus-flow-pg18-target-$$"

stage='resource_name_preflight'
authorize_resource_cleanup_after_absence

stage='image_pull'
timeout 300s docker pull --platform "$PLATFORM" "$PG17_IMAGE" \
  >"$workspace/pull17-private.log" 2>&1
timeout 300s docker pull --platform "$PLATFORM" "$PG18_IMAGE" \
  >"$workspace/pull18-private.log" 2>&1

stage='network_create'
if ! timeout 30s docker network create --internal --label "$LABEL" "$network" \
  >"$workspace/network-id-private" 2>"$workspace/network-private.log"; then
  resource_ownership_indeterminate=1
  exit 1
fi
if ! network_id="$(read_exact_resource_id "$workspace/network-id-private")"; then
  resource_ownership_indeterminate=1
  exit 1
fi
if ! verify_network_binding "$network_id" "$network"; then
  network_id=''
  resource_ownership_indeterminate=1
  exit 1
fi
[[ $(timeout 15s docker network inspect --format '{{.Internal}}' "$network" \
  2>/dev/null) == true ]] || exit 1

stage='pg17_source_start'
start_server "$source_container" "$PG17_IMAGE" source_container_id

stage='pg17_fixture_create'
timeout 30s docker exec --interactive \
  --env PGPASSWORD="$PASSWORD" \
  "$source_container" \
  psql -X --set=ON_ERROR_STOP=1 --username postgres --dbname synthetic \
  >"$workspace/source-private.log" 2>&1 <<'SQL'
CREATE TYPE public.synthetic_state AS ENUM ('queued', 'done');
CREATE TABLE public.synthetic_items (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  state public.synthetic_state NOT NULL,
  note text NOT NULL,
  updated_at timestamptz NOT NULL
);
INSERT INTO public.synthetic_items (state, note, updated_at) VALUES
  ('queued', 'synthetic-alpha', '2026-01-01T00:00:00Z'),
  ('done', 'synthetic-beta', '2026-01-02T00:00:00Z'),
  ('done', 'SYNTHETIC_ROW_PAYLOAD_MUST_NOT_APPEAR_IN_TOC', '2026-01-03T00:00:00Z');
CREATE VIEW public.synthetic_done AS
SELECT id, updated_at FROM public.synthetic_items WHERE state = 'done';
CREATE FUNCTION public.synthetic_count() RETURNS bigint
LANGUAGE sql STABLE
RETURN (SELECT count(*) FROM public.synthetic_items);
SQL

stage='pg18_client_start'
if ! timeout 60s docker run --detach --rm \
  --platform "$PLATFORM" \
  --name "$client_container" \
  --network "$network" \
  --label "$LABEL" \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
  --tmpfs /work:rw,nosuid,nodev,noexec,size=256m \
  --tmpfs /var/lib/postgresql:rw,nosuid,nodev,noexec,size=16m \
  --entrypoint sleep \
  "$PG18_IMAGE" infinity \
  >"$workspace/client-id-private" 2>"$workspace/client-private.log"; then
  resource_ownership_indeterminate=1
  exit 1
fi
if ! client_container_id="$(read_exact_resource_id \
  "$workspace/client-id-private")"; then
  resource_ownership_indeterminate=1
  exit 1
fi
if ! verify_container_binding "$client_container_id" "$client_container"; then
  client_container_id=''
  resource_ownership_indeterminate=1
  exit 1
fi
assert_no_published_ports_or_volumes "$client_container_id"

stage='version_identity'
timeout 30s docker exec "$source_container" postgres --version \
  >"$workspace/pg17-version-private.log" 2>&1
timeout 30s docker exec "$client_container" pg_dump --version \
  >"$workspace/pg18-dump-version-private.log" 2>&1
timeout 30s docker exec "$client_container" pg_restore --version \
  >"$workspace/pg18-restore-version-private.log" 2>&1
grep -Eq '^postgres \(PostgreSQL\) 17\.6 ' "$workspace/pg17-version-private.log"
grep -Eq '^pg_dump \(PostgreSQL\) 18\.4 ' "$workspace/pg18-dump-version-private.log"
grep -Eq '^pg_restore \(PostgreSQL\) 18\.4 ' "$workspace/pg18-restore-version-private.log"

stage='pg18_dump_from_pg17'
timeout 120s docker exec \
  --env PGPASSWORD="$PASSWORD" \
  "$client_container" \
  pg_dump --host "$source_container" --username postgres --dbname synthetic \
  --format custom --quote-all-identifiers --no-owner --no-privileges \
  --no-subscriptions --file /work/synthetic.backup \
  >"$workspace/dump-private.log" 2>&1

stage='pg18_list_offline'
timeout 30s docker network disconnect "$network" "$client_container" \
  >"$workspace/disconnect-private.log" 2>&1
[[ $(timeout 15s docker inspect --format \
  '{{len .NetworkSettings.Networks}}' "$client_container" 2>/dev/null) == 0 ]]
timeout --signal=TERM --kill-after=10s 60s docker exec "$client_container" \
  sh -c 'umask 077; ulimit -f 2048 || exit 70; exec pg_restore --list /work/synthetic.backup > /work/synthetic.toc' \
  >"$workspace/list-private.log" 2>&1
toc_size="$(timeout 15s docker exec "$client_container" \
  sh -c 'wc -c < /work/synthetic.toc' 2>/dev/null | tr -d '[:space:]')"
[[ "$toc_size" =~ ^[0-9]+$ && "$toc_size" -gt 0 && "$toc_size" -le "$TOC_CAP_BYTES" ]]
timeout 30s docker exec "$client_container" sh -c '
  [ "$(head -c 5 /work/synthetic.backup)" = PGDMP ] &&
  grep -Eq "^;[[:space:]]+Dumped from database version: 17\\.6([ .]|$)" /work/synthetic.toc &&
  grep -Eq "^;[[:space:]]+Dumped by pg_dump version: 18\\.4([ .]|$)" /work/synthetic.toc &&
  grep -Eq " TABLE public synthetic_items " /work/synthetic.toc &&
  grep -Eq " TABLE DATA public synthetic_items " /work/synthetic.toc &&
  grep -Eq " TYPE public synthetic_state " /work/synthetic.toc &&
  grep -Eq " VIEW public synthetic_done " /work/synthetic.toc &&
  grep -Eq " FUNCTION public synthetic_count" /work/synthetic.toc &&
  grep -Eq " SEQUENCE public synthetic_items_id_seq " /work/synthetic.toc &&
  ! grep -Fq "SYNTHETIC_ROW_PAYLOAD_MUST_NOT_APPEAR_IN_TOC" /work/synthetic.toc
' >"$workspace/toc-assertions-private.log" 2>&1

stage='pg18_toc_stream'
timeout 30s docker exec "$client_container" \
  sh -c 'cat /work/synthetic.toc' \
  >"$workspace/synthetic-private.toc" \
  2>"$workspace/toc-stream-private.log"
host_toc_size="$(wc -c <"$workspace/synthetic-private.toc" | tr -d '[:space:]')"
[[ "$host_toc_size" =~ ^[0-9]+$ && "$host_toc_size" == "$toc_size" ]]
stage='pg18_toc_permissions'
chmod 0400 "$workspace/synthetic-private.toc" >/dev/null 2>&1
stage='pg18_toc_parser'
if python3 -B -I - "$ROOT" "$workspace/synthetic-private.toc" \
  >"$workspace/toc-parser-private.log" 2>&1 <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
sys.path.insert(0, str(root / "scripts" / "migration"))
from lib.lovable_toc_contract import ContractError, DATA_TOC_CLASSES, parse_raw_toc

raw = Path(sys.argv[2]).read_bytes()
try:
    entries = parse_raw_toc(raw, b"s" * 32)
except ContractError as error:
    raise SystemExit(
        {
            "toc_unknown_class": 41,
            "toc_malformed": 42,
            "toc_duplicate_id": 43,
            "input_invalid": 44,
        }.get(error.code, 49)
    )
classes = {entry.object_class for entry in entries}
required = {
    "FUNCTION",
    "SEQUENCE",
    "SEQUENCE SET",
    "TABLE",
    "TABLE DATA",
    "TYPE",
    "VIEW",
}
if not required.issubset(classes):
    raise SystemExit(51)
if sum(entry.object_class in DATA_TOC_CLASSES for entry in entries) < 1:
    raise SystemExit(52)
PY
then
  :
else
  parser_status=$?
  case "$parser_status" in
    41) stage='pg18_toc_unknown_class' ;;
    42) stage='pg18_toc_malformed' ;;
    43) stage='pg18_toc_duplicate_id' ;;
    44) stage='pg18_toc_input_invalid' ;;
    51) stage='pg18_toc_expected_class_missing' ;;
    52) stage='pg18_toc_data_reference_missing' ;;
    *) stage='pg18_toc_parser_internal' ;;
  esac
  exit 1
fi
timeout 30s docker network connect "$network" "$client_container" \
  >"$workspace/reconnect-private.log" 2>&1

stage='pg17_target_start'
start_server "$target17_container" "$PG17_IMAGE" target17_container_id
stage='pg18_restore_to_pg17'
timeout 120s docker exec \
  --env PGPASSWORD="$PASSWORD" \
  "$client_container" \
  pg_restore --host "$target17_container" --username postgres --dbname synthetic \
  --single-transaction --exit-on-error --no-owner --no-privileges \
  /work/synthetic.backup \
  >"$workspace/restore17-private.log" 2>&1

stage='pg17_target_verify'
verify_exact_tested_semantics "$target17_container" '17.6' \
  "$workspace/verify17-private.log"

stage='pg18_target_start'
start_server "$target18_container" "$PG18_IMAGE" target18_container_id
stage='pg18_restore_to_pg18'
timeout 120s docker exec \
  --env PGPASSWORD="$PASSWORD" \
  "$client_container" \
  pg_restore --host "$target18_container" --username postgres --dbname synthetic \
  --single-transaction --exit-on-error --no-owner --no-privileges \
  /work/synthetic.backup \
  >"$workspace/restore18-private.log" 2>&1

stage='pg18_target_verify'
verify_exact_tested_semantics "$target18_container" '18.4' \
  "$workspace/verify18-private.log"

stage='cleanup'
if cleanup_resources; then
  :
else
  cleanup_status=$?
  if [[ $cleanup_status -eq 2 ]]; then
    stage='cleanup_indeterminate'
  else
    stage='cleanup_failed'
  fi
  exit 1
fi
trap - EXIT INT TERM HUP

stage='complete'
printf '%s\n' 'postgres_cross_major:pg_dump18.4_from_pg17.6=passed'
printf '%s\n' 'postgres_cross_major:pg_restore18.4_list_offline=passed'
printf '%s\n' 'postgres_cross_major:pg18_toc_parser=passed'
printf '%s\n' 'postgres_cross_major:restore_to_pg17.6_exact_tested_semantics=passed'
printf '%s\n' 'postgres_cross_major:restore_to_pg18.4_exact_tested_semantics=passed'
