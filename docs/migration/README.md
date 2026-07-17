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
  the execution-bound raw-`PGDMP` inspector, inventory, verification templates,
  and strict manifest comparison.

**Migration readiness remains RED.** PR #16 is the current merged aggregate
inspection contract at main
`1b13483be43b3d5f28a7086606b8a921a6879f18`. PR #19 later merged through the
history-preserving main commit
`30d5a46c30a851d89957fcfba0cc0a5a53df24d2`; its repository-only cron-receipt
work did not deploy or change any runtime and does not change migration
readiness.

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
resolve the 1,135 recognized-but-unresolved entries. A future, separately
authorized offline layer may use `capture-lovable-toc.py` to retain raw list
output only in the approved private evidence store, and
`validate-lovable-toc-ledger.py` to validate a private opaque disposition
ledger. Per-entry IDs are keyed HMACs over exact raw entry bytes and framing,
not automatically parsed names or unsalted hashes. The raw capture, private
key/index/ledger, and object identities must not enter Git, CI, chat, or
ordinary logs; only fixed diagnostics, categories, hashes, and aggregate
arithmetic may leave the private evidence store. The gate can become only
`ELIGIBLE_FOR_HUMAN_REVIEW` after exact structural coverage;
`restore_command_gate` and migration readiness remain `BLOCKED`/`RED`.

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
