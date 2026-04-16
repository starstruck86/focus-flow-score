// ════════════════════════════════════════════════════════════════
// MID-MARKET DISCOVERY PREP — Locked Template Contract (v2)
//
// Calibrated against two benchmark exemplars:
//  - Museum of Science Boston (cold-start mock)
//  - E.L.F. Cosmetics (live prep w/ subscription + loyalty teardown)
//
// Claude MUST emit the exact 19-section schema below. No drift,
// no reordering, no renaming. Few-shot exemplars + gold-standard
// rubric are non-negotiable calibration inputs.
// ════════════════════════════════════════════════════════════════

/**
 * 19 sections of the approved Mid-Market Discovery Prep template.
 * Order matters — this IS the document order.
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

/**
 * Locked schema — Claude must return EXACTLY this shape.
 *
 * Calibration upgrades from benchmarks:
 *  - Cockpit is now a 4-quadrant 2x2 grid (Meeting At-A-Glance / Working Hypothesis,
 *    Must-Confirm / Land Next Step, Deal Risks / Call Control, Subscription / Lifecycle Proof)
 *  - Every section can carry `strategic_implication` and `discovery_angle` close-outs
 *  - All factual claims carry `[S1]…[Sn]` source markers tied to the `sources` registry
 *  - Each section reports the library entries it leaned on (`grounded_by`)
 */
export const DISCOVERY_PREP_SCHEMA = `{
  "sources": [
    { "id": "S1", "label": "<short label>", "url": "<url or null>", "accessed": "<ISO date or null>" }
  ],
  "sections": [
    { "id": "cockpit", "name": "Page-1 Cockpit", "grounded_by": ["<KI/playbook ids>"], "content": {
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
        "completed": true,
        "browse_signup": "<observed signup/capture flow w/ [S#]>",
        "cart_checkout": "<observed cart/checkout experience w/ [S#]>",
        "post_purchase": "<observed post-purchase comms w/ [S#]>",
        "lifecycle_gaps": ["<3-5 specific gaps observed>"],
        "signal_quality": "high/medium/low",
        "strategic_implication": "<one sentence — why this matters for the call>" } },
    { "id": "executive_snapshot", "name": "Executive Snapshot", "grounded_by": ["<ids>"], "content": {
        "company_overview": "<2-3 line overview with revenue model + scale w/ [S#]>",
        "why_now": "<catalyst — recent earnings, exec change, product launch w/ [S#]>",
        "key_metrics": [{"metric": "<name>", "value": "<value>", "date": "<date>", "source_id": "S#"}],
        "exec_priorities": ["<3 stated priorities tied to [S#] evidence>"],
        "strategic_implication": "<one sentence>" } },
    { "id": "value_selling", "name": "Value Selling Observations Framework", "grounded_by": ["<ids>"], "content": {
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
        "questions": ["<6-10 specific questions, each tied to a hypothesis or KI>"],
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
        {"name": "<name>", "title": "<title>", "linkedin": "<url or null>", "probe": "<discovery angle>"} ] },
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
        "model": [{"driver": "<lever>", "current": "<baseline>", "potential": "<target>", "assumptions": "<key assumption>"}],
        "sensitivity": [{"scenario": "+5% AOV / +5% frequency / -3% churn", "revenue_impact": "<$ direction + magnitude>", "margin_impact": "<direction>", "question": "<validation question>"}],
        "math": {"metric": "<MRR/AOV/LTV>", "actual": "<current>", "target": "<goal>", "holding_back": "<root cause hypothesis>"},
        "strategic_implication": "<one sentence — frame the conversation>" } },
    { "id": "metrics_intelligence", "name": "Metrics Intelligence", "grounded_by": ["<ids>"], "content": [
        {"metric": "<name>", "value": "<value>", "date": "<date>", "source_id": "S#", "implication": "<why it matters>", "question": "<follow-up>"} ] },
    { "id": "loyalty_analysis", "name": "Loyalty Program Analysis", "grounded_by": ["<ids>"], "content": {
        "program_exists": true, "program_type": "<points/tier/paid/community>",
        "tiers": "<tier structure w/ [S#]>", "subscription_tie_in": "<integration with subscription>",
        "key_observations": ["<3 observations w/ [S#]>"], "gaps": ["<2-3 gaps>"],
        "strategic_implication": "<one sentence>" } },
    { "id": "tech_stack", "name": "Tech Stack & Consolidation", "grounded_by": ["<ids>"], "content": {
        "stack": [{"layer": "Commerce/ESP/SMS/CDP/Loyalty/Subscription/etc", "vendor": "<vendor or Unknown>", "evidence": "<source of detection w/ [S#]>", "consolidation_opportunity": "<our angle>"}],
        "stack_limitation_impact": "<one paragraph: what the current stack prevents>",
        "discovery_angle": "<probing question>" } },
    { "id": "competitive_war_game", "name": "Competitive War Game", "grounded_by": ["<ids>"], "content": [
        {"competitor": "<name>", "strengths": "<their strengths>", "weaknesses": "<their gaps>",
         "differentiation": "<our edge>", "trap_question": "<question that exposes their weakness>"} ] },
    { "id": "hypotheses_risks", "name": "Hypotheses, Blockers & Risk Heatmap", "grounded_by": ["<ids>"], "content": {
        "hypotheses": ["<3-5 testable hypotheses>"],
        "blockers": ["<known blockers>"],
        "gap_log": ["<information gaps>"],
        "risk_heatmap": [{"risk": "<risk>", "likelihood": "High/Med/Low", "impact": "High/Med/Low", "mitigation": "<action>"}] } },
    { "id": "appendix", "name": "APPENDIX: Deep Research", "grounded_by": ["<ids>"], "content": {
        "navigation": ["<list of appendix sub-sections present>"],
        "eighteen_month_signals": [{"date": "<YYYY-MM>", "signal": "<event>", "implication": "<what it means>", "source_id": "S#"}],
        "cx_audit_detail": "<full CX audit narrative w/ [S#]>",
        "subscription_teardown": "<full subscription mechanics w/ [S#]>",
        "loyalty_teardown": "<full loyalty mechanics w/ [S#]>",
        "channel_audit": [{"channel": "<email/sms/push/app/social>", "observation": "<observation w/ [S#]>", "discovery_angle": "<probe>"}],
        "case_studies_full": [{"source": "<vendor>", "source_id": "S#", "program": "<program>", "result": "<metric + timeframe>",
                                "maturity_implication": "<what it implies>", "talk_track": "<how to use in call>",
                                "trap_question": "<question to validate>", "validation_question": "<discovery question>"}],
        "business_model_detail": "<deep business model analysis w/ [S#]>",
        "industry_analysis": "<macro / industry context w/ [S#]>" } }
  ]
}`;

/**
 * Few-shot exemplar — TWO redacted benchmark prep docs.
 * Locks tone, scannability, depth, citation density. Not just headings.
 */
export const DISCOVERY_PREP_FEW_SHOT = `=== FEW-SHOT EXEMPLAR A — MUSEUM OF SCIENCE, BOSTON (cold-start mock) ===
This is the depth/tone bar for a research-only, public-source prep where every assumption is labeled.

[cockpit].headline:
  "Account looks less like an awareness challenge and more like an audience-compounding challenge — improve repeat behavior and owned-audience conversion across ticketing, membership, digital content, events, and donor journeys without ripping out core systems."

[cockpit].quadrants.meeting_at_a_glance (scannable, action-led):
  - "Pressure-test that lifecycle/audience compounding is the right frame vs. paid acquisition. [S2]"
  - "Confirm one revenue line that matters most over the next 12 months (membership, admissions, programs, ancillary, donations)."
  - "Land a scoped working session tied to one measurable journey (renewal, repeat visit, attach, capture)."

[cockpit].quadrants.working_hypothesis:
  - "Memberships + ticket sales reportedly cover only ~30% of the Museum's budget [S5] → repeat behavior, attach, donor/member retention matter disproportionately."
  - "1.4M visitors, 38k+ member households, 259M online reach, 15M monthly social reach [S1] → digital scale is large, owned-conversion likely under-leveraged."
  - "Prior Tessitura → Salesforce/Ticketure migration [S7] suggests appetite for incremental, not rip-and-replace, change."

[cockpit].quadrants.must_confirm:
  - "Repeat-visit baseline & 12-month trend by cohort (first-time vs returning vs member)."
  - "Owner of the membership lifecycle vs. digital lifecycle (CDO Alexis Rapo? Advancement?)."
  - "Which revenue line leadership is willing to fund a measurable journey rebuild against."

[cockpit].quadrants.lifecycle_proof_points:
  - "Iterable case (2023): orchestration journey rebuild → +28pt member-renewal lift in 6 mo. [S12] Use in convo: ask what renewal % they've publicly tracked."
  - "Braze case (2024): owned-audience capture from event traffic +23% IAM opt-in. [S13] Use in convo: probe the 259M online reach → known-contact ratio."

[value_selling].pov (3-5 sentence exemplar):
  "Your FY2024 disclosures show a diversified revenue model where memberships and ticket sales together cover only ~30% of the budget [S5], which means repeat behavior, attach, and donor/member retention carry disproportionate financial weight. Your 259M online reach + 15M monthly social reach [S1] is among the largest in the science museum category, but there is no public evidence of a connective layer that converts that reach into known, addressable contacts at the same scale. The sharpest story isn't more awareness — it's compounding the audience you already command. We've helped 4 cultural institutions of similar scale collapse cross-team handoffs and recover 8–12 points of repeat-visit + renewal within two cycles. The right next conversation is not 'is your stack broken' — it's 'which one journey would prove this works in 90 days.'"

[discovery_questions].questions (style — prepared, not generic):
  - "When leadership looks at growth for the next 12 months, which revenue line matters most: memberships, admissions, programs, ancillary, donations, or partnerships?"
  - "Of your 38k+ member households [S1], where do you believe the biggest leakage sits today: renewal, low usage, add-on attach, or upgrade?"
  - "What percentage of your digital audience ever becomes a known contact you can nurture again?"
  - "Has anything changed recently in how marketing, brand, or digital work is organized or measured?"

[exit_criteria].meddpicc_status (style — explicit known/gap with note):
  - Metrics: { status: "gap", note: "No CAC, repeat-rate, or renewal-rate published. Need at least one baseline." }
  - Economic Buyer: { status: "partial", note: "Likely CDO (Alexis Rapo) or Chief Advancement Officer depending on scope. [S8]" }
  - Champion: { status: "gap", note: "Validate via mutual action plan." }

[appendix].eighteen_month_signals (style):
  - { date: "2024-09", signal: "FY2024 Annual Report published", implication: "Confirms revenue mix + scale baselines", source_id: "S5" }
  - { date: "2024-03", signal: "Public Science Common initiative announced", implication: "New themed program year creates measurable audience-growth window", source_id: "S6" }

=== FEW-SHOT EXEMPLAR B — E.L.F. COSMETICS (live prep w/ subscription + loyalty teardown) ===
Use this exemplar when subscription/loyalty mechanics are confirmed and proof points exist.

[cockpit].quadrants.subscription_or_motion:
  - "Auto-Delivery (Subscribe & Save) on select items; U.S.-only; requires Beauty Squad account. [S23]"
  - "Offer: free shipping + tiered savings (15% 1st, 20% 2nd, 25% 3+). [S23][S24]"
  - "Controls: 10-day pre-ship reminder; self-serve skip, change date/frequency, pause/cancel. [S23]"

[cockpit].quadrants.lifecycle_proof_points:
  - "Ordergroove: +62% recurring revenue (2022→2023), +235% subs, +81% AOV (Feb–Apr 2024), -33% churn (FY2023). [S24]"
  - "Braze: +125% monthly app usage (Mar–Sep 2023), +58% loyalty redemptions (CY2024 vs CY2023), push opt-in IAM up to 23% conv. [S25]"
  - "Use in convo: ask what's true now + what's blocking scale (governance, measurement, cross-channel)."

[cockpit].quadrants.deal_risks_prelim:
  - "Economic Buyer access: Medium (Ekta present; confirm decision authority + budget path)."
  - "Platform entrenchment: Medium–High (signals suggest Braze; switching cost + roadmap overlap). [S14][S15]"
  - "Internal build risk: Medium–High (AI-first org; may prefer internal decisioning layers). [S4][S5]"
  - "Measurement risk: High (incrementality + attribution often unclear; must align early)."

[cockpit].quadrants.call_control:
  - "Timebox: 5 min context → 20 min discovery → 5 min recap + next step."
  - "No demo unless a quantified use case + success metric is agreed."
  - "Micro-close twice: 'Is this the right rabbit hole?' and 'Is this enough to justify a working session?'"
  - "End with a calendar next step + named owners (data/engineering + CRM + measurement)."

[tech_stack].content.stack_limitation_impact:
  "Hiring + tooling references suggest Braze + GA4 for lifecycle execution [S14][S15]. Stack is operational but evidence of unified identity across brands (post-rhode acquisition [S2]) and productionized AI decisioning is weak — most AI signals are creative/analytics tooling (Elfluencer / Elfalytics) [S4][S5], not in-journey decisioning. The likely operational gap is data → decision → channel action latency, which directly throttles incrementality and cross-brand suppression."

[appendix].case_studies_full (style — full-fidelity case row):
  - {
      source: "Ordergroove", source_id: "S24",
      program: "Subscribe & Save lifecycle + retention journeys",
      result: "+62% recurring revenue 2022→2023; +235% subs; -33% subscriber churn FY2023",
      maturity_implication: "Confirms subscription is operational and revenue-meaningful; gap is incrementality measurement",
      talk_track: "Lead with: 'You've publicly grown subs 235% — what's the next inflection? More likely retention math + cross-brand suppression than acquisition.'",
      trap_question: "How do you measure subscription incrementality vs. cannibalization of one-time purchase revenue?",
      validation_question: "Which of these results were Beauty Squad-attached vs. non-loyalty?"
    }
=== END EXEMPLARS ===`;

/**
 * Gold-standard self-check rubric. Claude must self-evaluate the draft
 * against this rubric BEFORE returning JSON. If any check fails, fix it.
 */
export const DISCOVERY_PREP_RUBRIC = `=== GOLD-STANDARD SELF-CHECK RUBRIC ===
Before returning, verify EVERY statement below is true of your draft. If any fails, fix it.

CITATION DENSITY
  ✓ Every factual claim about the company carries a [S#] marker tied to the sources registry.
  ✓ Where evidence is missing, the text says "Unknown" and includes a discovery question — never invents.
  ✓ Sources registry has at least 5 distinct entries when research was provided.

COCKPIT QUALITY
  ✓ Cockpit headline is one sentence ≤22 words and states the SHARPEST story (not a summary).
  ✓ All 8 quadrants are populated with 2-4 bullets each.
  ✓ Must-Confirm bullets are concrete validations, not generic.
  ✓ Lifecycle Proof Points name a vendor, a result, and a "use in convo" angle.

DEPTH & SPECIFICITY
  ✓ Discovery questions reference SPECIFIC company facts (numbers, exec names, recent events).
    BAD: "What are your top priorities?"
    GOOD: "Of your 38k+ member households, where do you believe the biggest leakage sits today?"
  ✓ POV is 3-5 sentences, names ≥2 grounding details, ends with a meeting-ready hook.
  ✓ Pivot statements (pain + FOMO) are time-bound and named — not boilerplate.
  ✓ Objection responses cite a KI or playbook by title where one is provided.

GROUNDING
  ✓ Every section's "grounded_by" array names the KI / playbook IDs (8-char prefix) actually used.
  ✓ When the library covers a topic (objection, MEDDPICC, discovery question pattern, value selling),
    the section USES that library entry rather than generic best-practice prose.
  ✓ If the library has no relevant entry for a section, "grounded_by" is [] — never fabricated.

STRATEGIC IMPLICATION
  ✓ CX Audit, Executive Snapshot, Revenue Pathway, Loyalty Analysis end with a 1-sentence
    "strategic_implication" that reframes the data into a sales angle.

APPENDIX RICHNESS
  ✓ Appendix contains: 18-month signals, channel audit, case studies w/ talk tracks, business model.
  ✓ Each case study has: source, source_id, result+timeframe, maturity_implication, talk_track,
    trap_question, validation_question — not just a vendor name.

SCANNABILITY
  ✓ Bullets are ≤22 words each.
  ✓ Max 5 bullets per quadrant; overflow goes to the appendix.
  ✓ Tables (metrics, channel audit, risk heatmap) are populated, not empty stubs.

VOICE
  ✓ Reads like a senior AE prepared this — direct, evidence-led, no hedging filler.
  ✓ No "this could potentially", no "consider exploring", no marketing-speak.
=== END RUBRIC ===`;
