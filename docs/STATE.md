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

#### New (Jul 14)

- **SUPABASE MIGRATION REHEARSAL — DRAFT, NOT EXECUTED.** Draft PR #13 pivots the migration architecture from the rejected custom bridge design to Lovable Support's reported Cloud export/remix path. Its hardening adds provenance-bound/fail-closed manifests, resolved Edge Function deployment-closure fingerprints and structured effective `verify_jwt`, a deterministic PostgreSQL catalog-output converter without PK values/ranges, immutable dump/TOC binding, real PostgreSQL 17 CI integration, and enforced source/target write-gate and lifecycle gates in the runbook. A follow-up closed a CI false-green caused by unavailable `rg` commands being swallowed inside shell conditionals: assertions now preflight fixed `grep`, distinguish no-match from command failure, avoid optimization-removable Python assertions, and run only after strict local test-target admission. The PostgreSQL harnesses require explicit fixture opt-in, a `migration_verify_*` database, PostgreSQL 17 identity, and either a canonical local Unix socket or a labeled local test container; 26 planted failures prove unsafe targets and missing/erroring dependencies do not reach fixture SQL. Metadata-only inspection now requires a canonical archive in an approved encrypted evidence store, a hash-verified disposable working copy, exact external-before/external-after/report archive SHA equality, and a provenance manifest that independently records procedure-origin commit `e4eed4a21049d274738110710a468e265c2893d2`, unchanged inspection-tool/migration-baseline commit `c87a124602eb669b3ec5a3829610c6cb465d3e26`, and the exact execution checkout resolved at runtime. Tracked tool/baseline changes plus ordinary or ignored untracked migration files fail before inspection. A synthetic end-to-end test executes the complete checked-in Bash workflow through the real inspector/helper with a controlled fake `pg_restore`; this verifies local procedure mechanics only, not a real Lovable archive, source completeness, remote state, or restore compatibility. The latest substantive branch head is `b6084905d2a04c752c94545d592dccc29226d86a`. Support's export-format, restore, Auth, Storage, Remix, write-fence, and rate-limit statements remain unproven until an authorized empirical rehearsal or written confirmation. No project was created or queried; no export, restore, remix, deployment, secret access, production invocation, or data movement occurred. `.lovable/plan.md` is explicitly rejected historical input, and the preserved local bridge spike is not part of PR #13.

#### New (Jul 12)

- **PRODUCTION `version` RESPONSE — JULY 12 OBSERVED, LIMITED PROOF.** PR #11 merged as `447c00f6bdfe988053e8e9ee650a834679a1a7fc`. A July 12 observation of the public production `version` function returned release `edge-20260712-5e071bee2975`, source `5e071bee29751f549dc3ae3f5308e0d81005be72`, and a project-scoped deployment ID. This proves only what that deployed `version` bundle returned at that observation time. It does not independently attest `strategy-chat`, `analyze-call`, or `mcp`, prove that the named source commit produced every deployed bundle, or establish current production state; tracked release metadata can name a commit other than the bundle-producing commit.
- **ALL-FUNCTION RUNTIME ATTESTATION — OPEN DRAFT, NOT DEPLOYED.** PR #12 is open and draft at `a70ea4e1e3cdaa588546cbd3730481ae85b664cd`. It proposes coordinated build/deploy/verification for `strategy-chat`, `analyze-call`, `mcp`, and `version`, but remains blocked on a protected `production` environment with `SUPABASE_ACCESS_TOKEN`, protected `main`, and removal/restriction of out-of-band Supabase deploy authority. Merge and the coordinated four-function redeploy both require separate authorization; neither occurred here.

#### New (Jul 11 night)

- **S-R1 — RETRIEVAL RELEVANCE/RANKING.** The Sources panel exposed low-relevance items entering evidence (generic sales KIs on a competitive turn), creating budget pressure and mis-citation risk. Investigate `situationIntelligenceRetrieval` scoring. P1, post-Monday.
- **S-R2 — SOURCES PANEL → FULL VERIFICATION VIEW.** Add clickable provenance and card-versus-playbook distinction. P2.
- **S-R3 — PROMPT BUDGET RECKONING.** 17,491/17,500 leaves approximately zero headroom. Additions need a paired trim or a deliberate ceiling raise plus revalidation. Linked to S-R1. P1.

#### Carried from v20

- **L3 PRODUCT wiring:** Unscoped. Day 1: upload Branch onboarding docs → Library → Product Intelligence head.
- **SUPABASE MIGRATION to own account:** REHEARSAL PLANNING IN DRAFT PR #13; no export, restore, project creation, remix, or cutover has occurred. Production remains on Lovable-managed `odbjjklumdsuqdvkgwyv`. Keep the original project intact and the new backend read-only until rollback-critical verification passes.
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

## 2026-07-14 — Codex — Migration evidence provenance separated

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Corrected draft PR #13's metadata-only evidence procedure so the procedure-origin commit (`e4eed4a21049d274738110710a468e265c2893d2`), unchanged inspector/helper/migration-baseline commit (`c87a124602eb669b3ec5a3829610c6cb465d3e26`), and exact execution checkout are independently validated and recorded. Inspection now fails before invoking `pg_restore` when the inspector, helper, or tracked migrations differ from the tool baseline, when ordinary or ignored untracked migrations exist, or when any provenance SHA is wrong, missing, or malformed. A synthetic end-to-end test executes the complete checked-in Bash workflow in a temporary Git checkout against a local synthetic archive and controlled fake `pg_restore`, with planted failures for every new guard. This proves the local workflow and fail-closed mechanics only; it does not inspect a real Lovable export, prove Lovable source completeness or configuration, establish remote state, or validate restore compatibility. No Supabase or Lovable project was accessed or changed; no export, restore, remix, database access, secret, deployment, production invocation, or production data access or movement occurred.
- **SHAs:** PR #13 prior head `f4710503432d6bc42cbd7bdb2a8d4ad9a316cfad`; new substantive head `b6084905d2a04c752c94545d592dccc29226d86a`.

## 2026-07-14 — Codex — Migration inspection evidence package bound

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Closed the metadata-only execution-handoff evidence gap in draft PR #13 without adding a restore or database path. The checked-in template preserves the canonical archive outside the ignored worktree, verifies its disposable working copy, retains external before/after checksum sidecars, requires exactly one matching archive SHA in the inspector report, hashes the report separately, and emits a provenance manifest with the exact source project, observed UTC times separated from unproven Support claims, operator, reviewed/tool Git SHA, original archive metadata, and report identity. Synthetic tests parse and execute the documented evidence-generation/validation snippets and plant external/report mismatch and duplicate-report-hash failures. No Supabase or Lovable project was accessed or changed; no export, restore, remix, secret, deployment, production invocation, database, or production data was accessed or moved.
- **SHAs:** PR #13 prior head `c87a124602eb669b3ec5a3829610c6cb465d3e26`; new substantive head `e4eed4a21049d274738110710a468e265c2893d2`.

## 2026-07-14 — Codex — Migration PostgreSQL CI false-green closed

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Hardened draft PR #13 after independently confirming that successful CI run `29341450013` logged three unavailable-`rg` errors while the catalog and service harnesses still printed `PASS`. Replaced those checks with preflighted fixed-`grep` assertions that accept only exit 1 as no-match, removed optimization-removable production Python assertions, and added a shared fail-closed target boundary before destructive synthetic fixtures. Direct execution now requires the canonical local PostgreSQL Unix socket; container execution requires the explicit test prefix, a local effective Docker endpoint, and a test-only label. Both paths require fixture opt-in, a `migration_verify_*` database, PostgreSQL 17, and exact local-socket identity. Twenty-six negative guard cases prove remote/non-test targets, identity mismatches, missing dependencies, assertion-command errors, and planted leaks fail without sending fixture SQL. No Supabase or Lovable project was accessed or changed; no export, restore, remix, secret, deployment, production invocation, or production data was accessed or moved.
- **SHAs:** PR #13 prior head `df10c9f7fe12d6e0a40391bfd14e41b5b130206f`; new substantive head `d84c7a4153ba55d7574d466383b82ec275082f28`.

## 2026-07-14 — Codex — Migration rehearsal hardened and runtime state caught up

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Hardened draft PR #13 without changing its migration architecture: eliminated local manifest false greens, fingerprinted resolved Edge Function deployment closures/effective JWT configuration, replaced ambiguous catalog evidence with strict typed fingerprints and a deterministic converter, bound dump TOCs to immutable archive snapshots, added PostgreSQL 17 integration coverage, and strengthened Remix connection, Storage final-sync, target-lifecycle, and enforced maintenance/write-fence gates. `.lovable/plan.md` is now visibly rejected. This entry also records the limited July 12 production `version` response observation for merged PR #11 and open draft PR #12's unresolved deployment prerequisites. No Supabase or Lovable project was accessed or changed; no export, restore, remix, secret, deployment, production invocation, or production data was accessed or moved.
- **SHAs:** PR #13 starting hardening head `e9ddd60e695b0d8bca405e514030d13b14f6daed`; hardening substantive head `6b9ca8ea617843acb15797e8b964e54e5487d78c`. PR #12 open draft head `a70ea4e1e3cdaa588546cbd3730481ae85b664cd`; PR #11 merge `447c00f6bdfe988053e8e9ee650a834679a1a7fc` and observed version source `5e071bee29751f549dc3ae3f5308e0d81005be72`.

## 2026-07-14 — Codex — Supabase migration rehearsal prepared for review

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Opened draft PR #13 to replace the rejected custom bridge architecture with a repository-derived migration inventory, 22-phase export/remix rehearsal and cutover runbook, local read-only dump inspection, fail-closed manifest comparison, verification templates, and a precise empirical/Lovable-confirmation backlog. The implementation treats Lovable Support's path and constraints as reported but not yet proven, commits synthetic fixtures only, and deliberately omits a final restore command until a real export TOC is inspected under separate authorization. No Supabase or Lovable project was created, queried, remixed, changed, or deployed; no export, secret, production system, or production data was accessed or moved.
- **SHAs:** PR #13 substantive head `5b56593a491227bc690751fffee43d4c3658317d`.

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
