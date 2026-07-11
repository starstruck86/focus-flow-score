# Strategy Chat Semantic Prompt Preservation Ledger

Baseline audited: `9cc562c06cd2a4f853ffebd834b8164acaa91c6a` (`origin/main`,
post-Option A). Character counts are JavaScript UTF-16 `trim().length`, matching
`composePrompt()`. Separator characters are reported separately.

This ledger uses three statuses:

- **preserved** — a distinct rule remains with the same effective authority.
- **merged duplicate** — equivalent copies were collapsed into one canonical
  rule.
- **retired conflict** — two live directives were mutually impossible; the
  effective server guard or explicit precedence rule is named, so nothing
  disappears silently.

## Before: active assembly and size

Full-core V1 order was:

1. `evidence.territory`
2. `fixed.strategy-objective`
3. `fixed.mode-lock`
4. `fixed.behavior-contract`
5. `fixed.strategy-core`
6. workspace-ordered `evidence.core.*`
7. `fixed.response-format`
8. `evidence.current-state`
9. `fixed.thesis-persistence`
10. `fixed.library-usage`
11. `runtime.global-sop`
12. `runtime.workspace-sop`
13. `fixed.decision-layer`
14. `fixed.v1-mode`
15. `evidence.standards`
16. `runtime.global-instructions`
17. `fixed.conversation-enforcement-final` when selected

V2 removed only `fixed.v1-mode`, inserted its identity near the front, and
appended its complete reasoning prompt after the decision layer. Generic paths
combined fixed rules and dynamic evidence in one `fixed.generic` segment.

The old Standard-depth fixed floor was already over budget before mode lock,
behavior, V1/V2 reasoning, SOPs, or a Current State digest:

| Workspace     | Old fixed floor |
| ------------- | --------------: |
| Brainstorm    |          23,660 |
| Deep Research |          20,857 |
| Refine        |          20,787 |
| Library       |          20,496 |
| Artifacts     |          20,644 |
| Projects      |          20,583 |
| Work          |          21,647 |

Representative totals were approximately 35,321 for Work/V1 analysis, 34,080 for
Work/V1 synthesis, and over 44,000 for V2 strong synthesis. Dynamic evidence
embedded in fixed segments made some logged totals larger and nondeterministic.

## Rule-by-rule destination map

Line numbers below refer to the audited baseline, not this refactor's shifted
lines.

| Baseline instruction source                                              |                      Baseline chars | One-line rule summary                                                                                                         | One canonical destination                                                                                      | Status                                                      |
| ------------------------------------------------------------------------ | ----------------------------------: | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `strategy-chat/index.ts:7435-7575` Strategy Objective / Quality Standard |                               4,402 | Leverage, specificity, POV, commercial usefulness, conversation examples, anti-structure                                      | `fixed.core-invariants`; anti-structure only in `fixed.conversation-enforcement-final`                         | merged duplicate; universal anti-structure retired conflict |
| `strategy-chat/index.ts:3542-4047` `buildModeLockBlock`                  |                        1,471-12,988 | Exact asset schemas, placeholder/filler discipline, economics, reasoning, application, binding                                | `fixed.turn-contract`                                                                                          | preserved / merged duplicate                                |
| `behaviorIntent.ts:150-225` behavior contracts                           |                           429-2,904 | One exclusive behavior and its visible delivery                                                                               | `fixed.turn-contract`; conversation density/count in final segment                                             | preserved / merged duplicate                                |
| `chatPrompt.ts:44` Strategy identity                                     |                               1,177 | Corey/Branch expansion remit                                                                                                  | `fixed.core-invariants`; live quota/territory facts remain evidence                                            | preserved                                                   |
| `reasoningCore.ts:20-27` thinking order                                  |                                 731 | Thesis → leakage → section POV → alignment                                                                                    | `fixed.core-invariants`                                                                                        | preserved                                                   |
| `reasoningCore.ts:33-37` fact discipline                                 |                                 379 | VALID/INFER/HYPO/UNKN and thin-evidence posture                                                                               | `fixed.core-invariants` + `fixed.evidence-policy`                                                              | merged duplicate                                            |
| `reasoningCore.ts:42-44` account specificity                             |                                 220 | Company-swappable content fails                                                                                               | `fixed.core-invariants`                                                                                        | merged duplicate                                            |
| `reasoningCore.ts:49-51` economics                                       |                                 182 | Diagnose → quantify → validate → propose                                                                                      | `fixed.core-invariants`; turn-specific CFO rule in `fixed.turn-contract`                                       | merged duplicate                                            |
| `chatPrompt.ts:46-90` output contract                                    |                               4,531 | Direct answer, asset delivery, strategic threshold, citation/count/lookup rules                                               | Operator rules → Core; shape → Turn; library rules → Evidence Policy                                           | merged duplicate                                            |
| `chatPrompt.ts:92-99` depth                                              |                              69-156 | Fast/Standard/Deep response depth                                                                                             | `fixed.core-invariants` depth line                                                                             | preserved                                                   |
| `workspacePrompt.ts:139-228` workspace overlay                           |                         3,220-4,288 | Mission, posture, reasoning path, formatting, failures, escalation                                                            | `fixed.workspace-delta`; retrieval/citation clauses → Evidence Policy / Library Disclosure                     | preserved / merged duplicate                                |
| `strategy-chat/index.ts:5667-5697` response-format contract              |                           729-1,000 | Explicit user override and output-mode shape                                                                                  | `fixed.turn-contract` format precedence                                                                        | preserved / merged duplicate                                |
| `strategy-chat/index.ts:5830-5856` thesis persistence                    |                               1,990 | Exact hidden `thesis_update` fence/schema and trust rules                                                                     | `fixed.thesis-persistence`                                                                                     | preserved                                                   |
| `strategy-chat/index.ts:7586-7601` library usage                         |                               1,092 | Silent relevant use, selective citation, no retrieval theater                                                                 | `fixed.evidence-policy`                                                                                        | merged duplicate                                            |
| `strategy-chat/index.ts:7609-7641` decision layer                        |                               1,669 | Workspace posture and value-before-clarification                                                                              | `fixed.workspace-delta` + Core ambiguity rule                                                                  | merged duplicate                                            |
| `strategy-chat/index.ts:6002-6049` V1 library mode                       |                               0-547 | Strong/partial/thin/short-form behavior and Grounded/Extended labels                                                          | Evidence posture → Evidence Policy; visible gap/extension outcome → Library Disclosure; shape → Turn           | preserved / merged duplicate                                |
| deleted `v2/extendedReasoningContract.ts:27-50` V2 identity              |                               3,220 | POV, tradeoffs, commercial outcome, next moves                                                                                | `fixed.core-invariants`; dormant stale identity API removed                                                     | merged duplicate / obsolete builder deleted                 |
| deleted `v2/extendedReasoningContract.ts:53-320` V2 reasoning            |          943-5,960 plus title lists | Mode, ask shape, extension, citations, rubric, synthesis recency                                                              | Evidence Policy, Library Disclosure, Turn, `fixed.v2-route-delta`, and final V2 segment; shared sentinel retains drift telemetry | retired from live assembly / obsolete builder deleted |
| `outputMode.ts:238-315` conversation final                               |           2,434 plus dynamic digest | Highest-recency prose-only conversation gate                                                                                  | `fixed.conversation-enforcement-final` with data removed                                                       | preserved                                                   |
| `strategy-chat/index.ts:5947-5974` Global SOP wrapper                    |                   payload + wrapper | User-authored global operating standard                                                                                       | `runtime.global-sop` with exact marker/wording                                                                 | preserved                                                   |
| `strategy-chat/index.ts:5977-6000` Workspace SOP wrapper                 |                   payload + wrapper | Workspace-specific user SOP                                                                                                   | `runtime.workspace-sop`, after Global SOP                                                                      | preserved                                                   |
| `strategy-chat/index.ts:9751-9859` Global Instructions                   | up to 4,000 free text + preferences | Persistent user response preferences                                                                                          | `runtime.global-instructions`, after standards/reasoning                                                       | preserved                                                   |
| `resourceRetrieval.ts:1062-1271` embedded resource directives            |                          651-3,529+ | Exact titles, picked closed set, source-shape adaptation, no-hit behavior                                                     | `fixed.resource-grounding`; renderer is now data-only                                                          | preserved; `[TBD]` retired conflict                         |
| `strategy-chat/index.ts:2358-2361` dossier usage directive               |                               1,408 | Use exact dollars, opportunity names, and THE SENTENCE                                                                        | `fixed.dossier-grounding`; dossier body is evidence                                                            | preserved                                                   |
| `thesisMemory.ts:406-450` embedded thesis behavior                       |                                516+ | Continue, do not revive dead claims, confirm/weaken/kill                                                                      | `fixed.thesis-continuity`; thesis state is evidence                                                            | preserved                                                   |
| `libraryTotals.ts:84-102` totals directive                               |                             dynamic | Only exact DB totals authorize numeric counts                                                                                 | `fixed.core-invariants` / Evidence Policy; totals renderer is data-only                                        | preserved                                                   |
| `libraryRetrieval.ts:297-360` KI/playbook headers                        |                             dynamic | Use company knowledge; prioritize primary playbook                                                                            | `fixed.evidence-policy`; first playbook is marked `[PRIMARY]` in evidence                                      | preserved / conflict-resolved to relevant steps only        |
| `libraryStandard.ts:496-507` standard directives                         |                     328 + exemplars | Standards shape quality but are not citations                                                                                 | `fixed.evidence-policy`; exemplars are evidence                                                                | preserved                                                   |
| `currentStateIntelligence.ts:1880-2079` mixed prompt block               |                5,477 minimum + data | Verified→change→insight→friction→move pipeline, confidence/reference rules, five-point gate, and universal conversation shape | Data → `evidence.current-state`; reasoning/gate → `fixed.current-state-reasoning`; visible shape → Turn/final  | preserved + retired conflict                                |
| `strategy-chat/index.ts:7669-7724` territory profile                     |                           77 + data | Standing AE identity facts                                                                                                    | `evidence.territory` under data-only header                                                                    | preserved                                                   |
| `chatPrompt.ts:192-243` library/account/thread wrappers                  |                             dynamic | Workspace contextMode ordering                                                                                                | `evidence.core.*` via `buildStrategyChatEvidenceBlocks`                                                        | preserved                                                   |

## Exact asset map

Every classified intent has exactly one Turn destination:

| Intent              | Canonical visible contract                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bootstrap           | Exact orientation line, four bullets, exact closing line                                                                                                                       |
| Template            | Fill-in template; placeholders allowed only here; business-case fields retained                                                                                                |
| Email               | `Send this:` plus body only and one concrete ask                                                                                                                               |
| Message/script      | `Say this:` / `Send this:` asset only                                                                                                                                          |
| Audience rewrite    | Rewrite first, then exactly one `Why this lands:` block                                                                                                                        |
| Pitch               | `Say this:` plus one-to-four sentences only                                                                                                                                    |
| Account brief       | Exact Company Snapshot → Stakeholders → Operator Read → Next Moves order; V2 buying-motion, risk, lead/skip-angle, two-week-gap, and named-contact action rules retained       |
| 30/60/90            | Exact Account Context → Learn → Engage → Advance → Operator Read order; V2 70% allocation, messaging, pipe/channel, inspection, metrics, tradeoff, and week-one rules retained |
| Next steps          | `Do this next:` plus three-to-six named, outcome-bearing actions                                                                                                               |
| Analysis            | Exact thesis/leakage/economic/discovery schema plus Application                                                                                                                |
| Provenance          | One-to-three sentences naming actual sources only                                                                                                                              |
| Synthesis           | Exact pattern/dimensions/weighting/example/source schema; V2 synthesis adds This-Week Moves                                                                                    |
| Creation            | Source Basis → Reused vs Created → Asset → Gaps plus Application; every Reused line is cited and every no-source line is Created (extended)                                    |
| Evaluation          | Score → Breakdown → Gaps → prioritized highest-leverage one-to-three Improvements → Rewrite → Attribution plus Application                                                     |
| Freeform            | Exclusive behavior route plus output-mode precedence                                                                                                                           |
| Grounded short form | Exact subject/opener/hook/voicemail/talk-track counts and caps; long-form scaffolds are suppressed in prompt and guard                                                         |

## Explicit conflict resolutions

These were contradictory before consolidation; preserving both was impossible.

1. **Universal anti-structure vs structured assets.** Structured Turn/task
   schemas win. The anti-structure rule now exists only in conversation final.
2. **Current State says “Return ONLY conversation strategy” on every intent.**
   Current State now contributes data and reasoning only. Turn owns visible
   shape; conversation final applies only to freeform conversation delivery.
3. **Conversation count is both max two and typical three-to-five.** A recognized
   explicit count wins: numeric 1–20 or spelled one–twelve, followed by up to
   three supported modifiers and then a supported noun (including ideas, angles,
   options, paths, scripts, messages, drafts, versions, and talk tracks). Otherwise
   `conversation_strategy` gets one primary plus one
   backup; `idea_generation` gets three-to-five, or at least five in Brainstorm.
4. **Library gap disclosure has four incompatible forms.** One deterministic
   `resolveLibraryDisclosurePlan()` now selects exactly one outcome in
   `fixed.library-disclosure`: short-form/closed Turn adds none; authoritative
   Library-workspace coverage (used or `required_missing`) gets one integrated
   source/gap outcome: compatible structured freeform ends with exactly one
   `## Sources used` then one `## Gaps`; prose stays inline; synthesis/evaluation
   use Source Attribution; creation uses Source Basis plus Gaps; analysis uses
   Account thesis. Any D-thin or A/B/V1-partial notice is folded into that sole
   gap location. Non-required D-thin uses one merged notice, A/B or V1-partial
   uses one material-extension notice, and ordinary non-required thin proceeds
   silently. Workspace, Evidence Policy, and V2 route blocks delegate and cannot
   add another notice. Resource Grounding preserves missing/no-match/empty-body
   truth but folds it into the selected disclosure location, with no separate
   preface, gap note, or follow-up.
5. **Message/pitch/next-step say “nothing else” while a shared Application layer
   requires an appendix.** Exact asset wins. Application remains for analysis
   and for synthesis/creation/evaluation; the latter three are server-audited
   and flagged by the post-generation guard.
6. **V1 account brief/90-day are facts/timeline-first while V2 says POV-first.**
   The resolved Turn prompt makes the exact V1-compatible schema canonical and
   moves V2 POV into Operator Read. On the streaming path, the baseline hybrid
   helper checks header presence/legacy openings and can repackage detected
   drift after citation audit, including generic fallback copy for empty
   sections; the non-stream fallback logs the same check but does not rewrite.
   Neither proves every content obligation or header order, and the helper's
   guarantee is limited to not fabricating source citations.
7. **V1 synthesis is rigid while V2 calls ask shapes guidance.** The resolved
   Turn prompt makes the exact sections/table/weight/example/attribution schema
   canonical; distinct V2 POV/weighting/overrated/consequence/moves requirements
   live inside it. Post-generation mode-lock records structural drift but does
   not currently retry or block. Literal-citation absence is audited only when
   the active Evidence Policy actually requires literal syntax.
8. **Picked structured source permits `[TBD]` while the server strips it outside
   templates.** Effective server behavior wins: use `needs: <missing input>` in
   Artifacts or `To confirm:`/omission elsewhere.
9. **Strict Global Instructions call themselves final, while conversation
   enforcement is later.** Existing effective order is preserved: conversation
   final wins for eligible freeform conversation turns.
10. **Strong-synthesis tail and conversation final both claim last place.**
    Exact structured synthesis wins on overlap. Strong-synthesis tail is final
    for A-strong synthesis and for synthesis with at least three combined hits;
    otherwise eligible conversation enforcement is final.
11. **“Run every step” from a primary playbook can conflict with the requested
    asset.** PRIMARY remains priority evidence, but only relevant
    steps/questions apply inside the Turn schema.
12. **Hard-coded quota/account-count identity can become stale against Territory
    Profile.** Volatile quota/account-count language was removed from the live
    durable identity, and the dormant V2 builder that retained a second stale
    identity was deleted. An explicit authority rule makes Territory Profile
    the sole owner of current role, company, quota, account count, motion,
    team, and dates.
13. **Brainstorm labels/minimums conflict with universal conversation prose.**
    A recognized explicit count wins; otherwise Brainstorm still produces at least five.
    Conversation-final owns unlabeled prose, while non-conversation Brainstorm
    keeps `[Angle: ...]` labels and its `Next move:` tail.
14. **Library `[Source: title]`, V2 natural attribution, strict namespace
    citations, and asset-specific placement conflict.** One shared citation
    syntax constant owns exact-title `RESOURCE`/`KI`/`CARD`/`PLAYBOOK` forms
    and exactly-eight-hex KI/CARD fallbacks; lighter turns use natural title attribution. Resource
    Grounding and the final V2 synthesis tail delegate to Evidence Policy and
    define no namespace syntax.
    Turn owns placement: Account Brief confines material library-derived claims
    to Next Moves, and 30/60/90 confines them to Engage/Advance. CARD is a live
    namespace for the exact classifier-retrieved competitive-intel set; W5
    validates it fail-closed and `citations_json.competitive_intel` drives its
    existing source badge. Library standards remain quality-only unless they
    are separately supplied as citable card evidence. The obsolete V2 prompt
    builder and stale identity were deleted; only the shared synthesis-marker
    sentinel remains, so it cannot reintroduce narrower RESOURCE/KI syntax.
15. **Refine requires headings while Preserve forbids newly imposed shape.**
    Explicit user/input shape wins; absent one, Refine keeps the Improved
    version, Changes, and bounded variant sections.
16. **Conversation mode once forbade naming source/playbook titles while strict
    evidence rules require material attribution.** Evidence Policy wins prompt
    precedence, but W5 remains shadow/reporting-only and does not rewrite or
    block output. Material titles never become idea headings and retrieval is
    never announced. Namespace counting is shared, excludes UNVERIFIED tokens,
    and Strategy Chat supplies its Resource, retrieved-KI, library-KI,
    classifier-retrieved CARD, and Playbook hit sets to the shadow verifier.
    When V2 forces literal syntax,
    W5's effective mode becomes strict even if the workspace's raw mode is not;
    both raw and effective modes remain in routing telemetry.
17. **Picked-resource adaptation wants a `Using <title>...` preface while exact
    email/message/pitch assets require their own first line.** Turn wins: the
    preface appears only when commentary is allowed and Library Disclosure has
    no visible outcome; otherwise grounding/citation stays inside Turn or folds
    into the single selected disclosure location. Closed/short Turns also
    suppress missing/no-match/empty-resource prefaces and follow-ups while
    omitting unsupported claims, so silence never implies a missing body was read.
18. **Thesis continuity asks for visible CONFIRMS/WEAKENS/KILLS commentary while
    locked assets forbid appendices.** Show that commentary only when Turn
    permits it; otherwise persist the change solely through hidden metadata.
19. **Visible “nothing else”/prose-only rules conflict with the persistence
    fence.** The `thesis_update` fence is server-stripped non-visible metadata,
    remains permitted after every visible contract, and never reaches the user.
20. **V2 extension/gap lines and `thesis_update` both claim the response end.**
    V2 lines close the visible response; the hidden fence follows physically
    last. Strong synthesis completes This-Week Moves before that visible tail.
21. **A freeform-classified artifact can inherit conversation mode.**
    `artifact_creation` wins: its requested structure survives, conversation
    affects tone only, and universal conversation-final is not appended.
22. **V2 evaluation says the prioritized changes end the response while the
    evaluation schema places Optional Rewrite (only when applicable), Source
    Attribution, and Application after Improvements.** The resolved Turn prompt
    owns that physical order. V2's highest-leverage, one-to-three, priority-order
    semantics live in Improvements. The structural audit reports drift but does
    not regenerate.
23. **Creation requires two-to-five actual Source Basis entries while its
    zero-source path forbids fabrication and still requires the asset.** Actual
    sources are listed when available; otherwise Source Basis says "None."
    without retrieval narration, every Reused-vs-Created line is Created
    (extended), and the asset is still delivered. Citation telemetry now requires
    a citation only when citeable Resource/KI/CARD/Playbook evidence exists.

## After: canonical order and accounting

The live initial ledger is:

1. `evidence.territory`
2. `fixed.core-invariants`
3. `fixed.workspace-delta`
4. workspace-ordered `evidence.core.*`
5. `evidence.current-state`
6. `evidence.standards` (when present; inserted before authority contracts)
7. `runtime.global-sop` (when present)
8. `runtime.workspace-sop` (when present)
9. `fixed.turn-contract`
10. `fixed.evidence-policy`
11. `fixed.library-disclosure` (one resolved outcome on every turn)
12. `fixed.resource-grounding` (when applicable)
13. `fixed.dossier-grounding` (when applicable)
14. `fixed.current-state-reasoning` (when Current State ran)
15. `fixed.thesis-continuity` (when applicable)
16. `fixed.thesis-persistence` (Strategy Core paths)
17. `fixed.v2-route-delta` (V2 path; disclosure-free)
18. `runtime.global-instructions` (when present)
19. exactly one highest-recency final segment when required: conversation
    enforcement or locked V2 synthesis tail

Exhaustive pure tests enumerate every workspace, intent, depth, library mode,
short-form kind, output mode, and representative V2 route. The adversarial
maximum includes all conditional fixed policies simultaneously, must remain
`<= 17,500` in tests, and therefore retains at least 2,500 characters below the
hard 20,000 budget. Runtime fails closed before the provider call at 20,000.

## Marker and telemetry preservation

- Exact SOP headers remain `━━━ GLOBAL STRATEGY SOP` and `━━━ WORKSPACE SOP`.
- `[strategy-sop][prompt-trace]` and `[strategy-sop][presence-check]` prefixes
  and existing JSON keys remain.
- SOP presence/order is now derived from segment IDs, not regex matches against
  user/retrieved text; adversarial evidence cannot spoof it.
- V2 drift literals remain exact: `OPEN WITH POV`, `UNEQUAL WEIGHTING`,
  `CITE LITERAL TITLES INLINE`, `WHAT'S OVERRATED`, `COMMERCIAL CONSEQUENCE`,
  `EXECUTABLE NEXT MOVES`.
- The locked V2 tail now has an explicit runtime/test assertion that it is the
  final segment.
- The exact fenced `thesis_update` marker and parser remain paired.
- Conversation enforcement has an explicit runtime/test assertion that it is
  final when active.

## Preservation conclusion

Every distinct baseline rule is assigned above to one canonical destination.
Equivalent copies are marked **merged duplicate**. The twenty-three impossible
combinations have explicit prompt precedence; post-generation checks are called
"enforced" only where they actually mutate/block, and otherwise are identified
as telemetry/shadow audit. No instruction is silently dropped, no dynamic
evidence is counted as fixed instruction, and no SOP/V2/thesis regex marker is
left dangling.
