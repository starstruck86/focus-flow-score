# CURRENT STATE

> **Supersedes all prior state documents and mirrors.**
>
> **Version:** v21 — July 11, 2026 night shipping cut
>
> **Owner:** Corey Hartin (Branch.io Strategic Account Executive; Day 1 = July 13, 2026)
>
> **Authority:** This repository is the master system of record. Todoist is the action layer. Google Drive is the human-readable mirror.
>
> **Source:** Seeded from Todoist task `6h54JCgmg8xRp2Vg`; supersedes Drive v20 (`1PeTg6kZ71G1ZgqrCp9X5W-GSVD1bz8BZCfH0Fppv9E0`).

## HOW THIS FILE WORKS

Any agent changing system state must update **CURRENT STATE** and add a dated **SESSION LOG** entry in the same commit. Add the newest log entry first and never edit, delete, or reorder prior log entries. Todoist holds actionable tasks; this file holds durable state. Drive may mirror this file for people, but the repository remains authoritative.

## DYNAMIC — MASTER STATE & ROADMAP

**v21 — JUL 11 NIGHT SHIPPED: STRATEGY CITATION INTEGRITY + COMPETITIVE RETRIEVAL LIVE IN PROD**

The single source of truth for the entire app.

**Updated:** July 11, 2026 (v21 — Jul-11-night Strategy shipping cut)

**Supersedes:** v20 (`1PeTg6kZ71G1ZgqrCp9X5W-GSVD1bz8BZCfH0Fppv9E0`). v20 recorded the corpus/fluency scale-up and listed the STRATEGY six-layer rollout as PENDING. v21 records that several of those layers shipped to prod the night of Jul 11 and are verified live.

### §A. WHAT SHIPPED JUL 11 (NIGHT) — DELTA OVER v20

1. **STRATEGY PROMPT CONSOLIDATION (L0) — SHIPPED.** ~56K-character prompt consolidated to <17,500. Twenty-three precedence conflicts resolved and documented; five DECISION rows equivalence-checked. PR #4 (merge `040751b`).
2. **COMPETITIVE + INDUSTRY WIRING (L6) — SHIPPED.** `competitive_intel` (CARD) and `vertical_briefs` wired via situation classifier → `situationIntelligenceRetrieval` → evidence packet, gated and fail-soft. Closes v20's “Strategy-wiring pending.”
3. **CITATION UI + INTEGRITY (L4) — SHIPPED & HARDENED.** Citations render (`RESOURCE`/`KI`/`CARD`/`PLAYBOOK`). The CARD namespace was restored after being dropped. The fabrication guard is live: a citation naming a non-retrieved source renders ⚠ UNVERIFIED plus an audit notice—verified in prod. Source-claim integrity requires source-derived facts to carry a tag; reasoning and opinion remain untagged. The Sources panel is rendering. PR #6 (merge `7ee1ebe6`, commit `41b539ed`).
4. **CLASSIFIER EXPLICIT-INTENT OVERRIDE — SHIPPED.** Explicit competitive asks now deterministically trigger retrieval; the grammar is qualified so “beat my number” and “replace this paragraph” do not over-trigger. Fixes the `classifier_not_requested` → “none in evidence” failure. PR #6.
5. **COUNT DETECTION (#3/#13) — SHIPPED.** `explicitOutputRequest.ts`; explicit counts win for general plural nouns, while durations such as “4 business days” are rejected. PR #4 stack.
6. **IDENTITY → TERRITORY (#12) — SHIPPED + DATA CONFIRMED.** Identity comes from `territory_profile`, not hardcoded values. Prod confirmed: Strategic Account Executive / 13 accounts / $1.4M USD Expansion / verticals media-ent, travel, retail, finserv. Stale “Senior AE / 14 accounts” text was removed.
7. **FRONTEND TYPE DEBT — SHIPPED.** PR #5 fixed 28 `RejectExcessProperties` errors; the postinstall type-safety bypass was removed; typecheck now compiles project references.

**DEPLOY STATE:** Edge functions (`strategy-chat`, `analyze-call`, `mcp`) were deployed via `supabase functions deploy` from merged `main`; `strategy-chat` is live from `41b539ed`. The frontend was published. Production Supabase remains `odbjjklumdsuqdvkgwyv` (Lovable-managed)—not migrated (§D).

### §B. STRATEGY SIX-LAYER STATUS

- **(0) Prompt consolidation:** SHIPPED (budget 17,491/17,500).
- **(1) Deterministic retrieval plan:** Live.
- **(2) Industry (`vertical_briefs`) wiring:** Live.
- **(3) Product wiring:** NOT scoped (gap unchanged).
- **(4) Citation UI:** SHIPPED + integrity hardening.
- **(5) Web Research widening:** IN FLIGHT (`agent/web-research-widening`; reconcile onto new `main`).
- **(6) Competitive wiring:** SHIPPED (cards reach the model; relevance is noisy—S-R1).

### §C. VERIFICATION PROVENANCE (JUL 11 NIGHT)

- Code claims verified against production `main` by direct repository read: SHAs, scope, call-site wiring, classifier grammar, and evidence-policy line.
- CI green confirmed via GitHub check-runs on PR #6 head (`41b539ed`).
- Fabrication guard and competitive retrieval verified live in production (screenshotted): ⚠ UNVERIFIED-CARD fired; the real Adjust card reached the model.
- `territory_profile` confirmed in the production database via Lovable read.
- Budget 17,491 came from the Codex Deno matrix rerun; it was not independently rerun in the originating session because of a private registry. Risk assessed as low.
- Todoist roadmap (`6gwh7jGXpJRJXhpg`) has a completed entry plus S-R1, S-R2, and S-R3.

### §D. OPEN / NEXT

#### New (Jul 11 night)

- **S-R1 — RETRIEVAL RELEVANCE/RANKING.** The Sources panel exposed low-relevance items entering evidence (generic sales KIs on a competitive turn), creating budget pressure and mis-citation risk. Investigate `situationIntelligenceRetrieval` scoring. P1, post-Monday.
- **S-R2 — SOURCES PANEL → FULL VERIFICATION VIEW.** Add clickable provenance and card-versus-playbook distinction. P2.
- **S-R3 — PROMPT BUDGET RECKONING.** 17,491/17,500 leaves approximately zero headroom. Additions need a paired trim or a deliberate ceiling raise plus revalidation. Linked to S-R1. P1.

#### Carried from v20

- **L3 PRODUCT wiring:** Unscoped. Day 1: upload Branch onboarding docs → Library → Product Intelligence head.
- **SUPABASE MIGRATION to own account:** STILL OPEN (Todoist due Jul 12). Production remains on Lovable-managed `odbjjklumdsuqdvkgwyv`. Do not cut over before Monday; do it with rollback time.
- **`account_risks` population gap:** Only 2/9 fluency accounts yield a competitive signal; the debrief-capture pipeline is the real fix.
- **`competitive_intel` freshness:** Spot-verify AppsFlyer (Jun 2026 raise) and Kochava (2026 FTC settlement) card text against live rows.
- **Web Research widening:** Reconcile onto new `main`, then rerun CI and the prompt budget before merge.

### §E. STANDING / KNOWN SIGNATURES

Deployment has three parts and can split-brain: a GitHub merge does not make code live. Edge functions require `supabase functions deploy`; the frontend requires Lovable Publish → Update; deploy them together. The deploy build runs strict full-project `tsc`, including the frontend, so a pre-existing frontend error can block an edge deploy—the root cause of the Jul 11 “Build unsuccessful” result.

Trust-but-verify held throughout the session: it caught an unmerged PR before a bad deploy, a CARD drop that a green suite missed, and a fabricated citation that the guard now flags. Branch plus SHA is the only trusted delivery. No merge without explicit human approval. Day 1 is July 13.

---

**END v21.** v20 recorded the corpus scale-up; v21 records the night Strategy's trust layer went live: citations that cannot fabricate, competitive intel that reaches the model, and identity grounded in real territory data. All verified live in production Jul 11. Day 1 is July 13. Go drive it.

# SESSION LOG

> Append-only, newest first. Add each new immutable entry directly below this note; never rewrite prior entries.

## 2026-07-11 — Codex — Unified system of record initialized

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Created repository-authoritative `docs/STATE.md`, seeded CURRENT STATE from Todoist v21, and established the repo/Todoist/Drive ownership model. Deleted the isolated Todoist connector test task `6h54MF6x83jmghcg`; no live roadmap task was changed.
- **Related SHAs:** `040751b`, `41b539ed`, `7ee1ebe6`.
