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

- **SUPABASE MIGRATION REHEARSAL — EVIDENCE CONTRACT HARDENED IN DRAFT; READINESS RED.** PR #13, ZIP-envelope PR #14, and diagnostic PR #15 are merged with history-preserving merge commits; PR #15 is present in verified main `8b872882787859b87549e7f884832c624e29ead9`. One authorized rehearsal export remains retained offline in the approved evidence store. A separately authorized metadata-only attempt was reported to have failed closed at `report_helper_failed` / `unresolved_known_toc_entry`; it produced no evidence package and performed no restore. No identifying artifact path, name, size, hash, or timestamp is recorded here. Draft PR #16 at latest substantive head `8cbb0da107812ee23cbbd164671e0c00aa641aa2` retains the aggregate-only correction and hardens its evidence contract using synthetic fixtures only. Pending and descriptor-bound durable provenance/manifests now reject duplicate members recursively, nonfinite values, unknown keys, nested readiness objects, malformed scalar leaves, contradictory identities, and last-key-wins documents; tool, source/config, outer, inner/header, report, checksum, and durable-path claims are cross-bound to retained bytes and the descriptor-held canonical identity before publication. Fully rehashed `READY`/`BLOCKED`, nested-duplicate, unknown-`GREEN`, identity, and checksum substitutions exercise the actual no-replace publication entry point and leave no successful package. Migration-duplicate analysis is independent and becomes `COMPLETE` only when every normalized class has reviewed repository matching or is explicitly non-applicable; a broad CREATE/ALTER candidate scan forces `INCOMPLETE/BLOCKED` for unsupported classes/forms, implicit names, comment-obscured grammar, and lexically unprovable SQL while retaining no names or SQL. Source and `pg_dump` versions use a bounded full-match grammar with fixed redaction, and owned versus ownerless EXTENSION entries are counted conservatively. Unknown classes, malformed TOCs, duplicate IDs, conflicting version headers, archive/hash failures, and unsafe diagnostics remain fatal. Local repository-only validation is green (157 migration Python tests, 113 raw-inspector checks, 26 target-safety regressions, eight shell syntax checks, seven Python no-write compilations, and diff checks); Linux PostgreSQL 17 plus application, Deno, audit, and macOS final-head CI remain required. Evidence completion still cannot mean restore readiness or migration green. The tooling cannot prove Lovable source completeness or UI-to-backend mapping, independently attest operator/UI claims, prove every inner byte was consumed, validate a restore, or establish target readiness. PR #16 did not access, stat, hash, read, copy, rename, chmod, unzip, normalize, or inspect the retained export and did not access Lovable, Supabase, production, secrets, or any external/pre-existing database; it performed no restore, deployment, migration, export, or data movement. `.lovable/plan.md` remains rejected historical input.

#### New (Jul 12)

- **PRODUCTION `version` RESPONSE — JULY 12 OBSERVED, LIMITED PROOF.** PR #11 merged as `447c00f6bdfe988053e8e9ee650a834679a1a7fc`. A July 12 observation of the public production `version` function returned release `edge-20260712-5e071bee2975`, source `5e071bee29751f549dc3ae3f5308e0d81005be72`, and a project-scoped deployment ID. This proves only what that deployed `version` bundle returned at that observation time. It does not independently attest `strategy-chat`, `analyze-call`, or `mcp`, prove that the named source commit produced every deployed bundle, or establish current production state; tracked release metadata can name a commit other than the bundle-producing commit.
- **ALL-FUNCTION RUNTIME ATTESTATION — OPEN DRAFT, NOT DEPLOYED.** PR #12 is open and draft at `a70ea4e1e3cdaa588546cbd3730481ae85b664cd`. It proposes coordinated build/deploy/verification for `strategy-chat`, `analyze-call`, `mcp`, and `version`, but remains blocked on a protected `production` environment with `SUPABASE_ACCESS_TOKEN`, protected `main`, and removal/restriction of out-of-band Supabase deploy authority. Merge and the coordinated four-function redeploy both require separate authorization; neither occurred here.

#### New (Jul 11 night)

- **S-R1 — RETRIEVAL RELEVANCE/RANKING.** The Sources panel exposed low-relevance items entering evidence (generic sales KIs on a competitive turn), creating budget pressure and mis-citation risk. Investigate `situationIntelligenceRetrieval` scoring. P1, post-Monday.
- **S-R2 — SOURCES PANEL → FULL VERIFICATION VIEW.** Add clickable provenance and card-versus-playbook distinction. P2.
- **S-R3 — PROMPT BUDGET RECKONING.** 17,491/17,500 leaves approximately zero headroom. Additions need a paired trim or a deliberate ceiling raise plus revalidation. Linked to S-R1. P1.

#### Carried from v20

- **L3 PRODUCT wiring:** Unscoped. Day 1: upload Branch onboarding docs → Library → Product Intelligence head.
- **SUPABASE MIGRATION to own account:** PR #13, ZIP-envelope PR #14, and diagnostic PR #15 are merged; aggregate TOC-analysis correction is open in draft PR #16. One authorized rehearsal export is retained offline, but no completed metadata evidence package exists and this PR does not authorize an inspection retry. No restore, target project creation/access, remix, or cutover has occurred. Production remains on Lovable-managed `odbjjklumdsuqdvkgwyv`. Keep the original project intact and any future target read-only until rollback-critical verification passes.
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

## 2026-07-15 — Codex — Evidence and duplicate-analysis contracts hardened

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Hardened draft PR #16 in place using repository code and synthetic fixtures only. Pending-path and descriptor-bound durable validation now load provenance and evidence manifests with recursive duplicate-key and nonfinite-number rejection, enforce exact schemas plus typed scalar leaves, cross-bind tool/source/config/artifact/header/report/checksum/durable-path claims, and rebind the pending package to the descriptor-held canonical identity before publication. Fully rehashed `READY` then `BLOCKED`, `BLOCKED` then `READY`, nested duplicate, unknown `migration_readiness=GREEN`, nested scalar-object, identity, and checksum substitutions are rejected by both validators and the actual no-replace publication path without a completed or indeterminate package. Migration-duplicate analysis is now independently complete only for reviewed or explicitly non-applicable normalized classes: the supported `CREATE LANGUAGE` and named `CREATE INDEX CONCURRENTLY` forms detect duplicates, while unsupported classes, unnamed indexes, comment-obscured language syntax, unreviewed CREATE/ALTER modifiers, and lexically unprovable migration text retain only aggregate `INCOMPLETE/BLOCKED` evidence without names or SQL. Source and `pg_dump` version headers use bounded exact grammar or fixed redaction without sentinel leakage, and EXTENSION owner handling distinguishes owned, ownerless, and explicit `-` forms. Local repository-only checks passed: 157 migration Python tests, 113 raw-inspector checks, 26 target-safety regressions, eight shell syntax checks, seven Python no-write compilations, and diff checks; Linux PostgreSQL 17, application, Deno, audit, and macOS final-head CI remain required. Migration readiness remains RED. The retained export was not accessed, statted, hashed, read, copied, renamed, chmodded, unzipped, normalized, or inspected; no Lovable, Supabase, production, secrets, external/pre-existing database, restore, deployment, migration, export, or data movement was accessed or performed.
- **SHAs:** PR #16 prior head `091c3617e09eee67ba6171162805a11bf9393ced`; latest substantive head `8cbb0da107812ee23cbbd164671e0c00aa641aa2`.

## 2026-07-15 — Codex — Aggregate-only TOC evidence grammar made exact

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Closed a final synthetic-review gap in draft PR #16 without touching the retained rehearsal export. An incomplete object-reference report must now match one exact LF-terminated ordered grammar: every fixed and dynamic field appears once, the full fixed-order unresolved-class ledger is present, the appended safe PGDMP-header block is exact, and metadata-entry plus data-reference counts equal the total TOC count. Planted reports containing duplicate safe-looking version, size, PostgreSQL-client, or TOC-count fields, contradictory arithmetic, reordered fields, CRLF framing, or a missing final line feed fail closed. Fully rehashed poison fixtures first pass both pending-path and descriptor-bound validation as valid packages, then mutate and rebind the report, detached hash, and evidence manifest and are rejected by both validators. Local repository-only checks passed: 140 migration Python tests, 111 raw-inspector checks, 26 target-safety regressions, eight shell syntax checks, seven Python no-write compilations, and diff checks. Linux PostgreSQL 17, application, Deno, audit, and macOS checks remain final-head CI gates. Evidence completion still means only that the retained metadata package is internally complete; `restore_planning_gate=BLOCKED` and migration readiness remains RED. This work did not access, stat, hash, read, copy, rename, chmod, unzip, normalize, or inspect the retained export and did not access Lovable, Supabase, production, secrets, or any external/pre-existing database; it performed no restore, deployment, migration, export, or data movement.
- **SHAs:** starting main `8b872882787859b87549e7f884832c624e29ead9`; original draft PR #16 substantive head `b3ad4b9379e541574972659638d5fae3ed274556`; latest substantive head `fbf78cfacd3e125021d195637cfd4aaac1353c30`.

## 2026-07-15 — Codex — Unresolvable TOC entries retain blocked aggregate evidence

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Opened draft PR #16 from verified main to correct the synthetic reproduction of `report_helper_failed` / `unresolved_known_toc_entry` without touching the retained rehearsal export. PostgreSQL's editable `pg_restore --list` output has no documented lossless quoting grammar for its whitespace-separated namespace, tag, and owner fields. The report helper now accepts only a narrow class-specific ASCII hyphen rule for EXTENSION names and treats any other recognized non-exempt class whose object reference cannot be conservatively resolved as aggregate-only incomplete analysis, never as a restore-ready result. The retained report contains a total plus fixed allowlisted class counts and binds `object_reference_analysis=INCOMPLETE`, `migration_duplicate_analysis=INCOMPLETE`, and `restore_planning_gate=BLOCKED`; it omits TOC lines, names, schemas, owners, OIDs, SQL, paths, payloads, and duplicate-name details. Unknown classes, malformed TOCs, duplicate IDs, conflicting version headers, archive/hash failures, and unsafe diagnostics still fail without a normal package. Provenance format version 5, pending and descriptor-bound durable validation, report/provenance equality, stdout, and the completion marker all enforce the blocked gate. Local synthetic checks passed: 138 migration Python tests, 111 raw-inspector checks, 26 target-safety regressions, shell syntax, Python no-write compilation, and diff checks. Database-backed PostgreSQL 17, application, Deno, audit, and macOS checks remain final-head CI gates. The prior separately authorized attempt was reported to have produced no evidence package and no restore. This PR did not access, stat, hash, read, copy, rename, chmod, unzip, normalize, or inspect the retained export and did not access Lovable, Supabase, production, secrets, or any external/pre-existing database; it performed no restore, deployment, migration, export, or data movement. Migration readiness remains RED.
- **SHAs:** starting main `8b872882787859b87549e7f884832c624e29ead9`; draft PR #16 substantive head `b3ad4b9379e541574972659638d5fae3ed274556`.

## 2026-07-14 — Codex — Helper diagnostics and failed publication made unambiguous

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Hardened open draft PR #15 in place without retrying or touching the retained rehearsal export. The report helper now emits exactly one fixed-order ASCII JSON diagnostic with one of eight allowlisted reasons and never relays paths, filenames, TOC lines, object names, SQL, row content, environment values, or exception text. The raw inspector privately validates that record byte-for-byte; empty, multiline, oversized, non-ASCII, malformed, extra-key, wrong-version, and unknown-reason output becomes `report_helper_failed` / `other_nonzero`. The high-level driver rejects invalid stage/reason combinations, removes partial poisoned output and every disposable/durable evidence artifact after failure, and records the changed helper against the approved execution checkout while retaining c87 only as the historical migration-input baseline. A planted combined post-link-directory-fsync/rollback-unlink failure must leave a private mode-`0400` indeterminate marker rather than a normal report; a planted closed notification descriptor proves an already committed report is not retroactively labeled failed. Local synthetic checks passed: 125 migration Python tests, 109 raw-inspector checks, 26 target-safety regressions, shell syntax, Python compilation, and diff checks. Linux PostgreSQL 17 and macOS final-head CI remain required. Migration readiness remains RED, and direct stdout compatibility remains a documented nontransactional, non-evidence stream. The retained real ZIP was not accessed, statted, hashed, listed, read, copied, renamed, chmodded, unzipped, or inspected, and no retry occurred. No Lovable, Supabase, production, secret, external/pre-existing database, restore, deployment, migration, export, or data movement was accessed or performed.
- **SHAs:** PR #15 prior head `3b27d969fe2ab0e47135b020363106559cc1c84e`; new substantive head `687ff5ee19127d0094d100d5326eaf98bf7eae26`; historical migrations-only baseline `c87a124602eb669b3ec5a3829610c6cb465d3e26`.

## 2026-07-14 — Codex — Migration inspection failures made attributable

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Opened draft PR #15 to close the metadata inspector's diagnostic blind spot without retrying or touching the retained rehearsal export. Every raw-inspector failure now emits one canonical allowlisted stage/reason record; the high-level workflow accepts only that grammar and never relays child stdout/stderr, TOC text, paths, object names, secrets, or row-payload sentinels. The workflow captures the safe 11-byte PGDMP header fields before `pg_restore`, binds them to the verified inner SHA-256, reduces nonzero `pg_restore` results to reviewed reason codes, records the resolved execution-Python identity, uses isolated child Python with shell/Python startup hooks removed, and cleans the private snapshot workspace before atomic no-replace report publication. Planted regressions exercise every stage, malformed/poisoned diagnostics, cleanup and publication failures, reviewed PostgreSQL 17 reason variants, and the exact `--version`/`--list` ledger. Migration readiness remains RED: these synthetic local and CI mechanics do not prove Lovable source completeness, UI-to-backend mapping, operator observations, archive provenance, full-byte consumption by `pg_restore --list`, restore compatibility, or target readiness. The retained real ZIP was not accessed, statted, hashed, listed, copied, renamed, chmodded, unzipped, or inspected, and no retry occurred. No Lovable, Supabase, production, secret, external/pre-existing database, restore, deployment, migration, export, or data movement was accessed or performed.
- **SHAs:** starting main `4fac3414f46f56f961574cea8ec99f1c439e7112`; draft PR #15 substantive head `65281d0597c8339882f2e70d8f0119dc5f1948d5`; unchanged historical helper/migration baseline `c87a124602eb669b3ec5a3829610c6cb465d3e26`.

## 2026-07-14 — Codex — Appended-byte verification ceiling assertion corrected

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Corrected draft PR #14's synthetic real-PostgreSQL integration assertion after CI empirically showed PostgreSQL 17 accepts a valid `pg_dump -Fc` archive with appended bytes. The prior regex looked for “inner” before “byte” and therefore failed to recognize the exact checked-in warning; the harness now requires that warning as an exact fixed string. This does not claim byte-consumption proof: whole-file hashing binds the input, while `pg_restore --list` still does not prove it consumed every inner byte. Migration readiness remains RED. No retained artifact, Lovable, Supabase, production, secret, external/pre-existing database, restore, deployment, migration, export, or data movement was accessed or performed.
- **SHAs:** failed evidence run `29379136414` on prior final head `3e1e0eba56f51895af19d05e4e29d38c829e2c59`; corrected substantive head `a4034712139b49416ceca3511765767f53455ba3`; unchanged inspector/helper/migration baseline `c87a124602eb669b3ec5a3829610c6cb465d3e26`.

## 2026-07-14 — Codex — Real PostgreSQL export-workflow CI harness isolated

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Corrected only draft PR #14's synthetic PostgreSQL 17 high-level test harness after CI exposed readonly shell-name collisions and a non-guaranteed clean execution checkout. The harness now passes the audited real-`pg_restore` path and invocation ledger through distinct environment names, clones the exact test HEAD into an isolated clean checkout, and runs the complete ZIP and direct-`PGDMP` drivers there without weakening the production clean-worktree guard. This correction does not broaden the workflow or its proof: migration readiness remains RED, inspection still requires a separately approved exact checkout and external artifact identity, and the test proves only synthetic local archive handling plus the permitted `pg_restore --version`/`--list` calls. No retained artifact, Lovable, Supabase, production, secret, external/pre-existing database, restore, deployment, migration, export, or data movement was accessed or performed.
- **SHAs:** failed final-head evidence run `29378647583` on prior final head `f713116292ab6174af5c4ea5c6c7703d6cc58387`; corrected substantive head `e4120f0d731a17850890d5bbc20ad8b26144c646`; unchanged inspector/helper/migration baseline `c87a124602eb669b3ec5a3829610c6cb465d3e26`.

## 2026-07-14 — Codex — Lovable ZIP evidence workflow hardened for re-review

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Hardened open draft PR #14 without inspecting the retained export. The checked-in workflow now requires externally approved canonical outer filename, exact byte size, SHA-256, and private evidence-store root before run creation or `pg_restore`; binds the repository project ref and ZIP member/UI object name; rejects FIFO/symlink/ownership/mode/path substitutions; and distinguishes expected identity from descriptor-observed identity in provenance. Durable evidence is copied, hashed, mode-bound, and fsynced through held directory descriptors, published with platform-native no-replace rename, then postcommit-validated before the exact completion marker is written. Any postcommit validation failure loses completion status and gains a durable `EVIDENCE_INDETERMINATE` marker; existing outputs are never overwritten or deleted. A fixed bounded guard admits only `pg_restore --version` and `--list`, kills descendants on failure even after the leader exits, and caps time/output. Planted regressions cover substitutions, source/config/member mismatches, private-store violations, collisions, late root/canonical changes, process escapes, partial failure, timeline errors, and completion/indeterminate separation. Real synthetic `pg_dump -Fc` ZIP/direct integration is required in PostgreSQL 17 Linux CI, and a macOS job exercises `renameatx_np`. Migration readiness remains RED. The workflow still cannot prove Lovable source completeness or mapping, operator observations, restore safety, every direct-PGDMP byte consumed by `pg_restore`, or target readiness; final filesystem I/O ambiguity is an explicit manual-quarantine ceiling. No retained artifact, Lovable, Supabase, production, secret, external/pre-existing database, restore, deployment, migration, export, or data movement was accessed or performed; CI database fixtures are isolated and synthetic.
- **SHAs:** PR #14 prior head `25ed0d22cb94ce36f4f3984e42cc97ac40858b77`; new substantive head `ecd719caed4fa1c5757fe36c305313d952ff0f24`; unchanged inspector/helper/migration baseline `c87a124602eb669b3ec5a3829610c6cb465d3e26`.

## 2026-07-14 — Codex — Lovable ZIP-envelope inspection prepared for review

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Opened draft PR #14 from verified main `ecdef62656c793b62611d89be22b09d15a03e74d` to add a strict ZIP normalizer ahead of the unchanged raw-`PGDMP` inspector. The workflow treats the downloaded ZIP as canonical outer evidence and its sole verified `PGDMP` member as a distinct derived artifact; enforces exact framing, safe regular-member identity, bounded streaming, CRC/length/hash checks, disk headroom, private fixed-name output, fail-closed cleanup, and atomic OS-level no-replace evidence publication; preserves direct-`PGDMP` support; and records separate outer/member/inner/report/provenance identities. Structured provenance keeps the retained rehearsal's unobserved initiation explicit, separates availability from completion, and remains `INCOMPLETE` / `REVIEW_REQUIRED`; future/final profiles require observed initiation. Synthetic adversarial tests execute the complete checked-in workflow with a controlled fake `pg_restore` and prove only `--version` and `--list` are invoked. Migration readiness remains RED. The authorized retained export and all identifying metadata were untouched; no Lovable, Supabase, production, secrets, remote/pre-existing database, restore, deployment, migration, export, or data movement was accessed or performed.
- **SHAs:** PR #14 substantive head `19c8e4187311847bf5c48ffe4a3804b7934cc850`; unchanged inspector/helper/migration baseline `c87a124602eb669b3ec5a3829610c6cb465d3e26`.

## 2026-07-14 — Codex — External migration procedure approval required

- **Who:** Codex, at Corey Hartin's direction.
- **What:** Removed draft PR #13's self-referential procedure-approval claim. The metadata-only workflow now requires an externally supplied full `APPROVED_EXECUTION_CHECKOUT_SHA` with no default, verifies that it names an available commit and exactly equals the runtime-resolved HEAD before creating the run directory or invoking `pg_restore`, and separately records the approved checkout, observed execution checkout, committed README blob, marked fenced-workflow SHA-256, informational historical origin, and unchanged inspection-tool/migration baseline. A synthetic clean committed-descendant test executes the descendant's own newly committed workflow, proves the prior approval pin fails without creating evidence or calling fake `pg_restore`, then proves the descendant proceeds only when its exact HEAD is explicitly approved; missing, empty, malformed, and unavailable approval pins also fail at the same boundary. The local evidence proves supplied-pin equality and checked-out content identity, not who authorized the pin, an independently captured shell-input stream, a real Lovable archive, source completeness, remote state, or restore compatibility. No Supabase or Lovable project was accessed or changed; no export, restore, remix, database query, secret, deployment, production invocation, or production data access or movement occurred.
- **SHAs:** PR #13 prior head `f871c210925072dcd7d510d976d192b19b0bada0`; new substantive head `df0a28d0409b6123e74179f41c625f5b20a168f7`.

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
