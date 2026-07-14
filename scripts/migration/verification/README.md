# Read-only migration verification templates

These files are local templates for a future, separately authorized rehearsal.
They were not run against Lovable Cloud, an owned Supabase project, or any
production data in this PR.

- `catalog-and-counts.sql` starts a read-only transaction and emits schema/object
  metadata, exact user-table counts, supported single-column primary-key ranges,
  sequence values, RLS state, policies, functions, triggers, extension versions,
  and publications. It emits no table rows.
- `supabase-service-counts.sql` starts a read-only transaction and emits Auth
  user/identity counts, per-bucket Storage object counts, and scheduled-job
  metadata. Access to managed schemas is role-dependent; an authorization error
  is a failed collection, not a zero count.
- `inventory-edge-functions.py` inventories reviewed repository slugs, hashes
  each function directory, and reports whether `verify_jwt` is explicit in
  `supabase/config.toml`. An omitted setting remains configuration-unknown.
- `manifest.schema.example.json` documents the strict comparison format.
- `compare-manifests.py` compares two local manifests and reports `Match`,
  `Missing on target`, `Unexpected on target`, `Count mismatch`,
  `Configuration unknown`, `Not independently verifiable`, and (when known
  fingerprints differ) `Configuration mismatch`. It exits `0` only when every
  component is exactly `Match`, `2` for any discrepancy/unknown, and `1` for an
  invalid manifest.

The SQL must be reviewed with the exact connection target visible before use.
Do not paste credentials into shell history or committed files. Capture stdout
only under `local-migration-artifacts/`, which is ignored. Treat metadata as
sensitive even though the queries do not print row values or secret values.

Any future data digest must be table-specific. Copy
`table-digest.template.sql`, hardcode and review its projection/ordering/type
framing, add deterministic synthetic vectors, and only then run it under a
separately authorized read-only verification. There is intentionally no generic
digest query in this repository.
