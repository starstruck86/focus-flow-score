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

**Migration readiness remains RED.** An authorized rehearsal export is retained
offline in an approved evidence store. PR #15 is merged at main
`8b872882787859b87549e7f884832c624e29ead9`. A separately authorized
metadata-only attempt failed closed at
`report_helper_failed/unresolved_known_toc_entry`; it produced no evidence
package and performed no restore. No identifying artifact metadata is committed
here. This correction and its tests use synthetic fixtures only and do not
access, inspect, list, copy, hash, rename, or extract the retained export. They
also do not access Lovable, Supabase, secrets, production, or any remote or
pre-existing database. CI keeps the required PostgreSQL checks confined to
isolated synthetic PG17 fixture databases.

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

The retained rehearsal's initiation time was not observed. Provenance must keep
that event explicitly null with `basis: not_observed` and a required reason,
record availability separately from completion, and remain
`export_timeline_status: INCOMPLETE` with
`inspection_status: REVIEW_REQUIRED`. That missing evidence is irreparable for
this rehearsal, but it does not require another export or prevent safe offline
metadata inspection after an exact execution checkout is separately reviewed
and approved. Every future rehearsal and final export must record initiation
before the export action.

No restore, deployment, migration, export, or data movement is performed by the
repository workflow. The canonical outer artifact and any verified inner
`PGDMP` are distinct evidence with distinct hashes; neither may be committed to
the repository.

Inspection execution records the resolved Python executable, version, and
SHA-256, invokes child Python in isolated mode, and removes inherited shell and
Python startup hooks. The raw inspector cleans its private workspace before an
atomic no-replace report publication, so cleanup failure cannot leave a normal
report behind.
