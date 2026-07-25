# Lovable Cloud to owned Supabase migration rehearsal

Lovable Support has reported a supported point-in-time export path. That path
supersedes the custom snapshot/CDC bridge described in `.lovable/plan.md`.
Bridge specifications remain historical design input only; this branch does not
implement or deploy a bridge.

This directory contains repository-derived planning and synthetic validation
evidence only:

- `repository-inventory.md` — what the repository can and cannot establish.
- `sql-migrations.sha256` — chronological checksum ledger for every checked-in
  SQL migration.
- `migration-runbook.md` — rehearsal, quiet-window cutover, verification, and
  rollback gates.
- `support-follow-up.md` — facts that still require Lovable confirmation or an
  empirical rehearsal.
- `../../scripts/migration/` — strict local ZIP-envelope normalization ahead of
  the execution-bound raw-`PGDMP` inspector, reviewed high-level private TOC
  capture, private annotation authoring/checkpointing, inventory, verification
  templates, and strict manifest comparison.

The metadata-only provenance re-attestation entrypoint is
`../../scripts/migration/run-lovable-toc-capture-metadata-reattestation.sh`.
Under a separate one-attempt authorization it may open only the capture
manifest, `capture.json`, and the completion marker. It never opens or hashes
the raw TOC, opaque index, or opaque key. Its opaque-index result is a recorded
candidate, not a content attestation or approval; the capture procedure must
also match its separately approved candidate. Even a pass leaves annotation
initialization unrun and every validation/restore/migration gate blocked.

**Migration readiness remains RED.** PR #16 is the current merged aggregate
inspection contract at main
`1b13483be43b3d5f28a7086606b8a921a6879f18`. PR #19 later merged through the
history-preserving main commit
`30d5a46c30a851d89957fcfba0cc0a5a53df24d2`; its repository-only cron-receipt
work did not deploy or change any runtime and does not change migration
readiness. PR #20 then merged through history-preserving main commit
`9ae5f98e44739c6a7a645e41527e6fa016d6fc63`; its private classification and
synthetic PostgreSQL compatibility contracts likewise did not authorize or
perform a restore. PR #21 subsequently merged the isolated high-level capture
launcher at main `6bdcb83e4006d04e8a8e6c54d1b6c243ec48adb1`. PR #22 then merged the
descriptor-bound bounded-output cleanup correction at main
`c78a0e09373235fe38d045c2bfa7a0fd8a32d364`. Those merges authorize neither a
capture nor annotation, and all downstream gates remain blocked.

An authorized rehearsal export remains offline in an approved evidence store.
After the earlier fail-closed parser result, a separately authorized inspection
under PR #16 produced an operator-reported complete durable metadata package
with `inspection_status=REVIEW_REQUIRED` and
`restore_planning_gate=BLOCKED`; it performed no restore. The sanitized result
records 2,354 TOC entries: 2,140 metadata entries, 214 data references, and
1,135 recognized-but-unresolved entries. It reports source PostgreSQL 17.6,
writer `pg_dump` 18.4, and inspecting `pg_restore` 17.10. This
repository-documentation work did not access that package or the retained
export and does not independently re-establish those observations. No artifact
path, filename, size, digest, or timestamp belongs here.

PostgreSQL's editable `pg_restore --list` output does not define lossless
quoting for its whitespace-separated namespace, tag, and owner fields. A
recognized entry whose object identity cannot be conservatively parsed now
retains only aggregate metadata with object-reference and migration-duplicate
analysis `INCOMPLETE` and `restore_planning_gate: BLOCKED`; unknown classes and
structurally malformed or conflicting TOCs remain fatal. Evidence-package
completion never means restore planning or migration readiness is complete.

Object-reference and repository-migration duplicate analysis have independent
gates. The repository scan is only `CONSERVATIVE` when object references are
resolved: it may identify reviewed possible duplicates, but cannot prove their
absence across PostgreSQL aliases, pre-name modifiers, object-kind ambiguity,
or dynamic SQL. It is `INCOMPLETE` when object references are unresolved, and
it never emits `COMPLETE`; that status is reserved for catalog-backed or
genuinely executed/parsed schema comparison. Restore planning remains blocked.
Pending and durable evidence JSON is validated with recursive duplicate-key
rejection, exact fixed-object schemas, typed scalar leaves, and identity
cross-bindings. A frozen runtime binding created before evidence construction
carries the live canonical descriptor and checkout/tool/config/Python/source/
timeline/inner/report/analysis identities through pending, staged, pre-rename,
and post-rename validation, so a coherent fully rehashed substitution cannot
publish merely by agreeing with itself.
Source and
`pg_dump` version headers use a bounded allowlist and fixed redaction for every
unrecognized value, and EXTENSION owner tokens participate in owner/role
warnings without changing the ownerless form.

The retained rehearsal's initiation time was not observed. Provenance keeps
that event explicitly null with `basis: not_observed` and a required reason,
records availability separately from completion, and remains
`export_timeline_status: INCOMPLETE` with
`inspection_status: REVIEW_REQUIRED`. That missing evidence is irreparable for
this rehearsal. It did not prevent the completed offline aggregate inspection,
but it remains part of that package's verification ceiling. Every future
rehearsal and final export must record initiation before the export action.

No retained-export, target, or runtime restore, deployment, migration, export,
or data movement is performed by this repository workflow. CI does create,
dump, list, and restore small disposable synthetic PostgreSQL fixtures. The
canonical outer artifact and any verified inner `PGDMP` are distinct evidence
with distinct hashes; neither may be committed to the repository.

Inspection execution records the resolved Python executable, version, and
SHA-256, invokes child Python in isolated mode, and removes inherited shell and
Python startup hooks. The raw inspector cleans its private workspace before an
atomic no-replace report publication, so cleanup failure cannot leave a normal
report behind.

The aggregate report intentionally does not disclose enough object identity to
resolve the 1,135 recognized-but-unresolved entries. The reviewed entrypoint
for any future, separately authorized offline raw-TOC capture is
`run-lovable-toc-capture.sh`; its Python envelope and low-level capture files
are internal components, not supported direct operator entrypoints. The
launcher validates the approved interpreter and invokes the envelope only with
`-I -S -B` under a minimal environment. The envelope validates the completed
aggregate evidence package and every approved identity, uses the existing
strict ZIP normalizer to create one temporary verified inner archive, and
passes it only through a held private-directory descriptor to the existing
low-level capture. It publishes one
private no-replace opaque key/index capture package, removes and fsyncs all
derived inner and staging bytes, and emits only fixed diagnostics. Success
still stops at `REVIEW_REQUIRED` / `ANNOTATION_REQUIRED`, with both restore
gates `BLOCKED`. The low-level capture is not an operator procedure, and this
step never creates or validates an annotation ledger.

The practical local path uses the separate zero-argument operator-session
launcher. A committed canonical execution profile defines public policy but
cannot approve itself; exactly one separately reviewed and no-replace installed
owner-private procedural approval artifact binds the current checkout, profile,
reviewed blobs, procedures, deterministic Python, repository, operator-session
root, authorizer, and review reference. The launcher never creates, installs,
repairs, or replaces that artifact. It deterministically requires the unique
exact-current-checkout candidate; zero or multiple matches fail closed. This is
not cryptographic authentication or an OS/privileged immutability boundary.
The approval parent remains owner-writable, so malicious same-UID replacement
of repository code or approval evidence before launch is an accepted local
trust ceiling. Descriptor-stable verification detects replacement at its
bootstrap and repository-binding checkpoints; it is not continuous monitoring,
and a same-UID swap-and-restore entirely between those checkpoints remains
within that accepted ceiling.
Normal execution and `VERIFY_ONLY` share one semantic pre-private verifier.
They automatically verify the public machine facts that the operator previously
typed; that same verifier also performs the bounded known-recorder ancestor
scan before consequence authorization. `VERIFY_ONLY` exits without any
private-root operation.

For an action, the operator chooses only the human action/operator/state claims
that remain necessary and types one fresh consequence-specific
`AUTHORIZE <ACTION> <MAX> <XXXX-XXXX>` phrase. Before that succeeds there is no
operator-session/capture/annotation stat, open, list, lock, read, or write.
Afterward the wrapper privately loads the unique current resume and immutable
root authorization, derives capture/head/release bindings, publishes one
action-authorization-v2 record, requires the fixed
`action_authorization_recorded` acknowledgement, performs at most one action,
publishes at most one successor, requires `resume_values_recorded`, and retires
the predecessor only after durable successor publication. No action digest or
resume tuple is transcribed. A TTY write, EOF, wrong acknowledgement, terminal
attribute/read failure, private record-publication ambiguity, or predecessor-
retirement ambiguity remains blocked by the lock and/or indeterminate state.

Initialization retains root authorization v1, resume v2, checkpoint v1, and its
historical private root-digest acknowledgement. The one exact compatibility
bridge accepts only the existing old-bound generation-1
`PRIMARY_REVIEW_REQUIRED` state for `primary_review`; it preserves those bytes,
publishes one current-bound generation-2 checkpoint/resume, then closes
permanently. Every later action walks the complete retained resume/action
history back to predecessor-free generation 1, requires exactly one historical-
to-current transition, and rejects altered/missing/orphaned links, cycles,
generation skips, mixed execution identities, and mixed or duplicate active
resume namespaces. A coherent newest link cannot conceal broken older evidence.
It cross-binds each resume to the exact checkpoint generation/hash and each
action to the predecessor state plus successor event/operator/session.
`status` alone preserves a generation/checkpoint; other retained nonterminal
actions advance one generation. Canonical release tokens must be unique, and
the descriptor-stable history/checkpoint observations are revalidated before
successor or terminal publication so mutation becomes a blocking/indeterminate
result.
It is not a generic compatibility path. The session and annotation roots, and
their direct parents, remain approved owner-private mode-`0700` directories
outside Git. Piping, clipboard transfer, shell-history retention, chat
retention, and terminal recording remain prohibited. The wrapper rejects known
startup-loader, remote, multiplexer, IDE, and recorder markers, including the
Apple-Terminal SSH marker before the minimal child environment is created, and
the isolated component revalidates the stable foreground controlling TTY.

The lower-level zero-argument `run-lovable-toc-annotation-authoring.sh`
launcher remains available only behind a reviewed private injection mechanism;
the operator-session wrapper is the reviewed practical mechanism.
Private raw TOC context remains confined to the bounded local alternate-screen
view; stdout/stderr stay fixed and aggregate. The launcher rejects inherited
output pipes/redirection, replaces a detached inherited stdin with the
process's controlling `/dev/tty` (discarding an input pipe or `/dev/null`), and
then requires stdin, stdout, stderr, and the held private descriptor to verify
as the same stable local foreground terminal. A process without that
controlling terminal remains rejected before private access. Known recorder,
remote, and multiplexer contexts are also rejected. Clearing the alternate
screen does not attest the absence of an unknown recorder, screen capture,
photography, a hostile terminal, or a hostile same-user process.

Authoring never opens `opaque-id.key` bytes: it only validates the key file's
safe metadata. It uses the already private raw TOC and opaque structural index,
plus the fixed capture/evidence manifests and completion marker needed to bind
that content, records primary decisions and distinct peer review in an
immutable full-hash checkpoint chain, and stops on stale locks, forks, missing
generations, mutation, collisions, or indeterminate filesystem state.
Exact resume also requires the private release token displayed and acknowledged
with its exact generation and checkpoint SHA before the preceding durable lock
release. Primary and peer private displays preserve the exact `dependency`,
`structural_parent`, `metadata_parent`, and applicable sequence-role mappings;
multi-role references are repeated per role, and the decision hash binds those
keyed assignments rather than a count or union. Peer review acknowledges its
primary-decision summary before the first screen clear, then pauses after each
role-labeled context. Multi-parent sequence review also pauses after each
parent before another screen clear can replace it.
Before final-candidate publication, `correction_review` is available from both
`FINALIZATION_REVIEW_REQUIRED` and `FINALIZATION_ELIGIBLE`. Relationship
correction re-prompts only the exact `dependency` and applicable
`structural_parent` roles, recomputes their canonical decision hash, and resets
the affected peer approval. A changed `SEQUENCE OWNED BY` structural-parent
list invalidates the prior sequence confirmation and requires fresh
`sequence_structural_parent` context, acknowledgement, and peer approval.
Clearing a required structural parent returns relationship review to `pending`
so reselection uses the ordinary role-labeled phase rather than bypassing order.
`SEQUENCE SET` correction remains confined to `sequence_metadata_parent`, and
data-reference correction remains confined to `metadata_parent`; unrelated
fields cannot change. Final-package publication remains no-replace and terminal.
The scoped primary-classification correction may clear an existing
manual-conflict disposition only to null. It must leave classification reviewed
and either require a fresh `manual_conflict_review` or mark that phase not
applicable, depending on the new class. Old/substituted final dispositions and
stale reviewed state are rejected; the decision hash changes and peer approval
must be repeated. Any descriptor-close or cleanup ambiguity, including during
aggregate-only `status`, overrides the nominal result with the fixed failure and
leaves blocking private state rather than a normal release.
Mechanical proposals are never approvals. Finalization is a distinct
authorized action and publishes one canonical private ledger package without
replacement only after every entry, data reference, dependency, sequence,
managed/global decision, and manual conflict has primary and peer review. It
does not invoke the validator and the created ledger remains
`REVIEW_REQUIRED`.

A later, separately authorized review may use only
`run-lovable-toc-ledger-validation.sh` to invoke the existing private opaque
ledger validator under the same isolated interpreter and checkout boundary.
Per-entry IDs are keyed HMACs over exact raw entry bytes and framing, not
automatically parsed names or unsalted hashes. The raw capture, private
key/index/checkpoints/ledger, and object identities must not enter Git, CI,
chat, or ordinary logs; only fixed diagnostics, categories, hashes, and
aggregate arithmetic may leave the private evidence store. Validation can
become only `ELIGIBLE_FOR_HUMAN_REVIEW` after exact structural coverage;
`restore_planning_gate` gains no restore authorization, `restore_command_gate`
remains `BLOCKED`, and migration readiness remains `RED`.

PostgreSQL documents `pg_restore --list` as an editable TOC listing and warns
that restoring a dump can execute arbitrary code chosen by source
superusers. The digest-pinned cross-major lane establishes dump/list/restore
behavior only for its generated fixture; separate fake-child tests establish
the private capture/ledger lifecycle. Neither establishes retained-archive
compatibility, complete byte consumption, target acceptance, or dump safety.
See the official PostgreSQL
[17](https://www.postgresql.org/docs/17/app-pgrestore.html) and
[18](https://www.postgresql.org/docs/18/app-pgrestore.html) `pg_restore`
documentation. Supabase's own CLI dump defaults and project-copy boundaries
are target-planning guidance, not evidence of Lovable's export flags; see the
[CLI dump reference](https://supabase.com/docs/reference/cli/supabase-db-dump)
and [restore-to-new-project guide](https://supabase.com/docs/guides/platform/clone-project).
