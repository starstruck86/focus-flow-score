# Local migration rehearsal tools

The operator-facing tools operate on local files or reviewed repository source
only. They do not implement a retained-export/target database restore,
connection, export, deployment, or migration. The dedicated cross-major CI
fixture creates, dumps, and restores only disposable synthetic PostgreSQL
databases inside isolated containers.
Migration readiness remains **RED** until a separately authorized selective
restore rehearsal succeeds and every runbook gate is reviewed.

The retained rehearsal now has one operator-reported complete metadata evidence
package. Its status remains `REVIEW_REQUIRED` with
`restore_planning_gate=BLOCKED`: 2,354 TOC entries, 2,140 metadata entries, 214
data references, and 1,135 recognized-but-unresolved entries. The sanitized
header evidence reports source PostgreSQL 17.6, writer `pg_dump` 18.4, and
inspecting `pg_restore` 17.10. This repository-only documentation work did not
open that package or export, and these aggregate facts are not a restore plan.

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
   identity. PostgreSQL does not document a lossless quoting grammar for the
   namespace, tag, and owner text in that editable listing, so names containing
   whitespace or punctuation cannot be assumed to round-trip unambiguously.
   See the
   [PostgreSQL 17 `pg_restore` documentation](https://www.postgresql.org/docs/17/app-pgrestore.html),
   and the corresponding
   [PostgreSQL 18 documentation](https://www.postgresql.org/docs/18/app-pgrestore.html).
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
Each invocation must supply exactly one explicit private temporary parent. The
descriptor-bound TOC capture passes the already held staging-directory
descriptor as `LOVABLE_BOUNDED_TEMP_PARENT_FD`. The standalone
`inspect-lovable-dump.sh` opens its fresh private mode-`0700` work directory and
passes that descriptor through the same variable. A reviewed direct wrapper
caller may instead pass an absolute private mode-`0700` directory through
`LOVABLE_BOUNDED_TEMP_PARENT`. The guard rejects an absent, ambiguous,
symlinked, wrong-owner, or permissive parent, duplicates or opens the approved
directory with no-follow semantics, and creates its random hidden mode-`0700`
capture directory descriptor-relatively. Its two exclusive capture files are
mode `0600`.

Even after `pg_restore` exits zero, the guard withholds the bounded successful
bytes in memory until it has closed and descriptor-relatively unlinked both
capture files, removed the hidden directory, and fsynced the private parent. A
cleanup or parent-fsync failure becomes fixed `other_nonzero`; no successful
child output is released. In the descriptor-bound envelope, any residue is
therefore confined to the exact held staging tree. The outer driver must remove
and fsync that tree or preserve only its reviewed private
indeterminate/quarantine state, and it can never publish a normal complete
capture package from that failure. These bounds and cleanup gates prevent an
unbounded inspection process and a false successful capture; they do not
strengthen what `pg_restore` semantically validates.

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

### Reviewed private TOC envelope capture and later opaque review ledger

The aggregate inspector intentionally does not solve lossless object-name
classification. The sole reviewed operator entrypoint for the next separately
authorized **offline** step is `run-lovable-toc-capture.sh`. It requires an
explicit absolute, canonical, non-symlink execution-Python path, an externally
approved exact executable SHA-256 and `cpython:MAJOR.MINOR.MICRO` identity, and
invokes `capture-lovable-toc-envelope.py` with exactly `-I -S -B`. The Python driver,
normalizer, low-level capture, and bounded wrapper are internal components, not
supported direct operator entrypoints. The driver composes
the existing strict `normalize-lovable-export.py` and low-level
`capture-lovable-toc.py` contracts; it does not reimplement or relax either
one. `capture-lovable-toc.py` remains an internal low-level component for this
procedure, not an operator instruction to prepare an inner archive manually.
The later `validate-lovable-toc-ledger.py` procedure remains separately
authorized. The capture is a new private evidence layer and never modifies or
replaces the completed aggregate evidence package.

The private envelope-capture contract is:

1. Start only after a separate authorization approves the canonical outer ZIP,
   the complete aggregate evidence run, and every exact binding listed below.
   The driver first validates the current clean checkout, the approved
   aggregate package through its completion marker and manifest, the canonical
   filename/size/hash/member binding, the inspection identities, the current
   capture-procedure identities, and the approved `pg_restore` path, executable
   SHA-256, and exact bounded version string. A
   complete package is a prerequisite, not authorization. The capture-chain
   components reject execution unless Python reports isolated mode,
   ignored environment configuration, disabled user and system site loading,
   and disabled bytecode writes before repository-local imports or private
   processing. Before the capture entrypoints make the reviewed repository
   directory importable, a fixed `/usr/bin/git` invocation under a minimal
   environment disables system/global configuration, hooks, `core.fsmonitor`,
   and the untracked cache; it proves the approved `HEAD`, tracked byte
   identities, a clean checkout, and the absence of both ordinary and ignored
   untracked inputs below `scripts/migration/`. Every Python child uses the
   same bound interpreter with exactly `-I -S -B`, so user-site `.pth`,
   `sitecustomize`, and `PYTHONPATH` startup hooks cannot run and a
   clean-checkout binding cannot be invalidated or masked by an untracked
   `__pycache__` side effect.
2. Require three distinct, existing, executing-user-owned, non-symlink private
   roots outside the Git worktree: the completed aggregate run, an empty
   staging root, and an empty durable capture-output root. Each directory is
   mode `0700`; staging and output must be on one filesystem and no canonical,
   aggregate, staging, or output path may overlap. The canonical ZIP is an
   exact-basename, single-link, mode-`0400` regular file. Relative, ambiguous,
   permissive, wrong-owner, symlinked, pre-existing-final, or overlapping
   inputs fail before publication. Existing outputs are never replaced. The
   durable output root must have at least 512 MiB available before staging;
   the strict normalizer separately requires capacity for the declared inner
   member plus its fixed 256 MiB reserve.
3. In a fresh hidden mode-`0700` child of the staging root, invoke only the
   checked-in strict normalizer with the externally approved outer SHA-256.
   Require ZIP mode, the one exact UI-observed member name, the approved outer
   size/hash before and after normalization, the observed bounded inner size
   and approved inner hash, strict normalization metadata, and a mode-`0400`
   `PGDMP` result. Pass that exact fixed derived file to the low-level capture
   through an inherited descriptor for the private staging directory.
   Do not use `unzip`, an
   extraction API, or a member-controlled output path.
4. The low-level capture may invoke only the bounded
   `pg_restore --version` and `pg_restore --list`
   forms. It passes the held staging-directory descriptor to the bounded
   wrapper as the sole temporary parent; it does not let that wrapper select an
   ambient system temporary directory. The wrapper privately captures child
   channels and releases successful bytes only after descriptor-relative
   capture cleanup and parent fsync. The capture tool discards child stderr,
   holds successful list bytes privately, and never forwards them. Raw TOC
   bytes are published only into a fixed mode-`0400` file beneath a mode-`0700`
   no-replace package in the approved evidence-store root. They never go to the
   terminal, Git, CI, chat, or a general log.
5. Bind the private capture to the canonical outer identity, verified inner
   SHA-256, metadata run ID, execution checkout, inspector/guard identities,
   the externally approved execution-Python SHA-256, its safe observed
   version/path/device/inode/owner/mode/size identity, that identity's
   canonical digest, externally approved and observed-equal `pg_restore`
   version, approved
   executable SHA-256, observed
   path/device/inode/mode/size, capture byte size, and raw-capture SHA-256. The
   capture stores the complete fixed-key repository procedure identity and its
   digest. The ledger result separately stores and hashes the exact validator,
   contract, schema, README, and execution-checkout identity. The
   executable is fingerprinted before and after the two bounded calls. The
   bounded wrapper still executes the reviewed pathname rather than a held
   descriptor, so this does not prove which bytes the kernel executed during a
   path-swap-and-restore race; record that ceiling rather than calling the
   executable bytes attested. The same pathname limitation applies to the
   inner archive: pre/post identity checks bind the approved path's bytes but
   do not prove which bytes a hostile same-user pathname swap made
   `pg_restore` open.
   The envelope timeout is a secondary bound around each checked-in child. The
   bounded wrapper owns the nested `pg_restore` process-group kill/reap
   contract; envelope tests do not independently prove cleanup of a detached
   nested process if that wrapper contract is bypassed or fails.
6. Validate the complete hidden capture package against the live runtime
   bindings, expected 2,354-entry and 214-data-reference counts, exact raw-TOC
   and capture-manifest hashes, fixed file set, mode-`0400` files, and
   mode-`0700` directories. Child output stays in bounded pipes and never
   becomes a sidecar file. Delete and fsync the derived inner archive and
   normalization metadata; revalidate the canonical outer, tool, and checkout;
   then publish the capture directory atomically without replacement. Remove
   the low-level completion marker before promotion and recreate it exclusively
   only after descriptor-bound post-rename validation and fsync. Revalidate the
   canonical outer again after publication. Success emits only a fixed
   allowlisted diagnostic
   with `REVIEW_REQUIRED`, `ANNOTATION_REQUIRED`,
   `restore_planning_gate=BLOCKED`, and `restore_command_gate=BLOCKED`.
   The capture creates the private raw TOC plus fresh opaque key/index package;
   it does **not** create, validate, or publish an annotation ledger and does
   not generate a restore command.
7. On ordinary failure, remove and fsync all derived/working bytes and hidden
   pending trees. If cleanup, rollback, publication, or directory durability
   cannot be proved, retain only a private hidden quarantine, mark a promoted
   package indeterminate, or retain a root-level indeterminate stop marker plus
   the exclusive root claim when package rollback itself cannot be proved; emit
   `cleanup_indeterminate` and never emit success. The later ledger validator
   rejects every unapproved capture-root sibling, including either stop marker
   or claim, even if a package-local completion marker survived.
   An abrupt host or kernel crash can still leave private hidden indeterminate
   remnants. Those remnants require manual quarantine review and are never a
   valid capture package or permission to retry.
   Failure output is one fixed `capture_driver` diagnostic whose reason is only
   `input_invalid`, `binding_mismatch`, `evidence_invalid`,
   `normalization_failed`, `normalization_timeout`,
   `normalization_output_invalid`, `inner_identity_mismatch`,
   `capture_failed`, `capture_timeout`, `capture_output_invalid`,
   `canonical_mutated`, `publication_exists`, `publication_failed`,
   `cleanup_indeterminate`, or `internal_failure`. Child output, raw TOC text,
   object names, SQL, filenames, secrets, and payloads are never relayed.
8. In a later, separately authorized step, review the private TOC locally. Each
   entry ID is
   `te1_` plus HMAC-SHA-256 under a fresh private 32-byte capture key over the
   domain `focus-flow-score/lovable-toc-entry/v1\0`, big-endian 64-bit ordinal,
   big-endian 64-bit raw-line length, and exact raw entry-line bytes. The key,
   raw TOC, and fixed class/ordinal index all remain private. This prevents
   dictionary guessing of common object names while allowing exact validator
   recomputation; IDs are not archive OIDs, dump IDs, names, or reversible
   encodings.
9. Feed only a private, canonical-ASCII ledger matching
   `verification/lovable-toc-annotation-ledger.schema.json` to
   `validate-lovable-toc-ledger.py`. Reject missing, duplicate, or extra IDs;
   unknown or contradictory fields; unknown classes; incomplete dependencies;
   unreviewed dispositions; count or capture-hash disagreement; and any name,
   namespace, owner, OID, SQL, path, payload, or raw TOC text outside the raw
   private capture. The ledger and output package remain in the approved store
   and Git-ignored; only fixed diagnostics, categories, hashes, and aggregate
   counts may be copied to ordinary logs.
   The classification vocabulary is closed and exact: `restore`,
   `exclude_supabase_managed`, `exclude_duplicate`, `dependency_only`,
   `manual_conflict`, or `unresolved`. `manual_conflict` requires a separate
   reviewed terminal disposition; it is not itself permission to restore.
   Every publication TOC class is structurally bound to the `publication`
   managed domain; a still-unresolved publication remains publishable only as
   `BLOCKED`. Constraint, policy, security, trigger, attach, publication-table,
   default, and sequence-ownership classes require distinct opaque parent IDs
   covering their reviewed parent-class groups. A boolean “reviewed” flag with
   an empty or class-incompatible parent set is rejected.

   Record these relationships only in `parent_entry_ids`; every repeated group
   requires a different opaque entry ID:

   | Entry class | Required parent class groups |
   |---|---|
   | `CHECK CONSTRAINT` | one of `DOMAIN`, `FOREIGN TABLE`, or `TABLE` |
   | `CONSTRAINT` | one of `DOMAIN`, `FOREIGN TABLE`, or `TABLE` |
   | `DEFAULT` | one of `FOREIGN TABLE` or `TABLE` |
   | `FK CONSTRAINT` | two distinct `TABLE` IDs |
   | `INDEX ATTACH` | two distinct `INDEX` IDs |
   | `POLICY` | one `TABLE` |
   | `PUBLICATION TABLE` | one `PUBLICATION` plus one `TABLE` |
   | `PUBLICATION TABLES IN SCHEMA` | one `PUBLICATION` plus one `SCHEMA` |
   | `ROW SECURITY` | one `TABLE` |
   | `SEQUENCE OWNED BY` | one `SEQUENCE` plus one `TABLE` |
   | `TABLE ATTACH` | one `TABLE` plus a distinct `TABLE` or `FOREIGN TABLE` ID |
   | `TRIGGER` | one of `FOREIGN TABLE`, `TABLE`, or `VIEW` |

   The tool validates only opaque ID/class structure; the reviewer remains
   responsible for proving that each chosen parent is the correct semantic
   object. `PUBLICATION`, `PUBLICATION TABLE`, and
   `PUBLICATION TABLES IN SCHEMA` always require
   `managed_domain=publication`. If such an entry is still `unresolved`, set
   aggregate publication handling to `manual_conflict`; the result remains
   `BLOCKED`.
   These intentionally narrow class sets follow the official PostgreSQL 18
   [`CREATE PUBLICATION`](https://www.postgresql.org/docs/18/sql-createpublication.html),
   [`CREATE TRIGGER`](https://www.postgresql.org/docs/18/sql-createtrigger.html),
   [`CREATE POLICY`](https://www.postgresql.org/docs/18/sql-createpolicy.html),
   [`ALTER TABLE`](https://www.postgresql.org/docs/18/sql-altertable.html), and
   [`ALTER SEQUENCE`](https://www.postgresql.org/docs/18/sql-altersequence.html)
   object boundaries. Uncertain shapes fail closed for later review rather
   than broadening a class group.
   Preserve the completed aggregate report's exact 214-entry data-reference
   definition. `SEQUENCE SET` is tracked separately as state-bearing metadata
   and must still map to an exact `SEQUENCE` parent; it is never allowed to
   disappear by being counted as ordinary metadata.
10. `restore_planning_gate` stays `BLOCKED` while any entry is unresolved or any
   exact accounting, data-parent, dependency, manual-conflict, global handling,
   managed-domain, archive, procedure, or tool binding is incomplete. When all
   structural conditions pass, opaque annotation accounting becomes
   `COMPLETE` but automatic object-reference analysis remains `INCOMPLETE`; the
   tool emits only
   `ELIGIBLE_FOR_HUMAN_REVIEW`; `restore_command_gate` remains `BLOCKED` and
   migration readiness remains `RED`. Human semantic correctness is an
   attestation the validator cannot independently prove.

### Private annotation authoring and immutable checkpoints

`run-lovable-toc-annotation-authoring.sh` is the only supported operator
entrypoint for drafting the private annotation ledger. It takes no arguments.
The requested operation is supplied through the mandatory
`TOC_AUTHOR_ACTION` environment variable; every invocation performs exactly
one operation and then exits. Its closed vocabulary is `initialize`,
`primary_review`, `revisit_unresolved`, `relationship_review`,
`data_reference_review`, `sequence_review`, `managed_review`,
`manual_conflict_review`, `peer_review`, `correction_review`, `status`, and
`finalize`. Review
generations advance only through `PRIMARY_REVIEW_REQUIRED` ->
`REVISIT_REQUIRED` -> `RELATIONSHIP_REVIEW_REQUIRED` ->
`DATA_REFERENCE_REVIEW_REQUIRED` -> `SEQUENCE_REVIEW_REQUIRED` ->
`MANAGED_GLOBAL_REVIEW_REQUIRED` -> `MANUAL_CONFLICT_REVIEW_REQUIRED` ->
`PEER_REVIEW_REQUIRED` -> `FINALIZATION_REVIEW_REQUIRED` ->
`FINALIZATION_ELIGIBLE`. `FINALIZATION_REVIEW_REQUIRED` means every recorded
phase is complete but the exact semantic finalization check still rejects the
decisions. Before any final-candidate publication, `correction_review` may run
from either `FINALIZATION_REVIEW_REQUIRED` or `FINALIZATION_ELIGIBLE`; mechanical
eligibility is not semantic infallibility or restore readiness. It selects an
explicit, sorted batch of at most 100 ordinals through the controlled TTY and
applies one existing scoped primary-review phase. That immutable correction
invalidates the affected peer approval and requires peer reapproval before
eligibility can be recomputed.
When the scoped phase is `primary_review`, reconsidering classification is
coupled narrowly to the prior manual-conflict state: an existing final
`manual_conflict_disposition` may only be cleared to null. The resulting
decision must have `classification_reviewed=true`; `manual_conflict` returns
to `manual_conflict_review_state=pending`, while every other classification
uses `not_applicable`. A fresh final disposition remains exclusive to
`manual_conflict_review`. Retaining or substituting a final disposition, or
retaining a stale `reviewed` state, is rejected. The corrected decision hash is
recomputed and peer approval returns to pending, including after peer-requested
re-review.
These are deterministic, enforced phase priorities, not permission to infer a
decision or silently complete an earlier review. Ordinary review actions do
not interleave: only a peer-requested correction or the explicit semantic
`correction_review` route may return to an earlier phase. A published final
candidate makes the root terminal; no correction is allowed afterward.
Finalization requires the conjunction of every phase predicate.
`initialize` is the sole initializer; `status` and `finalize` are orchestration
actions and do not silently create ordinary review transitions. `finalize` is
separately authorized rather than a continuation of an ordinary review
session.

The launcher has no defaults for private inputs or approval identities. Supply
the following environment contract out of band; do not place a real value in
Git, shell history, CI, or chat:

| Variable | Authoring contract |
|---|---|
| `TOC_AUTHOR_ACTION` | Exactly one action from the closed vocabulary above |
| `TOC_AUTHOR_EXECUTION_PYTHON` | Approved absolute, canonical CPython executable; non-symlink, one link, safely owned and not group/world writable |
| `TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_SHA256` | Externally approved exact executable SHA-256 |
| `TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_VERSION` | Externally approved exact `cpython:MAJOR.MINOR.MICRO` identity |
| `TOC_AUTHOR_APPROVED_EXECUTION_CHECKOUT_SHA` | Full lowercase Git SHA exactly equal to the clean execution checkout |
| `TOC_AUTHOR_CAPTURE_ROOT` | Absolute canonical mode-`0700` parent of the private capture package |
| `TOC_AUTHOR_CAPTURE_NAME` | Fixed safe direct-child capture-package name |
| `TOC_AUTHOR_PRIVATE_ROOT` | Separate absolute canonical, empty-on-initialization, mode-`0700` authoring root outside Git |
| `TOC_AUTHOR_EXPECTED_CAPTURE_MANIFEST_SHA256` | Approved SHA-256 of the capture package's evidence-files manifest |
| `TOC_AUTHOR_EXPECTED_RAW_TOC_SHA256` | Approved raw-TOC SHA-256 |
| `TOC_AUTHOR_EXPECTED_OPAQUE_INDEX_SHA256` | Approved opaque structural-index SHA-256 |
| `TOC_AUTHOR_EXPECTED_ENTRY_COUNT` | Approved positive entry count |
| `TOC_AUTHOR_EXPECTED_DATA_REFERENCE_COUNT` | Approved nonnegative data-reference count |
| `TOC_AUTHOR_EVIDENCE_RUN_ID` | Exact reviewed evidence-run identity |
| `TOC_AUTHOR_OUTER_SHA256` | Approved canonical outer-archive SHA-256 |
| `TOC_AUTHOR_INNER_SHA256` | Approved normalized inner-archive SHA-256 |
| `TOC_AUTHOR_EVIDENCE_MANIFEST_SHA256` | Approved predecessor inspection-evidence manifest SHA-256 |
| `TOC_AUTHOR_INSPECTION_CHECKOUT_SHA` | Exact checkout that produced the predecessor inspection evidence |
| `TOC_AUTHOR_INSPECTION_PROCEDURE_SHA256` | Exact predecessor inspection-procedure SHA-256 |
| `TOC_AUTHOR_CAPTURE_EXECUTION_CHECKOUT_SHA` | Exact checkout that produced the private capture package |
| `TOC_AUTHOR_EXPECTED_CAPTURE_PROCEDURE_IDENTITY_SHA256` | Approved private-capture procedure identity SHA-256 |
| `TOC_AUTHOR_APPROVED_PG_RESTORE_SHA256` | Approved `pg_restore` executable identity already recorded by capture; the authoring workflow does not invoke it |
| `TOC_AUTHOR_PRIMARY_OPERATOR_IDENTITY` | Named primary reviewer, fixed for the checkpoint chain |
| `TOC_AUTHOR_OPERATOR_IDENTITY` | Named operator for this generation; must equal the primary reviewer except during the distinct peer pass |
| `TOC_AUTHOR_SESSION_IDENTITY` | Operator-provided reviewed-session identity |
| `TOC_AUTHOR_EXPECTED_HEAD_GENERATION` | Exact latest generation (`0` only before initialization) |
| `TOC_AUTHOR_EXPECTED_HEAD_SHA256` | Exact latest checkpoint SHA-256 (64 zeroes only before initialization) |
| `TOC_AUTHOR_EXPECTED_RELEASE_TOKEN` | Exact private 64-hex token displayed and acknowledged while the preceding invocation still held its lock, and usable only after that invocation durably released the lock; 64 zeroes only for initialization |
| `TOC_AUTHOR_LOCAL_TTY_ATTESTATION` | Exact `LOCAL_CONTROLLING_TTY_NO_RECORDING_NO_REMOTE_NO_CLIPBOARD` operator attestation |
| `TOC_AUTHOR_FINALIZATION_AUTHORIZATION` | Empty for ordinary actions; exact `CREATE_UNVALIDATED_LEDGER` only for the separately approved finalization invocation |

Initialization therefore binds generation `0` plus the all-zero expected head
and publishes generation `1`. Every later invocation must be supplied the exact
observed generation and full checkpoint SHA-256; the procedure does not infer
or repair a head. Every successful non-finalization invocation displays its
exact next-resume values only on the held private TTY as
`resume_generation`, `resume_checkpoint_sha256`, and a fresh
`resume_release_token`; they never enter ordinary
stdout/stderr and are not part of the aggregate-only `status` result. Review
batches are deterministic and capped at 100 entries by the operator workflow.
The alternate screen remains visible while the durable lock is still held,
until the operator types the exact `resume_values_recorded` acknowledgement.
Only after that acknowledgement may the procedure durably convert the lock to
the released marker, clear the screen, and exit. A write, EOF, wrong response,
terminal attribute/read failure, or other incomplete handoff leaves a blocking
lock and, where possible, an indeterminate marker; it never leaves a normal
released state. This is a human recording checkpoint, not permission to pipe
or record the terminal.

The launcher requires an explicitly approved absolute canonical CPython path,
its externally approved SHA-256 and exact `cpython:MAJOR.MINOR.MICRO` version,
safe root-or-operator ownership, one link, and non-writable group/world mode.
It lowers both soft and hard core-file limits to zero, and the isolated
bootstrap verifies that limit before repository code or private input.
Its shell code rejects native-loader and Python-startup variables before the
reviewed Python child and private-input access, creates a minimal
`/usr/bin/env -i` environment, and invokes the internal authoring component
only with `-I -S -B`. The invoking shell and its native loader have necessarily
started before shell code can inspect their inherited environment, so launch
from a trusted sanitized local parent; rejection is not proof that hostile
pre-shell loader code never ran. Before any private input is opened, the
internal component rechecks the isolated/no-site/no-bytecode runtime, approved
clean checkout, reviewed Git blobs, and absence of ordinary or ignored
untracked migration-tool inputs. The internal `.py` file is not a supported
operator entrypoint. The procedure performs no network operation and never
invokes `pg_restore`, a database client, restore tooling, or the ledger
validator. The launcher hashes the approved interpreter before and after its
isolated version probe, but the kernel still executes a pathname rather than a
held executable descriptor. It therefore cannot independently exclude a
hostile same-user path-swap-and-restore race between the last check and `exec`;
stop unless that local-machine trust ceiling is acceptable.

Private review context is written only through the verified controlling TTY
descriptor in a local alternate-screen session. Standard input, output, and
error must each be the same foreground controlling terminal; pipes,
redirection, and non-TTY execution are rejected. Known record-to-file ancestor
processes and known SSH/Mosh/multiplexer/editor-terminal markers are rejected. The workflow
provides no browser or clipboard transport. The named operator must also
provide the exact local-TTY attestation
required by the launcher. Raw context is bounded and escaped before display;
ordinary stdout and stderr receive only fixed allowlisted diagnostics and
aggregate counts. The alternate screen is cleared on normal exit and on
reviewed interruption where possible. This is a display-containment boundary,
not proof that the terminal was not recorded or photographed: the procedure
cannot independently attest screen-recording settings, an unknown or disguised
recorder, external screen capture, a hostile terminal implementation, or a
hostile same-user process.
Stop if that local trust assumption is not acceptable.

The authoring procedure opens the bound raw TOC and opaque structural index for
review content. To prove their package binding it also reads `capture.json`,
`evidence-files.json`, and `EVIDENCE_COMPLETE`, and it validates filesystem
metadata for `opaque-id.key` without opening that key's bytes. It must never
open, copy, derive, or test the key. The raw-list SHA-256 and structural-index
SHA-256 are approved inputs. The authoring component verifies ordinal, class,
and data-reference agreement without recomputing the keyed opaque IDs;
recomputation remains the later validator's separate job. Neither raw context
nor an opaque identifier may enter a checkpoint diagnostic, ordinary log, CI
output, exception, or chat.

Unfinished work uses a dedicated authoring-checkpoint format, never the final
ledger schema. The private authoring root must be an absolute canonical,
executor-owned, non-symlink mode-`0700` directory outside Git. A fixed
exclusive mode-`0400` `AUTHORING_LOCK` serializes writers. A stale lock is a
hard stop and is never auto-deleted. Successful release leaves a fixed
mode-`0400` `AUTHORING_RELEASED` marker carrying the private token that was
displayed with the exact generation and checkpoint SHA and acknowledged while
`AUTHORING_LOCK` still existed. The token becomes resumable only after the
subsequent durable release. The next invocation must supply that exact token
and consumes the marker only after a new durable lock exists. A private TTY
write/acknowledgement/terminal failure never reaches release; a release
durability failure best-effort restores a blocking lock/indeterminate state.
A release-only filesystem remnant from a failed invocation is not sufficient
to authorize resume. If the filesystem rejects both lock restoration and
indeterminate-marker publication after a release durability error, the tool
cannot prove which names are durable; the fixed failure is a no-retry hard
stop, not a recovery token.
Every successful review action publishes
one new immutable, single-link, mode-`0400`
`checkpoints/checkpoint-g<16-digit-generation>-<full-sha256>.json` generation
with no replacement, file fsync, atomic no-replace rename, and parent-directory
fsync. There is deliberately no mutable `HEAD` file.
Each generation binds the capture package, capture manifest, raw TOC, opaque
index, execution checkout, authoring procedure, previous checkpoint SHA-256,
monotonic generation number, named operator, operator-provided session
identity, exact reviewed ordinal range, decisions, and primary/peer-review
state. Resume is permitted only from one unique, contiguous, structurally
valid latest head whose expected generation and SHA-256 were supplied by the
operator. Forked heads, a missing generation, a chain break, stale or
concurrent lock, malformed state, unexpected sibling, path replacement,
collision, or input mutation stops without choosing a winner.

Checkpoints and the fixed lock are never silently overwritten. A failed write
must remove and fsync only a provably incomplete pending generation. If
publication, rollback, cleanup, or directory durability cannot be proved, the
procedure retains a private fixed `AUTHORING_INDETERMINATE` marker, emits only
`cleanup_indeterminate`, and blocks resume and finalization. Do not delete,
rename, repair, or reinterpret stale locks, conflicting heads, or indeterminate
state without a separately reviewed recovery procedure.
This override applies to read-only orchestration too: a descriptor-close or
cleanup ambiguity during a nominal `status` result replaces the review-boundary
exit with the fixed failure, leaves a blocking lock/indeterminate state, and
does not publish normal resume values or a durable release marker.

Mechanical proposals are versioned suggestions only. They never become human
decisions automatically. Every entry requires an explicit primary decision.
The private primary prompts and peer transcript label exact roles:
`dependency_entry_ids` as `dependency`, `parent_entry_ids` as
`structural_parent`, and `metadata_parent_entry_id` as `metadata_parent`.
Applicable sequence views are additionally labeled
`sequence_metadata_parent` or `sequence_structural_parent`. A referenced entry
that occupies multiple roles is displayed separately under every role; roles
are never collapsed to counts or a reference union. Peer review requires a
fixed acknowledgement of its primary-decision summary before the first screen
clear, then one fixed acknowledgement for each role-labeled context. An
applicable multi-parent sequence review likewise acknowledges each parent
before the next clear. The canonical primary
decision hash and peer binding cover the exact keyed role assignments. Every
semantic parent and dependency requires explicit review; every data reference
and each sequence/state-bearing relation has a dedicated pass; and
managed-domain, schema, owner, role, extension, duplicate, global-handling,
and manual-conflict decisions require explicit human approval. Draft
`dependency_review_complete` remains false. Peer review is a separate pass by
a different named operator and cannot reuse the primary operator identity.
`status` and the finalization eligibility check report only fixed states and
aggregate counts, never IDs or object metadata.

The private `correction_review` route remains field-scoped. A relationship
correction is recorded as the distinct internal `relationship_correction`
checkpoint action and re-prompts both `dependency` and applicable
`structural_parent` roles even when they were previously reviewed. It may
clear, replace, or reselect those assignments, recomputes the canonical
decision hash, and resets the affected peer approval; it cannot change
classification, managed, metadata-parent, or unrelated review fields. If a
required structural-parent selection is cleared, relationship review returns
to `pending` so the ordinary role-labeled phase can reselect it without a
phase-order bypass. If a `SEQUENCE OWNED BY` structural-parent list changes,
the exact transition contract requires `sequence_review_state=pending`, followed by fresh
role-labeled `sequence_structural_parent` context and acknowledgement and then
fresh peer approval. A forged transition retaining the old sequence approval
is rejected. `SEQUENCE SET` correction remains confined to
`sequence_metadata_parent`, and ordinary data-reference correction remains
confined to `metadata_parent`. Multi-role contexts remain separately labeled.
For the scoped `primary_review` correction, classification reconsideration may
clear a prior manual-conflict disposition only to null. Selecting
`manual_conflict` requires a new manual-conflict review; selecting any other
class makes that phase not applicable. Either path changes the canonical
decision hash and requires fresh peer approval. The transition contract rejects
old or replacement final dispositions and stale reviewed state; only the later
`manual_conflict_review` phase may choose a final disposition.

Finalization is allowed only through a later invocation with
`TOC_AUTHOR_ACTION=finalize`, the exact expected checkpoint head, and a
separate explicit finalization authorization. It requires complete primary and
peer review, zero unresolved decisions, complete relationship/data/sequence/
managed/manual-conflict/global review, and exact capture accounting. It then
atomically publishes one no-replace private
`final-ledger-<checkpoint-sha-prefix>/` package containing mode-`0400`
`annotation-ledger.json`, `authoring-finalization.json`,
`evidence-files.json`, and `EVIDENCE_COMPLETE`, fsyncs every file and directory,
and leaves the immutable checkpoint chain intact. It never invokes
`validate-lovable-toc-ledger.py`. Creation therefore means only
`REVIEW_REQUIRED`; it is not validation, restore planning, a restore command,
or migration readiness. The final package makes the authoring root terminal;
all later authoring actions stop before reading private capture input. An
operator who withholds finalization authorization after finding a wrong
decision may use the scoped correction route while the root is still
unpublished, including from `FINALIZATION_ELIGIBLE`.

`run-lovable-toc-ledger-validation.sh` is the separately authorized,
zero-argument startup-isolated launcher for the existing validator. It applies
the same explicit-interpreter, clean-checkout, reviewed-blob, minimal
environment, and `-I -S -B` boundaries while preserving the validator's
existing 15-variable `TOC_REVIEW_*` input contract and semantics. Authoring and
finalization never call it. Even a later successful validation can produce at
most `ELIGIBLE_FOR_HUMAN_REVIEW`; `restore_planning_gate` is not a restore
authorization, `restore_command_gate` remains `BLOCKED`, and migration
readiness remains `RED`.

Even a complete private capture cannot prove source completeness, archive
completeness, full PGDMP-byte consumption, restore compatibility, or target
readiness. It never connects to a database, creates a target, or authorizes a
restore.

PostgreSQL explicitly describes the list file as editable input to
`--use-list`, and separately warns that restoring a dump can execute arbitrary
code chosen by a source superuser. A TOC-only review therefore does not make
the archive safe to restore or replace review of generated SQL and target
behavior. See the official PostgreSQL 17 and 18 `pg_restore` pages linked
above.

The checked-in synthetic matrix uses a digest-pinned official PostgreSQL 18.4
client to dump a disposable 17.6 source, list that custom archive, validate the
list with the conservative raw-TOC parser, and load the exact synthetic fixture
into separate disposable 17.6 and 18.4 targets. Separate unit tests use bounded
fake children to exercise the complete private-capture and opaque-ledger
lifecycle, including whitespace, punctuation, Unicode, duplicate,
unknown-class, malformed/oversized input, binding, publication, cleanup, and
leakage failures. Passing both lanes proves only those distinct synthetic
contracts. It does not prove that an older client can read every newer archive,
that either client consumed every input byte, that the retained Lovable archive
has the same TOC grammar, or that an owned Supabase target accepts the archive.
The currently approved metadata workflow remains pinned to PostgreSQL 17 until
a later reviewed procedure explicitly changes that requirement.

PostgreSQL 18 documents that its `pg_dump` can dump older servers, while its
output is not guaranteed to load into an older server even when the source was
that older version. Therefore the passing synthetic 18.4-to-17.6 load is one
fixture result, not a supported production-restore guarantee. See the official
[PostgreSQL 18 `pg_dump` compatibility notes](https://www.postgresql.org/docs/18/app-pgdump.html).

The high-level capture driver and later ledger validator consume paths and
approved identities only through mandatory `TOC_REVIEW_*` environment
variables, never shell arguments. The driver has no defaults and requires:

| Variable | Envelope-capture contract |
|---|---|
| `TOC_REVIEW_CANONICAL_OUTER` | Exact absolute canonical outer ZIP path |
| `TOC_REVIEW_APPROVED_EVIDENCE_RUN_DIRECTORY` | Exact completed aggregate evidence-run directory |
| `TOC_REVIEW_PRIVATE_STAGING_ROOT` | Empty private mode-`0700` staging root |
| `TOC_REVIEW_OUTPUT_ROOT` | Empty private mode-`0700` durable capture-output root |
| `TOC_REVIEW_EVIDENCE_RUN_ID` | Exact aggregate evidence run ID and aggregate-directory basename |
| `TOC_REVIEW_EXPECTED_ORIGINAL_FILENAME` | Externally approved canonical basename |
| `TOC_REVIEW_UI_EXPORT_OBJECT_NAME` | Exact UI-observed sole ZIP member name |
| `TOC_REVIEW_EXPECTED_OUTER_SIZE_BYTES` | Externally approved positive outer size |
| `TOC_REVIEW_OUTER_SHA256` | Externally approved outer SHA-256 |
| `TOC_REVIEW_INNER_SHA256` | Externally approved normalized inner SHA-256 |
| `TOC_REVIEW_EVIDENCE_MANIFEST_SHA256` | Exact completed aggregate evidence-manifest SHA-256 |
| `TOC_REVIEW_INSPECTION_CHECKOUT_SHA` | Checkout that produced the aggregate evidence |
| `TOC_REVIEW_INSPECTION_PROCEDURE_SHA256` | Exact fenced aggregate-inspection procedure SHA-256 |
| `TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA` | Externally approved current capture checkout, exactly equal to clean `HEAD` |
| `TOC_REVIEW_EXECUTION_PYTHON` | Explicit absolute, canonical, non-symlink executable used by the reviewed launcher and every Python child; no default |
| `TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256` | Externally approved exact SHA-256; checked by the shell before `exec`, rechecked by both capture components, and durably cross-bound |
| `TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION` | Externally approved exact safe runtime identity in `cpython:MAJOR.MINOR.MICRO` form |
| `TOC_REVIEW_PG_RESTORE_BIN` | Exact absolute reviewed `pg_restore` path |
| `TOC_REVIEW_APPROVED_PG_RESTORE_SHA256` | Externally approved executable SHA-256 |
| `TOC_REVIEW_APPROVED_PG_RESTORE_VERSION` | Externally approved exact bounded version output, for example `pg_restore (PostgreSQL) 18.4` |
| `TOC_REVIEW_EXPECTED_ENTRY_COUNT` | Externally approved exact TOC entry count |
| `TOC_REVIEW_EXPECTED_DATA_REFERENCE_COUNT` | Externally approved exact data-reference count |

The ledger validator additionally requires the fixed capture package name,
private canonical ledger path, independently approved capture
manifest/raw-TOC/procedure-identity hashes, and the same archive/tool/procedure
bindings. The capture/output roots and the ledger file must be in approved
mode-`0700` private roots outside the Git worktree; the ledger is opened
descriptor-relative as a direct child and must be a single-link mode-`0400`
regular file. These tools deliberately reject `local-migration-artifacts/`
because it is inside the repository. That ignored directory remains disposable
workspace for older aggregate tooling and must never be the sole evidence copy.

After every separately authorized input is exported into the process
environment, invoke only:

```bash
scripts/migration/run-lovable-toc-capture.sh
```

Do not invoke any capture-chain `.py` file directly. The launcher and each
component independently enforce the startup flags; the high-level driver then
passes only its reviewed minimal environment to child components. A closed or
broken diagnostic stream cannot produce a Python traceback or relabel an
already decided durable outcome; operators must inspect the exit status and
the private no-replace package state together.

The launcher validates the canonical configured interpreter pathname, safe
owner/mode, externally approved SHA-256, and isolated reported version before
`exec`; both capture components recheck the approved digest/version, safe
ownership/write mode, and stable runtime identity.
The canonical runtime-identity digest is retained in the capture procedure
identity. This still does not turn the shell's pathname-based `exec` into
descriptor-bound execution: an actor with parent-directory replacement
capability could replace the path between the launcher digest check and
execution. The launcher rehashes after its version probe, privately caps both
final-child channels, and releases only an exact allowlisted capture diagnostic;
native exec errors and all other child bytes collapse to the fixed
`capture_launcher` / `child_diagnostic_invalid` record. That prevents a path or
payload disclosure, but it cannot prove which executable bytes the kernel ran.
The completed aggregate
evidence's existing interpreter identity remains part of the separately
validated evidence contract.

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
including adversarial normalizer and bounded-guard tests on Linux and macOS, a
real PostgreSQL 17 `pg_dump -Fc` high-level ZIP/direct integration on Linux that
reaches the guarded real `pg_restore --list`, and targeted durable publication
tests on macOS. The bounded-guard regressions prove explicit private-parent
selection, cleanup-before-output, wrapper cleanup-failure suppression, outer
publication-fsync handling, and the envelope's cleanup-or-quarantine boundary.
A quarantine may intentionally retain raw TOC captures, a derived PGDMP, or
normalization metadata inside the reviewed private staging root. It must not be
enumerated, logged, or treated as cleaned, and inability to persist or verify
an indeterminate marker remains a hard manual-review stop. CI also plants checkout,
repository-binding,
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
