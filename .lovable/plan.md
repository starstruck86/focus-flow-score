# Bridge Sync — Plan v2.1 (Staging Mirror, Canary-Only)

**Status:** design only. No build, no DB changes, no secrets, no deploys.
**Scope:** Phase 1 = staging mirror of Lovable Cloud (source) → user-owned personal Supabase (target). Allowlist deferred. First run is a synthetic canary against one throwaway table.

---

## 0. Corrections from v2 (what changed and why)

| # | v2 defect | v2.1 fix |
|---|---|---|
| 1 | Fake `lsn` bigint, ACK by `≤ checkpoint` | Real `event_id` UUIDv7; lease/ACK/prune by **exact event_id set** |
| 2 | Cross-network `FOR UPDATE` while HTTP call ran | Two short RPCs: `bridge_claim_batch` (lease + return) and `bridge_ack_batch` (finalize); no long-held row locks across the wire |
| 3 | Baseline was app-enforced | `bridge_seal_baseline()` RPC: in ONE tx, takes advisory lock, creates `pg_export_snapshot()`-pinned materialized snapshot rows, writes a `baseline_barrier` event, flips `bridge_state='streaming'` |
| 4 | Target upsert + receipt in separate statements | Single `bridge_apply_batch()` RPC on target: upserts rows, inserts receipts, updates cursor, all in one tx; returns per-event outcome |
| 5 | One opaque "state hash" | Three separate hashes: **event_chain_hash** (envelope integrity), **affected_state_hash** (only PKs in this batch, post-apply), **full_state_hash** (nightly, whole allowlisted table) |
| 6 | Retries were "just re-send" | Idempotent by `event_id`; per-PK stale-event rule = drop if a newer `source_row_version` for same PK is already applied on target |
| 7 | JSON with sort-however | Canonical JSON (RFC 8785 JCS) + Ed25519 signed envelope with explicit fields and replay window |
| 8 | Public schema, no limits, hand-wavy cleanup | Private `bridge` schema with locked grants; retention + backpressure caps; exact prune contract; target deployed from a reviewed release artifact |

---

## 1. Topology

```text
┌────────────────────────┐        HTTPS + Ed25519 envelope        ┌───────────────────────────┐
│  Source: Lovable Cloud │  ────────────────────────────────────► │  Target: Personal Supabase │
│  edge fn: bridge-emit  │                                        │  edge fn: bridge-ingest    │
│  schema: bridge.*      │  ◄──── ack (event_ids, outcomes) ───── │  schema: bridge.*          │
└────────────────────────┘                                        └───────────────────────────┘
```

- One-directional. Source is authoritative. Target is read-mostly staging.
- No target service-role key on source. Source only holds a scoped bridge secret.
- No browser client is added. Server-to-server only.

---

## 2. Canary scope (first run)

- Single synthetic table `bridge.canary_rows` (`id uuid pk`, `payload text`, `row_version bigint`, `updated_at timestamptz`).
- Not a production table. Purpose: prove the pipeline end-to-end (baseline → stream → ack → hashes → nightly full-state) before any real allowlist is even discussed.
- Real allowlist stays **deferred**; adding a table requires a written approval step that is out of scope for this plan.

---

## 3. Source side (`bridge` schema, private)

### 3.1 Tables (source)

- `bridge.tables_enrolled(table_name text pk, pk_columns text[], enrolled_at timestamptz, sealed_baseline_at timestamptz)`
- `bridge.outbox(event_id uuid pk default uuidv7(), table_name text, pk jsonb, op text check in ('insert','update','delete'), row_version bigint, row_image jsonb, tombstone bool, created_at timestamptz)`
  - `row_version` = monotonic per (table, pk) counter, assigned by trigger.
  - Ordered per PK by `row_version`; global order by `event_id` (uuidv7 = time-sortable).
- `bridge.baseline_snapshots(snapshot_id uuid pk, table_name text, pg_snapshot text, created_at timestamptz, sealed bool)`
- `bridge.leases(lease_id uuid pk, event_ids uuid[], leased_at timestamptz, expires_at timestamptz, consumer text)`
- `bridge.acks(event_id uuid pk, outcome text, applied_at timestamptz, target_row_version bigint)`
- `bridge.state(k text pk, v jsonb)` — holds `mode ∈ {idle, baselining, streaming, paused}` and canary flags.

### 3.2 RPCs (source, `security definer`, granted only to bridge role)

- `bridge_seal_baseline(p_table text)`
  - One tx: `pg_advisory_xact_lock`, `SELECT pg_export_snapshot()`, materialize current rows into `baseline_snapshots` + emit one `baseline_barrier` event into `outbox`, set `sealed_baseline_at`, set `state.mode='streaming'`.
- `bridge_claim_batch(p_max int, p_lease_ms int) → (lease_id, events[])`
  - Short tx: `SELECT ... FROM outbox WHERE event_id NOT IN (acked ∪ leased-not-expired) ORDER BY event_id LIMIT p_max FOR UPDATE SKIP LOCKED`, insert `leases` row, return. **No network I/O inside this tx.**
- `bridge_ack_batch(p_lease_ids uuid[], p_results jsonb)`
  - Short tx: insert into `acks` per event_id with outcome, delete matching `leases` rows.
- `bridge_prune(p_before timestamptz)`
  - Deletes `outbox` rows whose `event_id` is in `acks` AND `created_at < p_before` AND older than retention floor.

### 3.3 Trigger contract

- On every enrolled table: `AFTER INSERT/UPDATE/DELETE` writes to `bridge.outbox` with computed `row_version = coalesce(max+1,1)` per PK, `tombstone=true` on delete. No trigger on non-enrolled tables. For canary phase only `bridge.canary_rows` is enrolled.

---

## 4. Envelope (canonical + signed)

### 4.1 Canonical serialization

- Body serialized with **JCS (RFC 8785)**: sorted keys, no insignificant whitespace, canonical numbers, UTF-8 NFC.
- Timestamps: RFC 3339 UTC, `Z` suffix, microsecond precision truncated to millisecond.

### 4.2 Envelope shape

```json
{
  "v": 1,
  "kid": "bridge-2026-07",
  "issuer": "cloud-source",
  "audience": "personal-target",
  "issued_at": "2026-07-14T00:00:00.000Z",
  "not_after": "2026-07-14T00:05:00.000Z",
  "nonce": "01J...ULID",
  "batch": {
    "lease_id": "uuid",
    "events": [ { "event_id":"uuid","table":"bridge.canary_rows","op":"update","pk":{"id":"..."},"row_version":42,"row_image":{...},"tombstone":false } ],
    "event_chain_hash": "sha256:...",
    "affected_state_hash_precheck": "sha256:..."
  }
}
```

- Signature: **Ed25519** over the JCS-serialized envelope minus the `sig` field. Attached as `sig` sibling in transport JSON.
- Replay window: target rejects if `now() ∉ [issued_at - 60s, not_after]`, or if `nonce` seen within window (target keeps `bridge.seen_nonces`).

### 4.3 Three hashes (explicitly split)

- **event_chain_hash**: `sha256` over concatenation of JCS-serialized events in batch, in event_id order. Verifies envelope integrity + ordering.
- **affected_state_hash**: `sha256` over `(pk, row_version, row_image_or_tombstone)` for the exact PK set in this batch, computed on target **after** apply. Verifies convergence on just what this batch touched.
- **full_state_hash**: nightly job, per table, `sha256` over PK-ordered `(pk, row_version, row_image)` for the whole allowlisted table. Verifies no long-term drift.

Source computes event_chain_hash + affected_state_hash_precheck (from row_image sent). Target computes affected_state_hash_postapply and returns it in the ack; mismatch triggers pause.

---

## 5. Target side (personal Supabase, `bridge` schema, private)

### 5.1 Tables (target)

- `bridge.applied_events(event_id uuid pk, table_name text, pk jsonb, row_version bigint, applied_at timestamptz, outcome text)`
- `bridge.cursor(table_name text pk, last_applied_event_id uuid, last_applied_at timestamptz)`
- `bridge.seen_nonces(nonce text pk, seen_at timestamptz)` — TTL-pruned.
- `bridge.hashes(table_name text, kind text, hash text, computed_at timestamptz, pk (table_name,kind,computed_at))`
- Mirror table for canary: `bridge.canary_rows` matching source schema, plus internal `row_version bigint`.

### 5.2 RPC (target, one tx)

- `bridge_apply_batch(p_envelope jsonb) → jsonb`
  1. Verify signature, kid, issuer, audience, replay window, nonce unseen; insert nonce.
  2. Recompute event_chain_hash; compare.
  3. For each event, in event_id order:
     - If `event_id` already in `applied_events`: mark `duplicate`, skip. (Idempotent retry.)
     - Look up current `row_version` on target for this PK.
       - If incoming `row_version <= current`: mark `stale`, skip. (Per-PK stale-event rule.)
       - Else apply upsert/tombstone-delete; set target `row_version = incoming`.
     - Insert `applied_events` row.
  4. Update `cursor` to max applied event_id in batch.
  5. Compute `affected_state_hash_postapply` over the touched PK set, insert into `hashes`.
  6. Return `[{event_id, outcome ∈ {applied,duplicate,stale,rejected}, target_row_version}]` + hash.
- Entire body is one Postgres transaction. Rollback on any signature/hash/schema failure; nothing partially applied.

---

## 6. Control loop (edge functions)

### 6.1 `bridge-emit` (source)

Loop, one tick:
1. `bridge_claim_batch(p_max, p_lease_ms)` → `(lease_id, events)`. If empty → sleep.
2. Build envelope, sign, POST to target `bridge-ingest`.
3. On 2xx: parse per-event outcomes, call `bridge_ack_batch`.
4. On non-2xx or timeout: **do nothing** — lease expires, batch is re-claimable. Idempotency at target handles duplicate delivery.

Retry: exponential backoff on 5xx/timeout. Circuit-breaker after N consecutive failures → set `state.mode='paused'`, alert.

### 6.2 `bridge-ingest` (target)

- Auth: verify shared bridge secret header **and** Ed25519 signature. Both required.
- Body: pass to `bridge_apply_batch`. Return its JSON result verbatim.

---

## 7. Baseline → stream sequencing

1. Target deployed from reviewed release artifact (see §10). Empty `bridge.*`.
2. Source: `bridge_seal_baseline('bridge.canary_rows')` — sealed snapshot rows queued as a special `baseline_load` event stream, terminated by a `baseline_barrier` event carrying the snapshot_id.
3. `bridge-emit` streams baseline events first (they're just outbox rows with earliest event_ids).
4. Target applies; on `baseline_barrier`, target records `baseline_barrier_applied_at` in `bridge.cursor` metadata.
5. From that point, live outbox events (already accumulating behind the barrier because `state.mode='baselining'` did **not** block triggers) flow through the same path. No mode switch races: baseline is defined as "everything up to the barrier event_id"; streaming is "everything after".

---

## 8. Retention, backpressure, cleanup (exact)

- **Outbox retention floor:** keep acked events for min(24h, 100k rows) even after ack. `bridge_prune` deletes only rows meeting BOTH `event_id ∈ acks` AND `created_at < now() - 24h`.
- **Backpressure caps:**
  - Hard cap `outbox` rows: 500k. Above cap → triggers pause writes on enrolled tables via `RAISE EXCEPTION` from trigger (fails source writes visibly rather than growing unbounded). Canary only, so blast radius is zero.
  - Lease max lifetime: 60s. Expired leases are ignored by `bridge_claim_batch`.
  - Nonce TTL on target: 15 min; pruned by scheduled job.
- **Cleanup contract:** `bridge_prune` runs every 5 min via `pg_cron`; single writer; logs deleted count. Never deletes unacked events. Never deletes baseline snapshot rows until `sealed=true AND all-baseline-events-acked`.

---

## 9. Permissions (private schema)

- `CREATE SCHEMA bridge;`
- `REVOKE ALL ON SCHEMA bridge FROM public, anon, authenticated;`
- Dedicated role `bridge_worker` (source) / `bridge_ingestor` (target). Only these roles get `USAGE ON SCHEMA bridge` and `EXECUTE` on the RPCs.
- Edge functions call RPCs via service role which impersonates the dedicated role via `SET LOCAL role`.
- No `GRANT` to `anon` or `authenticated` anywhere in `bridge.*`. Data API cannot see the schema.

---

## 10. Target deployment from reviewed artifact

- Target migrations + edge function bundle produced from a tagged git artifact (`bridge/vX.Y.Z`).
- Artifact contains: SQL migrations for `bridge.*`, `bridge-ingest` function, public key(s) for signature verification, canonical envelope schema.
- Operator applies to personal Supabase manually; no Lovable-side automation touches the target. This plan does not perform that apply.

---

## 11. Secrets (defined here, not created)

- Source: `BRIDGE_SIGNING_KEY_ED25519_PRIV`, `BRIDGE_TARGET_URL`, `BRIDGE_SHARED_HEADER`.
- Target: `BRIDGE_SIGNING_KEY_ED25519_PUB_JSON` (supports rotation via `kid`), `BRIDGE_SHARED_HEADER`.
- All scoped to bridge functions only. No service-role key of the target ever leaves the target.

---

## 12. Canary acceptance criteria

Before anything beyond canary is even proposed:
1. Baseline seal completes; `baseline_barrier` applied on target.
2. 10k synthetic inserts + 10k updates + 1k deletes on source → target converges; `affected_state_hash` matches on every batch.
3. Kill `bridge-emit` mid-batch → restart → zero duplicates, zero missing events (idempotency proven).
4. Send stale event manually (replay old envelope) → target rejects on nonce; send duplicate event_id → target marks `duplicate`.
5. Nightly `full_state_hash` matches for `bridge.canary_rows`.
6. Prune runs; unacked events survive; acked+aged events deleted.

Only after all six pass does the allowlist conversation begin — separately, under a new approval.

---

## 13. Open questions (still blocking build, per your instruction)

1. Personal Supabase project URL + region (for latency budget and edge fn placement).
2. Ed25519 key custody: generated on source and public shipped to target, or generated externally and both halves distributed?
3. Canary cadence: continuous tick every N seconds, or on-demand only?
4. Who owns pg_cron scheduling on target (operator vs. inline migration)?

No implementation follows. Awaiting your review of v2.1.
