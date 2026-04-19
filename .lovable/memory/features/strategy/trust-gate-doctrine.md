---
name: Strategy Trust Gate Doctrine
description: Server- and UI-side trust gate that blocks cross-account contamination on Strategy threads (e.g. Lima One content linked to Adore Me). Promotion is gated on compute_thread_trust_state; clone-first relink is the safe path.
type: feature
---

A Strategy thread that talks about Company A must never silently become a thread about Company B. The system enforces this with a layered trust gate:

1. **Detection (`strategy-detect-conflicts`)** — Scans thread title, messages, uploads, and artifacts for company/person signals; persists `entity_signals` + a row per conflict in `strategy_thread_conflicts` (severity = `warning` | `blocking`). Sets `strategy_threads.trust_state` via `compute_thread_trust_state(thread_id)`.

2. **UI surfacing (`ThreadTrustBanner`)** — Mounted in `StrategyMainPanel`. When `trust_state='blocked'` it renders a non-dismissible identity-conflict banner that explicitly calls out `detected_account_name → linked_account_name` (e.g. "Lima One → Adore Me"), lists the blocking reasons, and exposes three actions: **Clone for correct entity (primary)**, Unlink → freeform, Re-check.

3. **Server gate (`strategy-promote-proposal`, `strategy-stage-proposal`)** — Calls `compute_thread_trust_state` before any shared write. A blocked thread returns 409 `thread_trust_blocked` with the conflicts. The same function also enforces `opp_account_mismatch` (opportunity must belong to the proposal's target account).

4. **Safe relink (`SafeRelinkDialog` + `strategy-clone-thread`)** — Replaces in-place mutation. Cross-entity relink defaults to clone (shell clone: messages + title only; uploads, artifacts, proposals, memory are NOT carried). In-place mutation is disabled when `trust_state='blocked'`. Live conflict preview runs against the candidate account during selection.

5. **Quarantine for legacy contamination** — `resources.quarantined_at` + `quarantine_reason` and `account_strategy_memory.is_irrelevant` are used to neutralize already-promoted shared rows whose source thread is later flagged as conflicted. Quarantined rows must not appear in consumer surfaces.

**Canonical proof case:** thread `d4f99428-38cc-43e3-9fd2-867fb3c7df18` ("Adore Me - Discovery (was Lima One reseed)") is `blocked` with conflict `fdfbf1e2…` (kind=`content_vs_account`, detected=Lima One, linked=Adore Me).
