# Cron-secret rotation design

This is a design and template only. It does not authorize a secret change, a
deployment, a cron mutation, a database write, or an Edge Function invocation.
Secret values must never be placed in Git, chat, command-line arguments, logs,
test fixtures, or evidence files.

## Separate incidents and actors

| Environment | Incident | Rotation actor | Current discovery ceiling |
| --- | --- | --- | --- |
| `dynamic-staging` | Its cron credential is persistently exposed through public repository history and patches. | Corey, using the user-owned Supabase Dashboard or CLI under a separate mutation authorization. | The connector can read project metadata. `pg_cron`, `pg_net`, and `supabase_vault` are installed; the metadata-only cron inventory returned zero jobs. Secret-management writes were not tested. |
| Production `odbjjklumdsuqdvkgwyv` | Its independent cron credential entered a Claude session through insufficient query redaction. | Corey plus Lovable Support/admin through Lovable's secure management surface. | The Supabase connector returned permission denied for harmless project metadata, so no production project, function, extension, cron, Vault, or secret state was inspected. |

Never transfer a credential, Vault entry, caller configuration, or evidence
between these environments. Never compare or assume equality between the two
incident credentials.

## Repository consumers and producers

| Path | Category |
| --- | --- |
| `supabase/functions/daily-digest/index.ts` | Custom cron-header consumer plus a separate user-JWT path. |
| `supabase/functions/run-strategy-task-reaper/index.ts` | Cron-only custom-header consumer. |
| `supabase/functions/schedule-daily-plan/index.ts` | Cron-only custom-header consumer; its downstream call uses separate service-role authorization. |
| `supabase/functions/_shared/cronSecretAuth.ts` | Shared current/next receiver-side verifier. |
| `supabase/migrations/20260711134232_44bcd1c9-fc73-4dbc-b6a0-c28705a3a756.sql` | Database-only sentinel scheduler; it does not call an Edge Function or use the cron header. |

No current tracked runtime producer sends the custom cron header, and no
repository file provisions either receiver-side secret. Other scheduled or
secret-authenticated functions use different contracts and are not rotated by
this procedure.

## Receiver contract

The three listed consumers independently accept a nonempty `CRON_SECRET` or
`CRON_SECRET_NEXT`. They fail closed when neither configured value matches.
Comparison uses fixed-length SHA-256 digests and the Deno/Node
`timingSafeEqual` primitive rather than JavaScript string equality, and both
configured slots are evaluated. This narrows the equality operation's timing
surface; it is not a claim that the entire request handler has constant runtime.
An authenticated `HEAD`
request returns `204` without running application work; an unaccepted key
returns `401`. Every probe response must include `Cache-Control: no-store` so a
gateway, browser, or intermediary cannot turn one credential check into cached
evidence for another.

## Caller branch: choose exactly one

Receiver rotation and caller rotation are separate operations. Before any
mutation authorization, the named environment owner must select and evidence
exactly one caller branch:

1. **Confirmed no caller/job.** Sanitized database inventory shows no matching
   job, and owners of every other possible scheduler or integration confirm
   there is no external caller. Rotate the receiver credential through the
   function-secret surface. Do not install pg_cron, Vault objects, a wrapper,
   or a schedule merely to exercise or rotate an otherwise unused receiver.
   The metadata-only staging observation of zero cron jobs selects neither this
   branch nor an external-caller branch by itself; it must be combined with the
   external-caller inventory.
2. **Verified pg_cron + Vault caller.** Installed extension interfaces,
   privileges, job identity, wrapper identity, secure Vault update mechanism,
   and pg_net response retention have been rehearsed. Only this branch may use
   the SQL template below, and only under a later database-mutation
   authorization.
3. **Other external caller.** The caller owner rotates its own protected secret
   store and dispatch configuration out of band. Do not install the database
   scheduler as a substitute. Require the same acceptance/rejection probes,
   request correlation, transport evidence, deterministic application effect,
   rollback, and old-key retirement from that caller.

If the caller branch is unknown or mixed, stop. In particular,
`dynamic-staging` currently has zero discovered cron jobs; it must not gain a
scheduler as a side effect of credential containment.

## Secret-free sender template

The following is deliberately non-executable until every `__REQUIRED_*__`
marker is reviewed and replaced. The replacement credential itself is never a
substitution. Store it separately in Vault, then substitute only its stable
non-secret Vault name. The project origin is pinned as reviewed non-secret
code; it is not loaded from mutable Vault data. `cron.job.command` contains
only the fixed wrapper call. Every object creation intentionally fails if an
object already exists so a prior owner, shape, or ACL cannot be silently reused.

```sql
begin isolation level serializable;

do $installer_guard$
begin
  if session_user <> '__REQUIRED_INSTALLER_ROLE__'
     or current_user <> '__REQUIRED_INSTALLER_ROLE__' then
    raise exception 'unexpected installer role';
  end if;
end;
$installer_guard$;

lock table cron.job in share row exclusive mode;

set local role __REQUIRED_DEFINER_OWNER__;

do $definer_guard$
begin
  if current_user <> '__REQUIRED_DEFINER_OWNER__' then
    raise exception 'unexpected definer owner';
  end if;
end;
$definer_guard$;

create schema __REQUIRED_PRIVATE_SCHEMA__;
revoke all on schema __REQUIRED_PRIVATE_SCHEMA__ from public;
grant usage on schema __REQUIRED_PRIVATE_SCHEMA__
  to __REQUIRED_CRON_JOB_ROLE__;

create table __REQUIRED_PRIVATE_SCHEMA__.cron_http_attempt (
  attempt_id uuid primary key,
  job_name text not null,
  request_id bigint not null unique,
  requested_at timestamptz not null default pg_catalog.clock_timestamp()
);

revoke all on __REQUIRED_PRIVATE_SCHEMA__.cron_http_attempt
  from public, anon, authenticated;

create function __REQUIRED_PRIVATE_SCHEMA__.invoke_reviewed_cron_job()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt_id uuid := pg_catalog.gen_random_uuid();
  v_project_origin constant text := 'https://__REQUIRED_PROJECT_REF__.supabase.co';
  v_verify_jwt constant boolean := __REQUIRED_VERIFY_JWT_TRUE_OR_FALSE__;
  v_independent_authorization_required constant boolean :=
    __REQUIRED_INDEPENDENT_AUTHORIZATION_TRUE_OR_FALSE__;
  v_api_key text;
  v_gateway_jwt text;
  v_cron_secret text;
  v_headers jsonb;
  v_request_id bigint;
begin
  select decrypted_secret into strict v_api_key
  from vault.decrypted_secrets
  where name = '__REQUIRED_API_KEY_VAULT_NAME__';

  select decrypted_secret into strict v_cron_secret
  from vault.decrypted_secrets
  where name = '__REQUIRED_CRON_SECRET_VAULT_NAME__';

  if v_api_key is null or v_api_key = ''
     or v_cron_secret is null or v_cron_secret = '' then
    raise exception 'required cron dispatch configuration is unavailable';
  end if;

  v_headers := pg_catalog.jsonb_build_object(
    'content-type', 'application/json',
    'apikey', v_api_key,
    'x-cron-secret', v_cron_secret
  );

  if v_verify_jwt or v_independent_authorization_required then
    select decrypted_secret into strict v_gateway_jwt
    from vault.decrypted_secrets
    where name = '__REQUIRED_GATEWAY_JWT_VAULT_NAME__';

    if v_gateway_jwt is null or v_gateway_jwt = ''
       or v_gateway_jwt = v_api_key then
      raise exception 'required gateway JWT is unavailable';
    end if;

    v_headers := v_headers || pg_catalog.jsonb_build_object(
      'authorization', 'Bearer ' || v_gateway_jwt
    );
  end if;

  select net.http_post(
    url := v_project_origin || '/functions/v1/__REQUIRED_FUNCTION_SLUG__',
    headers := v_headers,
    body := pg_catalog.jsonb_build_object('cron_attempt_id', v_attempt_id),
    timeout_milliseconds := 10000
  ) into strict v_request_id;

  if v_request_id is null then
    raise exception 'pg_net did not return a request identifier';
  end if;

  insert into __REQUIRED_PRIVATE_SCHEMA__.cron_http_attempt (
    attempt_id, job_name, request_id
  ) values (
    v_attempt_id, '__REQUIRED_JOB_NAME__', v_request_id
  );

  return v_attempt_id;
end;
$function$;

revoke all on function
  __REQUIRED_PRIVATE_SCHEMA__.invoke_reviewed_cron_job()
  from public, anon, authenticated;
grant execute on function
  __REQUIRED_PRIVATE_SCHEMA__.invoke_reviewed_cron_job()
  to __REQUIRED_CRON_JOB_ROLE__;

set local role __REQUIRED_CRON_JOB_ROLE__;

do $schedule$
declare
  v_job_id bigint;
  v_existing_jobs integer;
  v_exact_matches integer;
begin
  if current_user <> '__REQUIRED_CRON_JOB_ROLE__' then
    raise exception 'unexpected cron job owner';
  end if;

  select pg_catalog.count(*) into strict v_existing_jobs
  from cron.job
  where jobname = '__REQUIRED_JOB_NAME__';

  if v_existing_jobs <> 0 then
    raise exception 'reviewed cron job name already exists';
  end if;

  v_job_id := cron.schedule(
    '__REQUIRED_JOB_NAME__',
    '__REQUIRED_SCHEDULE__',
    'select __REQUIRED_PRIVATE_SCHEMA__.invoke_reviewed_cron_job();'
  );
  perform cron.alter_job(v_job_id, active := false);

  select pg_catalog.count(*) into strict v_exact_matches
  from cron.job
  where jobid = v_job_id
    and jobname = '__REQUIRED_JOB_NAME__'
    and active = false
    and username = current_user
    and database = pg_catalog.current_database()
    and command = 'select __REQUIRED_PRIVATE_SCHEMA__.invoke_reviewed_cron_job();';

  if v_exact_matches <> 1 then
    raise exception 'scheduled job identity was not bound exactly';
  end if;
end;
$schedule$;

commit;
```

Before use, strictly validate every replacement marker by class, and verify the
target's installed extension versions, exact `cron.alter_job` signature,
transaction behavior, Vault/pg_net privileges, response retention, job role,
installer membership in both the non-login definer-owner and cron-job roles,
visibility of all same-name jobs for the precondition, schema/table/function
owners and ACLs, fixed origin and function slug, and effective Edge gateway
configuration. Run this transaction only inside an enforced maintenance gate
that has stopped every other cron mutation. The installer must be able to take
the reviewed `SHARE ROW EXCLUSIVE` lock on `cron.job`; target-test that lock plus
the serializable transaction against a planted concurrent named scheduler and
require the competitor to block and then fail or observe the committed job,
never overwrite it. The role changes remain transaction-local, and the exact
`session_user`/`current_user` installer guard rejects a session that entered
through an unreviewed role transition. Object creation, job-name precondition,
scheduling, disablement, and exact postcondition are one transaction: a failed
role entry, serialization/locking gate, or later check rolls back the whole
installation. The API key and gateway JWT are independent, unequal inputs with
separate Vault names and lifecycle checks. Never copy an opaque publishable API key into
`Authorization`. For an effectively reviewed `verify_jwt = true` deployment,
set `v_verify_jwt` true and supply a separately obtained, currently valid JWT.
For a reviewed `verify_jwt = false` deployment, leave Authorization absent by
setting both booleans false unless a distinct gateway or application contract
has independently proved that it is required; in that exceptional case set
only `v_independent_authorization_required` true and supply the separate JWT.
Changing either reviewed boolean is a new configuration review, not a runtime
fallback. The API key is gateway material, not the cron authorization
credential or the gateway JWT.
Vault keeps values out of `cron.job.command` and encrypted at rest, but the
decrypted header necessarily enters pg_net's privileged in-database request
queue while the request is pending.

## Sanitized verification

Inventory jobs without returning their commands:

```sql
select
  jobname,
  schedule,
  active,
  command = 'select __REQUIRED_PRIVATE_SCHEMA__.invoke_reviewed_cron_job();'
    as command_matches_reviewed_wrapper,
  username = '__REQUIRED_CRON_JOB_ROLE__' as owner_matches_reviewed_role,
  database = pg_catalog.current_database() as database_matches_current,
  position('net.http_' in lower(command)) > 0 as command_contains_pg_net,
  position('/functions/v1/' in lower(command)) > 0 as command_contains_edge_path,
  position('x-cron-secret' in lower(command)) > 0 as command_contains_cron_header,
  position('vault.decrypted_secrets' in lower(command)) > 0 as command_contains_vault_read
from cron.job
order by jobname;
```

For the fixed-wrapper design the four `command_contains_*` fields are expected
to be false; they describe command text only, not wrapper behavior. Publication
or enablement requires the exact-wrapper/owner/database booleans plus a separate
catalog check of the wrapper's identity, owner, ACL, `prosecdef`, fixed
`proconfig`, and a reviewed definition fingerprint. Do not return its body.

The following fixed-shape catalog check returns booleans only. It must return
exactly one row with every field true. Compute and review the expected
definition fingerprint from the exact approved SQL in an isolated rehearsal;
the query hashes the catalog definition server-side and never returns it.

```sql
with target as (
  select p.oid, p.proowner, p.proacl, p.prosecdef, p.proconfig
  from pg_catalog.pg_proc as p
  where p.oid = pg_catalog.to_regprocedure(
    '__REQUIRED_PRIVATE_SCHEMA__.invoke_reviewed_cron_job()'
  )
    and p.prokind = 'f'
)
select
  pg_catalog.count(*) = 1 as wrapper_found_exactly_once,
  pg_catalog.coalesce(pg_catalog.bool_and(
    t.proowner = pg_catalog.to_regrole('__REQUIRED_DEFINER_OWNER__')::oid
  ), false) as owner_matches_reviewed,
  pg_catalog.coalesce(pg_catalog.bool_and(t.prosecdef), false)
    as security_definer_enabled,
  pg_catalog.coalesce(pg_catalog.bool_and(
    t.proconfig = array['search_path=""']::text[]
  ), false) as proconfig_is_only_empty_search_path,
  pg_catalog.coalesce(pg_catalog.bool_and(
    (
      select pg_catalog.count(*) = 2
        and pg_catalog.bool_and(
          a.privilege_type = 'EXECUTE'
          and a.grantee in (
            t.proowner,
            pg_catalog.to_regrole('__REQUIRED_CRON_JOB_ROLE__')::oid
          )
          and not a.is_grantable
        )
      from pg_catalog.aclexplode(
        pg_catalog.coalesce(
          t.proacl,
          pg_catalog.acldefault('f', t.proowner)
        )
      ) as a
    )
  ), false) as acl_is_owner_plus_job_role_only,
  pg_catalog.coalesce(pg_catalog.bool_and(
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.pg_get_functiondef(t.oid),
          'UTF8'
        )
      ),
      'hex'
    ) = '__REQUIRED_REVIEWED_DEFINITION_SHA256__'
  ), false) as definition_fingerprint_matches_reviewed
from target as t;
```

If role lookup, function lookup, ACL expansion, config parsing, or fingerprint
evaluation fails, the wrapper gate fails closed. The expected fingerprint is
non-secret code identity; it is not a replacement for owner, ACL,
`SECURITY DEFINER`, or `search_path` checks. The exact `proconfig` encoding and
server-normalized definition fingerprint must be generated and rehearsed on
the same PostgreSQL major used by the target.

Record the database-execution layer without selecting `command` or
`return_message` from `cron.job_run_details`:

```sql
select
  d.jobid,
  d.runid,
  d.status = 'succeeded' as scheduled_sql_recorded_succeeded,
  d.database = pg_catalog.current_database() as database_matches_current,
  d.username = '__REQUIRED_CRON_JOB_ROLE__' as role_matches_reviewed,
  d.start_time,
  d.end_time,
  d.end_time is not null and d.end_time >= d.start_time as interval_is_closed
from cron.job_run_details as d
where d.jobid = __REQUIRED_JOB_ID__::bigint
  and d.runid = __REQUIRED_RUN_ID__::bigint;
```

Require exactly one row. A true `scheduled_sql_recorded_succeeded` is only the
first proof layer; it does not attest to pg_net or application success.

Correlate a reviewed attempt to transport metadata without returning response
content or error text:

```sql
select
  a.attempt_id,
  a.job_name = '__REQUIRED_JOB_NAME__' as job_name_matches_reviewed,
  a.request_id,
  a.requested_at,
  j.jobid,
  j.command = 'select __REQUIRED_PRIVATE_SCHEMA__.invoke_reviewed_cron_job();'
    as job_command_matches_reviewed,
  r.id is not null as response_observed,
  r.id = a.request_id as response_matches_exact_request,
  r.status_code,
  r.timed_out,
  r.error_msg is not null as has_transport_error,
  r.created as response_observed_at
from __REQUIRED_PRIVATE_SCHEMA__.cron_http_attempt as a
join cron.job as j on j.jobname = a.job_name
left join net._http_response as r on r.id = a.request_id
where a.attempt_id = '__REQUIRED_ATTEMPT_ID__'::uuid
  and a.request_id = __REQUIRED_REQUEST_ID__::bigint
  and j.jobid = __REQUIRED_JOB_ID__::bigint;
```

Require exactly one row, every identity boolean true, the exact reviewed job
ID and request ID, and the expected transport status/no-timeout/no-error
combination. Zero or multiple rows, a false identity boolean, or a missing
response is a stop.

`cron.job_run_details.status = 'succeeded'` means only that the scheduled SQL
was recorded as completing without a database error; it may be disabled or
unavailable and does not prove that the asynchronous HTTP request succeeded.
The private attempt row binds the supplied attempt UUID to exactly one pg_net
request ID, and the query binds that request to the reviewed current cron job
ID. Require an application receipt or deterministic effect keyed by the same
attempt UUID when the receiver supports one. The template does not record a
pg_cron run ID inside the wrapper, so do not claim exact run-to-attempt
correlation from timestamps alone. If the installed pg_cron interface cannot
make the run ID safely available to the wrapper, require a unique reviewed
job/run/time candidate and label that link `INFERRED`, or change the audited
attempt schema under a separate review to persist an exact run identifier.
Ambiguity is a stop.

A `2xx` pg_net response proves transport, not application completion. Each
enabled job must therefore have a pre-approved deterministic effect check using
counts, timestamps, or server-side booleans only. The three required proof
layers are: (1) the exact cron run's sanitized database-execution evidence,
(2) the exact request ID's sanitized pg_net `2xx`, no-timeout, and no-error
evidence, and (3) the correlated application receipt/effect. If no safe expected
effect or durable application receipt exists, the job remains disabled and
rotation verification is incomplete.

The `net._http_response` relation is internal and version-specific. A missing
row is ambiguous among pending, expired/purged, and never processed. Verify its
schema, privileges, and retention on the isolated target; reconcile before the
deadline and persist only the sanitized outcome. Bound and test cleanup for the
private attempt table.

The checked-in harness performs only the side-effect-free `HEAD` acceptance and
rejection probes. Populate these environment variables through a secure process
environment, never inline in shell history:

- `CRON_VERIFY_ENVIRONMENT`
- `CRON_VERIFY_PHASE`
- `CRON_VERIFY_URL`
- `CRON_VERIFY_ACCEPT_SECRET`
- `CRON_VERIFY_REJECT_SECRET`
- `CRON_VERIFY_API_KEY`
- `CRON_VERIFY_JWT` (required only for an allowlisted slug whose reviewed
  effective configuration has `verify_jwt = true`; forbidden for a reviewed
  `verify_jwt = false` slug)
- `CRON_VERIFY_ACCEPTED_SLOT` (`current` or `next`)

The harness binds the allowlisted environment to its exact reviewed project
host, one of the three reviewed function slugs, and the slug's reviewed
checked-in `verify_jwt` setting before sending either input. Effective deployed
gateway behavior remains a separate empirical precondition. The API key is
sent only as `apikey`; the independently supplied JWT is sent only as
`Authorization: Bearer ...`. The harness must never derive, copy, or reuse the
API key as the JWT and rejects equal inputs before any request. For reviewed `verify_jwt = false`, Authorization is omitted;
an independently required Authorization contract needs a separate reviewed
configuration change rather than an automatic fallback.

A successful probe set requires three accepted and three rejected `HEAD`
requests, each with the expected `204`/`401` status and
`Cache-Control: no-store`. Repetition is a propagation check, not proof of
global deployment convergence; the operator must choose a sufficient wait and
repeat window for the environment and stop on any inconsistent result. The
harness prints only non-secret project/function identity, environment, phase,
operator-supplied accepted-slot label, aggregate HTTP statuses, and PASS/FAIL
reason. It never reads a response body or prints the URL, headers, or inputs.
`CRON_VERIFY_PHASE` and `CRON_VERIFY_ACCEPTED_SLOT` are operator attestations;
the harness cannot infer which configured credential slot supplied an opaque
runtime value. A PASS also requires separate deployment-source attestation; the
harness cannot prove which bundle an endpoint is running.

## Rotation sequence and stop conditions

For each environment independently:

1. The named actor inventories receiver deployments, effective JWT settings,
   active callers, and safe effect checks, then records exactly one caller
   branch from the decision above. For the pg_cron branch also verify extension
   versions, Vault availability, wrapper identity, and response retention. Pause
   only confirmed callers/jobs and drain in-flight requests. Zero discovered
   staging cron jobs is not permission to create one.
2. The actor generates a new environment-specific value in an approved password
   manager and adds it as `CRON_SECRET_NEXT` through the environment's secure
   function-secret surface. The value never passes through Codex or Git.
3. Deploy the reviewed dual-key receiver. Run the harness with the current key
   accepted and a known-invalid key rejected, then with the next key accepted.
   Each accepted/rejected pairing must pass the required repeated propagation
   probes; phase and slot labels remain operator attestations.
4. Rotate the selected caller branch:
   - **No caller/job:** install no scheduler or sender secret. Rotate only the
     receiver-side value and skip sender and controlled-job steps.
   - **Verified pg_cron + Vault:** replace the value behind that environment's
     already reviewed, stable Vault name through the approved secure Vault
     management API. First verify the installed Vault API and its atomic update
     behavior. The fixed wrapper and `cron.job.command` do not change, and
     decrypted bytes are never interpolated into job SQL.
   - **External caller:** its named owner updates the replacement in that
     system's protected secret store and proves the exact reviewed dispatch
     configuration. No database scheduler is created.
5. For a caller branch, run one controlled dispatch. Require the three proof
   layers: exact cron/external execution evidence, exact sanitized HTTP
   transport correlation, and the job-specific application effect. The cron
   execution layer is replaced by the external scheduler's equivalent evidence
   for an external caller. Any missing or ambiguous layer is a silent-failure
   stop.
6. Promote the replacement to `CRON_SECRET`, remove `CRON_SECRET_NEXT`, and
   prove the predecessor is rejected while the promoted value is accepted.
7. Re-enable only the verified jobs. Expire the predecessor in the relevant
   password manager and selected caller store; retain only non-secret evidence.

Rollback is allowed only before predecessor retirement: pause the selected
caller; for pg_cron restore the predecessor behind the same stable Vault name,
or for an external caller restore it through that caller's approved secure
store; prove the predecessor is again accepted; and investigate. The no-caller
branch has no sender rollback and must not create one. After retirement, prefer
roll-forward; reintroducing an exposed credential requires a new explicit
incident decision.

Stop immediately if any value would enter Git, SQL command text, output, or
evidence; the two incidents become mixed; a project identity or effective JWT
setting is uncertain; Vault or response metadata is unavailable; a wrapper has
dynamic endpoint input or broad execution grants; a job cannot be paused; an
HTTP request cannot be correlated; no application-level success check exists;
or an unconfirmed/no-caller environment would gain a scheduler solely for this
rotation.
