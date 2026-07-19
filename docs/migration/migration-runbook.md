# Lovable Cloud export migration runbook

## Status and evidence boundary

**Migration readiness is RED.** No restore, target creation, or cutover is
authorized by this runbook or by a successful local inspection.

This is a future-execution runbook, not evidence that a migration occurred. It
uses the supported path reported by Lovable Support: retain the original
project, remix the project, export Cloud database data, restore selectively into
an isolated user-owned Supabase project, and recreate configuration on the
remix. Every dashboard, export, project, restore, deployment, secret, domain,
and production action below requires separate authorization.

The verification boundary is asymmetric. Local tooling can bind an export's
bytes to its TOC, detect restore-plan hazards, and later verify exactly what is
persisted/configured in the owned target. It cannot independently prove that a
Lovable-generated export contains every production row or runtime setting,
because Lovable controls the source database, export implementation, and Cloud
configuration. The owned target can later be inspected directly under separate
authorization; Lovable production remains independently uninspectable. A green
synthetic rehearsal does not remove that blocker.

The hardened workflow also cannot prove that externally supplied expected
filename/size/SHA values or operator-observed event values are truthful, that
the approved evidence-store volume is actually encrypted, or that Lovable's UI
export control maps to the repository-bound backend. It can only validate their
form, bind them to the inspected bytes and approved checkout, and report the
remaining claims explicitly.

pg_restore --list does not prove that every byte of the inner input was consumed.

One authorized rehearsal export is retained offline in the approved evidence
store. After the earlier fail-closed parser result, a separately authorized
inspection under the merged PR #16 contract produced a complete durable
metadata package with `inspection_status=REVIEW_REQUIRED` and
`restore_planning_gate=BLOCKED`; it performed no restore. The operator-supplied
sanitized result records 2,354 TOC entries: 2,140 metadata entries, 214 data
references, and 1,135 recognized-but-unresolved entries. It reports source
PostgreSQL 17.6, writer `pg_dump` 18.4, and inspecting `pg_restore` 17.10. This
repository-only documentation turn did not access that package or the retained
export and does not independently re-establish those observations. No artifact
path, filename, size, digest, or timestamp belongs here. Migration readiness
remains RED.

The following are **support-reported and not yet empirically proven**:

- The database payload is a point-in-time `pg_dump` custom-format archive, with
  a 5 GB maximum export and one generated export per 24 hours. The exact outer
  download packaging remains a separate property from the inner database
  archive.
- Auth data is partial/best-effort and password resets may be required.
- Storage objects require separate manual download/upload.
- No supported CDC/delta feed exists.
- Edge Functions and configuration must be recreated.
- Secret names, scheduled jobs, Realtime settings, OAuth, SMTP, and webhook
  inventories are not exported.
- The supported topology uses a remixed Lovable project while the original is
  retained.

Do not infer a restore command from those claims. A valid ZIP envelope and a
`PGDMP` magic header still do not establish which schemas, owners, privileges,
roles, extensions, or managed objects are present. The verified inner archive's
table of contents (TOC), source PostgreSQL major version, local `pg_restore`
version, and target constraints must be inspected first. Supabase's current CLI
documentation says its own `db dump` wrapper excludes managed schemas and does
not include data or custom roles by default. That is useful target guidance,
not evidence that Lovable used the same flags. Supabase also documents that a
database-only project copy still requires separate reconfiguration of Storage
objects/settings, Edge Functions, Auth settings and keys, Realtime, extensions,
and other project configuration. Those boundaries are why a wholesale restore
is not presumed safe. See the official
[Supabase CLI database-dump reference](https://supabase.com/docs/reference/cli/supabase-db-dump),
[database backup guidance](https://supabase.com/docs/guides/platform/backups),
and [restore-to-new-project guide](https://supabase.com/docs/guides/platform/clone-project).

## Non-negotiable rollback rule

The original Lovable project is a lossless rollback only while **no writes have
occurred on the new backend**. Once writes begin on the new backend, reverting
to the original loses those writes unless a separately designed and rehearsed
reverse-transfer procedure exists. Therefore the new system remains read-only
until every rollback-critical verification below passes. The original Lovable
project must not be disconnected or destroyed.

The reported one-export-per-24-hours limit means the rehearsal and final
cutover exports must occur in separate 24-hour windows. Schedule the rehearsal
early enough to absorb tool/version, restore-filter, Auth, Storage, and
application defects before the final quiet window.

## Target lifecycle and enforced write gates

Treat the owned target as an explicit state machine: **new/empty → isolated
rehearsal → discarded or proven-clean → final restore → enforced read-only →
writes enabled**. A rehearsal-restored target is not a clean final target merely
because tests passed. Before final restore, either recreate it from an approved
empty baseline or use a separately reviewed reset/restoration procedure that
proves no rehearsal object or row survives. Never substitute populated
`dynamic-staging`.

Read-only must be enforced at the data plane, not represented by a banner or
operator promise. Until phase 20, application, browser, Auth side-effect,
function, job, webhook, and integration credentials must be unable to mutate
the target; only the narrowly authorized restore/verification operator may make
the planned rehearsal/final changes. The source quiet-window fence must likewise
stop every human and background writer and prevent already-started work from
committing behind the final snapshot. If Lovable cannot provide a supported,
testable server-side source fence and drain signal, cutover is blocked.

## Roles and evidence

Use named operators for each checklist item: migration lead, Lovable operator,
Supabase operator, application verifier, execution-checkout approval owner, and
rollback decision owner. Record timestamps in UTC, the informational historical
procedure-origin SHA, externally approved execution-checkout SHA, independently
observed execution-checkout SHA, procedure README blob SHA, fenced-workflow
SHA-256, inspection-tool/baseline SHA, artifact checksums, TOC/report checksum,
target project identity, function artifact SHAs, and pass/fail notes. The
historical origin does not approve later procedure content, and the observed
execution SHA alone does not prove external approval.

Treat artifact identities as separate, immutable evidence. For a ZIP download,
record the canonical outer artifact's UI-observed object name and externally
approved expected original filename, size, and SHA-256 separately from the
workflow-observed filename, before/after size, before/after SHA-256, and
validated ZIP structural metadata. Never call the workflow's own measurement
an external checksum or promote it into the expected value.
Separately record the sole member's actual name, compression method, CRC, and
declared compressed/uncompressed sizes; the verified inner `PGDMP` size and
SHA-256; the SHA-256 reported by the existing inspector for that inner archive;
and the report and provenance-manifest hashes. The inspector-reported hash must
equal the verified inner hash, never the outer ZIP hash. A direct raw-`PGDMP`
input remains supported and has no fabricated ZIP/member metadata; in direct
mode, provenance explicitly records the verified inner as a byte copy of the
canonical input, so their equal hash is expected rather than misrepresented as
a ZIP-derived relationship. Record a manifest file hash in a
separate checksum sidecar rather than attempting to put a file's ordinary
SHA-256 inside the bytes being hashed.

Bind source identity before artifact access. `SOURCE_PROJECT_REF` must exactly
equal the single strict top-level `project_id` in the approved checkout's
`supabase/config.toml`. Record that config file's Git blob SHA and file SHA-256.
This proves repository configuration equality only; it does not independently
prove which Lovable backend produced the export. For ZIP input, the normalized
member name must exactly equal the independently recorded
`UI_EXPORT_OBJECT_NAME` before `pg_restore` is invoked.

The canonical outer artifact and completed export-inspection evidence package,
including its provenance manifest, must live in an approved encrypted evidence
store. `APPROVED_EVIDENCE_STORE_ROOT` has no default and must be absolute,
outside the Git worktree, a real non-symlink directory, owned by the executing
user, and mode `0700`. `CANONICAL_EXPORT` must be a direct child of that root, a
non-symlink regular file owned by the executing user, and inaccessible to group
and world. The local workflow verifies those filesystem properties, not volume
encryption. The ignored `local-migration-artifacts/` directory is disposable
private working space; it is removed after durable publication and can be
deleted by git-clean operations. Never commit exports, metadata reports,
credentials, user lists, or object names learned only from production.

Timeline events are independent evidence, not aliases. Represent initiation and
completion as structured observations: either an operator-observed UTC value or
`{"value": null, "basis": "not_observed", "reason": "..."}` with a required,
non-placeholder reason. Export availability and download completion must each
have an operator-observed, second-precision RFC3339 UTC value. Validate every
available observed relationship: observed initiation must not follow observed
completion or availability; observed completion must not follow availability;
and availability must not follow download completion. Never infer an event from
a filename, ZIP timestamp, filesystem metadata, or another event.

Reject any unknown basis, missing or placeholder `not_observed` reason,
`not_observed` event carrying a value, or `operator_observed` event carrying a
reason. A fully observed and ordered initiation → completion → availability →
download timeline records `COMPLETE`. Any accepted missing initiation or
completion records `INCOMPLETE`; availability is never relabeled as completion.

The retained rehearsal's initiation was not observed and that historical gap is
irreparable. Completion may likewise be explicitly unobserved; availability is
not completion. Its provenance must therefore record
`export_timeline_status: INCOMPLETE`, while metadata inspection remains
`inspection_status: REVIEW_REQUIRED`. The missing initiation does not require a
new rehearsal export and does not prevent safe offline metadata inspection after
an exact execution checkout is separately reviewed and approved. Every future
rehearsal and final export must record initiation correctly before the export
action is taken.

Bind the run to an explicit evidence profile. The retained-rehearsal profile
requires unobserved initiation and an `INCOMPLETE` timeline; future-rehearsal
and final-cutover profiles require operator-observed initiation. This prevents a
basis change from relabeling the retained gap as complete. The event values are
still human observations: local validation proves their syntax, ordering, and
package binding, not that the operator actually observed the claimed UI event.

## Phases

### 1. Preflight inventory

Start with `repository-inventory.md` and `sql-migrations.sha256`. Re-run the
repository inventory tooling from the exact reviewed Git SHA. Assign every
runtime-only unknown (Auth providers, SMTP, secrets, jobs, webhooks, Realtime,
Storage, custom domain, and effective function configuration) to an owner. Stop
if production size is not known to be below the reported 5 GB export limit or
if the quiet-window write sources cannot be enumerated.

Exit gate: signed inventory has no unowned critical unknowns; rehearsal and
final export windows are at least 24 hours apart.

### 2. Create isolated owned Supabase project

Under separate authorization, create a new, empty, user-owned project solely
for rehearsal. Record region, PostgreSQL major version, available extensions,
API exposure settings, and project identity. Do not use populated
`dynamic-staging`. Do not seed secrets, deploy functions, or expose the app yet.

Exit gate: target is isolated, empty, access-controlled, and positively
identified; its baseline catalog manifest has been captured read-only.

### 3. Remix Lovable project

Under separate authorization, use Lovable's supported Remix flow while keeping
the original project intact. Determine empirically whether Remix copied only
code or also configuration/data. Pin the remix to the reviewed Git repository
and commit without creating an unmanaged permanent fork. Then use Lovable's
confirmed connection flow to connect **the remix, never the original**, to the
isolated owned Supabase target. Record the remix identity, repository/branch,
target project ref, and every configuration item that did or did not carry over.
Do not disconnect the original from Lovable Cloud.

Exit gate: original remains operational and unchanged; remix provenance and
owned-target connection are positively identified; configuration gaps are
documented; no production domain or traffic points at the remix.

### 4. Generate rehearsal export

For every future rehearsal, use Cloud → Overview → Advanced settings → Export
data only after recording the initiation time and exact source project. Record
the time at which the export object becomes available as a distinct event. Do
not label availability as completion and do not assume either event means the
download contains a usable dump. If completion itself was not observed, record
it with `value: null`, `basis: not_observed`, and a required reason. The export
consumes the reported 24-hour generation slot.

For the retained rehearsal only, preserve the explicit missing-initiation record
and keep `export_timeline_status: INCOMPLETE`; do not backfill it from any other
timestamp. This prevents the run from becoming complete rehearsal evidence, but
does not block the separately reviewed offline metadata-only inspection.

Exit gate: future initiation is operator-observed; availability is separately
operator-observed; completion is either independently observed or explicitly
not observed with a reason; and no final-cutover window depends on another
export within the reported 24-hour limit.

### 5. Download and checksum export

Treat the untouched download as the canonical outer artifact, regardless of
whether it is ZIP-wrapped or direct `PGDMP`. Preserve it in the approved
encrypted evidence-store root as a direct child under its original filename. Do
not rename away the original extension. Before invoking the checked-in workflow,
obtain and externally approve its exact basename, byte size, and SHA-256, then
supply those values with no defaults as `EXPECTED_ORIGINAL_FILENAME`,
`EXPECTED_OUTER_SIZE_BYTES`, and `EXPECTED_OUTER_SHA256`. Separately record the
UI-observed export object name and observed download-completion time. Never
upload an outer or derived artifact to GitHub, chat, CI, or an unapproved file
store.

Supply the store itself as `APPROVED_EVIDENCE_STORE_ROOT`, also with no default.
It must be absolute and outside the Git worktree, a real non-symlink directory
owned by the operator with mode `0700`. The canonical direct child must be a
non-symlink regular file owned by that operator with no group/world access. The
workflow checks the basename, size, and SHA against the externally supplied
values before it creates a run directory, copies bytes, normalizes, or invokes
`pg_restore`. Its own descriptor-bound measurements are recorded only as
workflow-observed before/after identity; they are not external evidence.

An inner `PGDMP` produced by normalization is a distinct derived artifact. Its
filename, size, and hash cannot replace or relabel the outer evidence.

Exit gate: availability and download-completion timestamps are independently
observed and ordered; the expected canonical identity is approved independently
of the workflow; root/file ownership, modes, non-symlink and direct-child
requirements pass; expected and workflow-observed outer identities agree; and
the outer file is non-empty and within the reviewed limit.

### 6. Inspect dump table of contents

Before running the template, the named execution-checkout approval owner must
review an exact commit and supply that full SHA out of band as
`APPROVED_EXECUTION_CHECKOUT_SHA`. The template has no default for this value. A
missing, malformed, unavailable, or non-HEAD approval pin stops before creating
the run directory or invoking `pg_restore`. The workflow can prove only that the
supplied approval pin equals the executing checkout; it cannot prove who
authorized or supplied it.

Execute the complete, checked-in evidence-package template under **Inspect a
Lovable export envelope** in `scripts/migration/README.md`. Do not substitute the
inspector's stdout-only form: the template retains the report, externally
approved expected identity separately from workflow-observed outer before/after
checksums, derived-artifact metadata, report and provenance checksums, per-file
evidence manifest and detached manifest hash, and provenance manifest. Do not
edit a copied command block: the content identities attest the approved
checkout's README and marked fence, not an independently captured shell-input
stream.

Before any artifact access, require `SOURCE_PROJECT_REF` to equal the approved
checkout's one strict top-level `project_id` in `supabase/config.toml`; record
the config Git blob SHA and file SHA-256 in provenance. That check binds the
repository configuration, not Lovable's internal project/export mapping.
Likewise, all four artifact-approval inputs—`EXPECTED_OUTER_SHA256`,
`EXPECTED_OUTER_SIZE_BYTES`, `EXPECTED_ORIGINAL_FILENAME`, and
`APPROVED_EVIDENCE_STORE_ROOT`—are mandatory and have no defaults. A mismatch
stops before run creation or `pg_restore`.

The normalizer accepts either direct raw `PGDMP` input or a strictly validated
ZIP envelope. A ZIP must contain exactly one non-empty regular member. Reject
multiple or duplicate entries; directories, symlinks, devices, and other special
files; absolute, traversal, separator-containing, drive-prefixed,
control-character, or ambiguous names; encryption; unsupported compression;
nested archives; a STORE member not declaring ZIP version 1.0 or DEFLATE member
not declaring ZIP version 2.0; empty or non-`PGDMP` content; malformed headers/directories,
bad CRC, truncation, prefix/polyglot bytes, and trailing junk; and any declared
size, actual streamed size, compression ratio, or disk-headroom condition beyond
the reviewed limits. Working storage must accommodate the outer working copy,
derived inner, inspector snapshot, and temporary/report overhead—approximately
three archive copies for direct PGDMP input. The outer before/after SHA-256 must
remain identical, and a
supplied expected outer SHA-256 must match. Symlink inputs and canonical mutation
fail closed.

In ZIP mode, require the sole normalized member's exact name to equal the
operator-recorded `UI_EXPORT_OBJECT_NAME`; a mismatch stops before `pg_restore`
and publishes nothing. Do not conflate that UI object/member binding with the
downloaded outer filename.

PostgreSQL defines `pg_restore --list` as an editable TOC summary suitable for
`--use-list`, not as a lossless object-identity serialization. PostgreSQL does
not document a lossless quoting grammar for the namespace, tag, and owner text
in that editable listing. See the
[PostgreSQL 17 `pg_restore` documentation](https://www.postgresql.org/docs/17/app-pgrestore.html),
and the corresponding
[PostgreSQL 18 documentation](https://www.postgresql.org/docs/18/app-pgrestore.html).
The inspector therefore uses conservative class-specific grammars. The
hyphenated extension exception accepts only the reviewed ASCII EXTENSION shape;
it does not relax identifiers globally, and quote characters are never assumed
to be a lossless object-name quoting mechanism.

For ZIP input, prefix/polyglot and trailing-junk rejection is enforced by exact
byte-zero local-header and EOF end-of-central-directory framing. For direct raw
`PGDMP`, the normalizer enforces a stable bounded copy and conservative header
validation, while the execution-bound inspector's real `pg_restore --list` invocation
supplies a bounded TOC/compatibility signal only and may accept appended inner
bytes. Whole-file hashes bind the exact inner input, but do not prove that
`pg_restore` consumed it all. Failure at either layer publishes no evidence
package.

Route every inspector invocation through the reviewed bounded guard. Its
underlying PostgreSQL 17 executable is mandatory, absolute, executable, and not
a symlink; the guard accepts only `--version` or `--list <absolute-local-path>`.
Fixed limits permit 15 seconds and 1 MiB stdout for `--version`, 300 seconds and
128 MiB stdout for `--list`, and 1 MiB stderr for either. It streams both
channels into private exclusive captures, kills the process group and
waits for/reaps its direct child leader on timeout or overflow, and accepts
exactly one explicit private temporary parent. Descriptor-bound capture passes
the held staging-directory descriptor through
`LOVABLE_BOUNDED_TEMP_PARENT_FD`; standalone `inspect-lovable-dump.sh` opens its
fresh private mode-`0700` work directory and passes its descriptor through the
same variable. A reviewed direct wrapper caller may instead pass an absolute
private mode-`0700` directory through `LOVABLE_BOUNDED_TEMP_PARENT`. The guard
rejects no parent, both parents, symlinks, wrong ownership, and permissive modes.
It creates one random hidden mode-`0700` directory and two exclusive mode-`0600`
captures descriptor-relatively beneath that parent.

Do not treat child exit zero as sufficient to release the captured bytes. The
guard first buffers the bounded successful output, closes and
descriptor-relatively unlinks both capture files, removes their directory, and
fsyncs the private parent. Only then may it emit the successful bytes. Any
cleanup or parent-fsync ambiguity returns fixed `other_nonzero` and emits no
successful child output. In the high-level envelope, any residue is confined to
the exact held staging tree; the outer driver must remove and fsync that tree or
retain only a reviewed private indeterminate/quarantine stop. Such a failure
cannot yield a normal complete capture package.

Every raw-inspector failure must emit one exact versioned JSON record containing
only an allowlisted stage and safe reason. The high-level driver must reject a
missing, malformed, duplicate, oversized, non-ASCII, unknown, or mixed
diagnostic and must never relay raw child stdout/stderr, TOC text, paths, object
names, or payload bytes. A failed run publishes no normal durable evidence
package and removes its disposable snapshot, TOC, derived archive, partial
report, and provenance. The report helper emits exactly one ASCII JSON line
with fixed key order and version. Its only reasons are `unknown_toc_class`,
`unresolved_known_toc_entry`, `malformed_toc`, `duplicate_toc_id`,
`conflicting_source_version`, `conflicting_pg_dump_version`,
`migration_metadata_unreadable`, and `other_nonzero`. Capture both helper
channels privately; any empty, multiline, oversized, non-ASCII, malformed,
extra-key, wrong-version, or unknown-reason diagnostic reduces to
`report_helper_failed` / `other_nonzero`. The high-level driver accepts only
reviewed stage/reason pairs, never a globally valid reason attached to the
wrong stage. Reviewed `pg_restore` failure reasons are limited to
unsupported archive version, invalid archive, truncated archive, timeout,
output cap, or other nonzero; all unfamiliar text is `other_nonzero`.
The checked-in helper does not fail the entire package merely because a
recognized TOC class has an unresolvable namespace/tag/owner representation.
Instead, it stops all object-name, schema, owner, and migration-duplicate
analysis and emits only a total unresolved count plus fixed allowlisted
object-class counts with:

- `object_reference_analysis: INCOMPLETE`
- `migration_duplicate_analysis: INCOMPLETE`
- `restore_planning_gate: BLOCKED`

The fixed count block covers every recognized TOC class. Classes representing
data/payload position or annotations rather than a standalone schema-object
reference are explicitly exempt and must retain a zero unresolved count; every
other recognized class participates in this conservative gate.
Migration-duplicate analysis is a separate, non-complete heuristic. When every
TOC object reference needed by the report is resolved and migration metadata is
readable, it is `CONSERVATIVE`: reviewed name matches may identify possible
duplicates, but absence of a match is not proof across PostgreSQL aliases,
pre-name modifiers, object-kind ambiguity, or dynamic SQL. When object
references are unresolved, it is `INCOMPLETE` and only aggregate evidence is
retained. This workflow never emits `COMPLETE`; reserve that status for a
catalog-backed or genuinely executed/parsed schema comparison. Restore
planning remains `BLOCKED` in either case.
The `INCOMPLETE` aggregate path emits no TOC line, object name, schema, owner,
OID, SQL, path, payload, or migration-match detail. A `CONSERVATIVE` detailed
report may retain the normalized metadata references and possible checked-in
migration matches already defined by the report contract, but never raw TOC
lines, SQL text, or row payload; it remains blocked. Unknown classes, malformed
TOCs, duplicate TOC IDs, conflicting version headers, archive/hash failures,
unsafe diagnostics, and migration-metadata read failures on the resolved-object
analysis path remain fatal and publish no normal package.
These analysis fields are mandatory in provenance format version 6; the
pending and descriptor-bound durable validators reject an older or missing
provenance format rather than inferring the gate.
Those validators also use a recursive duplicate-key- and nonfinite-number-
rejecting JSON loader and exact allowed-key schemas at every fixed provenance
and evidence-manifest level. Rehashed last-key-wins documents, nested duplicate
members, unknown readiness claims, and contradictory fixed safety values are
publication failures.
Expected scalar values are type/format checked and cross-bound across tool,
source/config, outer, inner/header, report, checksum, and durable-path claims.
Before evidence-package construction, the workflow freezes an immutable
publication expectation from the live descriptor-bound canonical artifact and
the runtime-approved checkout, tools, configuration, Python, source, timeline,
inner archive, report, and analysis identities. The pending package,
descriptor-bound staging package, immediate pre-rename package, and renamed
package before `EVIDENCE_COMPLETE` must each equal that expectation and recheck
the live canonical descriptor. Synthetic poison cases include fully coherent,
fully rehashed outer and checkout/tool/config/project substitutions that remain
structurally valid but cannot pass the runtime publication gate.
The approved workflow records its resolved execution-Python identity, runs
child Python tools in isolated mode, pins the raw inspector to that interpreter
and `/bin/bash`, and excludes inherited shell/Python startup hooks from the
child environment. The raw inspector must finish private-workspace cleanup
before atomically publishing a no-replace report; cleanup failure publishes
nothing. If a standalone report link exists but post-link directory durability
and rollback cannot both be proved, replace its contents with a fixed private
indeterminate marker or move it to an unmistakably named quarantine. Such an
artifact is never a valid report; residual filesystem ambiguity is a mandatory
manual-quarantine stop.

The evidence workflow must use `--output`. Direct stdout compatibility mode is
not transactional with an arbitrary terminal or pipe; a consumer failure can
leave a partial stream even though the inspector returns
`report_publish_failed`. Never retain that stream as evidence.

pg_restore --list does not prove that every byte of the inner input was consumed.

Do not use `unzip`, `extractall`, or a member-controlled output path. Stream the
sole member to one fixed, exclusively created file in a private temporary
directory. Enforce the actual-byte cap while streaming, hash the stream, verify
CRC and actual length against the validated metadata, require `PGDMP` magic,
flush and `fsync`, atomically publish the derived file, and set mode `0400`.
Remove every partial output after any failure. Stage the derived archive,
report, manifest, and checksum sidecars away from the final run path; publish a
run only after all checks pass and never overwrite an existing run or output.
The durable destination is exactly
`<APPROVED_EVIDENCE_STORE_ROOT>/migration-inspection-evidence/<run-id>`. Before
publication, build `evidence-files.json` with each core evidence payload file's
SHA-256, size, and mode plus detached `evidence-files.sha256`; retain detached
`provenance.sha256`; require every file mode `0400` and evidence directory mode
`0700`. The payload manifest intentionally excludes the non-self-referential
completion marker. Copy through held directory descriptors to a private pending
durable tree, verify every copied identity, fsync final file modes plus its
directories and parents, remove disposable working evidence, and atomically
reserve the final run path with a descriptor-relative operating-system
no-replace rename. Reverify the committed payload, canonical artifact, store
root, and parent binding before exclusively writing and fsyncing
`EVIDENCE_COMPLETE`; its exact content binds the run ID and detached payload
manifest hash and `restore_planning_gate=BLOCKED`. That marker means the
metadata evidence bytes are durably complete; it is never a restore-ready,
object-analysis-complete, or migration-green signal. A postcommit validation failure must have no completion marker
and must instead carry `EVIDENCE_INDETERMINATE`. Consumers reject a missing or
malformed completion marker, any indeterminate marker, a manifest/hash/mode
mismatch, or a residual local run. Existing pending/final runs are never
overwritten or deleted.

An I/O failure while persisting the final completion/indeterminate state is an
explicit manual-quarantine stop: user-space cannot eliminate the crash or
filesystem ambiguity at the atomic-rename/`fsync` boundary. This ceiling does
not make an indeterminate package valid and does not authorize continuation.
Derive the run ID from the observed availability time plus a prefix of the outer
SHA-256, never from initiation or artifact metadata.

#### Future offline private-TOC review

The shareable aggregate report is not a lossless TOC. If aggregate evidence is
complete but object-reference analysis remains `INCOMPLETE`, stop. A future
private TOC capture requires separate authorization and must not modify or
replace that evidence package.

The sole reviewed operator entrypoint is
`scripts/migration/run-lovable-toc-capture.sh`. It requires the separately
approved `TOC_REVIEW_EXECUTION_PYTHON` to be an explicit absolute, canonical,
non-symlink executable, requires its separately approved exact SHA-256 and
`cpython:MAJOR.MINOR.MICRO` identity, and invokes the internal high-level driver
with exactly `-I -S -B`. Do not directly invoke `capture-lovable-toc-envelope.py`, the
low-level `capture-lovable-toc.py`, the normalizer, or the bounded wrapper, and
do not prepare an inner archive manually. The high-level driver composes the
existing strict ZIP normalizer and low-level
capture without relaxing either contract. It requires explicit, no-default
bindings for the canonical outer path, completed aggregate evidence-run
directory, empty private staging root, empty durable output root, canonical
filename and UI member name, outer size/hash, inner hash, aggregate manifest
hash, inspection checkout/procedure identities, current approved checkout,
exact `pg_restore` path, approved executable hash, externally approved exact
bounded version output, and expected total/data entry counts.
Every capture-chain Python component checks, before repository-local imports or
private processing, that isolated mode and ignored environment configuration
are active, user and system site loading are disabled, and bytecode writes are
disabled. Before either capture entrypoint adds the repository tools to
`sys.path`, a fixed `/usr/bin/git` under a closed minimal environment disables
system/global configuration, hooks, `core.fsmonitor`, and the untracked cache;
it requires the approved `HEAD`, tracked byte identity, a clean worktree, and
zero ordinary or ignored untracked inputs beneath `scripts/migration/`. The
high-level driver binds and revalidates the explicit interpreter;
normalizer, low-level capture, and bounded-wrapper children all use that same
path with exactly `-I -S -B` and reviewed minimal environments. User-site
`.pth`, `sitecustomize`, and `PYTHONPATH` hooks are therefore excluded, and an
untracked `__pycache__` is neither an accepted checkout mutation nor an ignored
execution artifact. `PYTHONSTARTUP` is not the proof boundary because ordinary
noninteractive script execution does not use it.

After a separate authorization supplies every exact `TOC_REVIEW_*` value,
including `TOC_REVIEW_EXECUTION_PYTHON`, invoke only:

```bash
scripts/migration/run-lovable-toc-capture.sh
```

If the diagnostic output channel is closed or broken, the bounded writer emits
no traceback and does not fall back to another channel. The already-decided
durable status and exit status remain authoritative; inspect private package
state before any human decision, and never infer permission to retry.
The launcher validates the canonical pathname, safe owner/mode, externally
approved Python digest, and isolated reported version before asking the shell
to execute it. Both capture components recheck
the exact digest/version, safe ownership/write mode, and stable identity, and
the capture procedure identity retains the canonical runtime-identity digest.
The shell still does not hold an executable descriptor, so an actor with
parent-directory replacement capability can exploit the digest-check-to-`exec`
window. The launcher rehashes after its isolated version probe, captures the
final child's stdout/stderr through private 4 KiB-bounded channels, and releases
only an exact allowlisted driver record; native exec errors and all other bytes
become `capture_launcher` / `child_diagnostic_invalid`. This preserves the
nonleaking public diagnostic contract, but it does not attest the executable
bytes the kernel ultimately ran.

Before staging, require all roots to be absolute, real, non-symlink,
executing-user-owned mode-`0700` directories outside the Git worktree. The
aggregate, staging, output, and canonical paths must not overlap; staging and
output must share a filesystem; staging and output must be empty; and no final
capture path may already exist. Require the canonical ZIP to be the exact
approved basename and a single-link, executing-user-owned mode-`0400` regular
file. Any missing, relative, permissive, wrong-owner, symlinked, pre-existing,
overlapping, or ambiguous input is a prepublication stop. Require at least 512
MiB available in the durable output root before staging; the strict normalizer
separately requires capacity for the declared inner member plus its fixed 256
MiB reserve.

The driver creates one fresh hidden mode-`0700` staging directory and invokes
only `normalize-lovable-export.py` with the externally approved outer SHA-256.
It requires ZIP mode, exact UI/member-name equality, approved outer identity
before and after, the observed bounded inner size and approved inner hash,
strict normalization metadata, and one fixed mode-`0400` `PGDMP` result. That
exact derived file is passed to the low-level capture through an inherited
descriptor for the private staging directory, so staging-root pathname
replacement cannot redirect publication. The low-level capture passes that
same held descriptor as the bounded helper's sole temporary parent, so bounded
stdout/stderr capture cannot escape to an ambient system temporary directory.
The helper privately captures child channels through bounded exclusive files, withholds
successful bytes until descriptor-relative cleanup and parent fsync succeed, and may
invoke `pg_restore` only as `--version` and `--list`; raw TOC bytes are
published only to fixed, exclusive, no-replace mode-`0400` files beneath a
mode-`0700` private capture directory in the approved encrypted evidence
store. They must never reach a terminal, ordinary log, Git, CI, chat, or the
disposable worktree.

Before publication, revalidate every runtime/archive/procedure/tool binding,
the exact expected counts, the capture manifest, raw-TOC hash, modes, and fixed
file set. Remove and fsync the derived inner archive and normalization metadata,
then revalidate the canonical outer and publish atomically with no replacement.
Withhold the low-level completion marker before promotion and recreate it
exclusively only after descriptor-bound post-rename validation and fsync.
Revalidate the canonical outer again after publication. Successful capture emits only fixed aggregate
fields and stops at `REVIEW_REQUIRED` / `ANNOTATION_REQUIRED`, with
`restore_planning_gate=BLOCKED` and `restore_command_gate=BLOCKED`. It creates
the fresh private opaque key/index capture package but does not create,
validate, or publish an annotation ledger and never generates a restore
command.

An ordinary failure must remove and directory-fsync every derived/working byte
and hidden pending tree. If cleanup, rollback, publication, or durability is
ambiguous, retain only a private hidden quarantine, mark the promoted package
indeterminate, or retain a root-level indeterminate stop marker plus the
exclusive root claim if package rollback cannot be proved; stop with a fixed
allowlisted diagnostic and never report success. The later ledger validator
requires the capture root to contain only the bound package and, when colocated,
the one bound ledger input, so either root stop artifact blocks annotation.
An abrupt host/kernel crash can still leave private hidden
indeterminate remnants. Treat them as a manual-quarantine stop, never as a
valid capture package or authorization to retry. Timeout, output cap,
concurrent mutation, path replacement, collision, insufficient capacity, or
binding mismatch likewise stops the one attempt.

#### Private annotation authoring and checkpoint gates

Human review occurs locally against that private capture only through the
zero-argument
`scripts/migration/run-lovable-toc-annotation-authoring.sh` launcher. Do not
run its Python component directly. Before opening private input, the launcher
requires an explicitly approved canonical CPython path, SHA-256, exact version,
safe ownership/mode/link count, a clean approved checkout, exact reviewed tool
blobs, and no ordinary or ignored untracked migration-tool inputs. It rejects
loader/Python startup variables before reviewed Python and private-input
access, creates a minimal `/usr/bin/env -i` environment, and invokes the
internal component with `-I -S -B`. The invoking shell/native loader has
already started before shell code can inspect its environment, so launch from
a trusted sanitized local parent; this guard does not attest that hostile
pre-shell loader code never executed. It makes no
network call and never invokes `pg_restore`, a database client, restore tooling,
or the ledger validator. Hash-before/probe/hash-after binds the reviewed
interpreter pathname, but `exec` is still path based; it cannot independently
attest the bytes consumed across a hostile same-user path-swap-and-restore race.
Treat that as a local trust ceiling, not as executable-byte attestation.

`TOC_AUTHOR_ACTION` chooses exactly one closed operation per invocation:
`initialize`, `primary_review`, `revisit_unresolved`,
`relationship_review`, `data_reference_review`, `sequence_review`,
`managed_review`, `manual_conflict_review`, `peer_review`,
`correction_review`, `status`, or `finalize`. The immutable generations advance
through these derived states:

Before an authorized session, bind every mandatory `TOC_AUTHOR_*` input using
the exact operator table in `scripts/migration/README.md`; there are no private
path, artifact-identity, interpreter-identity, operator, session, or checkpoint
head defaults. Generation `0` and the all-zero head are valid only for the
one-time initialization. Every resume must use the exact latest generation and
full checkpoint SHA-256 reported through the private evidence process.

1. `PRIMARY_REVIEW_REQUIRED`
2. `REVISIT_REQUIRED`
3. `RELATIONSHIP_REVIEW_REQUIRED`
4. `DATA_REFERENCE_REVIEW_REQUIRED`
5. `SEQUENCE_REVIEW_REQUIRED`
6. `MANAGED_GLOBAL_REVIEW_REQUIRED`
7. `MANUAL_CONFLICT_REVIEW_REQUIRED`
8. `PEER_REVIEW_REQUIRED`
9. `FINALIZATION_REVIEW_REQUIRED`
10. `FINALIZATION_ELIGIBLE`

These states are deterministic, enforced phase priorities. They do not infer a
missing decision, and ordinary review actions do not interleave. Only a
peer-requested correction or explicit semantic `correction_review` may return
to an earlier phase; finalization requires every phase predicate simultaneously.
`FINALIZATION_REVIEW_REQUIRED` is a fixed fail-closed state: all phase flags
are present but the semantic finalization contract still rejects the combined
decisions. Before final-candidate publication, `correction_review` may run from
either `FINALIZATION_REVIEW_REQUIRED` or `FINALIZATION_ELIGIBLE`; eligibility is
not proof that a human decision is semantically infallible or restore-ready. It
chooses one sorted, explicit TTY-only batch of at most 100 ordinals and one
existing scoped primary-review phase. The new immutable generation invalidates
affected peer approval, so a distinct peer must reapprove it before
finalization eligibility is recomputed.
If the selected correction phase is `primary_review`, classification review is
coupled to manual-conflict invalidation. A prior final disposition may change
only to null; the resulting classification must be marked reviewed, with
manual-conflict review `pending` for `manual_conflict` and `not_applicable` for
all other classes. Final disposition selection remains exclusive to
`manual_conflict_review`. Retaining or substituting a final disposition, or
retaining stale `reviewed` state, fails closed. The canonical decision hash and
peer approval are invalidated in both finalization states and after a peer
requests changes.

`initialize` alone creates the bound draft state. Primary review proceeds in
deterministic ordinal batches, normally 100 entries. The later passes must
explicitly revisit unresolved decisions, relationships and dependencies, every
data reference, all sequence/state-bearing relationships, managed-domain and
global handling, and each manual conflict. Mechanical proposals remain labeled
proposals and never count as approval. Primary prompts and peer review label
each relationship as `dependency`, `structural_parent`, or `metadata_parent`;
applicable sequence relationships are separately labeled
`sequence_metadata_parent` or `sequence_structural_parent`. The same ordinal is
shown once per role when it occupies multiple roles. The decision/peer hash
binds the exact role-keyed assignments rather than counts or their union. Peer
review acknowledges the primary-decision summary before its first screen clear
and then acknowledges every role-labeled context. Multi-parent sequence review
also acknowledges each parent before the next clear. Every
decision and semantic relationship requires explicit primary review. Peer
review is separate and requires a named
operator different from the primary reviewer. `status` displays fixed states
and aggregate counts only; it never reveals an opaque identifier or object
metadata. `finalize` checks eligibility but cannot manufacture a missing review
transition. Every successful checkpoint-publishing review action displays the
exact next generation and full checkpoint SHA-256 only on the controlled
private TTY for a later exact resume; neither value enters ordinary
stdout/stderr or the aggregate-only `status` result.

Relationship correction is persisted under the internal
`relationship_correction` checkpoint action and remains reachable only through
the operator's `correction_review` choice. It re-prompts `dependency` and every
applicable `structural_parent` even when their states were already reviewed,
allowing clear, replacement, or reselection. The canonical role-keyed decision
hash is recomputed and the affected peer approval returns to pending. If a
required structural-parent selection is cleared, relationship review also
returns to `pending`, and reselection must use the ordinary role-labeled phase.
If a `SEQUENCE OWNED BY` structural-parent list changes, the transition is
valid only with `sequence_review_state=pending`; fresh role-labeled
`sequence_structural_parent` display and acknowledgement, then fresh peer
approval, are mandatory. A forged transition that preserves stale sequence
approval fails. `SEQUENCE SET` correction can change only
`sequence_metadata_parent`, ordinary data-reference correction can change only
`metadata_parent`, and relationship correction cannot mutate classification,
managed, metadata-parent, or unrelated review fields.

The interactive surface is one verified local foreground controlling TTY in an
alternate screen. Raw context is bounded and escaped and goes only to the held
TTY descriptor; ordinary stdout/stderr retain fixed diagnostics and aggregate
counts. Refuse pipes, redirection, and non-TTY execution; reject known
record-to-file ancestor processes and known remote/multiplexer/editor-terminal
markers. The workflow provides no
browser or clipboard transport. The operator must attest that the session is
local and not being
recorded. Clear the alternate screen on reviewed exit where possible, but do
not claim this proves the absence of an unknown or disguised recorder, screen
capture, photography, a hostile terminal, or a hostile same-user process.
Keep the exact resume generation, checkpoint SHA, and private release token
visible while the durable authoring lock still exists, until the operator
types the fixed `resume_values_recorded` acknowledgement. Only then may the
procedure durably publish `AUTHORING_RELEASED` and remove the lock. A TTY
write failure, EOF, wrong acknowledgement, or terminal attribute/read failure
leaves a blocking lock and, where possible, an indeterminate marker; it must
not look normally resumable. Do not pipe or record the terminal to retain the
tuple; use the separately approved private operator record.

Authoring opens the bound raw TOC and opaque structural index for review
content, and reads `capture.json`, `evidence-files.json`, and
`EVIDENCE_COMPLETE` only to verify the complete package binding. It stats
`opaque-id.key` to bind safe filesystem metadata but must never open or copy
the key bytes. It verifies the approved raw/index hashes and their ordinal,
class, and data-reference structure without recomputing keyed IDs. That is
deliberately weaker than later validator recomputation and cannot advance a
validation gate.

Keep authoring state in a separate absolute canonical, operator-owned,
non-symlink mode-`0700` root outside Git. Unfinished generations use the draft
checkpoint schema, never the final ledger schema. The fixed mode-`0400`
`AUTHORING_LOCK` serializes writers; a stale or conflicting lock is a hard stop
and is never auto-removed. The launcher disables soft and hard core dumps
before the isolated child starts. Successful release leaves a durable fixed
mode-`0400` `AUTHORING_RELEASED` marker carrying the token displayed and
acknowledged with the exact checkpoint tuple while the lock was still held.
That token becomes usable only after durable release; the next invocation must
supply it and consumes the marker only after a new durable lock exists. An
incomplete private handoff does not release. A release durability failure
best-effort restores a blocking lock or indeterminate state. If the filesystem
rejects both restoration paths after a durability error, the remaining names
are ambiguous and the fixed failure is a no-retry stop; do not treat a release
name as recovery authorization. Each review action creates one no-replace,
single-link mode-`0400`
`checkpoints/checkpoint-g<16-digit-generation>-<full-sha256>.json`, fsyncs it,
atomically publishes it without replacement, and fsyncs its parent. There is no
mutable head pointer. Every generation binds the complete capture identity,
raw/index and procedure hashes, checkout, prior-generation hash, monotonic
generation, named operator and session identity, exact ordinal range, decisions,
and primary/peer state.

Resume only from one uniquely determined contiguous head whose exact generation,
SHA-256, and preceding successful release token the operator supplied. Stop on
a fork, missing generation, broken
hash chain, malformed or oversized checkpoint, duplicate JSON key, nonfinite
value, wrong mode/owner/link count, symlink, unexpected sibling, concurrent
writer, path/input mutation, stale lock, collision, or filesystem ambiguity.
Never choose a branch or delete ambiguous state automatically. A provably
incomplete pending generation may be removed and its parent fsynced. If write,
rename, rollback, cleanup, or fsync cannot be proved, retain private
`AUTHORING_INDETERMINATE`, emit only the fixed `cleanup_indeterminate` result,
and block resume and finalization pending a separately reviewed recovery.
The same rule governs read-only `status`: any descriptor-close or cleanup
ambiguity overrides its nominal review-boundary result with the fixed failure,
leaves a blocking lock/indeterminate state, and withholds a normal release token
and durable release marker.

Draft `dependency_review_complete` stays false. A separate, explicitly
authorized `TOC_AUTHOR_ACTION=finalize` may proceed only from
`FINALIZATION_ELIGIBLE`, with exact expected head identity, distinct peer
approval, zero unresolved decisions, complete relationship/data/sequence/
managed/manual/global reviews, and exact entry/data-reference accounting. It
publishes without replacement one private
`final-ledger-<checkpoint-sha-prefix>/` package containing
`annotation-ledger.json`, `authoring-finalization.json`,
`evidence-files.json`, and `EVIDENCE_COMPLETE`, all mode `0400`, and leaves the
checkpoint chain intact. Finalization never runs the validator. The resulting
ledger remains `REVIEW_REQUIRED`; it is neither validated nor restore-ready.
The final package makes the authoring root terminal; later authoring actions
stop before private capture input. Before publication, an operator who withholds
finalization authorization after finding a wrong decision may return through
the scoped correction route even from `FINALIZATION_ELIGIBLE`.

A later, separately authorized validation must use the zero-argument
`scripts/migration/run-lovable-toc-ledger-validation.sh` launcher. That launcher
adds explicit interpreter identity, minimal `env -i`, clean-checkout and
reviewed-blob checks, then invokes the existing validator with `-I -S -B` and
preserves its existing 15-variable `TOC_REVIEW_*` contract. Authoring never
calls it. Its maximum possible result remains
`ELIGIBLE_FOR_HUMAN_REVIEW`; restore planning receives no execution
authorization, `restore_command_gate` remains `BLOCKED`, and migration
readiness remains `RED`.

`validate-lovable-toc-ledger.py` accepts only a private canonical-ASCII ledger.
The capture assigns each entry `te1_` plus HMAC-SHA-256 under a fresh private
32-byte key over a fixed domain, big-endian ordinal, big-endian raw-line length,
and exact raw entry-line bytes. The validator recomputes every ID; it never
parses an ambiguous object name. IDs are not names, owner/namespace values,
archive OIDs/dump IDs, unsalted hashes, or reversible encodings. Keep the raw
entry, key, index, ledger, and resulting package private.
The ledger must be a direct child of the approved external mode-`0700` output
root and is opened descriptor-relative with no symlink or hardlink acceptance;
the new private tools reject repository-local workspace roots.
Reject duplicate, missing, or extra references; unknown classes; free-form
fields; unreviewed dispositions; count/hash drift; and any raw TOC, name, owner,
OID, SQL, path, or payload text outside the private raw capture. Peer review must bind
the ledger to the private capture without copying the mapping out of the
approved store.
The classification vocabulary is closed: `restore`,
`exclude_supabase_managed`, `exclude_duplicate`, `dependency_only`,
`manual_conflict`, and `unresolved`. A `manual_conflict` must carry one reviewed
terminal disposition; `unresolved` can never pass the planning gate.
Publication classes must be marked in the `publication` managed domain even
while unresolved. Relationship-bearing constraint, policy, security, trigger,
attach, publication-table, default, and sequence-ownership entries must bind
distinct opaque parents that cover the fixed reviewed parent-class groups; an
empty or class-incompatible parent set cannot be self-attested as complete.
Use `parent_entry_ids`, not free-form text, and follow the exact class-group
table in `scripts/migration/README.md`; repeated groups require distinct opaque
IDs. The validator proves only that class structure, so peer review must still
prove that each opaque parent is the correct semantic object. An unresolved
managed publication uses `managed_domain=publication` plus aggregate handling
`manual_conflict` and remains `BLOCKED`.
The validator preserves the aggregate package's exact 214-entry data-reference
definition. It separately treats every `SEQUENCE SET` as a state-bearing entry
that requires an exact `SEQUENCE` metadata parent, without rewriting the bound
aggregate count.
The capture stores the complete fixed-key repository procedure identity and
its digest. The classification result independently stores the validator,
contract, schema, README, and execution-checkout identity plus its digest.

PostgreSQL warns that restoring an archive can execute arbitrary code selected
by a source superuser. Neither a private list capture nor a reviewed opaque
ledger inspects all generated SQL or authorizes execution. It remains `BLOCKED`
while any condition is incomplete and can become only
`ELIGIBLE_FOR_HUMAN_REVIEW` after exact structural coverage.
That state means opaque annotation accounting is complete; automatic
object-reference analysis remains `INCOMPLETE` because the validator never
parses ambiguous names.
`restore_command_gate` stays `BLOCKED`; the ledger is an input to a later
selective plan, not a restore list or command.

The synthetic matrix includes the existing PostgreSQL 17 lane and immutable
official-image pins for PostgreSQL 17.6 and 18.4. A PostgreSQL 18.4 `pg_dump`
reads a disposable 17.6 source; PostgreSQL 18.4 `pg_restore --list` reads that
archive; and the exact synthetic fixture is separately loaded into disposable
17.6 and 18.4 targets. Contract tests cover parser, ledger, publication,
mutation, and nonleakage plants; existing bounded-tool tests cover timeout and
output caps. These fixtures prove local mechanics for those exact synthetic
pairings only. They cannot prove that PostgreSQL 17 reads every PostgreSQL 18
archive, that `pg_restore` consumed every byte, that the retained export uses
the same grammar, or that hosted Supabase accepts the archive.

The high-level capture driver is additionally exercised on Linux and macOS
with synthetic ZIP/PGDMP fixtures, private temporary roots, and fake or
disposable bounded tools. Planted cases cover successful atomic publication
plus normalization, hash,
capture, publication, cleanup, fsync, concurrent mutation, path replacement,
symlink, permission, ownership, collision, disk-capacity, timeout, and
child-output boundaries. Both platforms exercise explicit bounded temporary
parents and cleanup-before-output failures; the Linux PostgreSQL 17 integration
additionally reaches a real synthetic `pg_restore --list` through the guard.
If the outer driver cannot prove cleanup, private quarantine may intentionally
retain raw TOC captures, the derived PGDMP, or normalization metadata. Do not
enumerate, log, or treat those bytes as cleaned; an absent or unprovable
indeterminate marker is still a hard stop requiring manual review of the held
private staging root.
Passing those tests does not prove source
completeness, archive completeness, full PGDMP-byte consumption, restore
compatibility, or target readiness.

The low-level capture records an externally approved executable SHA-256 and
version output and checks path, hash, device, inode, mode, size, and the
observed-equal version before accepting the package. Because the
bounded helper still executes the pathname rather than a held descriptor, it
does not attest the exact executable bytes the kernel used during a
path-swap-and-restore race.
The envelope timeout is only a secondary bound around its checked-in children.
The bounded wrapper owns the nested `pg_restore` process-group kill/reap
contract; the envelope tests do not independently prove cleanup of a detached
nested process if that wrapper contract is bypassed or fails.
The same ceiling applies to the inner archive pathname: its approved bytes are
hashed before and after, but a hostile same-user pathname swap cannot be ruled
out as the bytes opened by `pg_restore`. The approved metadata workflow remains
PostgreSQL-17-only unless a later procedure changes that pin explicitly.

PostgreSQL 18 documents that its `pg_dump` can read older servers, but does not
guarantee that newer-client output will load into an older server even when the
source was that older version. The synthetic 18.4-to-17.6 load is therefore an
exact-fixture result only. See the official
[PostgreSQL 18 `pg_dump` compatibility notes](https://www.postgresql.org/docs/18/app-pgdump.html).

Only the verified inner `PGDMP` is passed to the execution-bound inspector.
Before invoking `pg_restore`, it records the numeric three-byte archive-format
version, integer width, offset width, and custom-format code from the first 11
PGDMP header bytes and binds them to the already verified inner SHA-256. The
inspector otherwise retains its boundary: it validates a local raw custom-format
archive, checks tool compatibility, invokes `pg_restore` only with `--version`
and `--list`, emits metadata only, and fails closed on unknown TOC classes.
Source PostgreSQL and `pg_dump` header values are retained only when the entire
header matches a bounded ASCII numeric-version grammar with the reviewed
`betaN`, `rcN`, or `devel` prerelease suffix. All other candidate text becomes
the fixed `REDACTED_UNSAFE_OR_UNRECOGNIZED` token; candidate count and byte
length are bounded, and candidate values are never included in diagnostics.
An EXTENSION owner token contributes to the owner/role warning count; ownerless
and explicit `-` owner forms do not.
When object-reference analysis is complete and migration-duplicate analysis is
conservative, review every heuristic warning for owners,
ACLs, roles, extensions, subscriptions, event triggers, publications, managed
schemas, `auth`, `storage`, `supabase_*`, and possible duplicates with
checked-in migrations. A conservative result is not proof that no other
duplicate exists. When object-reference analysis is incomplete, the only safe
result is the aggregate blocked package; resolve the parser/evidence gap before
any restore planning.

Exit gate: normalization and archive format/version checks pass; TOC parsing has
no unknown class; the report contains no row data; exactly one report `sha256:`
equals the verified inspected `PGDMP` SHA-256; outer before/after/expected hashes
agree; ZIP mode never compares or records the outer hash as the inner hash;
direct mode explicitly records the canonical-to-verified-copy relationship;
ZIP mode records exact UI/member-name equality; and provenance separately
records the repository-config source binding, structured timeline and statuses, outer
identity/ZIP metadata and actual member metadata when applicable, inner identity
and inspector-reported hash, the pre-`pg_restore` safe header fields bound to
that same inner hash, operator, informational procedure-origin SHA,
externally approved checkout SHA, actual execution-checkout SHA, committed
README blob SHA, fenced-workflow SHA-256, execution-bound inspector Git
blob/file SHA, separately execution-bound report-helper Git blob/file SHA,
historical migration-input baseline SHA, and
report/provenance hashes. The approved and execution SHAs must be identical.
The per-file manifest and detached hash must verify in the durable package, the
disposable local run must be absent, and the externally approved expected outer
identity must remain distinct from workflow-observed measurements. Migration
readiness remains **RED**, inspection remains `REVIEW_REQUIRED`, and
`restore_planning_gate` must be `BLOCKED` whether migration-duplicate analysis
is conservative or incomplete. No downstream validation may treat
`EVIDENCE_COMPLETE`, complete object-reference analysis, conservative duplicate
analysis, or a matching manifest as
restore authorization.

### 7. Decide selective restore plan

Do not classify real entries from the shareable aggregate report. Under a
separately authorized private-capture procedure, first require a complete
high-level envelope-driver package with `ANNOTATION_REQUIRED` and both restore
gates still `BLOCKED`. That package is not an annotation ledger and cannot
advance this phase by itself. In a later separately authorized review, inspect
each raw TOC entry locally and record only its opaque reference plus one of the
six fixed ledger classifications defined above. Resolve whether checked-in
migrations run before restore, after a data-only restore, or not at all.
Explicitly exclude objects owned by the managed platform unless Supabase and
Lovable document them as supported. Treat duplicate schema entries, migration
history, owner/ACL/role statements,
extensions, Auth, Storage metadata, publications, subscriptions, event
triggers, and managed schemas as hard review gates. The private mapping is
needed to implement any eventual plan but must not be copied into repository or
chat evidence.

Do **not** generate a final `pg_restore` command until this classification is
reviewed against the real TOC and Lovable's supported restore instructions.

Exit gate: the private capture and opaque ledger hashes are bound to the same
verified inner archive; ledger arithmetic accounts for every entry exactly
once; the private mapping and every disposition are peer reviewed; and no entry
is unclassified. This gate still does not authorize or generate a restore
command.

### 8. Rehearsal restore

Restore only into the isolated target, using the reviewed selective plan and
target-safe tool version. Capture stdout/stderr and exit status without logging
credentials. A non-zero status, ignored error, unsupported extension, ownership
failure, or duplicate object is a failed rehearsal—not a warning to waive.

Exit gate: restore completed without unreviewed errors and target remains
network/application isolated. Automated negative writes through every available
application credential prove the target's data-plane read-only gate is active.

### 9. Auth verification/reset rehearsal

Compare exact aggregate counts for `auth.users` and `auth.identities` when the
authorized role permits it. Test sign-in, refresh, sign-out, redirect, and reset
flows only with synthetic rehearsal users. Determine which existing identities
remain usable and rehearse the user communication/reset plan. Never assume
password hashes or identities are portable merely because rows exist.

Exit gate: supported identity classes and reset-required classes are known;
recovery messaging and rate limits are rehearsed.

### 10. Storage inventory/copy/checksum

Inventory bucket names, privacy settings, policies, and exact object counts.
Copy files separately using the supported Storage path, preserving object keys,
content type, cache metadata, and access semantics. Use per-object checksums
where the API exposes stable bytes; otherwise record `Not independently
verifiable`. Database rows in `storage` do not prove object bytes were copied.

Exit gate: bucket/object counts and sampled/full checksums match the approved
plan, with every unverifiable item explicit.

### 11. Edge Function deployment from reviewed GitHub source

Build each directory listed in the repository inventory from an exact reviewed
commit. Resolve every missing/implicit `verify_jwt` setting before deployment.
Deploy only under separate authorization; do not copy a Cloud bundle or treat a
runtime-reported SHA as sufficient artifact provenance.

Exit gate: deployed slug, effective JWT setting, source commit, and artifact
digest match the reviewed inventory.

### 12. Secrets/jobs/OAuth/SMTP/webhook recreation

Recreate configuration from a separately verified runtime inventory. Store
secret values only in the approved secret manager; compare names/presence, never
values in reports. Recreate jobs initially disabled, OAuth providers with
non-production callbacks, SMTP with test recipients, and webhooks pointed only
at test endpoints. Realtime publication/configuration is a separate checklist.

Exit gate: no required configuration remains unknown; all background/outbound
paths are disabled or safely sandboxed.

### 13. Non-production smoke testing

Bind only the remixed non-production frontend to the isolated target. Exercise
synthetic Auth, CRUD/RLS, uploads/downloads, Realtime subscriptions, Edge
Functions, jobs (manually where safe), email, OAuth, and outbound integrations.
Compare repository and target manifests with `compare-manifests.py`.

Exit gate: all critical behaviors pass; discrepancies are resolved by reviewed
changes and a repeatable clean rehearsal, never by privileged ad-hoc repair SQL.

### 14. Final quiet-window preparation

Schedule a final export at least 24 hours after the rehearsal export. Freeze
schema/code/config changes. Pre-stage reviewed tools and checklists; record the
last known-good original state and target rollback snapshot. Name go/no-go and
rollback decision owners. Confirm support availability and export link expiry.
The retained rehearsal's missing initiation timestamp cannot be used as proof of
the reported 24-hour spacing, so establish the final window independently and
conservatively. Assign an operator to record final-export initiation before the
export action, plus availability and download completion as separate observed
events. A final export with unobserved initiation is not acceptable cutover
evidence.

Exit gate: change freeze active, backups/restoration evidence current, and the
team can stop every human/background writer; the final-export evidence owner and
timestamp capture procedure are confirmed.

### 15. Stop human and background writes

Place the original application in an explicit maintenance/read-only mode. Stop
human writes, scheduled jobs, queue/retry workers, webhooks, Edge Functions,
OAuth callbacks, integrations, and any external client with write credentials.
Activate a Lovable-supported server-side write fence shared by all of those
paths; a maintenance page alone is insufficient. Attempt a harmless synthetic
write through each enumerated writer and require a rejected result. Drain
in-flight transactions/work using observed job/connection state, and prove no
transaction that began before the fence can commit afterward; do not rely on a
sleep. How Lovable jobs are paused and how this database-level fence/drain is
enforced remain support blockers until confirmed.

Exit gate: two-person evidence shows the server-side fence active, every writer
denied, and no active/in-flight transaction able to commit; freeze start
timestamp is recorded. Abort if any property cannot be positively demonstrated.

### 16. Final export and restore

Keep the source frozen. Record initiation, then generate, download, and checksum
a new final canonical outer artifact; never reuse the rehearsal artifact. Record
availability separately from completion and record download completion. Apply
the same strict ZIP-or-direct normalization, outer/inner hash separation,
atomic-publication rules, and existing-inspector boundary used in the rehearsal.
Repeat TOC inspection and diff it against the rehearsed TOC. Any new/unknown
class or schema change returns to selective-plan review. Restore into a clean or
proven-restorable owned target using the exact rehearsed plan. While the source
fence remains active, perform a final Storage sync from a newly captured source
object inventory: copy new/changed objects, apply reviewed deletion semantics
for objects absent from the final inventory, and compare exact per-bucket counts
plus stable byte checksums where available. The rehearsal Storage copy is not
the final copy.

Exit gate: final initiation, availability, and download completion are observed
and correctly ordered; outer, inner, report, and provenance identities are
separately approved; TOC inspection is approved; restore is error-free; source
remains frozen; final Storage inventory/checksum gates pass; and the target stays
under the enforced data-plane read-only gate.

### 17. Count/digest and behavior verification

Generate source and target manifests with the read-only templates. Compare
schema/object inventory, exact row counts, sequences, RLS,
policies, functions, triggers, extension versions, Auth/Storage counts, Edge
Function settings, and jobs. Any data digest must be a reviewed,
table-specific, deterministic query with explicit projection and primary-key
ordering under separate authorization; the default collector emits no key
values or min/max ranges. `Match` is required for rollback-critical components;
unknowns remain failures unless an accountable owner explicitly removes them
from the cutover scope.

Exit gate: exact comparison report is accepted and archive/target evidence is
retained; no generic hash or estimated row count is treated as proof.

### 18. Read-only cutover validation

Point a restricted test frontend/session at the target while all writes remain
disabled. Verify reads, RLS isolation, file reads, Realtime reads, read-only
function behavior, and outbound suppression. Use a pre-established rehearsal
session only if validation proves it creates no new target state; otherwise
defer live login/reset to phase 20. An Auth session, last-sign-in update, audit
row, telemetry event, or other "incidental" mutation is still a target write and
crosses the lossless-rollback boundary. Keep the public domain on the original
project.

Exit gate: rollback-critical behavior passes from the user-facing path with no
target mutation, including rejected negative writes from each application
credential. The target write gate remains enforced.

### 19. Domain/frontend rebinding

Under separate authorization, update the remixed frontend's Supabase URL and
publishable/anon key and transfer the custom domain using Lovable's confirmed
procedure. Never place service-role/secret keys in the frontend. Retain a tested
route back to the original while the target is still read-only.

Exit gate: DNS/domain/callback paths resolve to the intended remix and target;
the original remains intact and reachable for rollback.

### 20. Enable writes

This is the irreversible rollback boundary absent reverse transfer. Obtain an
explicit go decision only after phases 17–19 pass. Enable application writes
first for a controlled cohort by deliberately releasing the target data-plane
write gate; enable jobs/webhooks/integrations one class at a time. Record the
first target write timestamp. Keep the source fenced to prevent split brain.

Exit gate: controlled writes persist correctly and no split-brain writer exists.

### 21. Post-cutover monitoring

Monitor Auth failures/resets, database errors, RLS denials, function failures,
queues/jobs, Realtime, Storage, outbound integrations, latency, and resource
limits. Re-run exact counts only at defined quiescent comparison points; normal
writes make source/target count equality meaningless after cutover.

Exit gate: observation window completes with accepted error budgets and all
incidents resolved or owned.

### 22. Rollback boundaries

- **Before the first target write:** restore domain/frontend bindings to the
  unchanged original. This can be lossless if the original remained frozen and
  intact.
- **After the first target write:** do not call a return to the original
  lossless. Stop writes and choose between repairing forward, accepting loss, or
  executing a separately designed/rehearsed reverse transfer.
- Never destroy/disconnect the original as part of initial cutover. Archive all
  checksums, TOCs, selective plans, manifests, logs, and decision timestamps in
  the approved evidence store.

Any failed exit gate stops the run. Do not substitute an operator assertion for
missing evidence and do not repair the target with unreviewed ad-hoc SQL.
