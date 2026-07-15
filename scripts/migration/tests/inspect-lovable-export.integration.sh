#!/usr/bin/env bash

# Real PostgreSQL 17 integration for the complete Lovable export-envelope
# workflow.  This test is CI-only: it creates a synthetic fixture in an
# explicitly local migration_verify_* database, produces a pg_dump -Fc
# archive, and never restores or connects through the inspection workflow.

set -euo pipefail
IFS=$'\n\t'
LC_ALL=C
export LC_ALL
umask 077

readonly TEST_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SOURCE_REPO_ROOT="$(cd -P -- "${TEST_DIR}/../../.." && pwd)"
readonly SAFETY="${TEST_DIR}/lib/postgres-test-safety.sh"
readonly FIXTURE_SCHEMA="migration_export_fixture"
readonly ROW_SENTINEL="SYNTHETIC_HIGH_LEVEL_ROW_PAYLOAD_MUST_NOT_APPEAR"

# shellcheck source=scripts/migration/tests/lib/postgres-test-safety.sh
source "$SAFETY"

export PGHOST=${PGHOST:-/var/run/postgresql}
export PGPORT=${PGPORT:-5432}
export PGUSER=${PGUSER:-postgres}
export PGDATABASE=${PGDATABASE:-migration_verify_export}
export PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-5}

migration_verify_require_safe_target
for command_name in git grep pg_dump pg_restore psql python3; do
  migration_verify_require_command "$command_name"
done
for required_path in \
  "$SOURCE_REPO_ROOT/scripts/migration/inspect-lovable-export.py" \
  "$SOURCE_REPO_ROOT/scripts/migration/bounded-pg-restore.py" \
  "$SOURCE_REPO_ROOT/scripts/migration/normalize-lovable-export.py" \
  "$SOURCE_REPO_ROOT/scripts/migration/inspect-lovable-dump.sh" \
  "$SOURCE_REPO_ROOT/supabase/config.toml"; do
  migration_verify_require_file "$required_path"
done

readonly PYTHON="$(command -v python3)"
readonly PG_DUMP="$(command -v pg_dump)"
readonly REAL_PG_RESTORE_BIN="$(command -v pg_restore)"
readonly PSQL="$(command -v psql)"

for tool in "$PG_DUMP" "$REAL_PG_RESTORE_BIN" "$PSQL"; do
  "$tool" --version | grep -Eq '\(PostgreSQL\) 17([. ]|$)' || {
    printf 'ERROR: high-level integration requires PostgreSQL 17 client tools\n' >&2
    exit 2
  }
done

if ! database_identity="$($PSQL -X -qAt -F '|' -v ON_ERROR_STOP=1 -c \
  "SELECT pg_catalog.current_database(),
          pg_catalog.current_setting('server_version_num')::integer / 10000,
          COALESCE(pg_catalog.inet_server_addr()::text, 'local-socket');")"; then
  printf 'ERROR: database identity probe failed before synthetic fixture setup\n' >&2
  exit 2
fi
migration_verify_validate_identity "$database_identity" direct

readonly TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/lovable-export-high-level.XXXXXX")"
fixture_started=0
workspace_created_by_test=0

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ ${fixture_started:-0} -eq 1 ]]; then
    "$PSQL" -X -q -v ON_ERROR_STOP=1 <<SQL >/dev/null 2>&1 || true
DROP SCHEMA IF EXISTS ${FIXTURE_SCHEMA} CASCADE;
SQL
  fi
  if [[ ${workspace_created_by_test:-0} -eq 1 && -n ${LOCAL_WORKSPACE:-} ]]; then
    rmdir -- "$LOCAL_WORKSPACE" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TMP_ROOT"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

readonly EXECUTION_REPO="${TMP_ROOT}/approved-execution-checkout"
git clone --quiet --shared "$SOURCE_REPO_ROOT" "$EXECUTION_REPO"
readonly APPROVED_CHECKOUT="$(git -C "$SOURCE_REPO_ROOT" rev-parse HEAD)"
[[ $(git -C "$EXECUTION_REPO" rev-parse HEAD) == "$APPROVED_CHECKOUT" ]] || {
  printf 'ERROR: isolated execution checkout does not match the source HEAD\n' >&2
  exit 2
}
[[ -z $(git -C "$EXECUTION_REPO" status --porcelain) ]] || {
  printf 'ERROR: isolated execution checkout is not clean\n' >&2
  exit 2
}
readonly DRIVER="${EXECUTION_REPO}/scripts/migration/inspect-lovable-export.py"
readonly ZIP_STORE="${TMP_ROOT}/zip evidence store"
readonly DIRECT_STORE="${TMP_ROOT}/direct evidence store"
readonly ZIP_CANONICAL="${ZIP_STORE}/synthetic-lovable-export.zip"
readonly DIRECT_CANONICAL="${DIRECT_STORE}/synthetic-direct-export.backup"
readonly ZIP_MEMBER="synthetic-lovable-export.backup"
readonly PG_RESTORE_LEDGER_PATH="${TMP_ROOT}/pg_restore.calls"
readonly PG_RESTORE_WRAPPER="${TMP_ROOT}/audited-pg_restore"
readonly LOCAL_WORKSPACE="${EXECUTION_REPO}/local-migration-artifacts"

if [[ -e "$LOCAL_WORKSPACE" ]]; then
  [[ -d "$LOCAL_WORKSPACE" && ! -L "$LOCAL_WORKSPACE" ]] || {
    printf 'ERROR: local migration workspace is not a real directory\n' >&2
    exit 2
  }
  if [[ -n $(find "$LOCAL_WORKSPACE" -mindepth 1 -print -quit) ]]; then
    printf 'ERROR: high-level integration refuses a nonempty local workspace\n' >&2
    exit 2
  fi
else
  workspace_created_by_test=1
fi

mkdir -m 0700 -- "$ZIP_STORE" "$DIRECT_STORE"
: >"$PG_RESTORE_LEDGER_PATH"
chmod 0600 "$PG_RESTORE_LEDGER_PATH"

cat >"$PG_RESTORE_WRAPPER" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  --version)
    [[ $# -eq 1 ]] || exit 91
    ;;
  --list)
    [[ $# -eq 2 ]] || exit 92
    ;;
  *)
    printf 'unexpected pg_restore invocation: %s\n' "$*" >&2
    exit 93
    ;;
esac
printf '%s\n' "$1" >>"$PG_RESTORE_LEDGER"
exec "$REAL_PG_RESTORE" "$@"
WRAPPER
chmod 0700 "$PG_RESTORE_WRAPPER"

fixture_started=1
"$PSQL" -X -q -v ON_ERROR_STOP=1 <<SQL
DROP SCHEMA IF EXISTS ${FIXTURE_SCHEMA} CASCADE;
CREATE SCHEMA ${FIXTURE_SCHEMA};
CREATE TABLE ${FIXTURE_SCHEMA}.items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  note text NOT NULL
);
INSERT INTO ${FIXTURE_SCHEMA}.items (note)
VALUES ('${ROW_SENTINEL}'), ('synthetic second row');
SQL

"$PG_DUMP" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema="$FIXTURE_SCHEMA" \
  --file="$DIRECT_CANONICAL"
chmod 0400 "$DIRECT_CANONICAL"

"$PYTHON" - "$DIRECT_CANONICAL" "$ZIP_CANONICAL" "$ZIP_MEMBER" <<'PY'
import stat
import sys
import zipfile
from pathlib import Path

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
member_name = sys.argv[3]
member = zipfile.ZipInfo(member_name, date_time=(2030, 1, 2, 3, 0, 0))
member.compress_type = zipfile.ZIP_DEFLATED
member.create_system = 3
member.create_version = 20
member.extract_version = 20
member.external_attr = (stat.S_IFREG | 0o400) << 16
member.extra = b""
member.comment = b""
with zipfile.ZipFile(
    destination,
    mode="x",
    compression=zipfile.ZIP_DEFLATED,
    allowZip64=False,
) as archive:
    archive.comment = b""
    archive.writestr(member, source.read_bytes())
PY
chmod 0400 "$ZIP_CANONICAL"

project_ref="$($PYTHON - "$EXECUTION_REPO/supabase/config.toml" <<'PY'
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding="utf-8")
values = re.findall(r'^project_id\s*=\s*"([a-z0-9]{20})"\s*$', text, re.MULTILINE)
if len(values) != 1:
    raise SystemExit("supabase/config.toml must declare exactly one project_id")
print(values[0])
PY
)"
readonly project_ref

artifact_identity() {
  "$PYTHON" - "$1" <<'PY'
import hashlib
import sys
from pathlib import Path

path = Path(sys.argv[1])
digest = hashlib.sha256()
size = 0
with path.open("rb") as source:
    while chunk := source.read(1024 * 1024):
        size += len(chunk)
        digest.update(chunk)
print(f"{size}|{digest.hexdigest()}")
PY
}

run_driver() {
  local canonical=$1
  local store=$2
  local ui_name=$3
  local identity expected_size expected_sha
  identity="$(artifact_identity "$canonical")"
  IFS='|' read -r expected_size expected_sha <<<"$identity"

  SOURCE_PROJECT_NAME="Synthetic high-level integration" \
  SOURCE_PROJECT_REF="$project_ref" \
  UI_EXPORT_OBJECT_NAME="$ui_name" \
  OPERATOR_IDENTITY="synthetic-ci-operator" \
  EXPORT_EVIDENCE_PROFILE="future_rehearsal" \
  EXPORT_INITIATED_BASIS="operator_observed" \
  EXPORT_INITIATED_AT_UTC="2030-01-02T03:00:00Z" \
  EXPORT_INITIATED_REASON="" \
  EXPORT_COMPLETED_BASIS="operator_observed" \
  EXPORT_COMPLETED_AT_UTC="2030-01-02T03:03:00Z" \
  EXPORT_COMPLETED_REASON="" \
  EXPORT_AVAILABLE_AT_UTC="2030-01-02T03:04:00Z" \
  DOWNLOAD_COMPLETED_AT_UTC="2030-01-02T03:05:00Z" \
  CANONICAL_EXPORT="$canonical" \
  EXPECTED_OUTER_SHA256="$expected_sha" \
  EXPECTED_OUTER_SIZE_BYTES="$expected_size" \
  EXPECTED_ORIGINAL_FILENAME="$(basename -- "$canonical")" \
  APPROVED_EVIDENCE_STORE_ROOT="$store" \
  APPROVED_EXECUTION_CHECKOUT_SHA="$APPROVED_CHECKOUT" \
  PG_RESTORE_BIN="$PG_RESTORE_WRAPPER" \
  PG_RESTORE_LEDGER="$PG_RESTORE_LEDGER_PATH" \
  REAL_PG_RESTORE="$REAL_PG_RESTORE_BIN" \
  "$PYTHON" "$DRIVER"
}

zip_stdout="$(run_driver "$ZIP_CANONICAL" "$ZIP_STORE" "$ZIP_MEMBER")"
direct_stdout="$(run_driver "$DIRECT_CANONICAL" "$DIRECT_STORE" "synthetic-direct-export.backup")"

"$PYTHON" - \
  "$EXECUTION_REPO" \
  "$project_ref" \
  "$ZIP_STORE" "$ZIP_CANONICAL" "$ZIP_MEMBER" "$zip_stdout" \
  "$DIRECT_STORE" "$DIRECT_CANONICAL" "$direct_stdout" \
  "$ROW_SENTINEL" "$PG_RESTORE_LEDGER_PATH" <<'PY'
import hashlib
import json
import stat
import subprocess
import sys
from pathlib import Path

(
    repo_text,
    project_ref,
    zip_store_text,
    zip_outer_text,
    zip_member,
    zip_stdout,
    direct_store_text,
    direct_outer_text,
    direct_stdout,
    row_sentinel,
    ledger_text,
) = sys.argv[1:]
repo = Path(repo_text)
ledger = Path(ledger_text)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def evidence_package(store: Path) -> Path:
    durable_root = store / "migration-inspection-evidence"
    markers = list(durable_root.rglob("EVIDENCE_COMPLETE"))
    if len(markers) != 1:
        raise SystemExit(f"expected one durable evidence marker under {store}, got {markers}")
    return markers[0].parent


def verify_mode(
    store_text: str,
    outer_text: str,
    stdout: str,
    *,
    expected_kind: str,
    expected_member: str | None,
    expected_inner_sha: str,
) -> None:
    store = Path(store_text)
    outer = Path(outer_text)
    if stat.S_IMODE(store.stat().st_mode) != 0o700:
        raise SystemExit("approved evidence store is not mode 0700")
    evidence = evidence_package(store)
    if stat.S_IMODE(evidence.stat().st_mode) != 0o700:
        raise SystemExit("durable evidence run directory is not mode 0700")
    if stat.S_IMODE(evidence.parent.stat().st_mode) != 0o700:
        raise SystemExit("durable evidence parent directory is not mode 0700")
    provenance_path = evidence / "provenance.json"
    report_path = evidence / "inspection" / "rehearsal-metadata.txt"
    evidence_manifest_path = evidence / "evidence-files.json"
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    evidence_manifest = json.loads(
        evidence_manifest_path.read_text(encoding="utf-8")
    )
    completion = json.loads(
        (evidence / "EVIDENCE_COMPLETE").read_text(encoding="utf-8")
    )
    if (evidence / "EVIDENCE_INDETERMINATE").exists():
        raise SystemExit("successful evidence package is marked indeterminate")
    report = report_path.read_text(encoding="utf-8")
    outer_sha = sha256(outer)
    outer_size = outer.stat().st_size
    expected_identity = provenance["outer_artifact"]["expected_identity"]
    observed_identity = provenance["outer_artifact"]["workflow_observed_identity"]
    normalizer_hashes = provenance["outer_artifact"]["normalizer_sha256"]

    if provenance["inspection_status"] != "REVIEW_REQUIRED":
        raise SystemExit("high-level inspection status was not REVIEW_REQUIRED")
    if provenance["export_timeline_status"] != "COMPLETE":
        raise SystemExit("complete synthetic timeline was not recorded as COMPLETE")
    if expected_identity != {
        "original_filename": outer.name,
        "size_bytes": outer_size,
        "sha256": outer_sha,
        "basis": "mandatory externally supplied runtime approval inputs",
    }:
        raise SystemExit("externally expected outer identity binding mismatch")
    if observed_identity != {
        "original_filename": outer.name,
        "size_bytes_before": outer_size,
        "size_bytes_after": outer_size,
        "sha256_before": outer_sha,
        "sha256_after": outer_sha,
    }:
        raise SystemExit("workflow-observed outer identity binding mismatch")
    if normalizer_hashes != {"before": outer_sha, "after": outer_sha}:
        raise SystemExit("normalizer outer SHA binding mismatch")

    checksum_files = provenance["outer_artifact"]["checksum_files"]
    for checksum_label in (
        "expected",
        "workflow_observed_before",
        "workflow_observed_after",
    ):
        checksum_path = evidence / checksum_files[checksum_label]
        if checksum_path.read_text(encoding="ascii") != outer_sha + "\n":
            raise SystemExit(f"outer checksum-file mismatch: {checksum_label}")

    repository_binding = provenance["lovable_source_project"]["repository_binding"]
    config_path = repo / "supabase" / "config.toml"
    config_blob = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD:supabase/config.toml"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if repository_binding != {
        "path": "supabase/config.toml",
        "declared_project_id": project_ref,
        "git_blob_sha": config_blob,
        "sha256": sha256(config_path),
        "exact_match": True,
    }:
        raise SystemExit("approved-checkout source-project binding mismatch")

    guard_path = repo / "scripts" / "migration" / "bounded-pg-restore.py"
    guard_blob = subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "rev-parse",
            "HEAD:scripts/migration/bounded-pg-restore.py",
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if provenance["execution_tools"]["bounded_pg_restore_guard"] != {
        "path": "scripts/migration/bounded-pg-restore.py",
        "git_blob_sha": guard_blob,
        "sha256": sha256(guard_path),
    }:
        raise SystemExit("bounded pg_restore guard provenance mismatch")

    serialized = json.dumps(provenance, sort_keys=True)
    inner_sha = provenance["inner_pgdmp"]["sha256"]
    if inner_sha != expected_inner_sha:
        raise SystemExit("verified inner SHA does not match the synthetic pg_dump archive")
    if provenance["inner_pgdmp"]["inspector_reported_sha256"] != inner_sha:
        raise SystemExit("normalizer and inspector inner hashes differ")
    if f"sha256: {inner_sha}" not in report:
        raise SystemExit("report does not bind the verified inner SHA")
    if expected_kind == "zip":
        if inner_sha == outer_sha:
            raise SystemExit("ZIP outer and derived inner hashes were conflated")
        if provenance["archive_member"]["name"] != expected_member:
            raise SystemExit("ZIP member/UI object binding mismatch")
        if provenance["ui_member_binding"] != {
            "status": "exact_match",
            "ui_observed_name": expected_member,
            "normalized_member_name": expected_member,
        }:
            raise SystemExit("ZIP UI/member exact-match evidence is absent")
        if provenance["zip_envelope"]["entry_count"] != 1:
            raise SystemExit("ZIP envelope did not record exactly one entry")
    else:
        if inner_sha != outer_sha:
            raise SystemExit("direct PGDMP outer/inner byte identity mismatch")
        if provenance["archive_member"] is not None or provenance["zip_envelope"] is not None:
            raise SystemExit("direct PGDMP invented ZIP metadata")
        if provenance["ui_member_binding"]["status"] != "not_applicable":
            raise SystemExit("direct PGDMP invented a ZIP member/UI binding")

    if row_sentinel in stdout or row_sentinel in serialized or row_sentinel in report:
        raise SystemExit("synthetic row payload leaked into output or durable evidence")
    if evidence_manifest.get("run_id") != provenance.get("run_id"):
        raise SystemExit("durable evidence manifest run ID mismatch")
    if completion != {
        "evidence_files_sha256": sha256(evidence_manifest_path),
        "inspection_status": "REVIEW_REQUIRED",
        "run_id": provenance.get("run_id"),
    }:
        raise SystemExit("durable completion marker binding mismatch")
    manifest_entries = evidence_manifest.get("files")
    if not isinstance(manifest_entries, dict) or not manifest_entries:
        raise SystemExit("durable evidence manifest has no bound files")
    for relative, identity in manifest_entries.items():
        bound_file = evidence / relative
        if not bound_file.is_file() or bound_file.is_symlink():
            raise SystemExit(f"manifest-bound evidence file is missing: {relative}")
        if sha256(bound_file) != identity.get("sha256"):
            raise SystemExit(f"manifest-bound evidence SHA mismatch: {relative}")
        if bound_file.stat().st_size != identity.get("size_bytes"):
            raise SystemExit(f"manifest-bound evidence size mismatch: {relative}")
        if identity.get("mode") != "0400":
            raise SystemExit(f"manifest-bound evidence mode mismatch: {relative}")
    if (evidence / "evidence-files.sha256").read_text(encoding="ascii") != (
        sha256(evidence_manifest_path) + "\n"
    ):
        raise SystemExit("detached evidence-manifest SHA mismatch")
    for path in evidence.rglob("*"):
        metadata = path.lstat()
        if stat.S_ISDIR(metadata.st_mode):
            if stat.S_IMODE(metadata.st_mode) != 0o700:
                raise SystemExit(f"evidence directory is not mode 0700: {path}")
        elif stat.S_ISREG(metadata.st_mode):
            if stat.S_IMODE(metadata.st_mode) != 0o400:
                raise SystemExit(f"evidence file is not mode 0400: {path}")
            if row_sentinel.encode("utf-8") in path.read_bytes():
                raise SystemExit(f"synthetic row payload leaked into evidence: {path}")
        else:
            raise SystemExit(f"evidence contains a non-regular object: {path}")
    if list(store.rglob("verified-inner.pgdmp")):
        raise SystemExit("derived PGDMP remained in durable evidence")


verify_mode(
    zip_store_text,
    zip_outer_text,
    zip_stdout,
    expected_kind="zip",
    expected_member=zip_member,
    expected_inner_sha=sha256(Path(direct_outer_text)),
)
verify_mode(
    direct_store_text,
    direct_outer_text,
    direct_stdout,
    expected_kind="direct",
    expected_member=None,
    expected_inner_sha=sha256(Path(direct_outer_text)),
)

workspace = repo / "local-migration-artifacts"
if workspace.exists() and any(workspace.iterdir()):
    raise SystemExit("disposable working evidence was retained after durable publication")
if ledger.read_text(encoding="utf-8").splitlines() != [
    "--version",
    "--list",
    "--version",
    "--list",
]:
    raise SystemExit("pg_restore ledger contained an unexpected invocation")
PY

# PostgreSQL 17 currently accepts a valid custom archive with bytes appended.
# Keep this empirical check paired with the documented verification ceiling:
# pg_restore --list does not prove that every byte of the inner input was consumed.
appended_archive="${TMP_ROOT}/real-pgdmp-with-appended-junk.backup"
cp -- "$DIRECT_CANONICAL" "$appended_archive"
chmod 0600 "$appended_archive"
printf 'SYNTHETIC_APPENDED_JUNK' >>"$appended_archive"
if "$REAL_PG_RESTORE_BIN" --list "$appended_archive" >/dev/null 2>&1; then
  grep -Fq -- \
    'pg_restore --list does not prove that every byte of the inner input was consumed.' \
    "$EXECUTION_REPO/scripts/migration/README.md" || {
      printf 'ERROR: accepted appended bytes require the explicit documented ceiling\n' >&2
      exit 1
    }
  printf 'PASS: real PG17 accepts appended junk; exact-consumption ceiling is documented\n'
else
  printf 'PASS: real PG17 rejected the PGDMP archive with appended junk\n'
fi

printf 'PASS: complete ZIP and direct-PGDMP high-level PostgreSQL 17 inspection\n'
