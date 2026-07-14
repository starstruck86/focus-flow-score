## Migration Bridge — Revised Design (v2, plan only)

Phase 1 is a **staging mirror only** (Cloud stays authoritative, no cutover intent this phase). Allowlist is **not approved** and is deferred to a separate decision. No build, no DB changes, no secrets, no deploy in this turn.

---

### Diff vs v1 (what changed and why)

| Area | v1 | v2 | Why |
|---|---|---|---|
| Baseline | Paged cursor over live tables | **Verified snapshot export** (frozen point-in-time), hash-manifested, then delta stream resumes from that LSN | Cursor-only bootstrap can't prove target ≡ source at t₀; drift is unverifiable |
| Change capture | `(updated_at, id)` cursor read from live rows | **Ordered outbox** table populated by triggers (`op`, `pk`, `row_json`, `lsn`, `enq_at`) with monotonic `lsn` | `updated_at` misses hard deletes, is clock-skew sensitive, and reorders under concurrent writes |
| Deletes | Not propagated | **Tombstone rows** in outbox (`op='D'`, `pk`, `deleted_at`); target applies as delete | Staging mirror is useless if deletes silently diverge |
| Source auth | Manual invoke, no caller identity | **Authenticated source control**: invoke requires JWT of a named operator role; export function verifies + logs actor on every batch | v1 had no record of who pushed what |
| Signing | HMAC over body only | **HMAC over (body ‖ timestamp ‖ nonce ‖ batch_id)**, `x-bridge-ts` header, target rejects ts skew > 300s and replayed nonces (nonce table w/ TTL) | v1 signature is replayable indefinitely |
| Target ACK | `{received, upserted, hash}` in-memory | **Transactional receipt**: target opens tx → upserts/deletes → writes `bridge_receipts(batch_id, source_hash, applied_hash, applied_lsn, state_digest)` → commits → returns receipt. Source advances checkpoint only on receipt whose `applied_hash == source_hash` AND `state_digest` matches source's expected post-state digest | v1 could ACK without durably persisting; no end-to-end integrity proof |
| State digest | none | Rolling `state_digest = sha256(prev_digest ‖ applied_lsn ‖ sorted(pk,row_hash))` on both sides; divergence halts bridge | Detects silent corruption / out-of-order apply |
| First run | Live table, batch 10 | **Synthetic canary table** (`bridge_canary`, ~50 fabricated rows with I/U/D mix) end-to-end first; only after clean reconcile do real allowlisted tables enter scope | Proves the pipe without touching real data |
| Allowlist | Proposed 5 tables in the plan | **Empty until separately approved**; canary is the only in-scope object at build time | You flagged the v1 list as not approved |
| Scope framing | Ambiguous (mirror vs pre-cutover) | **Phase 1 = staging mirror only.** Pre-cutover work (freeze, drain, flip) is a separate later plan | Prevents scope creep into cutover semantics now |

---

### Architecture (v2)

```text
Cloud (source, authoritative)                    Personal Supabase (target, mirror)
─────────────────────────────                    ─────────────────────────────────
[app writes]                                     
   │                                             
   ▼                                             
[triggers] ──▶ bridge_outbox (lsn, op, pk, row)  
                    │                            
                    ▼                            
           bridge-export (edge fn)               
           - requires operator JWT               
           - reads outbox FOR UPDATE SKIP LOCKED 
           - builds batch, computes source_hash  
           - signs (body‖ts‖nonce‖batch_id)      
           - POST ──────────────────────────────▶ bridge-ingest (edge fn)
                                                    - verify key + HMAC + ts window + nonce
                                                    - BEGIN tx
                                                    - apply upserts + tombstone deletes
                                                    - recompute applied_hash + state_digest
                                                    - INSERT bridge_receipts
                                                    - COMMIT
                                                    - return receipt
           ◀──────────────────────────────────── receipt {applied_hash, state_digest, applied_lsn}
           - assert applied_hash == source_hash
           - assert state_digest matches expected
           - advance bridge_checkpoints.last_lsn
           - delete acked outbox rows (or mark)
```

---

### Components (v2)

**Source-side DB objects (Cloud, new; no build yet)**
- `bridge_outbox(id bigserial pk, lsn bigserial unique, table_name, op char(1), pk_json, row_json, enq_at)` — populated by per-table `AFTER INSERT/UPDATE/DELETE` triggers, added only when a table is admitted.
- `bridge_checkpoints(table_name pk, last_lsn, last_state_digest, updated_at)`.
- `bridge_run_log(id, batch_id, table_name, rows, source_hash, applied_hash, source_digest, target_digest, actor, status, error, started_at, finished_at)`.
- `bridge_canary(id uuid pk, kind text, payload jsonb, updated_at, deleted_at)` — the only object admitted at first build.
- All service-role-only; RLS denies user access.

**Source edge fn `bridge-export`**
- Auth: requires operator JWT (role check via `has_role`); logs `actor = auth.uid()` on every batch.
- Reads outbox in `lsn` order, `FOR UPDATE SKIP LOCKED`, bounded batch.
- Computes `source_hash` = sha256 of canonical batch JSON; computes expected post-apply `state_digest` from prior checkpoint digest + batch.
- Signs `sha256(body ‖ ts ‖ nonce ‖ batch_id)` with `BRIDGE_SIGNING_KEY`; headers: `x-bridge-key`, `x-bridge-ts`, `x-bridge-nonce`, `x-bridge-batch`, `x-bridge-sig`.
- On matching receipt: advance checkpoint, prune outbox rows ≤ `applied_lsn`.
- On mismatch or non-2xx: halt table, write `bridge_run_log` with diagnostic, do NOT advance.

**Target-side DB objects (personal Supabase, you create manually later)**
- Mirror tables (same PKs, minimal columns per allowlist).
- `bridge_nonces(nonce pk, seen_at)` with TTL sweep.
- `bridge_receipts(batch_id pk, table_name, applied_lsn, source_hash, applied_hash, state_digest, applied_at)`.

**Target edge fn `bridge-ingest`**
- Verifies `x-bridge-key`, HMAC over `(body‖ts‖nonce‖batch_id)`, `|now − ts| ≤ 300s`, nonce unseen.
- Single tx: apply ops in `lsn` order (upserts on PK, deletes on tombstone), recompute `applied_hash` and rolling `state_digest`, insert `bridge_receipts`, commit.
- Returns `{ batch_id, applied_lsn, applied_hash, state_digest }`. No side effects outside the tx.

**Secrets (deferred; not created this turn)**
- Cloud: `BRIDGE_TARGET_URL`, `BRIDGE_INGEST_KEY`, `BRIDGE_SIGNING_KEY`.
- Personal: `BRIDGE_INGEST_KEY`, `BRIDGE_SIGNING_KEY` (matched).
- No Cloud service-role key or DB URL leaves Cloud.

---

### Baseline (verified export) — precedes any delta

1. Freeze writes to admitted table (advisory lock or app-level pause) briefly.
2. Snapshot rows → NDJSON with per-row hash + total manifest hash + `baseline_lsn = pg_current_wal_lsn()`-equivalent marker.
3. Ship baseline via same signed channel in chunks; target loads into a staging schema, verifies manifest hash, then atomically swaps into mirror table and records `bridge_checkpoints.last_lsn = baseline_lsn`, `last_state_digest = baseline_digest`.
4. Unfreeze; delta stream from `baseline_lsn` forward. Target ≡ source is **proven**, not assumed.

---

### Safety properties (v2)

- **Ordered + gap-free**: monotonic `lsn`, target applies in order, checkpoint only advances contiguously.
- **Delete-safe**: tombstones propagate; mirror will not silently retain removed rows.
- **Replay-resistant**: timestamp window + nonce table on target.
- **Authenticated push**: only an operator-role JWT can invoke export; actor recorded.
- **End-to-end integrity**: source_hash == applied_hash AND state_digest match, both persisted on target before checkpoint advances.
- **Provable baseline**: snapshot manifest hash matches on both sides before deltas start.
- **Bounded blast radius**: allowlist empty; only `bridge_canary` at first build.
- **Revocable**: rotate `BRIDGE_INGEST_KEY` on target → bridge dies instantly; outbox retains unshipped deltas.
- **Observable**: `bridge_run_log` (source) + `bridge_receipts` (target) form a two-sided audit trail; a `bridge-reconcile` invocation compares per-table `count(*)` and latest `state_digest`.
- **Non-destructive to source**: source never mutates business data; outbox is append-only until pruned by ack.

---

### Rollout (still no build this turn)

1. You approve this v2 design (plan only).
2. Separate decision: approve/deny each candidate table for admission. Until then, only `bridge_canary` is in scope.
3. I create the migration for outbox / checkpoints / run_log / canary + triggers on `bridge_canary` only (awaits approval).
4. I write `bridge-export` and the `bridge-ingest` source you'll paste into your personal project.
5. You generate + set the three secrets on both sides.
6. **Synthetic canary run**: seed `bridge_canary` with a scripted I/U/D mix; run baseline → deltas; verify `state_digest` matches on both sides; verify tombstones apply; verify replay + skew rejection; verify halted-on-mismatch behavior via a deliberate corrupt-batch drill.
7. Only after clean canary do we bring the allowlist decision back for the first real table (baseline + delta), one at a time.

---

### Explicitly out of scope in Phase 1

- Cutover, freeze/drain, or app rebinding to the personal project.
- Bi-directional sync.
- Auth users / storage objects / secrets replication.
- Schema migration on the target (you own target DDL).

---

### Open items before any build

1. Confirm v2 design.
2. Confirm Phase 1 = staging mirror only (no cutover this phase).
3. Defer allowlist decision to its own review; canary-only at first build — confirm.
4. Personal project URL/region — needed only at secret-setup step, not now.
