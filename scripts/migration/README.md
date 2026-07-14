# Local migration rehearsal tools

These tools operate on local files or reviewed repository source only. They do
not contain a database restore path and were not run against a remote database,
Lovable Cloud, or production data in this PR.

## Inspect a future Lovable export

Preserve the untouched download first in an approved encrypted evidence store.
The ignored `local-migration-artifacts/` directory is disposable staging, not
the canonical or only copy: `git clean` operations can delete ignored files.
Inspect only a working copy whose SHA-256 has been verified against the
canonical archive.

The following Bash template creates a private per-run package, records
digest-only external before/after checksum files, runs the metadata-only
inspector, requires exactly one `sha256:` field in the report, and fails unless
the canonical archive, working copy, both external checksums, and reported
archive hash are identical. It then writes the report checksum and provenance
manifest with exclusive-create semantics. Replace every angle-bracketed value;
the validation rejects placeholders.

Git provenance has three separate meanings. `EVIDENCE_PROCEDURE_GIT_SHA` is the
substantive commit that introduced this evidence-package procedure;
`INSPECTION_TOOL_GIT_SHA` is the unchanged inspector/helper/migration baseline;
and `EXECUTION_CHECKOUT_SHA` is the exact checkout executing the procedure. The
first two are fixed review anchors. The third proves execution identity—not
review approval—and is always resolved from `git rev-parse HEAD` at execution.

<!-- BEGIN LOVABLE EXPORT EVIDENCE WORKFLOW -->
```bash
set -euo pipefail
umask 077

export SOURCE_PROJECT_NAME="${SOURCE_PROJECT_NAME:-<exact Lovable source project name>}"
export SOURCE_PROJECT_REF="${SOURCE_PROJECT_REF:-<exact 20-character Lovable source project ref>}"
export EXPORT_INITIATED_AT_UTC="${EXPORT_INITIATED_AT_UTC:-<operator-observed YYYY-MM-DDTHH:MM:SSZ>}"
export EXPORT_COMPLETED_AT_UTC="${EXPORT_COMPLETED_AT_UTC:-<operator-observed YYYY-MM-DDTHH:MM:SSZ>}"
export DOWNLOAD_COMPLETED_AT_UTC="${DOWNLOAD_COMPLETED_AT_UTC:-<operator-observed YYYY-MM-DDTHH:MM:SSZ>}"
export OPERATOR_IDENTITY="${OPERATOR_IDENTITY:-<named operator identity>}"
export EVIDENCE_PROCEDURE_GIT_SHA="${EVIDENCE_PROCEDURE_GIT_SHA:-e4eed4a21049d274738110710a468e265c2893d2}"
export INSPECTION_TOOL_GIT_SHA="${INSPECTION_TOOL_GIT_SHA:-c87a124602eb669b3ec5a3829610c6cb465d3e26}"
EXECUTION_CHECKOUT_SHA="$(git rev-parse HEAD)"
export EXECUTION_CHECKOUT_SHA

CANONICAL_EXPORT="${CANONICAL_EXPORT:-/approved/encrypted/evidence-store/Lovable export.backup}"
for required_name in \
  SOURCE_PROJECT_NAME SOURCE_PROJECT_REF EXPORT_INITIATED_AT_UTC \
  EXPORT_COMPLETED_AT_UTC DOWNLOAD_COMPLETED_AT_UTC OPERATOR_IDENTITY; do
  required_value="${!required_name}"
  if [[ -z "$required_value" || "$required_value" == *'<'* || "$required_value" == *'>'* ]]; then
    printf 'ERROR: %s is missing or still a placeholder\n' "$required_name" >&2
    exit 1
  fi
done
if [[ ! "$SOURCE_PROJECT_REF" =~ ^[a-z0-9]{20}$ ]]; then
  printf '%s\n' 'ERROR: SOURCE_PROJECT_REF must be 20 lowercase letters/digits' >&2
  exit 1
fi
for timestamp in \
  "$EXPORT_INITIATED_AT_UTC" "$EXPORT_COMPLETED_AT_UTC" \
  "$DOWNLOAD_COMPLETED_AT_UTC"; do
  if [[ ! "$timestamp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
    printf '%s\n' 'ERROR: observed times must be second-precision RFC3339 UTC' >&2
    exit 1
  fi
done

if [[ "$EVIDENCE_PROCEDURE_GIT_SHA" != 'e4eed4a21049d274738110710a468e265c2893d2' ]]; then
  printf '%s\n' 'ERROR: unexpected evidence procedure Git SHA' >&2
  exit 1
fi
if [[ "$INSPECTION_TOOL_GIT_SHA" != 'c87a124602eb669b3ec5a3829610c6cb465d3e26' ]]; then
  printf '%s\n' 'ERROR: unexpected inspection tool Git SHA' >&2
  exit 1
fi
for sha_name in \
  EVIDENCE_PROCEDURE_GIT_SHA INSPECTION_TOOL_GIT_SHA \
  EXECUTION_CHECKOUT_SHA; do
  sha_value="${!sha_name}"
  if [[ ! "$sha_value" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'ERROR: %s must be a full lowercase commit SHA\n' "$sha_name" >&2
    exit 1
  fi
  if ! git cat-file -e "${sha_value}^{commit}"; then
    printf 'ERROR: %s does not identify an available commit\n' "$sha_name" >&2
    exit 1
  fi
done
if [[ "$(git rev-parse HEAD)" != "$EXECUTION_CHECKOUT_SHA" ]]; then
  printf '%s\n' 'ERROR: execution checkout SHA does not match HEAD' >&2
  exit 1
fi
if ! git merge-base --is-ancestor \
  "$EVIDENCE_PROCEDURE_GIT_SHA" "$EXECUTION_CHECKOUT_SHA"; then
  printf '%s\n' 'ERROR: evidence procedure commit is not an execution ancestor' >&2
  exit 1
fi
if ! git merge-base --is-ancestor \
  "$INSPECTION_TOOL_GIT_SHA" "$EXECUTION_CHECKOUT_SHA"; then
  printf '%s\n' 'ERROR: inspection tool commit is not an execution ancestor' >&2
  exit 1
fi
procedure_origin="$(git show "${EVIDENCE_PROCEDURE_GIT_SHA}:scripts/migration/README.md")"
if [[ "$procedure_origin" != *'lovable_cloud_export_inspection_provenance'* ]]; then
  printf '%s\n' 'ERROR: evidence procedure is absent from its provenance commit' >&2
  exit 1
fi
if ! git diff --quiet "$EXECUTION_CHECKOUT_SHA" -- scripts/migration/README.md; then
  printf '%s\n' 'ERROR: evidence procedure differs from the execution checkout' >&2
  exit 1
fi
if ! git diff --quiet "$INSPECTION_TOOL_GIT_SHA" -- \
  scripts/migration/inspect-lovable-dump.sh \
  scripts/migration/lib/lovable_dump_report.py \
  supabase/migrations; then
  printf '%s\n' 'ERROR: inspection tool/input tree differs from its reviewed Git SHA' >&2
  exit 1
fi
if ! untracked_migrations="$(
  git ls-files --others --exclude-standard -- supabase/migrations
)"; then
  printf '%s\n' 'ERROR: could not inventory untracked migration inputs' >&2
  exit 1
fi
if [[ -n "$untracked_migrations" ]]; then
  printf '%s\n' 'ERROR: untracked files under supabase/migrations can alter inspection' >&2
  printf '%s\n' "$untracked_migrations" >&2
  exit 1
fi
if ! ignored_untracked_migrations="$(
  git ls-files --others --ignored --exclude-standard -- supabase/migrations
)"; then
  printf '%s\n' 'ERROR: could not inventory ignored migration inputs' >&2
  exit 1
fi
if [[ -n "$ignored_untracked_migrations" ]]; then
  printf '%s\n' 'ERROR: ignored files under supabase/migrations can alter inspection' >&2
  printf '%s\n' "$ignored_untracked_migrations" >&2
  exit 1
fi

RUN_ID="rehearsal-${EXPORT_INITIATED_AT_UTC//[-:]/}"
export RUN_ID
RUN_ROOT="local-migration-artifacts/${RUN_ID}"
WORKING_EXPORT="${RUN_ROOT}/archive/$(basename "$CANONICAL_EXPORT")"
BEFORE_SHA="${RUN_ROOT}/archive/archive.sha256.before"
AFTER_SHA="${RUN_ROOT}/archive/archive.sha256.after"
REPORT="${RUN_ROOT}/inspection/rehearsal-metadata.txt"
REPORT_SHA="${RUN_ROOT}/inspection/report.sha256"
PROVENANCE="${RUN_ROOT}/provenance.json"

test -s "$CANONICAL_EXPORT"
test ! -e "$RUN_ROOT"
mkdir -p "${RUN_ROOT}/archive" "${RUN_ROOT}/inspection"
cp -p "$CANONICAL_EXPORT" "$WORKING_EXPORT"
chmod 0400 "$WORKING_EXPORT"

python3 - "$CANONICAL_EXPORT" "$WORKING_EXPORT" "$BEFORE_SHA" <<'PY'
import hashlib
import pathlib
import sys

def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()

canonical, working, output = map(pathlib.Path, sys.argv[1:])
canonical_sha = sha256(canonical)
working_sha = sha256(working)
if canonical_sha != working_sha:
    raise SystemExit("canonical archive and working-copy SHA-256 differ")
with output.open("x", encoding="ascii") as destination:
    destination.write(working_sha + "\n")
PY

scripts/migration/inspect-lovable-dump.sh \
  --output "$REPORT" \
  "$WORKING_EXPORT"

python3 - \
  "$CANONICAL_EXPORT" "$WORKING_EXPORT" "$BEFORE_SHA" "$AFTER_SHA" \
  "$REPORT" "$REPORT_SHA" "$PROVENANCE" "$RUN_ROOT" <<'PY'
import datetime
import hashlib
import json
import os
import pathlib
import re
import sys

HEX64 = re.compile(r"[0-9a-f]{64}")
PLACEHOLDER = re.compile(r"[<>]|placeholder|replace|todo|tbd", re.IGNORECASE)

def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()

def required(name: str) -> str:
    value = os.environ.get(name, "")
    if not value or value.strip() != value or "\n" in value or "\r" in value:
        raise SystemExit(f"{name} must be a non-empty single-line value")
    if PLACEHOLDER.search(value):
        raise SystemExit(f"{name} still contains a placeholder")
    return value

def observed_utc(name: str) -> str:
    value = required(name)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value):
        raise SystemExit(f"{name} must be second-precision RFC3339 UTC")
    datetime.datetime.fromisoformat(value[:-1] + "+00:00")
    return value

def read_digest(path: pathlib.Path) -> str:
    value = path.read_text(encoding="ascii").strip()
    if not HEX64.fullmatch(value):
        raise SystemExit(f"invalid digest-only checksum file: {path}")
    return value

canonical, working, before_file, after_file, report, report_sha_file, provenance, run_root = (
    map(pathlib.Path, sys.argv[1:])
)
if canonical.name != working.name:
    raise SystemExit("working copy does not preserve the original filename")

before = read_digest(before_file)
after = sha256(working)
with after_file.open("x", encoding="ascii") as destination:
    destination.write(after + "\n")

report_text = report.read_text(encoding="utf-8")
reported = re.findall(r"^sha256: ([0-9a-f]{64})$", report_text, re.MULTILINE)
if len(reported) != 1:
    raise SystemExit("inspector report must contain exactly one archive sha256 field")
report_lines = set(report_text.splitlines())
required_report_lines = {
    "inspection_status: REVIEW_REQUIRED",
    "restore_attempted: no",
    "database_connection_attempted: no",
    "row_payload_inspected: no",
    f"input_file: {working.name}",
    f"size_bytes: {working.stat().st_size}",
}
if not required_report_lines <= report_lines or not any(
    line.startswith("archive_snapshot_binding: PASS ") for line in report_lines
):
    raise SystemExit("inspector report is missing a required safety-boundary field")
actual = sha256(working)
canonical_sha = sha256(canonical)
if len({before, after, reported[0], actual, canonical_sha}) != 1:
    raise SystemExit("external before/after, report, working, and canonical SHA-256 differ")

report_sha = sha256(report)
with report_sha_file.open("x", encoding="ascii") as destination:
    destination.write(report_sha + "\n")

initiated = observed_utc("EXPORT_INITIATED_AT_UTC")
completed = observed_utc("EXPORT_COMPLETED_AT_UTC")
downloaded = observed_utc("DOWNLOAD_COMPLETED_AT_UTC")
if not initiated <= completed <= downloaded:
    raise SystemExit("observed export/download times are out of order")
project_ref = required("SOURCE_PROJECT_REF")
if not re.fullmatch(r"[a-z0-9]{20}", project_ref):
    raise SystemExit("SOURCE_PROJECT_REF must be exactly 20 lowercase letters/digits")
procedure_sha = required("EVIDENCE_PROCEDURE_GIT_SHA")
tool_sha = required("INSPECTION_TOOL_GIT_SHA")
execution_sha = required("EXECUTION_CHECKOUT_SHA")
if procedure_sha != "e4eed4a21049d274738110710a468e265c2893d2":
    raise SystemExit("unexpected evidence procedure Git SHA")
if tool_sha != "c87a124602eb669b3ec5a3829610c6cb465d3e26":
    raise SystemExit("unexpected inspection tool Git SHA")
if not re.fullmatch(r"[0-9a-f]{40}", execution_sha):
    raise SystemExit("invalid execution checkout SHA")

relative = lambda path: str(path.relative_to(run_root))
manifest = {
    "format_version": 1,
    "artifact_kind": "lovable_cloud_export_inspection_provenance",
    "run_id": required("RUN_ID"),
    "run_kind": "rehearsal",
    "evidence_procedure_git_sha": procedure_sha,
    "inspection_tool_git_sha": tool_sha,
    "execution_checkout_sha": execution_sha,
    "lovable_source_project": {
        "name": required("SOURCE_PROJECT_NAME"),
        "ref": project_ref,
    },
    "export": {
        "initiated_at_utc": {"value": initiated, "basis": "operator_observed"},
        "completed_at_utc": {"value": completed, "basis": "operator_observed"},
        "downloaded_at_utc": {"value": downloaded, "basis": "operator_observed"},
        "original_filename": working.name,
        "working_copy_relative_path": relative(working),
        "size_bytes": working.stat().st_size,
        "sha256": actual,
        "sha256_evidence": {
            "external_before": before,
            "external_after": after,
            "inspector_report": reported[0],
        },
        "external_checksum_files": {
            "before": relative(before_file),
            "after": relative(after_file),
        },
        "support_reported_not_empirically_verified": [
            "point-in-time pg_dump custom-format archive",
            "maximum export size 5 GB",
            "one export generation per 24 hours",
        ],
    },
    "operator_identity": required("OPERATOR_IDENTITY"),
    "inspection_tool": {
        "path": "scripts/migration/inspect-lovable-dump.sh",
        "git_sha": tool_sha,
    },
    "report": {
        "filename": report.name,
        "relative_path": relative(report),
        "sha256": report_sha,
        "checksum_file": relative(report_sha_file),
    },
}
with provenance.open("x", encoding="utf-8") as destination:
    json.dump(manifest, destination, indent=2, sort_keys=True)
    destination.write("\n")
PY
```
<!-- END LOVABLE EXPORT EVIDENCE WORKFLOW -->

After inspection, transfer the manifest-indexed report and checksum sidecars to
the same approved encrypted evidence store as the canonical archive and verify
the copied file hashes there. Retaining only `local-migration-artifacts/` is not
acceptable. Never record an expiring download URL, connection string,
credential, or secret in the package.

The script refuses URLs/connection strings, missing or non-regular files,
non-`PGDMP` formats, missing/incompatible tools, existing output files, and
unknown TOC classes. It invokes `pg_restore` only with `--version` and `--list`.
It computes the archive SHA-256 and reports metadata/risk flags without
decoding or printing row payloads. A successful report still says
`REVIEW_REQUIRED`; it is not a restore plan.

CI extracts and executes the complete fenced Bash workflow in a temporary Git
checkout, using a synthetic `PGDMP` archive and a controlled fake `pg_restore`.
It exercises the real inspector/helper, report and provenance publication, and
the Git provenance and migration-input guards without a database or network.
Planted failures cover ordinary and ignored untracked migrations, modified
inspector/helper/tracked migration/procedure, wrong procedure/tool pins, and
missing or malformed execution checkout output. This proves the local procedure
mechanics only; it does not validate a real Lovable archive, source completeness,
or any remote system.

Do not construct a final `pg_restore` command until the actual TOC has been
classified and the supported Lovable/Supabase restore procedure is confirmed.

## Inventory reviewed Edge Function source

```text
scripts/migration/inventory-edge-functions.py \
  --role source \
  --collected-at '2026-07-14T13:29:59Z' \
  > /tmp/edge-functions.json
```

Supply the actual repository role and UTC collection time. A target collection
also requires its explicit `--project-ref`, preventing source evidence from
being relabeled accidentally. Because this tool reads only a local checkout,
target-role output is marked not independently verifiable and cannot produce a
green deployment comparison; deployed-target evidence requires a distinct,
independent collector. The repository-only output fingerprints
each function's resolved local deployment dependency closure (including
reachable `_shared` files) together with its effective entrypoint, import map,
and `verify_jwt`. An omitted `verify_jwt` is recorded structurally as the
documented default `true`, distinct from an explicit setting. Unresolved local
imports or unsupported function settings fail collection.

## Convert captured PostgreSQL verification output

Both read-only SQL collectors under `verification/` emit one strict JSON object
per line. Convert a captured byte snapshot deterministically:

```text
scripts/migration/catalog-jsonl-to-manifest.py \
  'local-migration-artifacts/source catalog.jsonl' \
  --output 'local-migration-artifacts/source manifest.json' \
  --label rehearsal-source --role source --project-ref '<source-ref>' \
  --artifact-source '<capture-provenance>' \
  --evidence-kind database_catalog
```

The converter reads and hashes the input once, fingerprints typed metadata with
domain-separated length framing, refuses incomplete table counts and unknown
record classes, derives its snapshot boundary/time and verification scope from
the captured SQL envelope, and will not overwrite an existing output. Use
`--evidence-kind service_inventory` only with the separately captured managed
service inventory.

The destructive synthetic PostgreSQL integration fixtures are test-only. They
require `MIGRATION_VERIFY_ALLOW_FIXTURE=1`, PostgreSQL 17, a database named
`migration_verify_*`, and either the canonical local PostgreSQL Unix socket or
an explicitly prefixed `focus-flow-migration-verify-*` container on a local
Docker socket carrying the test-only label
`com.focus-flow.migration-verify=true`. Both scripts verify the connected
database identity before fixture SQL. TCP hosts, non-test database names,
remote Docker endpoints, missing dependencies, and ambiguous assertion results
fail before fixture setup.

## Compare verification manifests

```text
scripts/migration/compare-manifests.py \
  local-migration-artifacts/source-manifest.json \
  local-migration-artifacts/target-manifest.json
```

Exit `0` means every component is exactly `Match`; exit `2` means at least one
discrepancy or unknown; exit `1` means input validation failed. The strict
schema and SQL collection templates are under `verification/`. Format v2
requires non-empty source and target manifests, distinct project refs and
collection provenance, real SHA-256 evidence, explicit source/target roles,
collector version/time, and kind-sufficient evidence. Reusing one input or
comparing source against source is an invalid comparison, not a match.
