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
offline in an approved evidence store. Merged ZIP support removed the wrapper
mismatch, but a separately authorized metadata-only attempt failed closed
without stable raw-inspector stage attribution. No identifying artifact
metadata is committed here. The diagnostic hardening work and tests use
synthetic fixtures only and do not access, inspect, list, copy, hash, rename, or
extract the retained export. They also do not access Lovable, Supabase, secrets,
production, or any remote or pre-existing database. CI keeps the required
PostgreSQL checks confined to isolated synthetic PG17 fixture databases.

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
