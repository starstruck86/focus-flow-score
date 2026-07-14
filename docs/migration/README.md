# Lovable Cloud to owned Supabase migration rehearsal

Lovable Support has reported a supported point-in-time export path. That path
supersedes the custom snapshot/CDC bridge described in `.lovable/plan.md`.
Bridge specifications remain historical design input only; this branch does not
implement or deploy a bridge.

This directory contains repository-derived planning evidence only:

- `repository-inventory.md` — what the repository can and cannot establish.
- `sql-migrations.sha256` — chronological checksum ledger for every checked-in
  SQL migration.
- `migration-runbook.md` — rehearsal, quiet-window cutover, verification, and
  rollback gates.
- `support-follow-up.md` — facts that still require Lovable confirmation or an
  empirical rehearsal.
- `../../scripts/migration/` — local-only dump inspection, inventory,
  verification templates, and strict manifest comparison.

No Lovable export was generated or downloaded, no Supabase project was created
or queried, no restore was attempted, and no secret or production data was read
while producing these files.
