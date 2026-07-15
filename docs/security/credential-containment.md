# Dynamic-staging schema credential containment

This control is repository-side containment only. It does not rotate, revoke,
deploy, or validate any runtime credential.

The original migration inventories remain bound to static repository inspection
on 2026-07-14 at `a21cd2dd90286633c08b99d83eb8a15cdf68c869`.

## Repository use and containment design

`supabase/dynamic_staging_schema.sql` is a generated drift snapshot outside
`supabase/migrations`. Repository migration tooling, application code, package
scripts, and CI do not execute it. The migration inventories use it only as
evidence of objects and jobs that are absent from chronological migrations.

The current repository snapshot omits the historical executable cron block and
contains no automatically executable schedule placeholder. This describes only
the checked-in snapshot: PR #17 did not disable, remove, change, or inspect any
runtime schedule. Historical repository evidence recorded nine snapshot
schedules in total, one of which was `ops_sentinel_v1`, already represented by
a chronological migration; the other eight were beyond that migration-defined
schedule.

Any future schedule requires separately reviewed endpoints and configuration
and credentials from an approved runtime secret source. Starting a recreated
schedule disabled is an operator policy and is not repository-enforced until an
authorized deployment mechanism implements and verifies that state.

The public PR patch itself disclosed predecessor bytes despite an attempted Git
diff-rendering hint. That ineffective hint has been removed. The PR patch, Git
history, forks, caches, archived patches, and prior clones must all be treated
as persistent exposure surfaces; no repository display control is a
confidentiality boundary.

## Credential classification and response boundary

Prior independent repository verification classified the removed bearer
material as a dynamic-staging anon JWT: publishable client material, not a
service-role credential. The containment scanner neither decodes nor proves
that classification. Publishable does not make the material appropriate to
hardcode in server-side cron SQL; a future schedule must use its reviewed
runtime binding instead.

The staging cron shared secret must be rotated outside this PR in every system
that accepted or stored it. This PR neither reads the runtime secret source nor
performs or verifies rotation.

Removing literals from the current tree does not remove predecessor bytes from
the PR patch, Git history, forks, caches, archived patches, or prior clones.
History rewriting is explicitly out of scope. Rotation is the required
mitigation for the staging cron secret; operators must treat previous exposure
as persistent when completing rotation and incident follow-up.

The sanitized snapshot contains zero current dynamic-staging or production
project-reference/endpoint literals. Any remaining repository references to the
staging identity are historical inventory statements or rejected planning
input, not a current executable binding.

## Recurrence guard

Run:

```sh
python3 scripts/security/scan-tracked-schema-secrets.py
python3 -m unittest discover -s tests/security -p 'test_*.py' -v
```

The scanner enumerates every Git-tracked file with a case-insensitive `.sql`
suffix anywhere in the repository. It also scans Git-tracked files beneath
`supabase/` whose suffix is `.ini`, `.json`, `.toml`, `.yaml`, or `.yml`. The
scope deliberately excludes `.env`, `.cfg`, `.conf`, `.jsonc`, `.properties`,
`.tfvars`, template files, shell scripts, extensionless files, and configuration
outside `supabase/`; those formats require a separately reviewed scanner before
they can be claimed as covered. It checks reviewed lexical forms for
non-placeholder `x-cron-secret` values, JWT-shaped bearer values, unsafe
assignments/defaults for the reviewed runtime-secret setting, qualified
`cron.schedule`, `cron.schedule_in_database`, `cron.alter_job`, and
`cron.unschedule` calls, reviewed search-path-enabled unqualified calls, and
direct `INSERT`, `UPDATE`, or `DELETE` against `cron.job` in the derived
snapshot. It stops on unreadable, non-UTF-8, oversized, missing, symlinked,
replaced, or otherwise malformed scan inputs.

Failure output is canonical JSONL containing only `path` and `finding_type`.
Only the exact reviewed derived-snapshot path is public; every other tracked
filename is replaced with a fixed opaque artifact label. The scanner never
emits matching text, context, line numbers, hashes, sizes, exception details,
or untrusted filenames. This known-pattern accidental-regression guard does not
prove external rotation, history purging, runtime configuration, or the absence
of credentials outside its declared tracked-artifact scope. It is not a SQL or
configuration semantic parser and is not exhaustive against arbitrary escapes,
aliases, dynamic/procedural SQL, computed values, or novel credential and
scheduling forms.

PR #17 did not access or change Lovable, Supabase, dynamic-staging, production,
any external or pre-existing database, secrets, or the retained export.
Repository validation did use ephemeral synthetic PostgreSQL 17 fixtures in CI;
those fixtures are not staging or production evidence.
