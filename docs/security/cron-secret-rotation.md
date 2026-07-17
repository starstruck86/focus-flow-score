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
| `supabase/functions/run-strategy-task-reaper/index.ts` | Current cron-only custom-header consumer. It remains legacy-compatible and does not require an attempt header. |
| `supabase/functions/run-strategy-task-reaper-receipt-v1/index.ts` | Unused strict successor that requires the durable attempt-receipt contract. It is not deployed or authorized for deployment. |
| `supabase/functions/schedule-daily-plan/index.ts` | Cron-only custom-header consumer; its downstream call uses separate service-role authorization. |
| `supabase/functions/_shared/cronSecretAuth.ts` | Shared current/next receiver-side verifier. |
| `supabase/migrations/20260711134232_44bcd1c9-fc73-4dbc-b6a0-c28705a3a756.sql` | Database-only sentinel scheduler; it does not call an Edge Function or use the cron header. |

No current tracked runtime producer sends the custom cron header, and no
repository file provisions either receiver-side secret. Other scheduled or
secret-authenticated functions use different contracts and are not rotated by
this procedure.

## Receiver contract

The four listed endpoints independently accept a nonempty `CRON_SECRET` or
`CRON_SECRET_NEXT`. They fail closed when neither configured value matches.
Comparison uses fixed-width, length-delimited byte representations and the
Deno/Node `timingSafeEqual` primitive rather than JavaScript string equality,
and both configured slots are evaluated. The credentials are not hashed,
fingerprinted, logged, or persisted. This narrows the equality operation's
timing surface; it is not a claim that the entire request handler has constant runtime.
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
   authorization. A legacy pg_cron caller with a plaintext header does not yet
   qualify for this branch; it must use the production handoff below before it
   can become a verified Vault-backed caller.
3. **Other external caller.** The caller owner rotates its own protected secret
   store and dispatch configuration out of band. Do not install the database
   scheduler as a substitute. Require the same acceptance/rejection probes,
   request correlation, transport evidence, deterministic application effect,
   rollback, and old-key retirement from that caller.

If the caller branch is unknown or mixed, stop. In particular,
`dynamic-staging` currently has zero discovered cron jobs; it must not gain a
scheduler as a side effect of credential containment.

### Production legacy-sender handoff

Sanitized production evidence supplied for this review, but not independently
observed by this repository work, identifies legacy job IDs `7`, `9`, and `15`.
The evidence classifies all three as active Edge Function callers whose command
text constructs an `x-cron-secret` header and does not read Vault. It does not
expose command text or credential values. This is neither the no-caller branch
nor the already-Vault-backed form of the pg_cron branch. Production rotation is
**BLOCKED** until Corey plus Lovable Support/admin execute and evidence the
following legacy-to-Vault handoff through the secure production management
surface under a separate mutation authorization.

Treat the handoff as a state machine. Failure before `LEGACY_PAUSED` makes no
mutation and does not claim the legacy jobs stopped; once `LEGACY_PAUSED` is
proved, every later failure leaves all affected jobs inactive. No later state
may be entered by operator attestation alone. While
`LEGACY_HANDOFF_MUTATION_GATE` or controlled-dispatch readiness is `BLOCKED`,
the actors may collect `LEGACY_IDENTITY_BOUND` evidence but must not enter
`LEGACY_PAUSED`, invoke a wrapper, execute the receipt-install template, deploy the strict receiver,
unschedule a job, or create a replacement. Clearing controlled-dispatch
*readiness* before pause means the later one-shot proof is executable and
authorized; it does not claim that dispatch occurred before the pause. The
index and receiver-deployment gates intentionally remain blocked through
pause/drain and clear only at their later table transitions:

| State | Required evidence and action | Stop condition |
| --- | --- | --- |
| `LEGACY_IDENTITY_BOUND` | Bind exactly IDs `7`, `9`, and `15` to their non-secret `jobname`, `schedule`, `username`, `database`, and reviewed function slug. Prove each tuple is unique and no other job occupies a tuple or name. Inspect legacy commands only through reviewed server-side booleans; never return command text. | Any ID is absent, extra, inactive unexpectedly, ambiguous, duplicated, or has an unreviewed caller shape. |
| `LEGACY_PAUSED` | Under an enforced all-cron-mutation gate, call the installed `cron.alter_job` interface to set all three IDs inactive, then prove all three are inactive before releasing the transaction. Do not edit `cron.job` directly. | Any job cannot be paused atomically or another scheduler can race the gate. |
| `LEGACY_DRAINED` | Outside a sleeping database RPC, poll bounded sanitized evidence until every run that began before the pause has a closed interval and every associated pg_net request is terminal. Record counts/booleans only. | An open run/request remains, response retention cannot cover the interval, or an old request cannot be correlated safely. |
| `RECEIPT_INSTALLATION_APPLIED` | While every legacy job remains inactive, satisfy the separately authorized valid/ready/live exact index prerequisite and run the repository template outside the ordinary migration chain as one authorized all-file transaction. Prove its private state, exact pre-provisioned non-superuser wrapper owner, column ACLs, RLS policies, definitions, grants, zero membership/default-ACL drift, and exact ownership footprint. | The index is absent/invalid, a routine write-blocking build would be required, the hosted actor/catalog/owner-transfer or all-file transaction contract is uncertain, or any owner/ACL/RLS/definition check differs. |
| `VAULT_SENDER_READY` | Install and verify one parameter-free private wrapper per bound job/function-slug tuple, including its distinct fixed endpoint, canonical `x-cron-attempt-id`, Vault names, roles, ACLs, gateway configuration, and definition fingerprint, while the legacy jobs remain inactive. The reaper replacement must target `run-strategy-task-reaper-receipt-v1`; the current `run-strategy-task-reaper` endpoint is not replaced and retains its no-attempt legacy behavior. The sender generates exactly one fresh canonical attempt identifier per dispatch; the receiver never supplies or substitutes a missing identifier. | The receipt installation is not proved, any secret source, tuple-to-wrapper mapping, attempt-header support, wrapper identity, endpoint, privilege, or installed extension interface is uncertain. |
| `REPLACEMENT_COMMITTED_INACTIVE` | In one serializable, cron-mutation-fenced transaction, revalidate the bound tuples; unschedule IDs `7`, `9`, and `15`; create one replacement per original tuple with the same name, schedule, owner, and database plus its exact reviewed endpoint mapping; set every replacement inactive; and require its command to equal only that tuple's fixed wrapper call. The reaper endpoint changes only from the legacy slug to `run-strategy-task-reaper-receipt-v1`. | The installed pg_cron APIs cannot preserve owner/database identity, any tuple or reviewed endpoint mapping changes, any replacement is active, or the whole transaction cannot roll back on a failed postcondition. |
| `REPLACEMENT_VERIFIED_INACTIVE` | Prove old IDs are absent, exactly one inactive attempt-capable replacement occupies each bound tuple, every replacement command equals its tuple-bound reviewed wrapper call, and no cron command contains an `x-cron-secret` header construction. Re-run every wrapper owner/ACL/definition check. | Any duplicate, old ID, missing attempt header, plaintext-header command, identity/endpoint mismatch, active sender, or non-wrapper command remains. |
| `STRICT_RECEIVER_DEPLOYED` | Only after `RECEIVER_DEPLOYMENT_GATE` is separately cleared, deploy the exact reviewed `run-strategy-task-reaper-receipt-v1` bundle while all legacy and replacement schedules remain inactive. Revalidate the exact expected sender-tuple set: every tuple present exactly once, every sender inactive, and every sender attempt-capable. Prove receipt installation and wrapper identities again. The strict receiver rejects a missing identifier and never generates one. | The bundle precedes receipt installation, any expected tuple is missing/extra/duplicate, any sender is active or not attempt-capable, deployment identity is uncertain, or a receiver-first rollout is proposed. |
| `CONTROLLED_DISPATCH_VERIFIED` | After the application-receipt and mutation gates are separately cleared, keep every replacement schedule inactive and invoke the reviewed fixed wrapper directly exactly once under a separate authorization. Bind that database invocation to its pg_net request and exact application receipt/effect. Never activate a schedule to perform this probe. | A schedule becomes active, more than one wrapper invocation occurs, or any direct-invocation, transport, or application proof is missing or ambiguous. |
| `RECEIVER_PROMOTED_PREDECESSOR_REJECTED` | After the controlled dispatch passes, promote the replacement receiver value to `CRON_SECRET`, remove `CRON_SECRET_NEXT`, and repeat bounded propagation probes proving the promoted value is accepted and the predecessor is rejected. Bind reviewed secure-management evidence proving `CRON_SECRET_NEXT` is absent; never persist either credential value. Keep every replacement job inactive. | The accepted/rejected result is inconsistent, `CRON_SECRET_NEXT` remains configured, propagation is incomplete, the predecessor is still accepted, or any replacement is active. |
| `REPLACEMENTS_ENABLED` | Only from `RECEIVER_PROMOTED_PREDECESSOR_REJECTED`, use one serializable, cron-mutation-fenced final-enable transaction. Revalidate legacy IDs absent, the exact three replacement identities and uniqueness, that wrapper definition fingerprints match the reviewed values, plaintext-header absence, bound receiver-promotion evidence, and that all three replacements are inactive. Activate all three replacements, revalidate every identity/security/active postcondition, and only then commit. | Any stale evidence, concurrent mutation, identity/fingerprint/command drift, duplicate, legacy ID, active precondition, activation error, or failed postcondition aborts the transaction and rolls back to all three replacements inactive. |

The replacement transaction is intentionally different from the fresh-install
template below. It first validates and pauses the legacy jobs; after drain, it
uses the installed `cron.unschedule` interface for each bound old ID and then
the rehearsed `cron.schedule` or `cron.schedule_in_database` interface needed
to reproduce the approved owner/database identity. Unscheduling and replacement
creation occur under one lock and one serializable transaction, so no committed
state contains both an old and replacement schedule. Each new job is disabled
before commit. Successful unscheduling retires the three old job IDs; they are
never reused. If the installed interfaces cannot provide those semantics for
all three tuples, stop rather than improvising direct DML against `cron.job`.

The checked-in security test executes a deterministic synthetic state model for
the entry gate, atomic pause outcome, drain stop, identity preservation,
replacement rollback, duplicate/old-ID/plaintext rejection, and direct-wrapper
single-dispatch invariant. It also models the future final-enable transaction,
including partial activation, second/third-job failure, pre-commit drift,
duplicate insertion, and concurrent mutation. That model is a repository contract test;
it does not prove the installed pg_cron APIs, lock behavior, privileges, or
production transaction semantics. Those remain mandatory isolated-rehearsal
gates.

The following server-side outcomes are required after commit. They are a
review contract, not a ready-to-run query: exactly three distinct replacement
IDs; zero rows for old IDs `7`, `9`, and `15`; exactly one row for each approved
`(jobname, schedule, username, database, reviewed function slug)` tuple; every
replacement inactive; every command exactly its tuple-bound fixed wrapper call; and
`count(*) filter (where position('x-cron-secret' in lower(command)) > 0) = 0`
across `cron.job`. Return only counts and booleans. This last check proves the
reviewed plaintext-header construction is absent; it is not a general secret
scanner and does not expose commands.

Inactive catalog verification proves installation shape only; it is not a
successful sender rotation. Only after the fixed gates are cleared may the
one-shot direct wrapper dispatch meet the three-layer
invocation/transport/application gate below. It must not activate a schedule.
If one-dispatch control or exact application evidence is unavailable, do not
enter `LEGACY_PAUSED`; leave the existing state unchanged and keep production
rotation **BLOCKED**.

Final activation is a second, separate all-or-none transaction; it is not an
extension of the controlled dispatch. Under the same reviewed all-cron-mutation
fence and serializable isolation, it must first rebind the approved tuples and
prove: legacy IDs `7`, `9`, and `15` remain absent; exactly three unique
replacement IDs occupy the exact approved name/schedule/owner/database/function
slug identities; each tuple's wrapper definition fingerprint matches the
reviewed fingerprint; every replacement command is the fixed wrapper call;
the reviewed plaintext-header predicate is false across all cron commands;
receiver-promotion evidence proves the promoted receiver value accepts,
`CRON_SECRET_NEXT` is absent, and the predecessor rejects; and all three
replacements are inactive. It then activates all three and repeats the exact
identity, uniqueness, wrapper-fingerprint, plaintext, legacy-ID, and receiver
checks plus the all-three-active postcondition before commit. A failure while
activating the first, second, or third job, a postcondition failure, or detected
concurrent drift aborts the whole transaction. No partial activation may commit;
rollback restores and must prove all three replacements inactive. If the fence
cannot exclude mutation or the inactive rollback state cannot be proved, stop
as indeterminate and do not retry or activate jobs individually.

Rollback never reinstalls or re-enables a plaintext legacy command. Before the
replacement transaction commits, database rollback may restore the already
paused legacy rows, but they remain inactive and the handoff is incomplete.
After commit, keep the replacement jobs inactive and either restore the last
accepted receiver/caller value behind the same reviewed Vault name or install a
corrected reviewed wrapper/replacement while preserving the bound non-secret
tuples. Do not recreate IDs `7`, `9`, or `15`, interpolate a secret into a cron
command, or reactivate a legacy sender. After predecessor retirement, roll
forward under a new incident decision.

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
     or v_cron_secret is null or v_cron_secret = ''
     or pg_catalog.octet_length(v_api_key) <> pg_catalog.length(v_api_key)
     or pg_catalog.octet_length(v_cron_secret) <> pg_catalog.length(v_cron_secret)
     or v_api_key !~ '^[!-~]+$'
     or v_cron_secret !~ '^[!-~]+$' then
    raise exception 'required cron dispatch configuration is unavailable';
  end if;

  if v_api_key = v_cron_secret then
    raise exception 'credential domains must be distinct';
  end if;

  v_headers := pg_catalog.jsonb_build_object(
    'content-type', 'application/json',
    'apikey', v_api_key,
    'x-cron-secret', v_cron_secret,
    'x-cron-attempt-id', v_attempt_id::text
  );

  if v_verify_jwt or v_independent_authorization_required then
    select decrypted_secret into strict v_gateway_jwt
    from vault.decrypted_secrets
    where name = '__REQUIRED_GATEWAY_JWT_VAULT_NAME__';

    if v_gateway_jwt is null or v_gateway_jwt = ''
       or pg_catalog.octet_length(v_gateway_jwt) <>
         pg_catalog.length(v_gateway_jwt)
       or v_gateway_jwt !~ '^[!-~]+$'
       or v_gateway_jwt = v_api_key
       or v_gateway_jwt = v_cron_secret then
      raise exception 'required gateway JWT is unavailable';
    end if;

    v_headers := v_headers || pg_catalog.jsonb_build_object(
      'authorization', 'Bearer ' || v_gateway_jwt
    );
  end if;

  select net.http_post(
    url := v_project_origin || '/functions/v1/__REQUIRED_FUNCTION_SLUG__',
    headers := v_headers,
    body := '{}'::jsonb,
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

The recurring sender has no rejected-control input: the rejected control is a
verification credential, not an operational sender dependency, and must never
appear in a scheduled command or accepted dispatch. Its complete live domain
set is therefore the accepted cron secret, API key, and optional gateway JWT,
which the wrapper checks pairwise before `net.http_post`.

The following controlled SQL wrapper is also a non-executable template. It
resolves accepted, rejected-control, API-key, and optional JWT values from four
independently named Vault entries, validates the exact header representation,
and compares all supplied domains before `net.http_post`. It must never be
installed as a recurring schedule. The template does not itself enforce a
single invocation; the application-receipt and controlled-SQL gates therefore
block either branch from deployment or invocation:

```sql
begin;
set local role __REQUIRED_DEFINER_OWNER__;

create function __REQUIRED_PRIVATE_SCHEMA__.invoke_reviewed_cron_probe(
  p_use_rejected_control boolean
)
returns table (attempt_id uuid, request_id bigint)
language plpgsql
security definer
set search_path = ''
as $controlled_probe$
declare
  v_attempt_id uuid := pg_catalog.gen_random_uuid();
  v_project_origin constant text := 'https://__REQUIRED_PROJECT_REF__.supabase.co';
  v_verify_jwt constant boolean := __REQUIRED_VERIFY_JWT_TRUE_OR_FALSE__;
  v_accepted_secret text;
  v_rejected_control text;
  v_api_key text;
  v_gateway_jwt text;
  v_dispatch_secret text;
  v_headers jsonb;
  v_request_id bigint;
begin
  select decrypted_secret into strict v_accepted_secret
  from vault.decrypted_secrets
  where name = '__REQUIRED_ACCEPTED_CRON_SECRET_VAULT_NAME__';

  select decrypted_secret into strict v_rejected_control
  from vault.decrypted_secrets
  where name = '__REQUIRED_REJECTED_CONTROL_VAULT_NAME__';

  select decrypted_secret into strict v_api_key
  from vault.decrypted_secrets
  where name = '__REQUIRED_API_KEY_VAULT_NAME__';

  if v_verify_jwt then
    select decrypted_secret into strict v_gateway_jwt
    from vault.decrypted_secrets
    where name = '__REQUIRED_GATEWAY_JWT_VAULT_NAME__';
  end if;

  if p_use_rejected_control is null
     or v_accepted_secret is null or v_accepted_secret = ''
     or v_rejected_control is null or v_rejected_control = ''
     or v_api_key is null or v_api_key = ''
     or pg_catalog.octet_length(v_accepted_secret) <>
       pg_catalog.length(v_accepted_secret)
     or pg_catalog.octet_length(v_rejected_control) <>
       pg_catalog.length(v_rejected_control)
     or pg_catalog.octet_length(v_api_key) <> pg_catalog.length(v_api_key)
     or v_accepted_secret !~ '^[!-~]+$'
     or v_rejected_control !~ '^[!-~]+$'
     or v_api_key !~ '^[!-~]+$'
     or v_accepted_secret = v_rejected_control
     or v_accepted_secret = v_api_key
     or v_rejected_control = v_api_key
     or (v_verify_jwt and v_gateway_jwt is null)
     or (
       v_gateway_jwt is not null
       and (
         v_gateway_jwt = ''
         or pg_catalog.octet_length(v_gateway_jwt) <>
           pg_catalog.length(v_gateway_jwt)
         or v_gateway_jwt !~ '^[!-~]+$'
         or v_gateway_jwt = v_accepted_secret
         or v_gateway_jwt = v_rejected_control
         or v_gateway_jwt = v_api_key
       )
     ) then
    raise exception 'credential domains must be distinct';
  end if;

  v_dispatch_secret := case
    when p_use_rejected_control then v_rejected_control
    else v_accepted_secret
  end;
  v_headers := pg_catalog.jsonb_build_object(
    'content-type', 'application/json',
    'apikey', v_api_key,
    'x-cron-secret', v_dispatch_secret,
    'x-cron-attempt-id', v_attempt_id::text
  );
  if v_gateway_jwt is not null then
    v_headers := v_headers || pg_catalog.jsonb_build_object(
      'authorization', 'Bearer ' || v_gateway_jwt
    );
  end if;

  select net.http_post(
    url := v_project_origin || '/functions/v1/__REQUIRED_FUNCTION_SLUG__',
    headers := v_headers,
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) into strict v_request_id;
  if v_request_id is null then
    raise exception 'pg_net did not return a request identifier';
  end if;
  return query select v_attempt_id, v_request_id;
end;
$controlled_probe$;

revoke all on function
  __REQUIRED_PRIVATE_SCHEMA__.invoke_reviewed_cron_probe(boolean)
  from public, anon, authenticated;

commit;
```

The controlled wrapper requires the same exact owner, ACL, `SECURITY DEFINER`,
empty-`search_path`, fixed-endpoint, and reviewed-definition checks as the
recurring wrapper. This template grants execute to no operator role and remains
owner-only and blocked. A later design must add an exact one-shot role/grant and
durable single-invocation enforcement before clearing the gate. Creation and
revocation stay in one transaction so a default PUBLIC grant is never committed.

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
separate Vault names and lifecycle checks. Every header credential must use
visible ASCII bytes only so HTTP optional-whitespace normalization cannot make
two distinct inputs equal on the wire. Never copy an opaque publishable API key into
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
layers are: (1) the selected cron run's sanitized database-execution evidence,
(2) the exact request ID's sanitized pg_net `2xx`, no-timeout, and no-error
evidence, and (3) the correlated application receipt/effect. If no safe expected
effect or durable application receipt exists, the job remains disabled and
rotation verification is incomplete.

### Application-receipt boundary

The single canonical transport identifier is the `x-cron-attempt-id` request
header. The sender generates one canonical lowercase UUID and supplies it only
through that header; it is not duplicated in the body, query string, or another
header. On a cron execution request, the receiver first authenticates the cron
secret, then strictly parses the header. Missing, repeated, non-string,
noncanonical, or malformed identifiers stop before business work or receipt
access. One request-local, per-key memoized environment view is shared by
authentication and attempt validation; each protected key is read once and
reused within that request. The attempt must differ directly from the presented cron
secret, both configured receiver slots (`CRON_SECRET` and `CRON_SECRET_NEXT`),
the gateway API key, gateway authorization credential, and receiver
service-role credential. Equality stops before semantic hashing, client/RPC
creation, or business work. No protected value enters the semantic digest,
logs, receipt state, or another fingerprint. This requirement does not apply
to `daily-digest`'s separate end-user JWT path. An authenticated `HEAD` remains
only a side-effect-free key probe and never creates an attempt or receipt. The
receiver never generates a missing attempt identifier.
For the reaper, the exact cached `SUPABASE_URL` and service-role value checked
at that boundary are also the values supplied to client construction; the
index module does not reread process environment after validation. Concurrent
requests have distinct caches, and each protected name is read once per
request.

Protocol version `1` binds the attempt to the receiver slug, the reviewed
non-secret environment/project identity, and a deterministic 64-character
lowercase hexadecimal semantic request fingerprint. The fingerprint excludes
credentials, credential fingerprints, volatile transport headers, request and
response bodies, business payloads, model prompts/output, and arbitrary error
text. A replay must match all bound identity fields. Reusing one attempt for a
different receiver, environment, project, protocol, or semantic fingerprint
fails closed.

The database wrapper does not independently discover its Supabase project. It
trusts the reviewed Edge receiver to derive and supply the environment/project
pair from the exact `SUPABASE_URL`; the wrapper then accepts only the two
repository-reviewed pairs and binds that pair into the request fingerprint.
This is repository contract evidence, not observed deployment configuration.

The implementation status is deliberately receiver-specific:

| Receiver | Attempt-bound receipt status | Exact transaction boundary |
| --- | --- | --- |
| `daily-digest` | `RED / BLOCKED` | Perplexity HTTP calls occur outside PostgreSQL, followed by separate per-account updates and an optional delete then insert of digest rows. A model call, an account update, or the delete can complete before a later write or receipt fails. The existing multi-user loop cannot atomically bind all of those effects to one receipt. |
| `run-strategy-task-reaper` | `YELLOW / LEGACY-COMPATIBLE` | The existing production-compatible slug still authenticates the cron secret and performs its existing sweep without requiring an attempt header. It intentionally does not claim an attempt receipt and is not changed into the strict receiver by this PR. |
| `run-strategy-task-reaper-receipt-v1` | `GREEN / IMPLEMENTED IN REPOSITORY FIXTURES ONLY` | `public.execute_strategy_task_reaper_attempt` serializes the bound attempt, deterministically locks eligible `task_runs`, performs one set-based transition, and terminalizes the receipt in the same PostgreSQL transaction. The no-eligible-row proof and legitimate-no-op receipt are committed together. This slug is unused and must remain undeployed while the gate is blocked. |
| `schedule-daily-plan` | `RED / BLOCKED` | The receiver loops over users and invokes `generate-time-blocks` once per eligible user over HTTP. Those downstream invocations and their database/model effects are outside one caller transaction, so a partial loop or lost response can leave effects that cannot be reconciled exactly to the outer attempt. |

For the strict `run-strategy-task-reaper-receipt-v1` successor, an exact
duplicate returns the durable prior receipt without
repeating the effect; a conflicting identity fails. Concurrent duplicates are
serialized so at most one set-based `task_runs` transition commits. Two
distinct attempts racing for one eligible row produce exactly one applied
transition and one legitimate no-op, with two distinct receipts and one total
business effect. Transaction
failure inside the effect subtransaction rolls back every row transition before
committing the fixed `known_failure_rolled_back` receipt; if terminal receipt
publication itself fails, the outer transaction leaves neither effect nor
receipt. A commit followed by a lost HTTP response is recovered by retrying the
same attempt and reading the same terminal receipt. The success outcomes are
`applied_success` with effect
`stale_pending_runs_reaped`, or `legitimate_noop` with effect
`no_eligible_stale_pending_runs`. The no-op proves no eligible rows were visible
to that locked statement execution; it is not a timeless claim about later
writes. The closed vocabulary also includes
`in_progress`/`attempt_in_progress`,
`known_failure_rolled_back`/`execution_rolled_back`, and
`indeterminate`/`effect_indeterminate`; no uncertain response may be converted
to success. `known_failure_rolled_back` is terminal only after rollback is
proven. A stale `in_progress` attempt remains nonterminal and visible; if its
effect cannot be proven absent or committed, reconciliation must classify it
`indeterminate` rather than silently retrying or passing verification.

Receipt state is private. The fixed wrappers
`public.execute_strategy_task_reaper_attempt` and
`public.read_strategy_task_reaper_receipt` use reviewed `SECURITY DEFINER`
ownership under the dedicated `cron_receipt_executor` role, which is
`NOLOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, and distinct from the `task_runs`
owner. It has only the reviewed task-run SELECT/UPDATE columns plus receipt
state SELECT/INSERT/UPDATE, explicit RLS policies, an empty safe `search_path`,
fully qualified objects, default-execute
revocation from `PUBLIC`, `anon`, and `authenticated`, and only the minimum
service-role wrapper grant. Missing
required column privileges, RLS, or fixed policy identities becomes only a
rollback-proven failure and cannot become a false no-op. The read wrapper
returns only the reviewed receipt fields:
version, receiver, attempt-present and terminal booleans, fixed outcome/effect
codes, receipt time, exact effect count, identity/effect consistency booleans,
and replayed state. It cannot return business identifiers or payloads.

The checked-in read-only verifier,
`scripts/security/verify-cron-attempt-receipt.ts`, accepts its attempt UUID only
through `CRON_RECEIPT_VERIFY_ATTEMPT_ID` in the protected process environment;
command-line attempt values are forbidden. It binds the reviewed environment,
project ref, fixed RPC URL, separately supplied gateway API key/JWT, and the
same semantic fingerprint before calling the fixed read wrapper. Its output is
limited to verification version, receiver, attempt-present/terminal booleans,
fixed outcome/effect codes, receipt time, exact effect count, identity/effect
consistency booleans, and `PASS` or `REVIEW_REQUIRED`. It never prints
credentials, credential fingerprints, request/response bodies, business rows,
model data, arbitrary database text, SQL errors, filenames, or paths. A
nonterminal or inconsistent receipt is not application proof.

Supply the verifier only through these six protected process-environment
variables:

- `CRON_RECEIPT_VERIFY_ENVIRONMENT`
- `CRON_RECEIPT_VERIFY_PROJECT_REF`
- `CRON_RECEIPT_VERIFY_URL`
- `CRON_RECEIPT_VERIFY_API_KEY`
- `CRON_RECEIPT_VERIFY_JWT`
- `CRON_RECEIPT_VERIFY_ATTEMPT_ID`

The attempt ID, API key, and JWT are three separate domains and must be pairwise
distinct. The JWT must independently authorize the `service_role`-only read
wrapper; the API key is never copied into `Authorization`, and no protected
value is printed.

No receiver may create a receipt after its business handler returns and call
that atomic. In particular, a post-effect receipt write could fail after an
effect committed, while a pre-effect claim alone could remain indeterminate or
permit a duplicate nontransactional effect. `daily-digest` and
`schedule-daily-plan` remain blocked until a larger redesign provides a single
audited transaction boundary or a domain-specific idempotency/reconciliation
protocol for every effect. HTTP `2xx`, timestamp proximity, job activity,
changed row counts, and self-reported handler success do not substitute for the
durable application receipt.

These fixed global gates remain because one receiver receipt cannot satisfy the
three-receiver application-proof requirement. They apply until the two blocked
receivers have separately reviewed exact receipt contracts and the independent
controlled-SQL-verification implementation, including synthetic
success/failure/duplicate/no-op and pre-dispatch domain tests, exists:

```text
APPLICATION_RECEIPT_STATUS: PARTIAL_BLOCKED
CONTROLLED_SQL_VERIFICATION_STATUS: TEMPLATE_ONLY_BLOCKED
RECEIVER_DEPLOYMENT_GATE: BLOCKED
RECEIPT_INDEX_DEPLOYMENT_GATE: BLOCKED
RECEIPT_INSTALLATION_GATE: BLOCKED
RECEIPT_PRUNING_GATE: BLOCKED
SENDER_ACTIVATION_GATE: BLOCKED
CONTROLLED_DISPATCH_GATE: BLOCKED
LEGACY_HANDOFF_MUTATION_GATE: BLOCKED
PRODUCTION_ROTATION_GATE: BLOCKED
```

The reaper implementation is repository-side readiness evidence only. It does
not authorize deployment, a controlled dispatch, a cron pause, a sender change,
credential rotation, or any production action.

The PostgreSQL integration applies the separately authorized receipt-install
template to an isolated PG17
database with a compatible minimal `task_runs` fixture. It proves the wrapper,
transaction, concurrency, rollback, ACL, and predicate mechanics against that
reviewed shape; it does not prove installation over live schema drift or any
deployed runtime.

### Receipt deployment catalog and index prerequisites

The receipt installer is not a migration or routine deployment. The executable
SQL is deliberately located at
`scripts/security/templates/install-cron-attempt-receipts.template.sql`, outside
`supabase/migrations`, so an ordinary Lovable/Supabase migration runner cannot
consume it automatically. It refuses to create any
receipt object unless `public.task_runs` already has RLS enabled and a valid,
ready, live, nonunique btree with exactly two key attributes, no included
attributes, ordered keys `(updated_at, id)`, and exact predicate
`status = 'pending'`. It does not run ordinary `CREATE
INDEX`, because that would take a write-blocking lock on `task_runs` during a
routine deployment. The repository-only
`scripts/security/create-task-runs-reaper-index-concurrently.sql` template is a
separate, nontransactional mutation procedure. It may be used only after a
separately authorized PostgreSQL 17 rehearsal and live catalog review. Its
mandatory psql bindings must exactly approve the mutation, database, execution
actor, current `task_runs` owner, and PostgreSQL major `17`; the template also
reads the server's own version and requires major `17`. Missing or mismatched
bindings stop before DDL. Database/actor/owner names do not uniquely identify a
cluster or Supabase project. The separately authorized execution record must
therefore bind the reviewed connection endpoint/project through the secure
control plane before invoking the template; this repository script cannot
independently attest that control-plane binding. If a concurrent build fails,
an invalid index may remain: stop for reviewed
recovery; do not retry or drop it ad hoc. An explicitly authorized task-run
maintenance window is the alternative when a concurrent path cannot be proved safe.
`RECEIPT_INDEX_DEPLOYMENT_GATE` remains `BLOCKED` because this PR observed no
production catalog.

The installer begins and commits one all-file transaction only after mandatory
non-secret psql authorization, database, actor, task-owner, PostgreSQL-major,
and exact executor-OID bindings are present. It never creates, alters, grants,
revokes, or normalizes a role or role membership. A separately authorized
hosted administrator must first provision the exact `cron_receipt_executor`;
the installer accepts it only after checking role flags,
password/expiry/connection limit, role/database settings, every membership
direction including grantor and option fields, default-ACL
ownership/grantor/grantee references, owned dependencies, and direct
role-specific ACL grantor/grantee/grant-option references across every
PostgreSQL 17 ACL-bearing catalog, including initial extension privileges. Any
unreadable catalog is a stop. Immediately before commit it proves the role
still has zero membership/default-ACL/settings drift, owns exactly the two
fixed wrappers, holds only owner-issued nondelegable reviewed
schema/private-state/task-column privileges, and has no unreviewed direct ACL
or ownership footprint. Effective privileges and the inherited `PUBLIC`
baseline are separately bound on every receipt wrapper/state object,
`task_runs`, and the `public` and private schemas; this is not a claim about
unrelated database objects.

PostgreSQL 17 gives a non-superuser `CREATEROLE` actor an automatic membership
in a role it creates with `ADMIN TRUE`, `SET FALSE`, and `INHERIT FALSE`. The
real PG17 integration reproduces that exact edge and proves the same actor
cannot transfer a function to the created role: the automatic edge violates
the zero-membership contract while `SET FALSE` prevents adopting the future
owner. The repository does not weaken the zero-edge contract or encode a
temporary grant workaround. Receipt installation therefore remains blocked
until Lovable confirms the actual migration actor, whether its runner provides
an all-file transaction, its `CREATE ROLE` behavior, and the exact privileged
owner-transfer procedure that can finish with zero edges. A synthetic
privileged fixture proves mechanics only; it does not prove hosted capability.

Before `RECEIPT_INSTALLATION_APPLIED`, mandatory production checks must be run
read-only and retained as counts, booleans, allowlisted identifiers, and
reviewed definition fingerprints only. They must establish:

- the exact `task_runs` owner and effective table/column ACLs;
- enabled/forced RLS state and every applicable policy role, command, and
  reviewed `USING`/`WITH CHECK` fingerprint;
- every trigger's allowlisted name, enabled state, function owner,
  `SECURITY DEFINER` state, safe `search_path`, and reviewed definition
  fingerprint;
- every candidate index's validity/readiness/liveness, access method, ordered
  key columns, included columns, and predicate;
- the installed wrapper owner's `NOLOGIN`/`NOSUPERUSER`/`NOBYPASSRLS` state,
  zero membership edges, exact required schema/table/column privileges, and
  absence of broader task-table or private-state privileges; and
- both wrappers' owner, ACL, `SECURITY DEFINER`, empty `search_path`, identity
  arguments, volatility, and reviewed definition fingerprints.

Any missing, duplicate, unexpected, unreadable, or live-drifted result keeps
installation and receiver deployment blocked. The synthetic fixture uses a
separate task-table owner, a non-superuser/non-bypass definer, column grants,
and RLS. It removes each required SELECT/UPDATE grant and a required policy in
turn and proves no business effect or success/no-op can commit. That is a
mechanics proof, not a substitute for the production inventory.

### Receipt retention and privileged pruning

Protocol v1 receipts are retained indefinitely while any v1 receiver accepts
requests. A UUID carries no trustworthy issue/expiry time; deleting its receipt
while v1 remains accepted would allow a late retry to become a fresh attempt
and potentially apply a later business effect. The executor, `service_role`,
`anon`, and `authenticated` therefore receive no DELETE privilege, the
install template exposes no pruning RPC or DELETE policy, and this PR installs no
cleanup schedule.

Privileged pruning requires a future, separately reviewed mutation procedure
and authorization. Before even a bounded owner-only batch may run, every v1
caller must be disabled and drained, the deployed receiver must reject v1
before database access, every in-progress/indeterminate receipt must be
reconciled, and capacity, backup, rollback, cutoff, batch-size, audit, and
no-retry evidence must be approved. Direct DELETE, online terminal-row cleanup,
and timestamp-only pruning are forbidden. A finite online horizon would require
a new protocol with trustworthy expiry or durable tombstones. Until then
`RECEIPT_PRUNING_GATE` remains `BLOCKED`; sender activation must accept and
monitor indefinite active-protocol retention rather than silently adding
cleanup.

The `HEAD` harness may establish receiver-key acceptance and rejection only.
It cannot clear any of these gates. The confirmed-no-caller branch may rotate
and retire the receiver-side value without installing or activating a sender,
but no environment may enable a sender or claim completed end-to-end rotation
from this PR. Production remains blocked additionally on caller inventory and
Corey/Lovable management access.

The `net._http_response` relation is internal and version-specific. A missing
row is ambiguous among pending, expired/purged, and never processed. Verify its
schema, privileges, and retention on the isolated target; reconcile before the
deadline and persist only the sanitized outcome. This transport retention is
separate from the no-prune application-receipt contract above.

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
host, one of the four reviewed function slugs, and the slug's reviewed
expected checked-in `verify_jwt` setting before sending either input. This is
reported only as `reviewed_expected_verify_jwt`; it is not an observation of
deployed runtime configuration. CI binds the harness map to the effective
setting in `supabase/config.toml` and the corresponding collected repository
entry in `docs/migration/edge-functions.json`. Effective deployed gateway
behavior remains a separate empirical precondition. The API key is
sent only as `apikey`; the independently supplied JWT is sent only as
`Authorization: Bearer ...`. Before any request, the harness requires the
accepted cron secret, rejected control, API key, and optional JWT to be
pairwise distinct. It must never derive, copy, or reuse one credential domain
as another. Each input must already be canonical visible ASCII with no spaces
or control characters; the harness rejects values that an HTTP implementation
could trim or normalize. The exported verifier revalidates the environment,
phase, and slot enums and requires every supplied field to be a primitive
string even when a caller bypasses the typed environment loader; numbers,
boxed strings, arrays, objects, and other coercible values fail before fetch.
For reviewed `verify_jwt = false`, Authorization is omitted;
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
   versions, Vault availability, wrapper identity, and response retention. This
   inventory step performs no pause or drain; those actions require the selected
   branch's cleared mutation gate and separate authorization. Zero discovered
   staging cron jobs is not permission to create one.
2. The actor generates a new environment-specific, visible-ASCII URL-safe value
   in an approved password manager and adds it as `CRON_SECRET_NEXT` through the
   environment's secure function-secret surface. The value never passes through
   Codex or Git.
3. Do not equate dual-key configuration with permission to deploy the strict
   receipt receiver. A no-caller or already attempt-capable caller branch may
   deploy only after its separate receipt installation, caller, retention, and
   `RECEIVER_DEPLOYMENT_GATE` prerequisites are proved.
   Production's active legacy no-attempt callers must defer strict receiver deployment to the
   paused/drained state machine in step 4. Receiver-first deployment and
   receiver-side generation of a missing attempt identifier are forbidden.
4. Rotate the selected caller branch:
   - **No caller/job:** install no scheduler or sender secret. Rotate only the
     receiver-side value and skip sender and controlled-job steps.
   - **Verified pg_cron + Vault:** replace the value behind that environment's
     already reviewed, stable Vault name through the approved secure Vault
     management API. First verify the installed Vault API and its atomic update
     behavior. The fixed wrapper and `cron.job.command` do not change, and
     decrypted bytes are never interpolated into job SQL.
   - **Production legacy pg_cron transition:** do not apply the preceding
     already-Vault-backed shortcut or the fresh-install same-name precondition.
     While `LEGACY_HANDOFF_MUTATION_GATE` is `BLOCKED`, stop before
     `LEGACY_PAUSED`; do not pause, drain, invoke, unschedule, replace, or
     enable a job. The reaper receipt alone cannot clear this gate. Only after
     every scheduled receiver has a separately reviewed exact receipt contract,
     controlled-dispatch readiness is proved, and a later explicit mutation
     authorization clears the other gates, may the actor atomically pause the
     legacy jobs; drain every old run/request; satisfy the index prerequisite;
     execute and verify the separately authorized receipt-install template;
     prepare and verify the exact inactive attempt-capable sender tuple set,
     mapping the reaper replacement to
     `run-strategy-task-reaper-receipt-v1`; separately clear
     `RECEIVER_DEPLOYMENT_GATE`; deploy only that strict successor while every sender
     remains inactive; perform exactly one direct controlled dispatch with
     exact invocation/transport/receipt correlation; promote/reject the
     receiver slots; and finally activate all replacements in the all-or-none
     transaction. A strict bundle before receipt installation, an active legacy
     no-attempt sender with the strict receiver, or partial activation is a
     rollback/stop condition.
   - **External caller:** its named owner updates the replacement in that
     system's protected secret store and proves the exact reviewed dispatch
     configuration. No database scheduler is created.
5. A caller branch stops here while `CONTROLLED_DISPATCH_GATE` is `BLOCKED`.
   A receipt for only one of the three receivers cannot clear that gate. After
   exact receipt contracts for all three and the independent controlled-SQL
   prerequisite are reviewed, one later-authorized controlled dispatch must
   produce three proof layers: the applicable reviewed cron-run, direct-wrapper,
   or external-caller execution evidence; exact sanitized HTTP transport
   correlation; and the job-specific attempt-bound application receipt/effect.
   Run-to-attempt evidence remains `INFERRED` unless an exact identifier is
   persisted. Any missing or ambiguous layer is a silent-failure stop.
6. Promote the replacement to `CRON_SECRET`, remove `CRON_SECRET_NEXT`, and
   prove the predecessor is rejected while the promoted value is accepted.
   Only complete, bound evidence for all three facts enters
   `RECEIVER_PROMOTED_PREDECESSOR_REJECTED`; every replacement remains inactive.
7. Re-enable all three verified jobs only through the single final-enable
   transaction defined above. Partial or individual activation is forbidden.
   Expire the predecessor in the relevant password manager and selected caller
   store; retain only non-secret evidence.

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
