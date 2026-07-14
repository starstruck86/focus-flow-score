
# Cloud → Personal Supabase Staging Mirror — v2.2.1

Plan-only correction to v2.2. No build, no DB/secret/deploy changes, no branches, no data movement. Await explicit approval before v2.3 or any implementation.

## 0. Scope (unchanged, restated)

- Phase 1: staging mirror only. No cutover.
- Synthetic canary only; **no real-table allowlist**.
- On-demand invocation only. No cron, no pruning, no retention, no load tests.
- ~50 operations total (20 baseline + 30 delta) per canary run.
- One-way Cloud → Personal target. Target never calls Cloud, never holds Cloud credentials.
- Candidate target for planning only: `dynamic-staging`, `https://uujkmcbqavsmzhnbqvmm.supabase.co`, `us-east-1`. Populated project — recommend an isolated branch/project before any deploy; do not modify without separate approval.

---

## 1. Baseline atomicity (replaces v2.2 begin/write/commit trio)

### 1.1 Single source RPC: `_bridge.baseline_seal()`

One transaction, service-role-only, hardcoded to `_bridge_demo.canary`:

1. `LOCK TABLE _bridge_demo.canary IN SHARE MODE` — blocks concurrent DML for the duration.
2. `UPDATE _bridge.stream_control SET stream_epoch = stream_epoch + 1 RETURNING stream_epoch` (row-locked first).
3. Materialize an immutable, typed snapshot into `_bridge.baseline_rows(stream_epoch, pk_uuid, row_jsonb, row_bytes_len)` — types resolved from `information_schema`, values captured as-is (no JCS in SQL).
4. Initialize `_bridge.pk_version(stream_epoch, pk_uuid, version bigint, tombstone bool)` to `version = 1, tombstone = false` for each baseline PK.
5. Mark pre-existing outbox rows with `covered_by_epoch = new_epoch` (soft-cover; no DELETE). Any row with `stream_epoch < covered_by_epoch` is ineligible for delivery.
6. Insert `_bridge.baseline_manifest(stream_epoch, row_count, sealed_at, status='sealed_pre_encode')`.
7. Commit; lock releases.

### 1.2 Post-transaction encoding (Edge Function, tested JCS impl)

Separate source RPC `_bridge.baseline_read_chunk(stream_epoch, offset, limit)` returns raw rows. The Edge Function:

- Encodes each row with the audited JCS implementation.
- Splits into chunks under the 1 MiB canonical-body ceiling with explicit `max_events_per_chunk` and `max_row_bytes` (oversized rows are hard-rejected — canary fails loudly).
- Computes `chunk_hash = SHA256("BRIDGE-BCHUNK-v1" || stream_epoch || chunk_no || jcs_bytes)`.
- Seals `baseline_manifest_hash = SHA256("BRIDGE-BMAN-v1" || stream_epoch || chunk_count || ordered_chunk_hashes || total_row_count)`.
- Marks the manifest `status='encoded'` via `_bridge.baseline_encoding_seal(stream_epoch, manifest_hash, chunk_hashes[])` — immutable after this call.

---

## 2. Baseline push (one-way, no reverse calls)

Source pushes signed messages `baseline_manifest`, `baseline_chunk`, `baseline_finalize` to target. Target holds **no Cloud credential** and makes **no Cloud calls**.

### Target RPCs (private schema `_bridge_tgt`, wrappers in already-exposed API schema, service-role-only):

- `stage_baseline_manifest(stream_epoch, manifest_hash, chunk_count, total_row_count)` — idempotent; second call with same `(epoch, manifest_hash)` is a no-op; different hash → 409.
- `stage_baseline_chunk(stream_epoch, chunk_no, chunk_hash, jcs_bytes)` — idempotent on `(epoch, chunk_no, chunk_hash)`; same `chunk_no` with different `chunk_hash` → 409.
- `finalize_baseline(stream_epoch, manifest_hash)` — atomically:
  - Verifies all `chunk_count` chunks present and hash-matched.
  - Decodes rows into `_bridge_tgt.mirror_canary`.
  - Initializes `_bridge_tgt.pk_version(pk, version=1, tombstone=false)` for each baseline PK.
  - Computes `persisted_baseline_state_hash = SHA256("BRIDGE-BSTATE-v1" || ordered_by_pk(pk || version || row_jcs))` via `pgcrypto.digest` inside the transaction.
  - Computes `baseline_receipt_hash = SHA256("BRIDGE-BRCPT-v1" || stream_epoch || manifest_hash || persisted_baseline_state_hash)`.
  - Persists `_bridge_tgt.baseline_receipts(stream_epoch, manifest_hash, persisted_baseline_state_hash, baseline_receipt_hash, finalized_at)`.
  - Returns the receipt.

`baseline_receipt_hash` **is the genesis `previous_receipt_hash` for the epoch's delta chain**. The v2.2 baseline-barrier delta event is removed.

---

## 3. Capture vs delivery batching (fully separated)

### 3.1 Trigger (capture only)

Private `AFTER INSERT/UPDATE/DELETE FOR EACH ROW` trigger on `_bridge_demo.canary`, in the same business transaction:

- Reads `_bridge.stream_control.stream_epoch` (single row).
- Advances `_bridge.pk_version` for the affected PK atomically (`INSERT ... ON CONFLICT (stream_epoch, pk) DO UPDATE SET version = pk_version.version + 1 RETURNING version`). Deletes set `tombstone = true` and still bump `version`.
- Inserts one `_bridge.outbox_event` row: `event_id uuid`, `stream_epoch`, `table_key text` (stable logical name `_bridge_demo.canary`; **never `oid`**), `pk_uuid`, `pk_version`, `op`, `row_jsonb_before/after`, `captured_at`, `batch_id NULL`, `batch_seq NULL`, `covered_by_epoch NULL`.

Trigger never touches batching, hashing, or signing.

### 3.2 `_bridge.claim_batch()` (delivery)

- `SELECT ... FROM _bridge.stream_control FOR UPDATE` — serializes claimers.
- If an in-flight batch exists (`status IN ('claimed','sent','awaiting_ack')` within lease), return it verbatim (recovery path).
- Else create exactly one new batch:
  - `batch_id = gen_random_uuid()` (identity only).
  - `batch_ordinal = stream_control.next_batch_ordinal; UPDATE ... SET next_batch_ordinal = next_batch_ordinal + 1` (gap-free, transactional).
  - Select pending events: `WHERE stream_epoch = current_epoch AND batch_id IS NULL AND (covered_by_epoch IS NULL OR covered_by_epoch = current_epoch) ORDER BY pk_uuid, pk_version, captured_at, event_id LIMIT :cap`. Per-PK version order is preserved.
  - Assign `batch_seq = 1..n` and `UPDATE outbox_event SET batch_id, batch_seq` for exactly those event IDs.
  - Compute `batch_content_hash` (see §5) and store on `_bridge.batches(batch_id, stream_epoch, batch_ordinal, batch_content_hash, event_ids uuid[], lease_expires_at, status)`.
- **Canary constraint:** at most one in-flight batch. `claim_batch` refuses to create a new one until the previous is ACKed or expired.

### 3.3 ACK

- ACK payload lists exact `event_ids[]` plus `(stream_epoch, batch_ordinal, batch_id)`.
- Source verifies event set equality against `batches.event_ids`.
- On success: mark events `acked`, batch `status='acked'`, persist target-returned receipt row `_bridge.receipts(receipt_ordinal serial, stream_epoch, batch_ordinal, batch_id, receipt_chain_hash, batch_content_hash, persisted_state_hash, received_at)`.
- Receipt pagination for operator inspection uses `(stream_epoch, batch_ordinal)` or `receipt_ordinal`. No UUID comparison. No `since_event_id`.

---

## 4. Retry semantics

Batch identity (`batch_id`, `batch_content_hash`) is immutable. Delivery attempts are separate.

- `_bridge.delivery_attempt(attempt_id uuid, batch_id, attempt_nonce uuid, signed_at timestamptz, envelope_sha256, signature, status)`.
- 5-minute nonce window: exact `(attempt_nonce, envelope_sha256)` replay → target returns stored receipt without reapplying.
- Same `attempt_nonce`, different `envelope_sha256` → 409 `nonce_reuse`.
- After nonce expiry: source re-signs the same immutable batch with a new `signed_at` and new `attempt_nonce`; produces a new envelope and signature. Batch content hash unchanged.
- Target dedup key on apply is `(stream_epoch, batch_id, batch_content_hash)`:
  - Match → return existing receipt (durable, idempotent).
  - `batch_id` present, different `batch_content_hash` → 409 `batch_content_conflict`.
- **Commit-then-lost-ACK:** target commits inside one RPC (apply + receipt insert). If HTTP response is lost, source retries the delivery attempt; target recognizes `(batch_id, batch_content_hash)` and returns the persisted receipt.

---

## 5. Hash hierarchy (non-circular, frozen)

```
event_payload =
  { stream_epoch, table_key, pk_uuid, pk_version, op,
    row_jsonb_before, row_jsonb_after, captured_at, event_id }
  // excludes any hash, nonce, timestamp of signing, signature

event_hash =
  SHA256( "BRIDGE-EVENT-v1" || JCS(event_payload) )

batch_content_hash =
  SHA256( "BRIDGE-BATCH-v1" ||
          u64be(stream_epoch) || u64be(batch_ordinal) ||
          concat( ordered_event_hashes_by_batch_seq ) )

receipt_chain_hash =
  SHA256( "BRIDGE-CHAIN-v1" ||
          previous_receipt_hash ||           // baseline_receipt_hash at seq 1
          u64be(stream_epoch) ||
          u64be(batch_ordinal) ||
          batch_id_bytes ||
          batch_content_hash )
```

`event_hash` and `batch_content_hash` are stable across retries — only the delivery signature and its envelope change.

### 5.1 Wire grammar (Ed25519 signed envelope, length-delimited)

Signed input is the exact concatenation:

```
"bridge/1.0\n"                                        // protocol
"schema=1\n"                                          // message-schema version
"kid=" || key_id || "\n"
"src=" || source_id || "\n"
"dst=" || target_id || "\n"
"kind=" || message_kind || "\n"                       // baseline_manifest|baseline_chunk|baseline_finalize|delta_batch|ack
"epoch=" || dec(stream_epoch) || "\n"
"batch=" || batch_id_b64url || "\n"                   // zero-uuid for baseline_manifest/finalize
"ord=" || dec(batch_ordinal) || "\n"                  // 0 for baseline messages
"ts=" || rfc3339_utc(signed_at) || "\n"
"nonce=" || attempt_nonce_b64url || "\n"
"blen=" || dec(canonical_body_len_bytes) || "\n"
"bsha=" || body_sha256_hex || "\n"
"---\n"
<canonical_body_bytes>                                // exactly blen bytes, UTF-8, no trailing newline
```

- Newlines are single LF (`0x0A`) exactly where shown.
- All base64url uses no padding.
- Target reconstructs and **verifies the exact received bytes** (signature + `blen` + `bsha`) **before** JSON parsing the body.
- Any mismatch → 400 `envelope_invalid`; never applied.

---

## 6. Reconciliation & full-state check

### 6.1 Baseline seeding

`finalize_baseline` initializes `_bridge_tgt.pk_version` and `_bridge_tgt.tombstones` from baseline rows. Deltas below build on this state.

### 6.2 Delta apply rules (per event, in `batch_seq` order, single transaction per batch)

| Condition | Result |
|---|---|
| Same `event_id`, same `event_hash` | duplicate → skip, still ACK |
| Same `event_id`, different `event_hash` | 409 `event_content_conflict`, batch rejected, **not ACKed** |
| Target `pk_version` for pk == incoming.version, different `row_jcs` | 409 `pk_version_content_conflict`, **not ACKed** |
| Incoming `pk_version <= target.pk_version` for pk (single-worker canary) | **pause** as `protocol_error_stale_version`, **not ACKed** |
| Incoming `pk_version > target.pk_version + 1` | **pause** as `protocol_error_version_gap`, **not ACKed** |
| Incoming `pk_version == target.pk_version + 1` | apply; update `pk_version`; deletes retain durable tombstone + version |

Rejected/paused batches are **never ACKed**. Operator must inspect and explicitly resume/reset.

### 6.3 Full-state digest

- Source RPC `_bridge.full_state_digest(stream_epoch)` — under `LOCK TABLE ... IN SHARE MODE`, computes `SHA256("BRIDGE-FSTATE-v1" || ordered_by_pk(pk || live_row_jcs))` + exact row set.
- Target RPC `_bridge_tgt.full_state_digest(stream_epoch)` — same construction over mirror.
- **Canary success requires:** write pause on source → drain outbox → ACK the final batch → both digests computed at the same fixed boundary → source and target row sets equal AND digests equal.

---

## 7. RPC & permission model

- Data tables in private schemas `_bridge` (source) and `_bridge_tgt` (target). Not exposed to PostgREST.
- **Do not** attempt to add `_bridge*` to the managed Cloud Data API `db-schema` allowlist.
- Fixed-name, service-role-only wrapper functions in an already-exposed API schema (`public`), prefixed `bridge_v1_*`, each `SECURITY DEFINER`.
- Every wrapper:
  - Owned by a dedicated role `bridge_owner` with `NOLOGIN NOBYPASSRLS`.
  - `SET search_path = pg_catalog, pg_temp` (empty/safe).
  - Fully qualifies every object (`_bridge.stream_control`, etc.).
  - Takes only typed scalars/arrays — **no client-controlled schema/table identifiers**.
  - `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;`
  - `GRANT EXECUTE ... TO service_role;`
- Transactional SHA-256 uses `pgcrypto.digest(..., 'sha256')` inside RPCs. **Asymmetric signature verification stays in the Edge Function** (Ed25519 verify with pinned `kid` → public key map).

Wrappers (source): `bridge_v1_baseline_seal`, `bridge_v1_baseline_read_chunk`, `bridge_v1_baseline_encoding_seal`, `bridge_v1_claim_batch`, `bridge_v1_ack_batch`, `bridge_v1_full_state_digest`, `bridge_v1_stream_status`.
Wrappers (target): `bridge_v1_stage_baseline_manifest`, `bridge_v1_stage_baseline_chunk`, `bridge_v1_finalize_baseline`, `bridge_v1_apply_delta_batch`, `bridge_v1_full_state_digest`, `bridge_v1_receipts_page`.

Explicit authenticated operator authorization to invoke the source emitter Edge Function is preserved (JWT + operator UUID allowlist injected at deploy time as env, never in chat).

---

## 8. Deployment provenance (deploy_log demoted)

- `deploy_log` is informational only. Not a proof, not a precondition.
- Actual target verification (pre-invocation) is:
  1. Pin exact commit SHA + full artifact SHA-256 of the target bundle + config file.
  2. Deploy the complete target function bundle and configuration.
  3. Retrieve the deployed function body + config via the **user-owned Supabase Management connector** (Corey's PAT scope on the personal project).
  4. Compare retrieved artifact bytes to the reviewed artifact SHA-256.
  5. Only then invoke.
- Runtime-reported SHAs (e.g. a `/version` endpoint) are **not** sufficient alone.

---

## 9. Canary fixture & tests

### 9.1 Canonical table

```
CREATE TABLE _bridge_demo.canary (
  id         uuid PRIMARY KEY,
  n          integer NOT NULL,
  note       text    NOT NULL,                        -- bounded: octet_length(note) <= 512
  updated_at timestamptz NOT NULL
);
```

### 9.2 Deterministic acceptance fixture

- Seed: 20 rows in the sealed baseline (fixed UUIDs, deterministic `n`, `note`, `updated_at`).
- Post-baseline: 10 inserts (new UUIDs), updates on 10 surviving baseline rows, deletes on 10 other baseline rows.
- Totals: 20 baseline row applications + 30 delta events.
- **Expected final target state:** exactly 20 predetermined rows (10 untouched baseline + 10 updated baseline + 10 inserted; 10 baseline deleted; tombstones retained).
- Both full-state digests must match at the fixed boundary.

### 9.3 Negative tests (all must fail closed, never ACK)

1. DML attempted during `baseline_seal` lock window → blocked/serialized; baseline still atomic.
2. Delta event arriving before its epoch's baseline is finalized → rejected `baseline_not_ready`.
3. Missing chunk on `finalize_baseline` → rejected `baseline_incomplete`.
4. Corrupt chunk bytes (hash mismatch) → rejected `chunk_hash_mismatch`.
5. Duplicate chunk_no, different hash → 409 `chunk_conflict`.
6. Exact envelope replay within nonce window → returns stored receipt, no reapply.
7. Re-signed retry after nonce expiry, same `batch_content_hash` → returns durable receipt.
8. Same `batch_id`, different `batch_content_hash` → 409 `batch_content_conflict`.
9. Target commit + simulated lost HTTP response → next attempt returns durable receipt; state unchanged.
10. Wrong `previous_receipt_hash` predecessor → 409 `chain_predecessor_mismatch`.
11. `pk_version` gap → pause `protocol_error_version_gap`.
12. Stale `pk_version` (already applied higher) → pause `protocol_error_stale_version`.
13. Delete then reinsert same PK → new row uses `pk_version = tombstone.version + 1`; tombstone retained in registry.
14. Full-state digest detects: missing row, extra row, single-field corruption in mirror.

---

## 10. Decisions locked for planning

- **Target project (planning only):** `dynamic-staging` @ `https://uujkmcbqavsmzhnbqvmm.supabase.co`, `us-east-1`. Populated — recommend isolated Supabase branch or separate project before any deploy. Not modified under this plan.
- **Canary table:** as §9.1, hardcoded in RPCs.
- **Operator UUIDs / PAT / signing keys:** deployment-time parameters. Not committed. Not requested in chat.
- **Wire version:** `bridge/1.0`.
- **Chunk ceiling:** 1 MiB canonical body max; `max_events_per_chunk` and `max_row_bytes` enforced; oversized row → hard reject.
- **First run:** on-demand, ~50 ops, no cron, no prune, no retention. Load/cleanup drills require separate approval.

---

## 11. Open items for approval (v2.3 gate)

1. Confirm isolated target project vs. Supabase branch of `dynamic-staging` for the actual canary run.
2. Confirm `bridge_v1_*` naming and `public` as the exposed wrapper schema (vs. a dedicated exposed schema like `bridge`).
3. Confirm Ed25519 `kid`→public-key registry lives in the target's private schema (seeded at deploy from env), not fetched at runtime.
4. Confirm operator authorization surface: JWT + operator UUID allowlist env var on the source emitter.
5. Confirm acceptance fixture UUIDs/values will be provided at v2.3 (deterministic, checked-in as a test vector).

Stop. Awaiting explicit approval before v2.3 or any implementation.

---

# v2.2.1 — Binding Implementation Addendum (frozen)

Status: architectural basis conditionally approved. This addendum FREEZES the contract items below. No build, no DB/secret/deploy/branch/commit/tag/invoke/data movement. v2.3 draft PR must satisfy every item verbatim.

## A. Expired-batch recovery (single in-flight rule)
- `public.bridge_v1_claim_batch(p_stream_epoch)`:
  - Locks stream-control row.
  - If ANY non-ACKed batch exists (lease valid OR expired): RECOVER and renew lease. Return the SAME `batch_id`, `batch_ordinal`, ordered `event_ids`, `batch_seq` assignment, and `batch_content_hash`. Zero mutation of these five fields.
  - Only when no unresolved batch exists may a new batch be created.
  - Never permits >1 in-flight batch per stream during canary.

## B. Persisted-state canonicalization (SQL-side)
- JCS (RFC 8785) is WIRE/EVENT-only. Postgres MUST NOT use `jsonb::text` as a JCS substitute.
- Define `_bridge.row_encode_canary_v1(row)` — fixed, versioned, length-delimited SQL encoding:
  - Tag: ASCII `"BRIDGE-ROW-CANARY-v1"` || LF
  - Per field, in fixed order: `id uuid`, `n int4`, `note text (≤N bytes)`, `updated_at timestamptz`, `pk_version int8`, `tombstone bool`
  - Each field: 1-byte type tag || 4-byte big-endian length || raw bytes (UUID=16B, int4=4B BE, int8=8B BE, text=UTF-8 bytes with declared byte cap enforced, timestamptz=int8 microseconds since epoch UTC BE, bool=1B).
- `row_hash = sha256("BRIDGE-ROW-CANARY-v1" || row_encode_canary_v1(row))`.
- `table_state_hash = sha256("BRIDGE-STATE-CANARY-v1" || concat(row_hash ORDER BY pk_uuid ASC))`.
- Cross-runtime test vectors REQUIRED (checked-in): source SQL, target SQL, TypeScript produce identical hex for a fixed fixture of ≥8 rows including edge cases (min/max int, unicode note at byte cap, tombstoned row, epoch-boundary timestamp).
- Delta apply MUST, inside the same target transaction, read back affected rows/tombstones, recompute the affected-state hash, and reject (rollback, no ACK) if it disagrees with the source-signed expectation.

## C. Deterministic baseline extraction
- `public.bridge_v1_baseline_read_chunk(p_epoch, p_chunk_no)`:
  - Hardcoded projection list for `_bridge_demo.canary` (`id, n, note, updated_at, pk_version, tombstone`). No `information_schema`, no dynamic SQL for columns.
  - `ORDER BY id ASC` (pk_uuid); deterministic chunk boundaries by `(chunk_no-1)*CHUNK_ROW_LIMIT` OFFSET / LIMIT computed over the sealed immutable baseline table.
  - Rejects if `stream_epoch <> p_epoch` OR baseline seal state ≠ `sealed`.
- Covered-event exclusion uses explicit `covered_by_epoch IS NULL` semantics on the outbox. NEVER "eligible because marker == current_epoch".

## D. Stream-state transitions (frozen state machine)
- `baseline_seal()` REFUSES to start while any non-ACKed batch exists (any epoch).
- New epoch txn: `next_batch_ordinal := 1`; increments `stream_epoch`.
- Post-source-seal: source state = `baseline_encoded_pending`; delta `claim_batch` DISABLED.
- Target baseline finalization → computes `baseline_receipt_hash` = initial chain tip for epoch.
- Source verifies target receipt, persists it, transitions to `streaming`.
- Target accepts a delta batch iff: exact expected `epoch`, `batch_ordinal == last_applied_ordinal+1`, and `previous_receipt_hash == target_chain_tip`.
- Target advances chain tip ONLY inside the successful apply transaction.
- Source advances chain tip ONLY after verifying and persisting the returned receipt.
- Any chain mismatch → stream PAUSED, no ACK, operator intervention required.

## E. ACK contract
- `ack` REMOVED from source-signed message kinds. No target signing key introduced for canary.
- Target returns receipt over HTTPS response body.
- Source verifies receipt contains EXACT expected: `epoch`, `batch_id`, `batch_ordinal`, `batch_content_hash`, `previous_receipt_hash`, `receipt_chain_hash`, `event_id_set` (exact set equality), `affected_state_hash`.
- Any missing/added/altered `event_id` → fail-closed rejection, no ACK, stream paused.

## F. Signing-key placement
- Public `kid → Ed25519 public key` map lives in the reviewed TARGET ARTIFACT/CONFIGURATION (function bundle + env), not a mutable DB row.
- Source Ed25519 private key: source Edge Function secret store ONLY.

## G. Function security (frozen)
- Source emitter (`bridge-export`): `verify_jwt=true` + explicit operator UUID allowlist check post-JWT.
- Target ingest (`bridge-ingest`): `verify_jwt=false` (custom Ed25519 over exact raw bytes is mandatory pre-parse).
- Public wrapper names: hardcoded `public.bridge_v1_*` only.
- Data tables: `_bridge.*` (source), `_bridge_tgt.*` (target).
- Every SECURITY DEFINER wrapper: `SET search_path = ''` (or `pg_catalog` only; NO `pg_temp`); all objects fully qualified; no client-controlled schema/table identifiers.
- `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`; `GRANT EXECUTE ... TO service_role` only.

## H. Locked planning decisions
- Wire: `bridge/1.0`.
- Canary table + 20-baseline/30-delta fixture: approved.
- Operator UUIDs, signing keys, PATs: deployment-time only; never requested in chat, never committed.
- Target: prefer isolated Supabase branch or separate project. `dynamic-staging` (`uujkmcbqavsmzhnbqvmm`) is populated and NOT AUTHORIZED for modification.
- Excluded from canary: cron, pruning, cleanup, retention automation, load testing, real tables.

---

## Artifact Map (condition → planned artifact)

| Item | Artifact |
|---|---|
| A. Expired-batch recovery | migration `bridge/0003_claim_batch.sql` → `public.bridge_v1_claim_batch`; test `bridge/tests/claim_recovery.sql` (expired-lease preserves 5 fields; forbids parallel batch) |
| B. Row/state encoding | migration `bridge/0004_canonical_encoding.sql` → `_bridge.row_encode_canary_v1`, `_bridge.row_hash_canary_v1`, `_bridge.table_state_hash_canary_v1`; TS `supabase/functions/_shared/bridge/encodeCanaryRow.ts`; test vectors `bridge/tests/vectors/canary_rows.json` + parity runners `bridge/tests/parity_{sql,ts}.test.*` |
| B. Affected-state readback | migration `bridge/0007_apply_batch.sql` → `public.bridge_v1_apply_batch` (single-txn readback+compare+rollback); test `bridge/tests/apply_state_mismatch.sql` |
| C. Deterministic baseline read | migration `bridge/0005_baseline.sql` → `public.bridge_v1_baseline_read_chunk` (hardcoded projection, ORDER BY id, epoch/seal guard); test `bridge/tests/baseline_determinism.sql` |
| C. Covered-event semantics | migration `bridge/0002_outbox.sql` (adds `covered_by_epoch`); test `bridge/tests/covered_exclusion.sql` |
| D. State machine | migration `bridge/0006_stream_state.sql` (control row + transitions + guards); test `bridge/tests/state_transitions.sql` |
| E. ACK contract | edge function `supabase/functions/bridge-export/receiptVerify.ts`; test `bridge/tests/receipt_contract.test.ts` (missing/added/altered event_id → reject) |
| F. Key placement | env in target bundle (`BRIDGE_KID_MAP_JSON`); source secret `BRIDGE_SRC_ED25519_SK`; test `bridge/tests/key_placement.test.ts` (no DB read for pubkeys) |
| G. verify_jwt + operator allowlist | `supabase/config.toml` entries for `bridge-export` (true) and `bridge-ingest` (false); source `operatorAuthz.ts`; test `bridge/tests/authz.test.ts` |
| G. Wrapper hygiene | linter script `bridge/tests/wrapper_hygiene.sql` (asserts search_path, ownership, grants for every `bridge_v1_*`) |
| H. Fixture + decisions | `bridge/fixtures/canary_20_30.json`; `bridge/README.md` records wire=`bridge/1.0`, target=isolated branch TBD (NOT `dynamic-staging`) |
| Provenance | pinned SHA-256 in `bridge/RELEASE.md`; verified via Management connector pre-invocation |

Nothing above is created in this turn. This is the frozen contract for the v2.3 draft PR.

## Technical Blockers (true, must be resolved before v2.3 begins)
1. **Isolated target project ref unresolved.** `dynamic-staging` is explicitly out-of-bounds. v2.3 cannot deploy target artifacts until Corey names an isolated Supabase branch or separate project ref (and a service_role key issued only to that project).
2. **Cross-runtime hash parity requires a real Postgres runtime for test-vector generation.** Deno test env alone cannot prove SQL parity; v2.3 must include a Postgres-container step (or equivalent) in CI to run `bridge/tests/parity_sql.test.sql` and diff against the checked-in vectors.
3. **`verify_jwt=true` on `bridge-export` requires an authenticated operator session.** No blocker for design, but v2.3 must ship an invocation harness (script or checked-in curl recipe) that uses an operator-owned JWT; no shared/service token substitute.

No other blockers identified. Awaiting explicit authorization to draft v2.3 PR.
