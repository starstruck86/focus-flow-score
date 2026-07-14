# Local migration rehearsal tools

These tools operate on local files or reviewed repository source only. They do
not implement a database restore, connection, export, deployment, or migration.
Migration readiness remains **RED** until a separately authorized empirical
rehearsal succeeds and every runbook gate is reviewed.

## Inspect a Lovable export envelope

Lovable may deliver a PostgreSQL custom archive inside a ZIP envelope. The ZIP
is the canonical downloaded artifact; the PGDMP member is a distinct, derived
inspector input. Their sizes and SHA-256 values must never be conflated. A raw
PGDMP remains a supported input and is recorded as a direct byte-copy
relationship rather than as an invented ZIP member.

Preserve the untouched download, under its original filename, in an approved
encrypted evidence store outside this Git worktree. The ignored
`local-migration-artifacts/` directory is disposable working space, not the
canonical or only copy: `git clean` can delete ignored files. The completed
metadata evidence package must also be copied into the approved evidence store
and verified there. Never upload an export, metadata report, object inventory,
credential, or secret to GitHub, CI, chat, or unapproved storage.

The high-level driver `inspect-lovable-export.py` performs these steps:

1. Requires an externally supplied approval pin that exactly equals `HEAD`, a
   clean checkout, the unchanged direct inspector baseline, and reviewed
   normalizer/driver/README bytes from that checkout.
2. Validates structured event provenance without inferring any timestamp.
3. Captures the canonical outer bytes into private working space and calls
   `normalize-lovable-export.py` with the expected outer SHA-256.
4. For ZIP input, requires one safe regular member and streams it to the fixed
   exclusive file `verified-inner.pgdmp`; for raw PGDMP input, makes the same
   bounded verified copy without inventing member metadata.
5. Runs the unchanged `inspect-lovable-dump.sh` only against that verified inner
   file. The inspector may invoke `pg_restore` only with `--version` and
   `--list`.
6. Rechecks the canonical outer, working outer, derived inner, inspector report,
   and every digest binding. Archive bytes are deleted from working evidence.
7. Fully prepares and fsyncs the metadata report, checksum sidecars,
   provenance, and `EVIDENCE_COMPLETE` inside the private pending tree, then
   atomically renames that complete tree with an operating-system no-replace
   guarantee. Failure strictly removes the entire incomplete run; a cleanup
   failure is itself fatal. Existing runs and outputs are never overwritten.

The normalizer does not use `unzip`, `extractall`, or a member-controlled output
path. Its accepted ZIP subset is intentionally small: no prefix or trailing
bytes, no archive comment, no ZIP64, no data descriptor, no extra fields,
exactly one central/local entry pair, and only stored or raw-DEFLATE data. It
rejects duplicate/multiple entries, unsafe or ambiguous names, directories,
symlinks and special files, encryption, nested archives, unsupported flags or
compression, inconsistent headers, truncation, CRC/size lies, non-PGDMP bytes,
declared or streamed size excess, excessive compression ratio, and insufficient
disk headroom. After the outer working copy exists, normalization requires room
for both the derived inner and the inspector's private inner snapshot plus the
larger of 256 MiB or ten percent of the inner size; direct PGDMP mode therefore
plans for approximately three archive copies plus overhead in working storage.
The output is streamed through an exclusive partial file, hashed
and CRC-checked while bounded, fsynced, set to mode `0400`, and published with a
no-overwrite hard link inside an owner-only temporary directory.

Prefix, polyglot, and trailing-junk rejection is structural in ZIP mode: the
local header must begin at byte zero and the end-of-central-directory record
must end at EOF. In direct-PGDMP mode the normalizer performs the bounded,
stable byte copy and a conservative custom-archive header check; the unchanged
inspector's real `pg_restore --list` call remains the full-format and
trailing-content compatibility boundary. A rejection there removes the pending
derived archive and publishes no report or provenance.

### Required operator inputs

Supply these values in the environment. Values shown here are descriptions,
not defaults:

| Variable | Contract |
|---|---|
| `SOURCE_PROJECT_NAME` | Exact operator-observed Lovable UI project name |
| `SOURCE_PROJECT_REF` | Exact 20-character lowercase project ref |
| `UI_EXPORT_OBJECT_NAME` | Exact export object name observed in the Lovable UI; separate from the downloaded filename |
| `OPERATOR_IDENTITY` | Named human operator |
| `EXPORT_EVIDENCE_PROFILE` | `retained_rehearsal_missing_initiation`, `future_rehearsal`, or `final_cutover` |
| `CANONICAL_EXPORT` | Absolute local path in the approved encrypted evidence store |
| `APPROVED_EXECUTION_CHECKOUT_SHA` | Externally approved full lowercase 40-character commit SHA; no default |
| `PG_RESTORE_BIN` | Reviewed PostgreSQL 17 `pg_restore` path |
| `EXPORT_AVAILABLE_AT_UTC` | Operator-observed availability time, second-precision RFC3339 UTC |
| `DOWNLOAD_COMPLETED_AT_UTC` | Operator-observed download-completion time, second-precision RFC3339 UTC |
| `EXPORT_INITIATED_BASIS` | `operator_observed` or `not_observed` |
| `EXPORT_INITIATED_AT_UTC` | Required only for `operator_observed`; otherwise empty/unset |
| `EXPORT_INITIATED_REASON` | Required only for `not_observed`; otherwise empty/unset |
| `EXPORT_COMPLETED_BASIS` | `operator_observed` or `not_observed` |
| `EXPORT_COMPLETED_AT_UTC` | Required only for `operator_observed`; otherwise empty/unset |
| `EXPORT_COMPLETED_REASON` | Required only for `not_observed`; otherwise empty/unset |

Missing initiation evidence for the retained rehearsal is irreparable. Record
it honestly as `{"value": null, "basis": "not_observed", "reason": "..."}`.
This does not require another export and does not prevent safe offline metadata
inspection. Export availability is a separate observed event and is never
relabeled as completion. Completion may likewise be explicitly unobserved.
Availability and download completion are mandatory and must be ordered. Any
missing initiation or completion records `export_timeline_status=INCOMPLETE`;
successful inspection still records `inspection_status=REVIEW_REQUIRED`.
Future and final exports must record initiation at the UI action instead of
reusing this exception.

The evidence profile makes that distinction fail closed. The retained-rehearsal
profile requires unobserved initiation and an `INCOMPLETE` timeline. Future and
final profiles require operator-observed initiation; changing the basis alone
cannot turn this retained rehearsal green. Event values remain operator
attestations—the local tool can validate structure/order and bind them to the
approved package, but cannot independently prove what the operator saw.

The run ID is derived from the observed availability time and the first 12
hexadecimal characters of the canonical outer SHA-256. No time is inferred from
a filename, ZIP/DOS timestamp, filesystem metadata, download time, availability
time, or any other event.

### Checked-in execution workflow

Git provenance has distinct meanings:

- `procedure_origin_sha` is the historical commit that first introduced the
  evidence procedure. It is informational only.
- `approved_execution_checkout_sha` is supplied externally and must exactly
  match `execution_checkout_sha`, independently resolved from `HEAD`.
- The committed README blob and exact fenced block SHA-256 identify procedure
  content. The driver and normalizer have separate Git-blob and file SHA-256
  identities.
- `inspection_tool_git_sha` remains
  `c87a124602eb669b3ec5a3829610c6cb465d3e26`, the unchanged direct inspector,
  report helper, and migration-input baseline.

The workflow proves pin equality and byte identity only; it does not prove who
approved the pin.

<!-- BEGIN LOVABLE EXPORT EVIDENCE WORKFLOW -->
```bash
set -euo pipefail
umask 077

: "${SOURCE_PROJECT_NAME:?required}"
: "${SOURCE_PROJECT_REF:?required}"
: "${UI_EXPORT_OBJECT_NAME:?required}"
: "${OPERATOR_IDENTITY:?required}"
: "${EXPORT_EVIDENCE_PROFILE:?required}"
: "${CANONICAL_EXPORT:?required}"
: "${APPROVED_EXECUTION_CHECKOUT_SHA:?required from external approval}"
: "${PG_RESTORE_BIN:?required PostgreSQL 17 pg_restore path}"
: "${EXPORT_INITIATED_BASIS:?required}"
: "${EXPORT_COMPLETED_BASIS:?required}"
: "${EXPORT_AVAILABLE_AT_UTC:?required observed UTC time}"
: "${DOWNLOAD_COMPLETED_AT_UTC:?required observed UTC time}"

scripts/migration/inspect-lovable-export.py
```
<!-- END LOVABLE EXPORT EVIDENCE WORKFLOW -->

On success the only published local output is:

```text
local-migration-artifacts/rehearsal-<availability>-<outer-sha-prefix>/evidence/
  EVIDENCE_COMPLETE
  archive/outer.sha256.before
  archive/outer.sha256.after
  inspection/rehearsal-metadata.txt
  inspection/report.sha256
  provenance.json
  provenance.sha256
```

`provenance.json` records the outer ZIP filename/size/before-and-after hashes and
structural metadata, UI object name, exact member name/compression/CRC/sizes,
inner PGDMP size/hash, inspector-reported inner hash, report hash, timeline,
operator, source identity, and procedure/tool identities. `provenance.sha256` is
a detached digest because a file cannot contain its own ordinary SHA-256.
Neither the working outer bytes nor derived inner bytes are retained in the
metadata package. A directory without the final `EVIDENCE_COMPLETE` marker is
not a published evidence package and must fail review.

The existing low-level inspector remains available for a reviewed direct raw
PGDMP path:

```text
scripts/migration/inspect-lovable-dump.sh \
  --output 'local-migration-artifacts/metadata-report.txt' \
  '/absolute/local/path/to/synthetic-or-authorized.dump'
```

It refuses URLs/connection strings, missing/non-regular/empty files, non-PGDMP
formats, incompatible tools, existing reports, unknown TOC classes, and
unresolved known object entries. It captures a private byte snapshot and never
connects to or restores a database.

CI executes the complete fenced workflow in isolated synthetic Git checkouts
with a controlled fake `pg_restore`. It also tests the normalizer adversarially,
retains the direct-PGDMP shell and real PostgreSQL 17 `pg_dump -Fc` integration
tests, plants checkout/migration/tool/timeline/hash/publication failures, proves
only `pg_restore --version` and `--list` are called, and scans output/evidence for
a synthetic row-payload sentinel. This validates local mechanics only—not a
real Lovable export, source completeness, or any external system.

Do not construct a final `pg_restore` command until the actual TOC has been
classified and the supported managed-Supabase restore procedure is confirmed.

## Inventory reviewed Edge Function source

```text
scripts/migration/inventory-edge-functions.py \
  --role source \
  --collected-at '<operator-observed RFC3339 UTC>' \
  > /tmp/edge-functions.json
```

Supply the actual repository role and UTC collection time. A target collection
also requires its explicit `--project-ref`. The repository-only output
fingerprints each function's resolved local deployment dependency closure,
including reachable `_shared` files, together with its effective entrypoint,
import map, and structured `verify_jwt` setting. Deployed-target evidence
requires a distinct authorized collector.

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

The converter hashes the input once, fingerprints typed metadata with
domain-separated length framing, refuses incomplete counts/unknown record
classes, derives its snapshot boundary/time from the SQL envelope, and never
overwrites output. The destructive synthetic PostgreSQL fixtures require
`MIGRATION_VERIFY_ALLOW_FIXTURE=1`, PostgreSQL 17, a database named
`migration_verify_*`, and a recognized local socket or explicitly labeled local
test container. Remote/non-test targets fail before fixture SQL.

## Compare verification manifests

```text
scripts/migration/compare-manifests.py \
  local-migration-artifacts/source-manifest.json \
  local-migration-artifacts/target-manifest.json
```

Exit `0` means every component is exactly `Match`; exit `2` means at least one
discrepancy or unknown; exit `1` means validation failed. The strict v2 schema
requires non-empty, distinct source/target manifests, project refs, collection
provenance, real fingerprints, explicit roles, collector version/time, and
kind-sufficient evidence. Source-vs-source or same-input comparisons are invalid,
not a match.
