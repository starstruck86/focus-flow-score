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
encrypted evidence store outside this Git worktree. Supply that exact store as
`APPROVED_EVIDENCE_STORE_ROOT`: it must be an absolute, real non-symlink
directory owned by the executing user with mode `0700`. `CANONICAL_EXPORT` must
be its direct child, not a symlink, owned by the executing user, and inaccessible
to group and world. The ignored `local-migration-artifacts/` directory is
disposable working space only: `git clean` can delete it, and the workflow
removes its completed working run after durable publication. Never upload an
export, metadata report, object inventory, credential, or secret to GitHub, CI,
chat, or unapproved storage. The workflow enforces filesystem privacy but does
not independently verify volume encryption; approval of the encrypted store is
an external assertion.

The high-level driver `inspect-lovable-export.py` performs these steps:

1. Requires an externally supplied approval pin that exactly equals `HEAD`, a
   clean checkout, execution-checkout-bound raw-inspector and report-helper
   bytes, the unchanged historical migration-input baseline, and reviewed
   normalizer/driver/bounded-guard/README/config bytes from that checkout.
2. Requires `SOURCE_PROJECT_REF` to exactly equal the single strict top-level
   `project_id` in the approved checkout's `supabase/config.toml`, whose Git blob
   and file SHA-256 are recorded. This binds repository configuration, not
   Lovable's internal export-control mapping.
3. Validates structured event provenance without inferring any timestamp, then
   validates the approved evidence-store root and the externally supplied
   expected outer filename, byte size, and SHA-256 before creating a run,
   copying bytes, normalizing, or invoking `pg_restore`.
4. Captures the canonical outer bytes into private working space and calls
   `normalize-lovable-export.py` with `EXPECTED_OUTER_SHA256`, never a digest
   freshly measured and promoted by the workflow itself.
5. For ZIP input, requires one safe regular member whose name exactly equals
   `UI_EXPORT_OBJECT_NAME`, and streams it to the fixed
   exclusive file `verified-inner.pgdmp`; for raw PGDMP input, makes the same
   bounded verified copy without inventing member metadata.
6. Runs the execution-bound `inspect-lovable-dump.sh` only against that verified
   inner file. Before any `pg_restore` call, the inspector records only the
   first 11 safe PGDMP header bytes as numeric archive-version bytes, integer
   width, offset width, and custom-format code, bound to the verified inner
   SHA-256. It routes `pg_restore` through the reviewed bounded guard, which may
   invoke the absolute, non-symlink underlying executable only as `--version`
   or `--list <absolute-local-path>`.
   PostgreSQL documents `--list` as an editable TOC summary that can be fed
   back to `--use-list`; it does not define lossless field quoting for object
   identity. In PostgreSQL 17's `PrintTOCSummary`, the sanitized description,
   namespace, tag, and owner are emitted as whitespace-separated `%s` fields.
   Names containing whitespace or punctuation therefore cannot always be
   reconstructed unambiguously from this interface alone. See the
   [PostgreSQL 17 `pg_restore` documentation](https://www.postgresql.org/docs/17/app-pgrestore.html)
   and the upstream
   [`PrintTOCSummary` implementation](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/bin/pg_dump/pg_backup_archiver.c).
7. Rechecks the canonical outer, working outer, derived inner, inspector report,
   and every digest binding. Archive bytes are deleted from working evidence.
8. Fully prepares the metadata report, expected and workflow-observed checksum
   sidecars, provenance and detached provenance hash, and the per-file evidence
   manifest plus detached manifest hash inside a private pending tree. It copies
   and verifies every payload file at mode `0400` through held directory
   descriptors and fsyncs the final modes and every mode-0700 directory. After
   one payload-tree and canonical/root recheck it atomically reserves the final
   run path with a descriptor-relative operating-system no-replace guarantee at
   `<APPROVED_EVIDENCE_STORE_ROOT>/migration-inspection-evidence/<run-id>`, and
   then revalidates the committed descriptor-bound tree, canonical artifact,
   and store binding before adding an exact `EVIDENCE_COMPLETE` marker that
   binds the run ID, detached-manifest identity, and
   `restore_planning_gate=BLOCKED`. `EVIDENCE_COMPLETE` means only that the
   retained metadata evidence package is complete and durable; it never means
   object-name analysis, restore planning, or migration readiness is complete.
   Disposable working evidence
   and derived archive are removed before commit. A precommit failure publishes
   no final-named package; cleanup failure can leave only a hidden quarantined
   pending directory. A postcommit validation failure has no completion marker
   and receives `EVIDENCE_INDETERMINATE`. Existing pending or final runs are
   never overwritten or deleted.

The normalizer does not use `unzip`, `extractall`, or a member-controlled output
path. Its accepted ZIP subset is intentionally small: no prefix or trailing
bytes, no archive comment, no ZIP64, no data descriptor, no extra fields,
exactly one central/local entry pair, and only STORE declaring ZIP version 1.0
or raw DEFLATE declaring ZIP version 2.0. It
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
stable byte copy and a conservative custom-archive header check; the execution-bound
inspector's real `pg_restore --list` call supplies a bounded TOC/compatibility
signal only and may accept appended inner bytes. Whole-file hashes bind the
exact inner input, but do not prove that `pg_restore` consumed it all. A
rejection removes the pending derived archive and publishes no report or
provenance.

The bounded guard has fixed, non-environment-overridable limits: `--version`
has 15 seconds and 1 MiB stdout; `--list` has 300 seconds and 128 MiB stdout;
both have a 1 MiB stderr cap. It drains output through private exclusive capture
files, kills the child process group and waits for/reaps its direct child leader
on timeout or output overflow, and passes captured output only after exit status
zero. On failure it classifies only `unsupported_archive_version`,
`invalid_archive`, `truncated_archive`, `timeout`, `output_cap`, or
`other_nonzero` and emits one fixed JSON record; it never relays child output.
These bounds
prevent an unbounded inspection process; they do not strengthen what
`pg_restore` semantically validates.

pg_restore --list does not prove that every byte of the inner input was consumed.

### TOC object-reference analysis boundary

The parser accepts only small class-specific object-name grammars. In
particular, `EXTENSION - uuid-ossp <owner>` and the ownerless
`EXTENSION - pgcrypto` form use a narrowly scoped ASCII extension-name rule;
hyphens are not enabled for tables, functions, or the global identifier
grammar, and quote characters are not treated as lossless identifier syntax.
An EXTENSION owner token contributes to the owner/role warning counts; the
ownerless form and an explicit `-` owner do not.

Source PostgreSQL and `pg_dump` header values are copied into evidence only
when the complete header matches a bounded ASCII grammar: numeric version
components plus the reviewed `betaN`, `rcN`, or `devel` PostgreSQL prerelease
forms. Unrecognized, vendor-suffixed, trailing-text, or overlong values become
the fixed `REDACTED_UNSAFE_OR_UNRECOGNIZED` token. Candidate count and byte
length are capped, distinct candidates fail closed, and candidate text is never
included in a diagnostic.

A known TOC class whose namespace/tag/owner text cannot be resolved
unambiguously is not an archive-integrity failure. The inspector retains a
metadata package with `inspection_status=REVIEW_REQUIRED`, a total unresolved
count, fixed allowlisted counts for every recognized class, and exactly these hard
gates:

- `object_reference_analysis: INCOMPLETE`
- `migration_duplicate_analysis: INCOMPLETE`
- `restore_planning_gate: BLOCKED`

Data/payload-position and annotation classes that do not represent a standalone
schema-object reference are explicitly exempt and retain zero unresolved
counts; every other recognized class participates in the conservative gate.
Migration-duplicate analysis is independent but never claims completeness.
When object references are resolved and migration metadata is readable, the
name scan is labeled `CONSERVATIVE`: it can flag reviewed possible duplicates,
but it cannot prove their absence across PostgreSQL aliases, modifiers before
an object name, object-kind ambiguity, or dynamically constructed SQL. When an
object reference is unresolved, duplicate analysis is `INCOMPLETE` and the
report retains only aggregate counts. `COMPLETE` is reserved for a future
catalog-backed or genuinely executed/parsed schema comparison and is not
emitted by this workflow. Both statuses keep
`restore_planning_gate: BLOCKED`.
Provenance format version 6 makes these analysis fields and the blocked gate
mandatory; an older package cannot satisfy the current publication
validator. Durable and pending `provenance.json` and `evidence-files.json` are
loaded with recursive duplicate-key and nonfinite-number rejection and exact
allowed-key schemas at every fixed object level; unknown readiness fields,
contradictory safety values, and last-key-wins JSON cannot satisfy publication.
Every expected scalar is type/format checked and identity fields are
cross-bound to their parent claims and retained checksum/report bytes. Before
evidence-package construction, the workflow freezes a runtime publication
contract containing the live descriptor-bound canonical identity and the
approved checkout, tool, configuration, Python, source, timeline, inner,
report, and analysis identities. Pending validation, descriptor-bound staging
validation, the immediate pre-rename gate, and the post-rename gate before
`EVIDENCE_COMPLETE` each compare provenance to that same runtime contract and
reverify the live canonical descriptor. Internal agreement among substituted
provenance fields, sidecars, and a fully rehashed manifest is therefore not
sufficient for publication.
That aggregate-only path does not perform or emit name-, schema-, owner-, OID-,
SQL-, path-, payload-, or migration-duplicate detail analysis. Unknown object
classes, malformed TOC records, duplicate TOC IDs, conflicting source or
`pg_dump` version headers, archive/hash failures, and unsafe helper diagnostics
remain fatal and publish no normal evidence package. A fully resolved object
analysis still remains `REVIEW_REQUIRED` and has
`restore_planning_gate=BLOCKED`; no report, provenance record, stdout status, or
completion marker from this workflow is a restore-ready or migration-green
signal.

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
| `APPROVED_EVIDENCE_STORE_ROOT` | Absolute approved encrypted-store root outside the Git worktree; real non-symlink, executing-user-owned, mode `0700`; no default |
| `CANONICAL_EXPORT` | Absolute direct-child path beneath `APPROVED_EVIDENCE_STORE_ROOT`; non-symlink regular file, executing-user-owned, no group/world access |
| `EXPECTED_ORIGINAL_FILENAME` | Externally approved exact canonical basename; no default |
| `EXPECTED_OUTER_SIZE_BYTES` | Externally approved positive decimal canonical byte size, at most the 5 GB inspection cap; no default |
| `EXPECTED_OUTER_SHA256` | Externally approved 64-character lowercase SHA-256 of the canonical outer artifact; no default |
| `APPROVED_EXECUTION_CHECKOUT_SHA` | Externally approved full lowercase 40-character commit SHA; no default |
| `PG_RESTORE_BIN` | Reviewed absolute, executable, non-symlink PostgreSQL 17 `pg_restore` path; the workflow places the bounded guard in front of it |
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

Timeline validation rejects an unknown basis, a missing or placeholder reason
for `not_observed`, a value paired with `not_observed`, a reason paired with
`operator_observed`, observed initiation after completion or availability,
observed completion after availability, and availability after download
completion. A fully observed, correctly ordered initiation → completion →
availability → download timeline records `COMPLETE`; availability is never
relabeled as completion.

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
- `inspection_tool_git_sha` is the approved execution checkout containing the
  current raw inspector and report helper; each exact Git blob and file SHA-256
  is also recorded independently.
- `inspection_baseline_git_sha` remains
  `c87a124602eb669b3ec5a3829610c6cb465d3e26` and explicitly covers only the
  unchanged migration-input tree. The helper is execution-checkout-bound
  because this diagnostic protocol intentionally changes it after that
  historical baseline.
- The execution Python is resolved before the driver starts, used in isolated
  mode, and recorded by resolved path, implementation/version, and executable
  SHA-256. The driver pins `/bin/bash` and that same interpreter for the raw
  inspector, using a minimal child environment without inherited shell or
  Python startup controls.

The workflow proves pin equality and byte identity only; it does not prove who
approved the pin.

<!-- BEGIN LOVABLE EXPORT EVIDENCE WORKFLOW -->
```bash
set -euo pipefail
umask 077
unset BASH_ENV ENV PYTHON_BIN PYTHONHOME PYTHONPATH PYTHONSTARTUP

: "${SOURCE_PROJECT_NAME:?required}"
: "${SOURCE_PROJECT_REF:?required}"
: "${UI_EXPORT_OBJECT_NAME:?required}"
: "${OPERATOR_IDENTITY:?required}"
: "${EXPORT_EVIDENCE_PROFILE:?required}"
: "${APPROVED_EVIDENCE_STORE_ROOT:?required from external approval; no default}"
: "${CANONICAL_EXPORT:?required}"
: "${EXPECTED_ORIGINAL_FILENAME:?required from external approval; no default}"
: "${EXPECTED_OUTER_SIZE_BYTES:?required from external approval; no default}"
: "${EXPECTED_OUTER_SHA256:?required from external approval; no default}"
: "${APPROVED_EXECUTION_CHECKOUT_SHA:?required from external approval}"
: "${PG_RESTORE_BIN:?required PostgreSQL 17 pg_restore path}"
: "${EXPORT_INITIATED_BASIS:?required}"
: "${EXPORT_COMPLETED_BASIS:?required}"
: "${EXPORT_AVAILABLE_AT_UTC:?required observed UTC time}"
: "${DOWNLOAD_COMPLETED_AT_UTC:?required observed UTC time}"

execution_python="$(command -v python3)"
case "$execution_python" in
  /*) ;;
  *) printf '%s\n' 'ERROR: python3 must resolve to an absolute executable' >&2; exit 4 ;;
esac
[[ -x "$execution_python" && ! -d "$execution_python" ]] || {
  printf '%s\n' 'ERROR: python3 must resolve to an executable file' >&2
  exit 4
}
"$execution_python" -I scripts/migration/inspect-lovable-export.py
```
<!-- END LOVABLE EXPORT EVIDENCE WORKFLOW -->

On success the durable output is published directly outside the Git worktree:

```text
<APPROVED_EVIDENCE_STORE_ROOT>/migration-inspection-evidence/<run-id>/
  EVIDENCE_COMPLETE
  archive/outer.expected.sha256
  archive/outer.workflow-observed.before.sha256
  archive/outer.workflow-observed.after.sha256
  inspection/rehearsal-metadata.txt
  inspection/report.sha256
  provenance.json
  provenance.sha256
  evidence-files.json
  evidence-files.sha256
```

`provenance.json` keeps `expected_identity`—the externally supplied original
filename, size, and SHA-256—separate from `workflow_observed_identity`, which is
the workflow's descriptor-bound measurement before and after inspection. It
also records ZIP structure, UI object name, exact member
name/compression/CRC/sizes, inner PGDMP size/hash, inspector-reported inner hash,
safe numeric PGDMP header metadata bound to that inner hash, report hash,
timeline, operator, source/config binding, and procedure/tool
identities. `provenance.sha256` is detached because a file cannot contain its
own ordinary SHA-256. `evidence-files.json` binds the size, mode, and SHA-256 of
every core evidence payload file except the deliberately non-self-referential
completion marker; its detached `evidence-files.sha256` binds the manifest, the
exact completion marker binds that detached-manifest identity and run ID, and
publication rechecks every copied file including both manifest files.
Neither outer working bytes nor derived inner bytes are retained. A directory
without the final `EVIDENCE_COMPLETE` marker, with
`EVIDENCE_INDETERMINATE`, or with a manifest/hash/mode mismatch is not a valid
published package.

If the atomic final rename succeeds but a subsequent descriptor revalidation or
parent-directory `fsync` fails, the workflow removes any completion marker,
writes and fsyncs `EVIDENCE_INDETERMINATE`, reports a manual-review stop, and
does not destructively clean the committed payload. Consumers must reject any
run without the exact completion marker or with the indeterminate marker.
Filesystem crash/I/O ambiguity during these last persistence operations cannot
be eliminated in user space; inability to persist the indeterminate marker is a
manual-quarantine hard stop. This is an execution-platform verification
ceiling, not authorization to continue.

The existing low-level inspector remains available for a reviewed direct raw
PGDMP path:

```text
scripts/migration/inspect-lovable-dump.sh \
  --output 'local-migration-artifacts/metadata-report.txt' \
  '/absolute/local/path/to/synthetic-or-authorized.dump'
```

It refuses URLs/connection strings, missing/non-regular/empty files, non-PGDMP
formats, incompatible tools, existing reports, unknown TOC classes, and
structurally malformed TOCs. Recognized but unresolved object entries produce
only the aggregate, blocked `REVIEW_REQUIRED` report described above. It
captures a private byte snapshot and never connects to or restores a database.

Every low-level failure emits exactly one versioned JSON diagnostic containing
only an allowlisted `stage` and `reason`; raw child stdout/stderr, TOC text,
paths, object names, and archive bytes are never forwarded. The stage allowlist
is `input_validation_failed`, `dependency_validation_failed`,
`workspace_setup_failed`, `pg_restore_version_failed`, `snapshot_copy_failed`,
`snapshot_permissions_failed`, `snapshot_hash_before_failed`,
`pgdmp_header_failed`, `pg_restore_list_rejected`, `pg_restore_list_empty`,
`snapshot_hash_after_failed`, `snapshot_identity_changed`,
`report_helper_failed`, `report_publish_failed`, `cleanup_failed`, and
`internal_failure`. The report helper has its own exact ASCII wire record,
`{"diagnostic_version":1,"reason":"<reason>"}`, and may report only
`unknown_toc_class`, `unresolved_known_toc_entry`, `malformed_toc`,
`duplicate_toc_id`, `conflicting_source_version`,
`conflicting_pg_dump_version`, `migration_metadata_unreadable`, or
`other_nonzero`. `unresolved_known_toc_entry` remains a protocol-compatible
failure reason for a rejected/injected helper, but the checked-in parser now
represents safely recognized unresolved entries as aggregate incomplete
analysis instead of failing the package. The raw inspector captures helper stdout/stderr privately and
accepts only one byte-exact helper record. Empty, multiline, oversized,
non-ASCII, malformed, extra-key, wrong-version, or unknown-reason helper output
becomes `report_helper_failed` / `other_nonzero`; no helper detail is relayed.
The high-level driver accepts only the exact outer JSON grammar and reviewed
stage/reason combinations; malformed, missing, duplicated, oversized,
non-ASCII, mixed, or incompatible diagnostics collapse to
`inspector_diagnostic_invalid` / `other_nonzero`. No ordinary durable evidence
package is published after any such failure.
The raw inspector stages a report away from its private snapshot workspace,
removes that workspace before publication, and atomically creates the final
report name without replacement. A cleanup failure therefore publishes no
final or staged report. If a standalone report hard link is created but its
directory durability or rollback cannot be proved, the inspector replaces the
requested path with a fixed mode-`0400` `INDETERMINATE` marker or moves the
linked inode to an unmistakably named indeterminate quarantine. It never treats
that path as a successful report; irreducible filesystem I/O ambiguity remains
a manual-quarantine stop.

Use `--output` whenever the report is retained as evidence; the high-level
workflow always does. The compatibility mode that writes a successful report to
stdout cannot make an arbitrary pipe or terminal transactional: if its consumer
disappears mid-write, a partial successful report may already have been emitted
before `report_publish_failed` is returned. That stream is not durable evidence
and no report/provenance package is published.

On success the additive safe-header fields are
`archive_format_version_bytes`, `archive_integer_width_bytes`,
`archive_offset_width_bytes`, `archive_format_code`, and
`archive_header_bound_sha256`. They are captured from bytes 5–10 after the
`PGDMP` magic while hashing the full private snapshot and before invoking
`pg_restore`; the high-level workflow requires their bound hash to equal the
normalizer, derived-file, and inspector-report inner SHA-256.

CI executes the complete fenced workflow in isolated synthetic Git checkouts,
including adversarial normalizer and bounded-guard tests, a real PostgreSQL 17
`pg_dump -Fc` high-level ZIP/direct integration on Linux, and targeted durable
publication tests on macOS. It plants checkout, repository-binding,
privacy/timeline/hash/member/publication failures, proves only
`pg_restore --version` and `--list` are called, and scans output/evidence for a
synthetic row-payload and secret sentinel. Planted failures exercise every raw
inspector stage, every reviewed helper reason, malformed helper records, partial
helper reports, and combined post-link-durability/rollback failure. They prove
child output is absent from visible diagnostics, logs, reports, provenance, and
durable files. This validates local mechanics only. It cannot
prove the truth or provenance of externally supplied assertions, encryption of
the approved evidence-store volume, Lovable's UI-control-to-backend mapping, or
source completeness. Migration readiness remains **RED**.

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
