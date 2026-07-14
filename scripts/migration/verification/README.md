# Read-only migration verification templates

These files are local templates for a future, separately authorized rehearsal.
They were not run against Lovable Cloud, an owned Supabase project, or any
production data in this PR.

- `catalog-and-counts.sql` starts a read-only transaction and emits strict JSONL
  records for schemas, relations, columns, types, defaults, nullability,
  generated/identity settings, collations, owners, ACLs/default privileges,
  replica identity, indexes, constraints, exact table counts, sequence values,
  RLS state, policies, functions, triggers, extension versions, and
  publications. It emits no table rows and deliberately emits no primary-key
  values or min/max row-derived evidence.
- `supabase-service-counts.sql` starts a read-only transaction and emits Auth
  user/identity counts, per-bucket Storage object counts/configuration, and
  scheduled-job metadata as the same strict JSONL envelope. Cron commands are
  never printed; a domain-separated, length-delimited SHA-256 is emitted.
  Access to managed schemas is role-dependent; an authorization error is a
  failed collection, not a zero count.
- `catalog-jsonl-to-manifest.py` reads captured SQL stdout exactly once, hashes
  and parses that same byte snapshot, rejects unknown/duplicate/orphaned or
  incomplete records, and deterministically writes manifest v2 with collection
  provenance. Use `--evidence-kind database_catalog` for the catalog collector
  and `--evidence-kind service_inventory` for the service collector.
- `inventory-edge-functions.py` inventories reviewed repository slugs and
  fingerprints each resolved local deployment dependency closure, including
  reachable `_shared` modules, an explicit import map, and effective
  entrypoint/`verify_jwt` settings. Effective settings are structured fields,
  not notes; omitted `verify_jwt` is recorded as the documented default `true`.
- `manifest.schema.example.json` documents the strict comparison format.
- `compare-manifests.py` compares two local manifests and reports `Match`,
  `Missing on target`, `Unexpected on target`, `Count mismatch`,
  `Configuration unknown`, `Not independently verifiable`, and (when known
  fingerprints differ) `Configuration mismatch`. It exits `0` only when every
  component is exactly `Match`, `2` for any discrepancy/unknown, and `1` for an
  invalid manifest. Format v2 binds evidence to project ref, source/target role,
  collection boundary/time, collector name/version, and artifact provenance.
  It rejects empty manifests, same-input or source/source comparisons,
  placeholder/low-entropy fingerprints, and evidence kinds that cannot support
  the component kind. Available source evidence may still be marked not
  independently verifiable; this produces a non-green comparison rather than
  overstating source completeness.

The SQL must be reviewed with the exact connection target visible before use.
Do not paste credentials into shell history or committed files. Capture stdout
only under `local-migration-artifacts/`, which is ignored. Treat metadata as
sensitive even though the queries do not print row values or secret values.

Run `psql` with `-X -q -v ON_ERROR_STOP=1` and capture stdout directly into a
new file under the ignored artifact directory. Convert that immutable capture,
for example:

```text
scripts/migration/catalog-jsonl-to-manifest.py \
  local-migration-artifacts/source-catalog.jsonl \
  --output local-migration-artifacts/source-manifest.json \
  --label rehearsal-source --role source --project-ref '<source-ref>' \
  --artifact-source '<capture-provenance>' \
  --evidence-kind database_catalog
```

The SQL output itself supplies the repeatable-read snapshot boundary and
transaction timestamp. The converter rejects operator-supplied replacements.
It also derives verification scope: a real source project is always marked not
independently verifiable, while synthetic fixtures and an independently read
owned target can be distinguished by role/project provenance.

Catalog component fingerprints use domain
`focus-flow-score/postgresql-component-evidence/v2\0`. Values are framed
recursively with explicit type tags: null `N`; boolean `B` plus one byte;
integer `I` and UTF-8 string `S` plus an unsigned 64-bit big-endian byte length
and payload; list `L` and object `D` plus an unsigned 64-bit item count and
framed children. Object keys are strings sorted lexicographically and framed
separately from their values. The evidence kind and the complete component
record are separate frames. This avoids type and boundary ambiguity without
depending on delimiters or PostgreSQL JSON text formatting.

Potentially sensitive catalog text (function/view/trigger definitions,
defaults, expressions, relation/function/foreign options, and cron commands)
is never emitted. PostgreSQL hashes each value as UTF-8 bytes using
`SHA256(domain_utf8 || 0x00 || int8send(byte_length) || value_utf8)` with a
field-specific domain; the converter validates every supplied fingerprint and
then includes it in the typed component frame. This is explicit byte framing,
not RFC 8785/JCS and not delimiter concatenation.

Any future data digest must be table-specific. Copy
`table-digest.template.sql`, hardcode and review its projection/ordering/type
framing, add deterministic synthetic vectors, and only then run it under a
separately authorized read-only verification. There is intentionally no generic
digest query in this repository.
