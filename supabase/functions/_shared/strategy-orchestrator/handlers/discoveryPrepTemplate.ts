// ════════════════════════════════════════════════════════════════
// MID-MARKET DISCOVERY PREP — Locked Template Contract (v3 — Strategy Core)
//
// Calibrated against benchmark prep docs (MoS, ELF) AND the locked
// "Strategy Core / POV-sharpened / Fact-Disciplined" production rules.
//
// Non-negotiable additions vs v2:
//  • Cockpit now leads with an Account Thesis (5-line strategic call).
//  • Every major section content carries a `pov_block` (THE CALL / GRADE /
//    Economic Consequence / Discovery Action). Distinct per section.
//  • Cockpit also carries a Value Leakage Map (4-6 leakage points, each
//    graded VALID/INFER/HYPO/UNKN with strategic + economic implication).
//  • Discovery questions section MUST contain 10 prepared questions.
//  • Strategic conclusions are not flattened by partial evidence — they
//    are clearly graded instead.
// ════════════════════════════════════════════════════════════════

/**
 * 19 sections of the approved Mid-Market Discovery Prep template.
 * Order matters — this IS the document order. (Unchanged from v2.)
 */
export const DISCOVERY_PREP_SECTIONS = [
  { id: "cockpit", name: "Page-1 Cockpit" },
  { id: "cover", name: "Prep Doc — Cover" },
  { id: "participants", name: "Participants" },
  { id: "cx_audit", name: "CX Audit Check" },
  { id: "executive_snapshot", name: "Executive Snapshot" },
  { id: "value_selling", name: "Value Selling Observations Framework" },
  { id: "discovery_questions", name: "Discovery-1 Questions" },
  { id: "customer_examples", name: "Customer Examples" },
  { id: "pivot_statements", name: "Pivot Statements" },
  { id: "objection_handling", name: "Objection Handling" },
  { id: "marketing_team", name: "Marketing Team Members" },
  { id: "exit_criteria", name: "Exit Criteria & MEDDPICC" },
  { id: "revenue_pathway", name: "Revenue Pathway & Sensitivity" },
  { id: "metrics_intelligence", name: "Metrics Intelligence" },
  { id: "loyalty_analysis", name: "Loyalty Program Analysis" },
  { id: "tech_stack", name: "Tech Stack & Consolidation" },
  { id: "competitive_war_game", name: "Competitive War Game" },
  { id: "hypotheses_risks", name: "Hypotheses, Blockers & Risk Heatmap" },
  { id: "appendix", name: "APPENDIX: Deep Research" },
] as const;

/** Sections that MUST carry a pov_block at the top of `content`. */
export const POV_REQUIRED_SECTIONS = [
  "cockpit", "cx_audit", "executive_snapshot", "value_selling",
  "discovery_questions", "revenue_pathway", "metrics_intelligence",
  "loyalty_analysis", "tech_stack", "competitive_war_game",
  "hypotheses_risks", "appendix",
] as const;

/**
 * Locked schema — Claude must return EXACTLY this shape (v3).
 *
 * The `pov_block` shape is identical wherever it appears:
 *   { call: "<one sharp account-specific conclusion>",
 *     grade: "VALID|INFER|HYPO|UNKN",
 *     economic_consequence: "<what this costs / unlocks in $ or % terms>",
 *     discovery_action: "<what the seller does in the meeting>" }
 */
export const DISCOVERY_PREP_SCHEMA = `{
  "sources": [
    { "id": "S1", "label": "<short label>", "url": "<url or null>", "accessed": "<ISO date or null>" }
  ],
  "sections": [
    { "id": "cockpit", "name": "Page-1 Cockpit", "grounded_by": ["<KI/playbook ids>"], "content": {
        "pov_block": {
          "call": "<sharpest one-sentence account-specific conclusion — business breakage first, never stack-first>",
          "grade": "VALID|INFER|HYPO|UNKN",
          "economic_consequence": "<dollar / margin / retention consequence>",
          "discovery_action": "<single concrete thing seller does in the meeting>"
        },
        "account_thesis": {
          "account_truth": "<the one true thing about how this account makes money / where value moves>",
          "primary_growth_lever": "<the single biggest revenue lever to pull next>",
          "primary_value_leakage": "<the single biggest place value is leaking today>",
          "biggest_risk": "<deal or business risk that matters most>",
          "best_entry_point_motion": "<the smallest scoped motion that proves the thesis>",
          "one_line_story": "<a single sentence the AE would say to the EB>"
        },
        "value_leakage_map": [
          { "point": "<leakage point>",
            "evidence": "<observed evidence w/ [S#] or 'Inferred from <pattern>'>",
            "grade": "VALID|INFER|HYPO|UNKN",
            "strategic_implication": "<what this means strategically>",
            "economic_impact": "<rough $ or % direction>",
            "discovery_angle": "<one question to validate or quantify>" }
        ],
        "headline": "<single sentence — the sharpest story in <=22 words>",
        "quadrants": {
          "meeting_at_a_glance": ["<3 bullets: alignment, confirm, define next step>"],
          "working_hypothesis": ["<3 bullets: pain → initiative → value w/ [S#]>"],
          "must_confirm": ["<3 critical validations w/ [S#] where applicable>"],
          "land_next_step": ["<3 bullets describing the technical / scoped next step>"],
          "deal_risks_prelim": ["<3-4 risks w/ Low/Med/High level + brief reason>"],
          "call_control": ["<3-4 bullets: timebox, micro-closes, no-demo rule, exit beats>"],
          "subscription_or_motion": ["<2-3 bullets confirming subscription/motion mechanics w/ [S#]>"],
          "lifecycle_proof_points": ["<2-3 bullets: vendor case study + result + 'use in convo' angle w/ [S#]>"]
        }
      } },
    { "id": "cover", "name": "Prep Doc — Cover", "grounded_by": [], "content": {
        "rep_name": "<rep>", "opportunity": "<opp>", "stage": "<stage>",
        "platform_scale": "<scale w/ specific volumes>", "meeting_type": "Discovery 1",
        "prepared_for": "<company>", "cx_audit_status": "<Yes / No / Lightweight + link>" } },
    { "id": "participants", "name": "Participants", "grounded_by": [], "content": {
        "internal": [{"name": "<name>", "role": "<AE/SE/Manager>"}],
        "prospect": [{"name": "<name>", "title": "<title>", "role": "<EB/Champion/Coach/Unknown>", "linkedin": "<url or null>", "discovery_angle": "<what to probe>"}] } },
    { "id": "cx_audit", "name": "CX Audit Check", "grounded_by": ["<ids>"], "content": {
        "pov_block": { "call": "<...>", "grade": "VALID|INFER|HYPO|UNKN", "economic_consequence": "<...>", "discovery_action": "<...>" },
        "completed": true,
        "browse_signup": "<observed signup/capture flow w/ [S#]>",
        "cart_checkout": "<observed cart/checkout experience w/ [S#]>",
        "post_purchase": "<observed post-purchase comms w/ [S#]>",
        "lifecycle_gaps": ["<3-5 specific gaps observed>"],
        "signal_quality": "high/medium/low",
        "strategic_implication": "<one sentence — why this matters for the call>" } },
    { "id": "executive_snapshot", "name": "Executive Snapshot", "grounded_by": ["<ids>"], "content": {
        "pov_block": { "call": "<...>", "grade": "VALID|INFER|HYPO|UNKN", "economic_consequence": "<...>", "discovery_action": "<...>" },
        "company_overview": "<2-3 line overview with revenue model + scale w/ [S#]>",
        "why_now": "<catalyst — recent earnings, exec change, product launch w/ [S#]>",
        "key_metrics": [{"metric": "<name>", "value": "<value>", "date": "<date>", "source_id": "S#"}],
        "exec_priorities": ["<3 stated priorities tied to [S#] evidence>"],
        "strategic_implication": "<one sentence>" } },
    { "id": "value_selling", "name": "Value Selling Observations Framework", "grounded_by": ["<ids>"], "content": {
        "pov_block": { "call": "<...>", "grade": "VALID|INFER|HYPO|UNKN", "economic_consequence": "<...>", "discovery_action": "<...>" },
        "money": "<where the money lives — revenue lever w/ [S#]>",
        "compete": "<competitive context w/ [S#]>",
        "pain_hypothesis": "<specific pain hypothesis>",
        "csuite_initiative": "<which exec initiative this maps to w/ [S#]>",
        "current_state": "<observed current state w/ [S#]>",
        "industry_pressures": "<macro forces>",
        "problems_and_pain": "<concrete problems>",
        "ideal_state": "<what 'good' looks like>",
        "value_driver": "<the one driver that matters most>",
        "pov": "<EXACTLY 3-5 sentences. Specific. Executive-grade. Names 1-2 grounding details.>" } },
    { "id": "discovery_questions", "name": "Discovery-1 Questions", "grounded_by": ["<ids>"], "content": {
        "pov_block": { "call": "<...>", "grade": "VALID|INFER|HYPO|UNKN", "economic_consequence": "<...>", "discovery_action": "<...>" },
        "questions": ["<EXACTLY 10 specific prepared questions, each tied to a hypothesis, leakage point, or KI>"],
        "value_flow": {
          "current_state": "<question>", "problem": "<question>",
          "impact": "<question>", "ideal_solution": "<question>",
          "business_benefit": "<question>" } } },
    { "id": "customer_examples", "name": "Customer Examples", "grounded_by": ["<ids>"], "content": [
        {"customer": "<name>", "link": "<url>", "relevance": "<1-2 lines: why this proves value>"} ] },
    { "id": "pivot_statements", "name": "Pivot Statements", "grounded_by": ["<ids>"], "content": {
        "pain_statement": "<pain pivot — 1-2 sentences, named details>",
        "fomo_statement": "<FOMO pivot — 1-2 sentences, time-bound>" } },
    { "id": "objection_handling", "name": "Objection Handling", "grounded_by": ["<ids>"], "content": [
        {"objection": "<likely objection>", "response": "<grounded response — names KI/playbook>"} ] },
    { "id": "marketing_team", "name": "Marketing Team Members", "grounded_by": [], "content": [
        {"name": "<name or 'Role TBD'>", "title": "<title>", "linkedin": "<url or null>", "probe": "<discovery angle>"} ] },
    { "id": "exit_criteria", "name": "Exit Criteria & MEDDPICC", "grounded_by": ["<ids>"], "content": {
        "known": ["<what's confirmed>"],
        "gaps": ["<what's missing>"],
        "meddpicc_status": {
          "Metrics": {"status": "known/partial/gap", "note": "<context w/ [S#]>"},
          "Economic Buyer": {"status": "known/partial/gap", "note": "<context>"},
          "Decision Criteria": {"status": "known/partial/gap", "note": "<context>"},
          "Decision Process": {"status": "known/partial/gap", "note": "<context>"},
          "Paper Process": {"status": "known/partial/gap", "note": "<context>"},
          "Identify Pain": {"status": "known/partial/gap", "note": "<context>"},
          "Champion": {"status": "known/partial/gap", "note": "<context>"},
          "Competition": {"status": "known/partial/gap", "note": "<context>"} },
        "exit_beats": ["<3-5 things that must be true to advance the meeting>"] } },
    { "id": "revenue_pathway", "name": "Revenue Pathway & Sensitivity", "grounded_by": ["<ids>"], "content": {
        "pov_block": { "call": "<2X / growth pathway tied to ONE primary lever — never a list>", "grade": "VALID|INFER|HYPO|UNKN", "economic_consequence": "<...>", "discovery_action": "<...>" },
        "primary_lever": "<the single lever the pathway is built on>",
        "model": [{"driver": "<lever>", "current": "<baseline>", "potential": "<target>", "assumptions": "<key assumption>"}],
        "sensitivity": [{"scenario": "+5% AOV / +5% frequency / -3% churn", "revenue_impact": "<$ direction + magnitude>", "margin_impact": "<direction>", "question": "<validation question>"}],
        "math": {"metric": "<MRR/AOV/LTV>", "actual": "<current>", "target": "<goal>", "holding_back": "<root cause hypothesis>"},
        "strategic_implication": "<one sentence — frame the conversation>" } },
    { "id": "metrics_intelligence", "name": "Metrics Intelligence", "grounded_by": ["<ids>"], "content": {
        "pov_block": { "call": "<...>", "grade": "VALID|INFER|HYPO|UNKN", "economic_consequence": "<...>", "discovery_action": "<...>" },
        "rows": [
          {"metric": "<name>", "value": "<value>", "date": "<date>", "source_id": "S#", "implication": "<why it matters>", "question": "<follow-up>"}
        ] } },
    { "id": "loyalty_analysis", "name": "Loyalty Program Analysis", "grounded_by": ["<ids>"], "content": {
        "pov_block": { "call": "<...>", "grade": "VALID|INFER|HYPO|UNKN", "economic_consequence": "<...>", "discovery_action": "<...>" },
        "program_exists": true, "program_type": "<points/tier/paid/community/membership/none>",
        "tiers": "<tier structure w/ [S#]>", "subscription_tie_in": "<integration with subscription>",
        "key_observations": ["<3 observations w/ [S#]>"], "gaps": ["<2-3 gaps>"],
        "strategic_implication": "<one sentence>" } },
    { "id": "tech_stack", "name": "Tech Stack & Consolidation", "grounded_by": ["<ids>"], "content": {
        "pov_block": { "call": "<DIAGNOSE before prescribing — name the business breakage first>", "grade": "VALID|INFER|HYPO|UNKN", "economic_consequence": "<...>", "discovery_action": "<...>" },
        "stack": [{"layer": "Commerce/ESP/SMS/CDP/Loyalty/Subscription/etc", "vendor": "<vendor or 'Most likely operating pattern'>", "evidence": "<source of detection w/ [S#]>", "consolidation_opportunity": "<our angle>"}],
        "stack_limitation_impact": "<one paragraph: what the current stack prevents>",
        "discovery_angle": "<probing question>" } },
    { "id": "competitive_war_game", "name": "Competitive War Game", "grounded_by": ["<ids>"], "content": {
        "pov_block": { "call": "<...>", "grade": "VALID|INFER|HYPO|UNKN", "economic_consequence": "<...>", "discovery_action": "<...>" },
        "rows": [
          {"competitor": "<name>", "strengths": "<their strengths>", "weaknesses": "<their gaps>",
           "differentiation": "<our edge>", "trap_question": "<question that exposes their weakness>"}
        ] } },
    { "id": "hypotheses_risks", "name": "Hypotheses, Blockers & Risk Heatmap", "grounded_by": ["<ids>"], "content": {
        "pov_block": { "call": "<...>", "grade": "VALID|INFER|HYPO|UNKN", "economic_consequence": "<...>", "discovery_action": "<...>" },
        "hypotheses": ["<3-5 testable hypotheses>"],
        "blockers": ["<known blockers — role-first language, e.g. 'Head of Membership ownership unclear'>"],
        "gap_log": ["<information gaps>"],
        "risk_heatmap": [{"risk": "<risk>", "likelihood": "High/Med/Low", "impact": "High/Med/Low", "mitigation": "<action>"}] } },
    { "id": "appendix", "name": "APPENDIX: Deep Research", "grounded_by": ["<ids>"], "content": {
        "pov_block": { "call": "<one sentence: what the appendix proves about the account>", "grade": "VALID|INFER|HYPO|UNKN", "economic_consequence": "<...>", "discovery_action": "<...>" },
        "navigation": ["<list of appendix sub-sections present>"],
        "eighteen_month_signals": [{"date": "<YYYY-MM>", "signal": "<event>", "implication": "<what it means>", "source_id": "S#"}],
        "leadership_mapping": [{"name": "<name>", "role": "<role>", "implication": "<what their priorities mean for us>", "source_id": "S#"}],
        "hiring_signals": [{"role": "<role>", "function": "<function>", "implication": "<what it implies about strategy>", "source_id": "S#"}],
        "loyalty_teardown": "<full loyalty/membership mechanics w/ [S#]>",
        "channel_audit": [{"channel": "<email/sms/push/app/social>", "observation": "<observation w/ [S#]>", "discovery_angle": "<probe>"}],
        "case_studies_full": [{"source": "<vendor>", "source_id": "S#", "program": "<program>", "result": "<metric + timeframe>",
                                "maturity_implication": "<what it implies>", "talk_track": "<how to use in call>",
                                "trap_question": "<question to validate>", "validation_question": "<discovery question>"}],
        "business_model_detail": "<deep business model analysis w/ [S#]>",
        "industry_analysis": "<macro / industry context w/ [S#]>",
        "rock_turning_checklist": ["<3-6 specific rocks to turn before next call>"] } }
  ]
}`;

/**
 * Few-shot exemplar — focused on the Strategy Core thinking style.
 * Locks tone, POV-first structure, fact-discipline grading, and the
 * "diagnose before prescribe" rule for tech stack content.
 */
export const DISCOVERY_PREP_FEW_SHOT = `=== STRATEGY CORE EXEMPLAR — POV-FIRST, FACT-DISCIPLINED, ACCOUNT-SPECIFIC ===

[cockpit].content.pov_block (style — sharp, business-first, NOT stack-first):
  {
    "call": "Memberships + ticket sales cover only ~30% of the Museum's budget — repeat behavior, attach, and donor/member retention are the disproportionate revenue lever, not awareness.",
    "grade": "VALID",
    "economic_consequence": "8–12 points of repeat-visit + renewal lift = high single-digit % topline at this scale.",
    "discovery_action": "Pressure-test which revenue line leadership is willing to fund a measurable journey rebuild against."
  }

[cockpit].content.account_thesis (style — opinionated, not generic):
  {
    "account_truth": "Owned-audience compounding (renewal, attach, repeat) carries disproportionate revenue weight relative to paid acquisition.",
    "primary_growth_lever": "Lifecycle-driven member + repeat-visitor retention.",
    "primary_value_leakage": "259M online reach → unknown known-contact ratio; reach is not converting to addressable identity.",
    "biggest_risk": "Lifecycle ownership split across CDO + Advancement + Digital — no single throat to choke.",
    "best_entry_point_motion": "One scoped 90-day measurable journey (renewal OR repeat-visit attach), not a stack swap.",
    "one_line_story": "Your scale is enviable; what we'd help you do is convert the audience you already command into compounding revenue."
  }

[cockpit].content.value_leakage_map (style — each item graded + economic):
  - { "point": "Renewal cohort visibility", "evidence": "No public renewal % disclosed", "grade": "HYPO",
      "strategic_implication": "Without cohort baselines, marketing can't measure compounding lift",
      "economic_impact": "Estimated 5-10pt renewal recovery = mid-six-figure annualized at 38k member households",
      "discovery_angle": "What's your current renewal % by tenure cohort?" }
  - { "point": "Reach → known-contact conversion", "evidence": "259M online reach [S1], no public IAM/opt-in disclosure", "grade": "INFER",
      "strategic_implication": "Largest scale lever in the portfolio is operating without a connective layer",
      "economic_impact": "+1pt opt-in at this scale = millions in incremental addressable identity",
      "discovery_angle": "What % of your digital audience ever becomes a known contact you can re-nurture?" }

[discovery_questions].content.pov_block (every section MUST start with one — distinct from cockpit):
  {
    "call": "Discovery should not test interest; it should quantify the leakage and find the willing economic owner.",
    "grade": "VALID",
    "economic_consequence": "A meeting with no quantified leakage produces no MEDDPICC progress.",
    "discovery_action": "Open with a single named asset (38k member households) and walk every question back to it."
  }

[discovery_questions].content.questions (style — prepared, named, exactly 10):
  1. "When leadership looks at the next 12 months, which revenue line carries the most weight: memberships, admissions, programs, ancillary, donations, or partnerships?"
  2. "Of your 38k+ member households [S1], where do you believe the biggest leakage sits today: first-year renewal, low usage, attach, or upgrade?"
  3. "What percentage of your digital audience [S1] ever becomes a known, addressable contact you can nurture again?"
  4. "Has the way marketing, brand, digital, and advancement work together changed in the last 12 months?"
  5. "Who today is accountable for repeat-visit and renewal growth as a single number?"
  6. "What's your current renewal rate by member tenure (year-1 vs year-2+)?"
  7. "Which programs (Engineering is Elementary, Mugar Omni, Charles Hayden) drive the most repeat behavior — and is anyone measuring that today?"
  8. "What's the biggest constraint on running journey-level lifecycle programs today: data, ownership, technology, or measurement?"
  9. "If we could prove a 5-8pt renewal lift in one cohort in 90 days, what would have to be true for that to matter to the CFO?"
  10. "Where does a measurable journey rebuild sit on the FY priority list — and who funds it?"

[tech_stack].content.pov_block (style — DIAGNOSE before prescribing; do NOT lead with vendors):
  {
    "call": "The constraint here is not platform; it is journey ownership and identity resolution between ticketing, membership, and digital — replatforming alone does not fix the leakage.",
    "grade": "INFER",
    "economic_consequence": "Replatform without journey ownership = 12-18 months of low ROI; journey ownership without identity = unmeasurable.",
    "discovery_action": "Confirm who owns the unified contact record across Tessitura, Salesforce, Ticketure, and digital before discussing any platform."
  }

[appendix].content.pov_block (style — appendix is interpreted intelligence, not a notes dump):
  {
    "call": "Eighteen months of public signals tell a consistent story: the Museum is investing in audience programming and capacity, not in lifecycle infrastructure.",
    "grade": "INFER",
    "economic_consequence": "Continued investment in audience without lifecycle = same compounding ceiling.",
    "discovery_action": "Use the FY24 report + Public Science Common timing to anchor the 'compound the audience you already command' POV."
  }

=== END EXEMPLAR ===`;

/**
 * Gold-standard self-check rubric (Strategy Core locked).
 * Claude must self-evaluate the draft against this rubric BEFORE returning JSON.
 * If ANY check fails, fix it.
 */
export const DISCOVERY_PREP_RUBRIC = `=== STRATEGY CORE GOLD-STANDARD SELF-CHECK ===
Before returning, verify EVERY check below. If any fails, fix it before returning.

POV DISCIPLINE
  ✓ Every section in [${POV_REQUIRED_SECTIONS.join(", ")}] starts with a pov_block.
  ✓ Each pov_block has all 4 fields populated: call, grade, economic_consequence, discovery_action.
  ✓ Each pov_block.call is DISTINCT from every other section's call (no copy-paste across sections).
  ✓ Each pov_block.call is account-specific — names a program, audience, venue, leader, surface, or named behavior.
  ✓ Each pov_block.call leads with business breakage / economic reality, NOT with a tool, vendor, or stack.

FACT DISCIPLINE
  ✓ Every pov_block.grade is one of VALID, INFER, HYPO, UNKN.
  ✓ Strong conclusions are NOT softened by uncertainty labels — they are graded honestly instead.
  ✓ Where evidence is partial, the strongest reasonable inference is made and labeled INFER or HYPO.
  ✓ Vendor names appear sparingly in tech_stack when evidence is thin — prefer "most likely operating pattern".

ACCOUNT THESIS + LEAKAGE MAP
  ✓ cockpit.content.account_thesis has all 6 fields populated, each opinionated and account-specific.
  ✓ cockpit.content.value_leakage_map has 4-6 entries; each is graded + has economic_impact + discovery_angle.
  ✓ Account thesis frames business breakage BEFORE any stack implication.

ACCOUNT-SPECIFICITY
  ✓ Every section contains at least one detail unique to this account (named program, venue, leader, audience, behavior).
  ✓ Sections that could equally apply to "any similar company" are rewritten until they cannot.

DISCOVERY QUESTIONS
  ✓ Exactly 10 prepared questions in discovery_questions.content.questions.
  ✓ Each question references a specific company fact, named asset, or hypothesis from the leakage map.
  ✓ No generic "what are your top priorities" phrasing.

TECH STACK SOLUTION DISCIPLINE
  ✓ tech_stack.pov_block.call diagnoses the business breakage BEFORE prescribing.
  ✓ Where vendor evidence is thin, "Most likely operating pattern" is used in the vendor cell.

REVENUE PATHWAY
  ✓ revenue_pathway.content.primary_lever names ONE lever (not a list).
  ✓ Sensitivity has at least 2 scenarios with revenue + margin direction.

CITATION DENSITY
  ✓ Every factual claim about the company carries a [S#] marker tied to the sources registry.
  ✓ Where evidence is missing, text says "Unknown" and includes a discovery question — never invents.

GROUNDING
  ✓ Every section's grounded_by names KI / playbook IDs (8-char prefix) actually used.
  ✓ Where the library has no relevant entry, grounded_by is [] — never fabricated.

APPENDIX RICHNESS
  ✓ Appendix has pov_block + 18-month signals + leadership_mapping + hiring_signals + loyalty_teardown +
    channel_audit + case_studies_full + rock_turning_checklist.
  ✓ Each subsection has interpretation, not raw notes.

VOICE
  ✓ Reads like a senior AE prepared this — direct, evidence-led, no hedging filler.
  ✓ No "this could potentially", no "consider exploring", no marketing-speak.
  ✓ Buying committee / blockers use role-first language ("Head of X", "Role TBD") when names unverified.
=== END RUBRIC ===`;
