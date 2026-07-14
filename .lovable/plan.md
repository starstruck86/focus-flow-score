# Cloud → Personal Supabase Staging Mirror — v2.2 (plan only)

Scope unchanged from v2.1: Phase 1 staging mirror; real-table allowlist deferred; synthetic canary only. No build, DB writes, secrets, deploy, cron, or data movement performed by this plan.

---

## 1. Identity, ordering, and stream state

- **event_id** — `gen_random_uuid()`. Used ONLY as a globally unique row/message identity and for idempotency lookups. Never used for ordering, comparison, or cursor math.
- **stream_epoch** — `bigint`, persisted in `_bridge.stream_state` (single row). Incremented on any operator-approved reset (baseline re-take, corruption recovery). All ordering is scoped within `(stream_epoch, batch_id, batch_seq)`.
- **batch_id** — `bigint`, monotonically assigned by a source-side sequence at batch open.
- **batch_seq** — `int`, monotonically assigned per event **within** a batch by a batch-local counter; starts at 1, gap-free.
- **Global order** = lexicographic `(stream_epoch, batch_id, batch_seq)`. No `lsn`, no "max event" cursor, no UUID-based ordering anywhere.
- **prev_event_hash / event_hash** — SHA-256 chain over canonical event bytes (§7). `stream_state` stores the current chain tip `(stream_epoch, batch_id, batch_seq, event_hash)`.

---

## 2. Baseline mechanism (replaces snapshot-as-events)

Baseline is a distinct object, not a stream of delta events.

**Source side (single transaction T1 — "baseline lock"):**
1. `LOCK TABLE <allowlisted real tables> IN EXCLUSIVE MODE` (writes blocked, reads allowed). Phase 1 canary uses the synthetic table only.
2. Bump `stream_epoch`, open a new `batch_id`, assign `batch_seq = 0` as the reserved **baseline barrier**.
3. Insert one immutable `_bridge.baseline_manifest` row: `(stream_epoch, baseline_id, table_set[], row_count_per_table, chunk_count, chunk_size, content_hash_alg, created_at, operator_user_id)`.
4. Materialize baseline rows into `_bridge.baseline_chunks(baseline_id, chunk_no, canonical_bytes, chunk_hash)` — append-only, immutable after commit. Chunks are **not** events; they never enter `_bridge.outbox`.
5. Write the baseline-barrier event into `_bridge.outbox` at `batch_seq = 0` referencing `baseline_id` and `manifest_hash`. Commit.

`pg_export_snapshot()` is not used. Consistency comes from the table lock + single-transaction manifest write.

**Wire transfer:** baseline chunks are pulled by the target via a separate signed `get_baseline_chunk(baseline_id, chunk_no)` wrapper RPC (§4), streamed, and each chunk hash re-verified against the manifest.

**Target side (separate finalization transaction T2):**
- Applies chunks into staging tables under an advisory lock.
- Verifies `manifest_hash` and every `chunk_hash`.
- Writes `_bridge_tgt.baseline_receipts(baseline_id, stream_epoch, applied_at, persisted_state_hash)`.
- Marks target `stream_state` ready to accept `batch_seq >= 1` for that `(stream_epoch, batch_id)`.

Delta application before T2 commits is refused by the target wrapper RPC.

---

## 3. Signature verification location

- **Edge Function (target) verifies Ed25519** over the **exact raw HTTP request bytes** (not a re-serialized JSON). The function reads the raw body once, verifies signature + timestamp + nonce window, then hands the parsed payload to the DB.
- **Database RPC does NOT verify signatures.** Its responsibilities are strictly:
  1. Atomic nonce claim + batch/epoch resolution.
  2. Wire-version and schema-version validation.
  3. DML application inside one transaction.
  4. Read back persisted state and compute `persisted_state_hash`.
  5. Insert receipt row and advance chain tip.
- No cryptographic primitives run inside Postgres.

---

## 4. Schema isolation and wrapper RPCs

- All bridge tables live in private schemas: `_bridge` (source) and `_bridge_tgt` (target). `REVOKE ALL ... FROM PUBLIC, anon, authenticated`.
- No table is exposed via PostgREST. `GRANT USAGE ON SCHEMA ... TO service_role` only.
- Access is exclusively through a **fixed, closed set** of SECURITY DEFINER wrapper RPCs owned by a dedicated `bridge_owner` role, executable only by `service_role`:
  - Source: `bridge.open_batch`, `bridge.append_event`, `bridge.close_batch`, `bridge.baseline_begin`, `bridge.baseline_write_chunk`, `bridge.baseline_commit`, `bridge.claim_lease(limit)`, `bridge.ack_events(event_ids[])`, `bridge.get_baseline_chunk`.
  - Target: `bridge.apply_batch`, `bridge.finalize_baseline`, `bridge.get_state_digest`, `bridge.get_receipts(since_event_id)`.
- `SET LOCAL role ...` is removed everywhere. Privilege scoping is done by function ownership + `EXECUTE` grants.

---

## 5. Durable per-PK versioning and tombstones

**Source (`_bridge.row_versions`):** `(table_oid, pk_hash, current_version bigint, last_event_id, last_batch_id, last_batch_seq, deleted bool)`. Every emit atomically increments `current_version` for that PK inside the same transaction that inserts the outbox event; the event carries `pk_version_prev` and `pk_version_new`.

**Target (`_bridge_tgt.row_versions`):** same shape. `apply_batch` requires `event.pk_version_prev == stored.current_version`; otherwise the event is treated per §6.

**Tombstones** are first-class events (`op='delete'`) carrying `pk_version_new`; target stores `deleted=true` and retains the version row for later reconciliation. Retention/prune is deferred (§9).

---

## 6. Collision, staleness, and gap handling

- **Event hashes stored:** `_bridge.outbox_hashes(event_id PK, event_hash UNIQUE)` on source; `_bridge_tgt.applied_hashes(event_id PK, event_hash UNIQUE)` on target. Insert-time uniqueness violations on either `event_id` or `event_hash` cause the event to be **rejected**.
- **Never ACK a rejected event.** Source keeps it in the lease pool marked `rejected`, requires operator inspection.
- **Stale version** (`pk_version_prev < stored.current_version` and `event_hash` matches an already-applied hash): idempotent no-op, ACK.
- **Unexpected stale or gapped version** (mismatched hash, or `pk_version_prev > stored.current_version`, or `batch_seq` gap within an open batch): target sets `stream_state.status = 'paused'`, records the offending event, and refuses further `apply_batch` calls for that `(stream_epoch, batch_id)` until operator clears. No auto-skip, no auto-repair.

---

## 7. Canonical serialization, signing envelope, retries, hashing

- **Canonical form:** JCS (RFC 8785) over a fixed field order. Explicit type encoding:
  - integers as JSON numbers only when within IEEE-safe range; otherwise `{"$int":"<decimal>"}`.
  - `numeric`/`decimal` as `{"$num":"<decimal>"}`.
  - `timestamptz` as RFC 3339 UTC with `Z`, microsecond precision, `{"$ts":"..."}`.
  - `bytea` as `{"$b64":"..."}`.
  - `uuid` as lowercase canonical string `{"$uuid":"..."}`.
  - `null` distinguished from missing.
- **Signed envelope (raw bytes signed):**
  ```
  BRIDGE1\n
  <ISO8601 timestamp>\n
  <nonce (uuid)>\n
  <stream_epoch>\n
  <batch_id>\n
  <wire_version>\n
  <content_sha256_hex>\n
  <canonical_body_bytes>
  ```
  Signature = Ed25519 over the entire block above. HTTP carries `X-Bridge-Sig`, `X-Bridge-Ts`, `X-Bridge-Nonce`, `X-Bridge-Epoch`, `X-Bridge-Batch`, `X-Bridge-Wire`, and the raw canonical body. Target verifies signature against **exact received bytes**; any re-encoding is a verification failure.
- **Retries:** transport retries reuse the **same** `event_id`, `nonce`, timestamp, and signature. Target dedupes on `(nonce, event_id)`. Timestamp window: ±5 minutes; nonce cache TTL: 15 minutes.
- **Chain hashes on each event:**
  - `prev_event_hash` = previous event's `event_hash` (or genesis constant for `batch_seq=0` of a fresh epoch).
  - `event_hash = SHA256(prev_event_hash || canonical_envelope_bytes)`.
- **Persisted-state hashes (three, separate):**
  1. `event_chain_hash` — running SHA-256 over event chain, stored per receipt.
  2. `affected_state_hash` — SHA-256 over canonical serialization of the PKs touched by the batch, read back post-DML.
  3. `full_state_hash` — SHA-256 over canonical serialization of the entire allowlisted staging table set, computed on demand by `bridge.get_state_digest` (not per event; used at reconciliation checkpoints only).
  Receipts store all three where applicable.

---

## 8. Source authorization

- The source emitter Edge Function requires an **authenticated operator** JWT (`authenticated` role, plus explicit membership in `_bridge.operators(user_id)`), verified before any batch is opened or leased. `verify_jwt = true`.
- Service-role secret is used only for internal DB calls, never accepted from the client.
- Bridge secret (Ed25519 private key) lives only in the source Edge Function env; public key lives only in the target Edge Function env. Neither is readable from the DB.

---

## 9. First-run defaults, load, cleanup

- **First run:** on-demand invocation only (operator hits the source function). No cron, no schedule, no autostart.
- **Volume cap:** ~50 synthetic canary events, single batch, single baseline of a synthetic table.
- **No prune, no retention job, no backpressure enforcement** in this phase — outbox and receipts accumulate; operator inspects manually.
- **Load testing, retention/prune policy, backpressure thresholds, and cleanup RPCs are explicitly out of scope** and require separate written approval before design.

---

## 10. Target deployment provenance

- Target Edge Function is deployed **only** from a reviewed, tagged artifact (git SHA recorded in `_bridge_tgt.deploy_log` at first startup via a signed `bridge.record_deploy` call). Runtime refuses to serve if `deploy_log` is empty or SHA mismatch vs env-injected `BRIDGE_EXPECTED_SHA`.

---

## 11. Open items requiring your decision before v2.3 / build

1. Personal Supabase project URL + region (target).
2. Synthetic canary table shape (proposed: `_bridge_demo.canary(id uuid pk, n int, note text, updated_at timestamptz)`) — confirm or amend.
3. Operator user_id(s) to seed into `_bridge.operators`.
4. Wire version string for v1 (proposed: `bridge/1.0`).
5. Confirmation that baseline chunk size default of 1 MiB canonical bytes is acceptable for canary (irrelevant at 50 rows, but fixes the constant).

No implementation, DB change, secret, deploy, schedule, or data movement will occur until v2.2 is approved and the open items above are answered.
