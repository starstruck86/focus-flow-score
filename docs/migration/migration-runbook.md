# Lovable Cloud export migration runbook

## Status and evidence boundary

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

The following are **support-reported and not yet empirically proven**:

- Export is a point-in-time `pg_dump` custom-format archive, with a 5 GB maximum
  and one generated export per 24 hours.
- Auth data is partial/best-effort and password resets may be required.
- Storage objects require separate manual download/upload.
- No supported CDC/delta feed exists.
- Edge Functions and configuration must be recreated.
- Secret names, scheduled jobs, Realtime settings, OAuth, SMTP, and webhook
  inventories are not exported.
- The supported topology uses a remixed Lovable project while the original is
  retained.

Do not infer a restore command from those claims. A `PGDMP` magic header alone
does not establish which schemas, owners, privileges, roles, extensions, or
managed objects are present. The actual archive table of contents (TOC), source
PostgreSQL major version, local `pg_restore` version, and target constraints must
be inspected first. Supabase's current generic Postgres migration guidance also
recommends stripping owners/privileges and separately handling roles and RLS,
which is why a wholesale restore is not presumed safe:
<https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres>.

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
Supabase operator, application verifier, and rollback decision owner. Record
timestamps in UTC, the evidence-procedure origin SHA, inspection-tool/baseline
SHA, exact execution-checkout SHA, archive checksum, TOC/report checksum, target
project identity, function artifact SHAs, and pass/fail notes.
The canonical archive and completed export-inspection evidence package,
including its provenance manifest, must live in an approved encrypted evidence
store. The ignored
`local-migration-artifacts/` directory is only a private working area and must
never be the sole retained copy because git-clean operations can delete ignored
files. Never commit exports, metadata reports, credentials, user lists, or
object names learned only from production.

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

Use Cloud → Overview → Advanced settings → Export data only after recording the
start time and the exact source project. Do not assume export completion means a
usable dump. The rehearsal export consumes the reported 24-hour generation
slot.

Exit gate: UI reports success, download is available, and no final-cutover
window depends on another export within 24 hours.

### 5. Download and checksum export

Preserve the untouched download in the approved encrypted evidence store, then
make a restricted working copy under `local-migration-artifacts/`. Do not rename
away the original extension until format inspection. Immediately record file
size and SHA-256; checksum again after any copy and verify the working copy
against the canonical archive. Never upload the archive to GitHub, chat, CI, or
an unapproved file store.

Exit gate: the canonical and working-copy checksums agree, the external
pre-inspection digest-only checksum file is retained, and the file is non-empty
and within the support-reported limit.

### 6. Inspect dump table of contents

Execute the complete, checked-in evidence-package template under **Inspect a
future Lovable export** in `scripts/migration/README.md`. Do not substitute the
inspector's stdout-only form: the template retains the report, external
before/after checksums, report checksum, and provenance manifest.

The inspector is read-only: it validates local paths and custom format, checks
tool compatibility, invokes `pg_restore --list`, emits metadata only, and fails
closed on unknown TOC classes. Review every warning for owners, ACLs, roles,
extensions, subscriptions, event triggers, publications, managed schemas,
`auth`, `storage`, `supabase_*`, and duplicates with checked-in migrations.

Exit gate: archive format/version is supported; TOC parsing has no unknown
class; report contains no row data; exactly one report `sha256:` value equals
both external before/after archive checksums; and the provenance manifest records
the exact source project name/ref, observed UTC export/download times separately
from Support-reported claims, original filename/size/archive SHA-256, operator,
procedure-origin Git SHA, inspection-tool/baseline Git SHA, execution-checkout
SHA, and report filename/SHA-256. Copy the completed package to the approved
encrypted evidence store and verify it there before continuing.

### 7. Decide selective restore plan

Classify each TOC entry as include, exclude, recreate from reviewed migrations,
or requires vendor confirmation. Resolve whether checked-in migrations run
before restore, after a data-only restore, or not at all. Explicitly exclude
objects owned by the managed platform unless Supabase and Lovable document them
as supported. Treat duplicate schema entries, migration history, owner/ACL/role
statements, extensions, Auth, Storage metadata, publications, subscriptions,
event triggers, and managed schemas as hard review gates.

Do **not** generate a final `pg_restore` command until this classification is
reviewed against the real TOC and Lovable's supported restore instructions.

Exit gate: a per-TOC selective plan is peer reviewed, reproducible, and has no
unclassified entry.

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

Exit gate: change freeze active, backups/restoration evidence current, and the
team can stop every human/background writer.

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

Keep the source frozen. Generate/download/checksum a new final export; never
reuse the rehearsal archive. Repeat TOC inspection and diff it against the
rehearsed TOC. Any new/unknown class or schema change returns to selective-plan
review. Restore into a clean or proven-restorable owned target using the exact
rehearsed plan. While the source fence remains active, perform a final Storage
sync from a newly captured source object inventory: copy new/changed objects,
apply reviewed deletion semantics for objects absent from the final inventory,
and compare exact per-bucket counts plus stable byte checksums where available.
The rehearsal Storage copy is not the final copy.

Exit gate: final checksum and TOC are approved; restore is error-free; source
remains frozen; final Storage inventory/checksum gates pass; target stays under
the enforced data-plane read-only gate.

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
