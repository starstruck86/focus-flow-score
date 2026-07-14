## Migration Bridge — Server-to-Server (Cloud → Personal Supabase)

Temporary, one-directional data bridge. Lovable Cloud stays authoritative. No browser client, no DB connection string, no service-role key crossing boundaries. Not deployed until you approve a dry-run.

---

### Architecture

```text
┌────────────────────────┐        HTTPS POST (JWT-less, HMAC-signed)
│  Lovable Cloud         │        Header: x-bridge-key + x-bridge-sig
│  edge fn:              │  ───▶  ┌──────────────────────────────┐
│  bridge-export         │        │ Personal Supabase            │
│  (paged, checkpointed) │        │ edge fn: bridge-ingest       │
└────────────────────────┘        │ (validates, upserts, ACKs)   │
        ▲                         └──────────────────────────────┘
        │ reads
   ┌────┴─────┐
   │ Cloud DB │      bridge_checkpoints (cursor per table)
   │          │      bridge_run_log (batch id, counts, hash)
   └──────────┘
```

Nothing on the personal side calls back into Cloud. One-way push.

---

### Components

**1. Cloud edge function `bridge-export`** (source)
- Trigger: manual invoke with `{ table, batch_size, dry_run }`.
- Reads from an **allowlist** of tables + columns (hard-coded in the function; not client-controlled).
- Pages by `(updated_at, id)` cursor persisted in `bridge_checkpoints`.
- For each batch: build payload, compute SHA-256 of canonical JSON, HMAC-sign with `BRIDGE_SIGNING_KEY`, POST to target.
- On 2xx ACK matching the sent hash + row count → advance checkpoint; else stop and log.
- Writes `bridge_run_log` row per batch: `{ table, batch_id, rows_sent, rows_acked, hash, target_hash, status, error }`.

**2. Personal Supabase edge function `bridge-ingest`** (target, you deploy manually)
- Verifies `x-bridge-key` equals `BRIDGE_INGEST_KEY` (rejects otherwise, no other auth).
- Verifies HMAC signature over raw body with same `BRIDGE_SIGNING_KEY`.
- Validates payload against per-table schema (Zod).
- Idempotent `upsert` on `(id)` using the personal project's service role (stays inside that function — never leaves the personal project).
- Returns `{ received, upserted, hash }` for reconciliation.

**3. Secrets (scoped, new)**
- Cloud side: `BRIDGE_TARGET_URL`, `BRIDGE_INGEST_KEY`, `BRIDGE_SIGNING_KEY` (generated).
- Personal side: `BRIDGE_INGEST_KEY`, `BRIDGE_SIGNING_KEY` (same values). You paste them into your project.
- No Cloud service-role key or DB URL ever leaves Cloud.

**4. Cloud tables (new, tiny)**
- `bridge_checkpoints(table_name pk, last_updated_at, last_id, updated_at)`
- `bridge_run_log(id, table_name, batch_id, rows_sent, rows_acked, source_hash, target_hash, status, error, started_at, finished_at)`
- Both RLS-locked to service_role only (no user access).

**5. Table allowlist (initial proposal — confirm before build)**
Start with low-risk, user-scoped reference data:
- `accounts`, `contacts`, `opportunities`, `knowledge_items`, `resources`
Excluded until explicitly added: `auth.*`, `circle_credentials`, `approved_users`, anything with tokens or secrets.

---

### Safety properties

- **Idempotent**: upsert on primary key; replays are no-ops.
- **Checkpointed**: crash/resume safe; never re-sends acked rows, never skips.
- **Reconciled**: source hash + count must equal target hash + count before checkpoint advances.
- **Bounded blast radius**: allowlist is code-level; no wildcard export.
- **Revocable**: rotate `BRIDGE_INGEST_KEY` on personal side → bridge dies instantly.
- **Observable**: `bridge_run_log` is the audit trail; a `reconcile` invocation compares `count(*)` per table across both sides.
- **Non-destructive**: no deletes propagated in v1 (add soft-delete propagation later if needed).

---

### Rollout (no prod deploy in this plan)

1. You approve the plan + allowlist.
2. I create the migration for `bridge_checkpoints` / `bridge_run_log` (awaits your approval).
3. I write `bridge-export` + the `bridge-ingest` source you'll paste into your personal project.
4. You generate + set the three secrets on both sides.
5. Dry-run: invoke `bridge-export` with `dry_run:true` → payload built + signed but POST skipped; log inspected.
6. Live run against **one table, batch_size=10**; reconcile counts + hashes.
7. Only after clean reconciliation do we scale batch size and add tables.

---

### Open questions before I build

1. Confirm the allowlist above (or amend).
2. Personal project region/URL — you'll provide when we get to secret setup.
3. Cutover intent: is this bridge a **staging mirror** (Cloud remains prod indefinitely) or a **pre-transfer sync** (eventually you switch the app over)? Affects whether we later add deletion propagation and a freeze/cutover step.