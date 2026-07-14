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
scripts/migration/inventory-edge-functions.py > /tmp/edge-functions.json
```

The output is repository-only. It marks a missing `verify_jwt` value as unknown
instead of assuming a platform default.

## Compare verification manifests

```text
scripts/migration/compare-manifests.py \
  local-migration-artifacts/source-manifest.json \
  local-migration-artifacts/target-manifest.json
```

Exit `0` means every component is exactly `Match`; exit `2` means at least one
discrepancy or unknown; exit `1` means input validation failed. The strict
schema and SQL collection templates are under `verification/`.
