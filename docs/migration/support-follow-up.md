# Lovable Support follow-up and empirical blockers

The following questions require written Lovable confirmation before the final
restore plan is approved:

1. What exact `pg_dump` command, flags, and PostgreSQL major version produce the
   Cloud export?
2. Are owner, ACL, and role statements stripped? If so, at dump time or restore
   time?
3. Which schemas are included and excluded, exactly?
4. Should repository migrations run before restore, or must schema entries be
   filtered from the dump to avoid duplicates?
5. What exact `pg_restore` command does Lovable support for managed Supabase?
6. Which `auth.*` tables are included, and are password hashes and identity rows
   usable in an owned Supabase project?
7. How long does an export download link remain valid?
8. Does Remix copy code only, or any Cloud configuration/data as well?
9. Can the remixed project ultimately use this same GitHub repository without a
   permanent code fork?
10. What is the custom-domain transfer and rollback procedure?
11. How can all scheduled/background jobs be enumerated and paused during the
    final export?
12. Does Storage support folder or bucket download/upload despite lacking an
    automated export?

## Facts only an empirical rehearsal can establish

- Actual archive magic, format version, source database version, TOC syntax,
  archive size, download behavior, and local `pg_restore` compatibility.
- Actual included schemas/object classes and whether owner/ACL/role, extension,
  publication, subscription, event-trigger, `auth`, `storage`, `vault`,
  `realtime`, or `supabase_*` entries appear.
- Exact overlap with checked-in migrations and the safe ordering/filtering of
  migrations versus restore.
- Which statements a fresh managed Supabase target accepts without privileged
  repair, and whether a clean retry is repeatable.
- Completeness/usability of Auth users, identities, sessions, factors, and
  password material; required reset behavior and email deliverability.
- Storage object availability, metadata fidelity, and checksum coverage.
- Effective production-only secrets, OAuth/SMTP settings, jobs, webhooks,
  Realtime configuration, Edge Function settings, and external writers.
- Export generation duration, restore duration, freeze/drain duration, final
  verification duration, and whether the planned quiet window is sufficient.
- Domain/callback propagation and the lossless rollback path before target
  writes begin.

Until these are answered, the support-backed path is promising but not proven
for this application. A passing synthetic/local tool test does not unblock the
production migration.
