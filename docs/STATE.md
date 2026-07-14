# CURRENT STATE

> **Supersedes all prior state documents and mirrors.**
>
> **Version:** v21 — July 12, 2026 runtime provenance review
>
> **Owner:** Corey Hartin (Branch.io Strategic Account Executive; Day 1 = July 13, 2026)
>
> **Authority:** This repository is the master system of record. Todoist is the action layer. Google Drive is the human-readable mirror.
>
> **Source:** Seeded from Todoist task `6h54JCgmg8xRp2Vg`; supersedes Drive v20 (`1PeTg6kZ71G1ZgqrCp9X5W-GSVD1bz8BZCfH0Fppv9E0`).

## HOW THIS FILE WORKS

### SESSION START — ALL AGENTS, EVERY SESSION

Claude, Codex, and Cowork must read **CURRENT STATE** and scan the most recent **SESSION LOG** entries before acting. This file is authoritative; Todoist is the task layer; Drive is a read-only human mirror.

### SESSION END — ONLY AFTER A SYSTEM-STATE CHANGE

If a session shipped code, deployed, changed production data or configuration, or altered architecture, record that state under these rules:

1. **Use the work PR.** Refresh **CURRENT STATE** and add the dated **SESSION LOG** entry to the same branch and PR as the work that caused the change, before that PR merges. Reference the PR number and the latest substantive branch-head SHA known before the state/log commit; never reference the post-merge commit SHA.
2. **Never open a standalone log PR.** A PR whose only purpose is a state or log entry is prohibited.
3. **Batch non-PR state changes.** Production deploys, production database edits, verification, and other state changes without their own repository PR must fold into the next repository PR's entry or be batched into an already-open work PR at session end—never one PR per event.
4. **Keep immutable history.** Use the heading `## YYYY-MM-DD — Author — Title` with **Who**, **What**, and **SHAs**; place the newest entry first and never edit, delete, or reorder prior entries.

Read-only or advisory sessions that changed nothing do not add a log entry.

### WRITE CAPABILITY

Codex and Claude write this file through the repository. Claude drafts entries and hands them to Codex to include in the relevant work PR when Claude cannot push. Cowork mirrors the state to Drive, but the repository remains the source of truth. Log state changes, not attendance.

## DYNAMIC — MASTER STATE & ROADMAP

**v21 — JUL 11 NIGHT SHIPPED: STRATEGY CITATION INTEGRITY + COMPETITIVE RETRIEVAL LIVE IN PROD**

The single source of truth for the entire app.

**Updated:** July 12, 2026 (runtime provenance review on top of the v21 Jul-11-night Strategy shipping cut)

**Supersedes:** v20 (`1PeTg6kZ71G1ZgqrCp9X5W-GSVD1bz8BZCfH0Fppv9E0`). v20 recorded the corpus/fluency scale-up and listed the STRATEGY six-layer rollout as PENDING. v21 records that several of those layers shipped to prod the night of Jul 11 and are verified live.

### §A. WHAT SHIPPED JUL 11 (NIGHT) — DELTA OVER v20

1. **STRATEGY PROMPT CONSOLIDATION (L0) — SHIPPED.** ~56K-character prompt consolidated to <17,500. Twenty-three precedence conflicts resolved and documented; five DECISION rows equivalence-checked. PR #4 (merge `040751b`).
2. **COMPETITIVE + INDUSTRY WIRING (L6) — SHIPPED.** `competitive_intel` (CARD) and `vertical_briefs` wired via situation classifier → `situationIntelligenceRetrieval` → evidence packet, gated and fail-soft. Closes v20's “Strategy-wiring pending.”
3. **CITATION UI + INTEGRITY (L4) — SHIPPED & HARDENED.** Citations render (`RESOURCE`/`KI`/`CARD`/`PLAYBOOK`). The CARD namespace was restored after being dropped. The fabrication guard is live: a citation naming a non-retrieved source renders ⚠ UNVERIFIED plus an audit notice—verified in prod. Source-claim integrity requires source-derived facts to carry a tag; reasoning and opinion remain untagged. The Sources panel is rendering. PR #6 (merge `7ee1ebe6`, commit `41b539ed`).
4. **CLASSIFIER EXPLICIT-INTENT OVERRIDE — SHIPPED.** Explicit competitive asks now deterministically trigger retrieval; the grammar is qualified so “beat my number” and “replace this paragraph” do not over-trigger. Fixes the `classifier_not_requested` → “none in evidence” failure. PR #6.
5. **COUNT DETECTION (#3/#13) — SHIPPED.** `explicitOutputRequest.ts`; explicit counts win for general plural nouns, while durations such as “4 business days” are rejected. PR #4 stack.
6. **IDENTITY → TERRITORY (#12) — SHIPPED + DATA CONFIRMED.** Identity comes from `territory_profile`, not hardcoded values. Prod confirmed: Strategic Account Executive / 13 accounts / $1.4M USD Expansion / verticals media-ent, travel, retail, finserv. Stale “Senior AE / 14 accounts” text was removed.
7. **FRONTEND TYPE DEBT — SHIPPED.** PR #5 fixed 28 `RejectExcessProperties` errors; the postinstall type-safety bypass was removed; typecheck now compiles project references.

**DEPLOY STATE:** Exact bundle provenance is not yet independently established for any production Edge Function. `version` self-reports substantive commit `5e071bee29751f549dc3ae3f5308e0d81005be72`; `strategy-chat` has live-behavior evidence for the `41b539ed` citation/classifier changes; `analyze-call` and `mcp` were manually deployed from merged `main`. Those three statements are operational records, not bundle-bound proof. Draft PR #12 (`agent/all-functions-runtime-attestation`, original substantive head `dd649ec63017058c77b896aa766897b5aa41a8f4`; verifier-test hardening `acbef013bf094b283eddd9be23566731e374f548`) adds one CI-generated commit manifest, independent runtime proof for `strategy-chat`, `analyze-call`, `mcp`, and `version`, and a clean-checkout deploy-and-verify workflow whose exact verifier now has a nonzero mismatch regression in normal PR CI. It is not merged or deployed. The only `supabase/functions/**` change from `5e071bee` through current `main` `447c00f6` is `_shared/release.json`; no scoped handler or business-logic file changed. A coordinated four-function redeploy is required after PR #12 merges and the protected deployment credentials are configured. The frontend was published. Production Supabase remains `odbjjklumdsuqdvkgwyv` (Lovable-managed)—not migrated (§D).

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

#### New (Jul 12)

- **ALL-FUNCTION RUNTIME ATTESTATION — IN REVIEW, NOT DEPLOYED.** Draft PR #12 (`agent/all-functions-runtime-attestation`, original substantive head `dd649ec63017058c77b896aa766897b5aa41a8f4`; verifier-test hardening `acbef013bf094b283eddd9be23566731e374f548`) replaces the hand-editable version-only SHA authority with an ignored manifest generated from GitHub Actions `GITHUB_SHA`. Each of `strategy-chat`, `analyze-call`, `mcp`, and `version` reports its bundle SHA and deployment ID. A dispatch-only workflow validates one clean detached `main` checkout, stages all four functions in one CLI invocation, and fails unless every runtime reports the expected SHA. Normal PR CI now executes the exact post-deploy verifier against synthetic responses and proves that a per-function SHA mismatch exits `1`; it also covers the all-valid, missing-header, and duplicate-deployment-ID paths. Before use, GitHub needs a protected `production` environment with `SUPABASE_ACCESS_TOKEN`; main and out-of-band Supabase deploy authority also need protection for CI to be the provenance boundary.
- **VERSION-ONLY ATTESTATION — MERGED, DEPLOYED, AND SUPERSEDED BY PR #12'S DESIGN.** PR #11 merged as `447c00f6`. The public `version` endpoint returns release `edge-20260712-5e071bee2975`, source `5e071bee29751f549dc3ae3f5308e0d81005be72`, and a project-scoped deployment ID. It does not attest the other functions, and its tracked `release.json` can name a commit other than the bundle-producing commit; PR #12 removes that second authority.

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

## 2026-07-12 — Codex — Post-deploy mismatch proof added to PR #12

- **Who:** Codex, responding to Corey's independent review of PR #12.
- **What:** Confirmed that the four-function post-deploy `verify` job was present but that its nonzero mismatch behavior had no executable regression. Extracted the exact runtime verifier into a tracked script used directly by the workflow, made the verification job check out and prove the exact deployed source SHA, and added normal-PR-CI tests. The tests prove all-valid attestations exit `0`, one otherwise-valid function reporting the wrong SHA exits `1`, a missing required header exits `1`, and reused deployment IDs exit `1`. No merge or deployment was performed.
- **SHAs:** PR #12 verifier-test hardening `acbef013bf094b283eddd9be23566731e374f548`.

## 2026-07-12 — Codex — All-function runtime attestation prepared for review

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Opened draft PR #12 on `agent/all-functions-runtime-attestation`. It replaces tracked, hand-editable version-only SHA metadata with one ignored manifest generated from GitHub Actions `GITHUB_SHA`; exposes fail-closed bundle proof for `strategy-chat`, `analyze-call`, `mcp`, and `version`; and adds a clean detached-main, four-function deploy plus independent runtime verification workflow. The production audit found that `_shared/release.json` is the only `supabase/functions/**` change between `5e071bee` and current `main` `447c00f6`; no scoped handler or business logic changed. Production exact-SHA status remains unproven for all four until a coordinated verified redeploy. No merge or deployment was performed.
- **SHAs:** PR #12 substantive head `dd649ec63017058c77b896aa766897b5aa41a8f4`.

## 2026-07-12 — Codex — Production runtime version attestation prepared for review

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Opened draft PR #11 with a side-effect-free public `version` Edge Function, shared bundle-bound release metadata, fail-closed runtime identity response, focused Deno/security tests, CI coverage, and a dispatch-only production verifier. Independent-review hardening added strict release/commit format and binding validation plus main-ancestry and project-scoped deployment-ID verification. Release `edge-20260712-5e071bee2975` is bound to substantive hardening commit `5e071bee29751f549dc3ae3f5308e0d81005be72`. No merge or deployment was performed.
- **SHAs:** PR #11 hardened substantive head `5e071bee29751f549dc3ae3f5308e0d81005be72`.

## 2026-07-12 — Codex — State logging mechanics refined

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Merged PR #9 as the final standalone log-only PR under the old pattern. In PR #10, refined the shared protocol so CURRENT STATE and SESSION LOG updates travel with the substantive work PR before merge, standalone log PRs are prohibited, non-PR state changes are batched into an open or next work PR, and Claude hands drafted entries to Codex for inclusion when Claude cannot push.
- **SHAs:** PR #9 head `c7caf99934e5eeede9f7fe17d2c19e715c59ee2f`; PR #10 substantive head `232a43b09b30c6011d0a1adea29db7a2f54ad122`.

## 2026-07-12 — Codex — Frontend type-safety restored / CI blind spot closed

- **Who:** Codex (rebase, verification, and merge).
- **What:** Merged PR #5 (`03d77dd`), removing the postinstall type-safety bypass, changing `typecheck` to full-project `tsc -b`, and fixing 28 `RejectExcessProperties` errors. CI now catches frontend type errors. Frontend-only; no Supabase Edge Function files were touched.
- **SHAs:** PR head `03d77dd93a515b77cccd6d323bce1c5e2cf7bbcb`; merge commit `7c4b8eb39301092c652923ffea3f7d81dfa9d7c3`.

## 2026-07-11 — Claude + Codex + Lovable — Strategy trust layer shipped to prod (night)

- **Who:** Claude (coordinator/verification), Codex (build), and Lovable (production database/deploy).
- **What:** Shipped and verified live PR #4 (`040751b`), the semantic-reduction and competitive-industry stack with five precedence conflicts resolved, CARD restored, a single citation authority, and explicit count detection; PR #5, which cleared frontend type debt and removed the postinstall type-safety bypass; and PR #6 (`7ee1ebe6` / `41b539ed`), which added competitive-citation integrity, the fabrication guard (⚠ UNVERIFIED verified in production), the classifier explicit-intent override, and source-claim integrity. Corrected `territory_profile` in production to Strategic AE / 13 accounts / $1.4M.
- **SHAs:** `040751b`, `7ee1ebe6`, `41b539ed`.
- **Deploy:** Deployed edge functions with `supabase functions deploy`; `strategy-chat` is live from `41b539ed`; the frontend was published. Production remains on Lovable-managed Supabase and has not been migrated.
- **System of record:** Established `docs/STATE.md` in this session through merged PR #7 as repository-authoritative. Todoist is the action layer; Drive is the read-only human mirror.
- **Open:** S-R1 retrieval relevance, S-R2 Sources panel, S-R3 prompt budget (17,491/17,500), Supabase migration, product-layer wiring, and Web Research reconciliation. See §D and Todoist.
- **Provenance:** Code verified by direct repository read; CI green on `41b539ed`; the fabrication guard and competitive retrieval verified live in production. The 17,491 prompt-budget figure is Codex's Deno-matrix result and was not rerun in the coordinating session.

## 2026-07-11 — Codex — Unified system of record initialized

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Created repository-authoritative `docs/STATE.md`, seeded CURRENT STATE from Todoist v21, and established the repo/Todoist/Drive ownership model. Deleted the isolated Todoist connector test task `6h54MF6x83jmghcg`; no live roadmap task was changed.
- **Related SHAs:** `040751b`, `41b539ed`, `7ee1ebe6`.
