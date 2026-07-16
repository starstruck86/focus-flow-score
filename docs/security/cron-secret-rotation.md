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
returns `401`.

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
  v_publishable_key text;
  v_cron_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into strict v_publishable_key
  from vault.decrypted_secrets
  where name = '__REQUIRED_PUBLISHABLE_KEY_VAULT_NAME__';

  select decrypted_secret into strict v_cron_secret
  from vault.decrypted_secrets
  where name = '__REQUIRED_CRON_SECRET_VAULT_NAME__';

  if v_publishable_key is null or v_publishable_key = ''
     or v_cron_secret is null or v_cron_secret = '' then
    raise exception 'required cron dispatch configuration is unavailable';
  end if;

  select net.http_post(
    url := v_project_origin || '/functions/v1/__REQUIRED_FUNCTION_SLUG__',
    headers := pg_catalog.jsonb_build_object(
      'content-type', 'application/json',
      'apikey', v_publishable_key,
      'authorization', 'Bearer ' || v_publishable_key,
      'x-cron-secret', v_cron_secret
    ),
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
installation. Rehearse whether the
target requires the `apikey`, `authorization`, or both publishable-key headers;
the template does not claim that one key form satisfies every gateway version.
The publishable key is gateway material, not the cron authorization credential.
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

Correlate a reviewed attempt to transport metadata without returning response
content or error text:

```sql
select
  a.attempt_id,
  a.job_name,
  a.requested_at,
  r.id is not null as response_observed,
  r.status_code,
  r.timed_out,
  r.error_msg is not null as has_transport_error,
  r.created as response_observed_at
from __REQUIRED_PRIVATE_SCHEMA__.cron_http_attempt as a
left join net._http_response as r on r.id = a.request_id
where a.attempt_id = '__REQUIRED_ATTEMPT_ID__'::uuid;
```

`cron.job_run_details.status = 'succeeded'` means only that the scheduled SQL
was recorded as completing without a database error; it may be disabled or
unavailable and does not prove that the asynchronous HTTP request succeeded. A `2xx`
pg_net response proves transport, not application completion. Each enabled job
must therefore have a pre-approved deterministic effect check using counts,
timestamps, or server-side booleans only. If no safe expected effect or durable
application receipt exists, the job remains disabled and rotation verification
is incomplete.

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
- `CRON_VERIFY_GATEWAY_TOKEN` (optional; required when effective gateway JWT
  verification rejects unauthenticated requests)

The harness binds the allowlisted environment to its exact reviewed project
host and one of the three reviewed function slugs before sending either input.
It prints only that non-secret project/function identity, environment, phase,
HTTP statuses, and PASS/FAIL reason. It never reads a response body or prints
the URL, headers, or inputs. A PASS also requires separate deployment-source
attestation; the harness cannot prove which bundle an endpoint is running.

## Rotation sequence and stop conditions

For each environment independently:

1. The named actor inventories receiver deployments, effective JWT settings,
   active callers, extension versions, Vault availability, and safe effect
   checks. Pause the specific jobs and drain in-flight requests.
2. The actor generates a new independent value in an approved password manager
   and adds it as `CRON_SECRET_NEXT` through the environment's secure function
   secret surface. The value never passes through Codex or Git.
3. Deploy the reviewed dual-key receiver. Run the harness with the current key
   accepted and a known-invalid key rejected, then with the next key accepted.
4. Replace the value behind that environment's already reviewed, stable Vault
   name through the approved secure Vault management API. First verify the
   installed Vault API and its atomic update behavior on that environment. The
   fixed wrapper and `cron.job.command` do not change, and decrypted bytes are
   never interpolated into job SQL.
5. Run one controlled job. Require cron SQL evidence, a correlated sanitized
   pg_net `2xx`/no-timeout/no-error result, and the job-specific application
   effect. Any missing layer is a silent-failure stop.
6. Promote the replacement to `CRON_SECRET`, remove `CRON_SECRET_NEXT`, and
   prove the predecessor is rejected while the promoted value is accepted.
7. Re-enable only the verified jobs. Expire the predecessor in the relevant
   password manager and sender store; retain only non-secret evidence.

Rollback is allowed only before predecessor retirement: pause the job, restore
the predecessor value behind the same stable Vault name through the approved
secure surface, prove the predecessor is again accepted, and investigate.
After retirement, prefer roll-forward; reintroducing an exposed credential
requires a new explicit incident decision.

Stop immediately if any value would enter Git, SQL command text, output, or
evidence; the two incidents become mixed; a project identity or effective JWT
setting is uncertain; Vault or response metadata is unavailable; a wrapper has
dynamic endpoint input or broad execution grants; a job cannot be paused; an
HTTP request cannot be correlated; or no application-level success check exists.
