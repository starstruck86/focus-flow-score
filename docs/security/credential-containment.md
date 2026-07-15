# Dynamic-staging schema credential containment

This control is repository-side containment only. It does not rotate, revoke,
deploy, or validate any runtime credential.

## Repository use and fail-closed design

`supabase/dynamic_staging_schema.sql` is a generated drift snapshot outside
`supabase/migrations`. Repository migration tooling, application code, package
scripts, and CI do not execute it. The migration inventories use it only as
evidence of objects and jobs that are absent from chronological migrations.

The current tree therefore removes the snapshot's executable cron block in its
entirety. It retains only a comment stating that schedules are disabled and
must be recreated separately during an authorized deployment. Any future
schedule requires reviewed endpoints and configuration, starts disabled, and
obtains credentials from an approved runtime secret source. There is no
functional credential default or automatically executable placeholder.

Because predecessor revisions contain credential-shaped material, the snapshot
is marked `-diff` in `.gitattributes`. That prevents routine textual review from
reproducing removed values; it is not deletion from repository history.

## Credential classification and response boundary

The removed bearer material was an anon JWT: publishable client material, not a
service-role credential. Publishable does not make it appropriate to embed in
server-side cron SQL. It must be supplied through the reviewed runtime binding
appropriate to the eventual schedule design.

The staging cron shared secret must be rotated outside this PR in every system
that accepted or stored it. This PR neither reads the runtime secret source nor
performs or verifies rotation.

Removing literals from the current tree does not remove them from Git history,
forks, caches, archived patches, or prior clones. History rewriting is
explicitly out of scope. Operators must treat previous exposure as persistent
when completing rotation and incident follow-up.

## Recurrence guard

Run:

```sh
python3 scripts/security/scan-tracked-schema-secrets.py
python3 -m unittest discover -s tests/security -p 'test_*.py' -v
```

The scanner enumerates tracked SQL plus Supabase server-configuration formats.
It detects non-placeholder `x-cron-secret` values, JWT-shaped bearer values,
unsafe assignments/defaults for the reviewed runtime-secret setting, and
executable schedules reintroduced into the derived snapshot. It fails closed
on unreadable or malformed scan inputs.

Failure output is canonical JSONL containing only `path` and `finding_type`.
It never emits matching text, context, line numbers, hashes, sizes, or exception
details. This lexical repository scan does not prove external rotation, history
purging, runtime configuration, or the absence of credentials outside its
declared tracked-artifact scope.
