# Local migration rehearsal tools

These tools operate on local files or reviewed repository source only. They do
not contain a database restore path and were not run against a remote database,
Lovable Cloud, or production data in this PR.

## Inspect a future Lovable export

Place the export in the ignored `local-migration-artifacts/` directory, then
run:

```text
scripts/migration/inspect-lovable-dump.sh \
  --output 'local-migration-artifacts/rehearsal metadata.txt' \
  'local-migration-artifacts/Lovable export.backup'
```

The script refuses URLs/connection strings, missing or non-regular files,
non-`PGDMP` formats, missing/incompatible tools, existing output files, and
unknown TOC classes. It invokes `pg_restore` only with `--version` and `--list`.
It computes the archive SHA-256 and reports metadata/risk flags without
decoding or printing row payloads. A successful report still says
`REVIEW_REQUIRED`; it is not a restore plan.

Do not construct a final `pg_restore` command until the actual TOC has been
classified and the supported Lovable/Supabase restore procedure is confirmed.

## Inventory reviewed Edge Function source

```text
scripts/migration/inventory-edge-functions.py \
  --role source \
  --collected-at '2026-07-14T13:29:59Z' \
  > /tmp/edge-functions.json
```

Supply the actual repository role and UTC collection time. A target collection
also requires its explicit `--project-ref`, preventing source evidence from
being relabeled accidentally. Because this tool reads only a local checkout,
target-role output is marked not independently verifiable and cannot produce a
green deployment comparison; deployed-target evidence requires a distinct,
independent collector. The repository-only output fingerprints
each function's resolved local deployment dependency closure (including
reachable `_shared` files) together with its effective entrypoint, import map,
and `verify_jwt`. An omitted `verify_jwt` is recorded structurally as the
documented default `true`, distinct from an explicit setting. Unresolved local
imports or unsupported function settings fail collection.

## Convert captured PostgreSQL verification output

Both read-only SQL collectors under `verification/` emit one strict JSON object
per line. Convert a captured byte snapshot deterministically:

```text
scripts/migration/catalog-jsonl-to-manifest.py \
  'local-migration-artifacts/source catalog.jsonl' \
  --output 'local-migration-artifacts/source manifest.json' \
  --label rehearsal-source --role source --project-ref '<source-ref>' \
  --artifact-source '<capture-provenance>' \
  --evidence-kind database_catalog
```

The converter reads and hashes the input once, fingerprints typed metadata with
domain-separated length framing, refuses incomplete table counts and unknown
record classes, derives its snapshot boundary/time and verification scope from
the captured SQL envelope, and will not overwrite an existing output. Use
`--evidence-kind service_inventory` only with the separately captured managed
service inventory.

The destructive synthetic PostgreSQL integration fixtures are test-only. They
require `MIGRATION_VERIFY_ALLOW_FIXTURE=1`, PostgreSQL 17, a database named
`migration_verify_*`, and either the canonical local PostgreSQL Unix socket or
an explicitly prefixed `focus-flow-migration-verify-*` container on a local
Docker socket carrying the test-only label
`com.focus-flow.migration-verify=true`. Both scripts verify the connected
database identity before fixture SQL. TCP hosts, non-test database names,
remote Docker endpoints, missing dependencies, and ambiguous assertion results
fail before fixture setup.

## Compare verification manifests

```text
scripts/migration/compare-manifests.py \
  local-migration-artifacts/source-manifest.json \
  local-migration-artifacts/target-manifest.json
```

Exit `0` means every component is exactly `Match`; exit `2` means at least one
discrepancy or unknown; exit `1` means input validation failed. The strict
schema and SQL collection templates are under `verification/`. Format v2
requires non-empty source and target manifests, distinct project refs and
collection provenance, real SHA-256 evidence, explicit source/target roles,
collector version/time, and kind-sufficient evidence. Reusing one input or
comparing source against source is an invalid comparison, not a match.
