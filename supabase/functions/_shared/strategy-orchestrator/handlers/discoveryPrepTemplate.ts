// ════════════════════════════════════════════════════════════════
// MID-MARKET DISCOVERY PREP — Locked Template Contract
//
// This file is the source of truth for the Discovery Prep template.
// Claude MUST emit the exact 19-section schema below. No drift,
// no reordering, no renaming. Few-shot exemplar locks tone & depth.
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
 * The exact JSON schema Claude must return.
 * Embedded in the system prompt as a non-negotiable contract.
 */
export const DISCOVERY_PREP_SCHEMA = `{
  "sections": [
    { "id": "cockpit", "name": "Page-1 Cockpit", "content": {
        "cards": [
          { "label": "Objective & Next Step", "value": "<specific objective + desired next step>" },
          { "label": "Working Hypothesis & Why Now", "value": "<2-3 lines: pain → initiative → value, plus catalyst>" },
          { "label": "Must-Confirm", "bullets": ["<3 critical validations>"] },
          { "label": "Deal Risks & Call Control", "bullets": ["<2-3 risks with mitigations>"] },
          { "label": "Subscription Model", "value": "Yes/No + key mechanics" },
          { "label": "Lifecycle Proof Points", "bullets": ["<top 1-2 case studies with result + implication>"] }
        ] } },
    { "id": "cover", "name": "Prep Doc — Cover", "content": {
        "rep_name": "<rep>", "opportunity": "<opp>", "stage": "<stage>",
        "platform_scale": "<scale>", "meeting_type": "Discovery 1",
        "prepared_for": "<company>" } },
    { "id": "participants", "name": "Participants", "content": {
        "internal": [{"name": "<name>", "role": "<AE/SE/Manager>"}],
        "prospect": [{"name": "<name>", "title": "<title>", "role": "<EB/Champion/Coach/Unknown>", "linkedin": "<url or null>"}] } },
    { "id": "cx_audit", "name": "CX Audit Check", "content": {
        "completed": true,
        "browse_signup": "<observed signup/capture flow>",
        "cart_checkout": "<observed cart/checkout experience>",
        "post_purchase": "<observed post-purchase comms>",
        "lifecycle_gaps": ["<3-5 specific gaps observed>"],
        "signal_quality": "high/medium/low" } },
    { "id": "executive_snapshot", "name": "Executive Snapshot", "content": {
        "company_overview": "<2-3 line overview with revenue model + scale>",
        "why_now": "<catalyst — recent earnings, exec change, product launch, etc.>",
        "key_metrics": [{"metric": "<name>", "value": "<value>", "date": "<date>", "source": "<url or 'Unknown'>"}],
        "exec_priorities": ["<3 stated priorities tied to evidence>"] } },
    { "id": "value_selling", "name": "Value Selling Observations Framework", "content": {
        "money": "<where the money lives — revenue lever>",
        "compete": "<competitive context>",
        "pain_hypothesis": "<specific pain hypothesis>",
        "csuite_initiative": "<which exec initiative this maps to>",
        "current_state": "<observed current state>",
        "industry_pressures": "<macro forces>",
        "problems_and_pain": "<concrete problems>",
        "ideal_state": "<what 'good' looks like>",
        "value_driver": "<the one driver that matters most>",
        "pov": "<EXACTLY 3-5 sentences. Specific. Not generic.>" } },
    { "id": "discovery_questions", "name": "Discovery-1 Questions", "content": {
        "questions": ["<6 specific questions, each tied to a hypothesis>"],
        "value_flow": {
          "current_state": "<question>", "problem": "<question>",
          "impact": "<question>", "ideal_solution": "<question>",
          "business_benefit": "<question>" } } },
    { "id": "customer_examples", "name": "Customer Examples", "content": [
        {"customer": "<name>", "link": "<url>", "relevance": "<1-2 lines: why this proves value>"} ] },
    { "id": "pivot_statements", "name": "Pivot Statements", "content": {
        "pain_statement": "<pain pivot — 1-2 sentences>",
        "fomo_statement": "<FOMO pivot — 1-2 sentences>" } },
    { "id": "objection_handling", "name": "Objection Handling", "content": [
        {"objection": "<likely objection>", "response": "<grounded response — uses internal playbooks>"} ] },
    { "id": "marketing_team", "name": "Marketing Team Members", "content": [
        {"name": "<name>", "title": "<title>", "linkedin": "<url or null>"} ] },
    { "id": "exit_criteria", "name": "Exit Criteria & MEDDPICC", "content": {
        "known": ["<what's confirmed>"],
        "gaps": ["<what's missing>"],
        "meddpicc_status": {
          "Metrics": "<known/gap + note>", "Economic Buyer": "<known/gap + note>",
          "Decision Criteria": "<known/gap + note>", "Decision Process": "<known/gap + note>",
          "Paper Process": "<known/gap + note>", "Identify Pain": "<known/gap + note>",
          "Champion": "<known/gap + note>", "Competition": "<known/gap + note>" } } },
    { "id": "revenue_pathway", "name": "Revenue Pathway & Sensitivity", "content": {
        "model": [{"driver": "<lever>", "current": "<baseline>", "potential": "<target>", "assumptions": "<key assumption>"}],
        "sensitivity": [{"scenario": "+5% AOV / +5% frequency / -3% churn", "impact": "<$ direction + magnitude>", "question": "<validation question>"}],
        "math": {"metric": "<MRR/AOV/LTV>", "actual": "<current>", "target": "<goal>", "holding_back": "<root cause hypothesis>"} } },
    { "id": "metrics_intelligence", "name": "Metrics Intelligence", "content": [
        {"metric": "<name>", "value": "<value>", "date": "<date>", "source": "<url>", "implication": "<why it matters>", "question": "<follow-up>"} ] },
    { "id": "loyalty_analysis", "name": "Loyalty Program Analysis", "content": {
        "program_exists": true, "program_type": "<points/tier/paid/community>",
        "tiers": "<tier structure>", "subscription_tie_in": "<integration with subscription>",
        "key_observations": ["<3 observations>"], "gaps": ["<2-3 gaps>"] } },
    { "id": "tech_stack", "name": "Tech Stack & Consolidation", "content": [
        {"layer": "Commerce/ESP/SMS/CDP/Loyalty/Subscription/etc", "vendor": "<vendor or Unknown>",
         "evidence": "<source of detection>", "consolidation_opportunity": "<our angle>"} ] },
    { "id": "competitive_war_game", "name": "Competitive War Game", "content": [
        {"competitor": "<name>", "strengths": "<their strengths>", "weaknesses": "<their gaps>",
         "differentiation": "<our edge>", "trap_question": "<question that exposes their weakness>"} ] },
    { "id": "hypotheses_risks", "name": "Hypotheses, Blockers & Risk Heatmap", "content": {
        "hypotheses": ["<3-5 testable hypotheses>"],
        "blockers": ["<known blockers>"],
        "gap_log": ["<information gaps>"],
        "risk_heatmap": [{"risk": "<risk>", "likelihood": "High/Med/Low", "impact": "High/Med/Low", "mitigation": "<action>"}] } },
    { "id": "appendix", "name": "APPENDIX: Deep Research", "content": {
        "cx_audit_detail": "<full CX audit narrative>",
        "subscription_teardown": "<full subscription mechanics>",
        "case_studies_full": [{"source": "<vendor/url>", "program": "<program>", "result": "<metric + timeframe>",
                                "maturity_implication": "<what it implies>", "talk_track": "<how to use in call>",
                                "trap_question": "<question to validate>", "validation_question": "<discovery question>"}],
        "business_model_detail": "<deep business model analysis>",
        "industry_analysis": "<macro / industry context>" } }
  ]
}`;

/**
 * Few-shot exemplar — redacted, high-quality completed prep.
 * Locks tone, scannability, depth. Not just headings.
 *
 * Style notes Claude must follow:
 *  - Specific metrics with sources, never generic
 *  - Bullets are tight (≤ 18 words)
 *  - POV is 3-5 sentences, executive-grade
 *  - Discovery questions sound prepared, not generic
 *  - "Unknown" is acceptable — paired with a discovery question
 */
export const DISCOVERY_PREP_FEW_SHOT = `=== FEW-SHOT EXEMPLAR (redacted) ===
This is the depth, tone, and scannability bar. Match it.

[cockpit].cards:
  • Objective & Next Step:
      "Validate hypothesis that lifecycle fragmentation is throttling repeat-revenue. Next step: scoped technical eval w/ CRM + CDP owner within 14 days."
  • Working Hypothesis & Why Now:
      "Q3 earnings cited '14% YoY repeat-rate decline' + 'over-reliance on paid acquisition.' New CMO (Mar 2024, ex-[REDACTED]) is mandating retention/CDP consolidation by FY-end."
  • Must-Confirm:
      - Repeat-rate baseline & 12-mo trend (CMO cited 14% — confirm window + segment)
      - Owner of post-purchase journey (Marketing Ops vs Lifecycle vs CRM team)
      - Subscription program revenue mix (we observed 'Subscribe & Save' but no $ disclosed)
  • Subscription Model:
      "Yes — Ordergroove-powered Subscribe & Save, 5–15% discount tiers, monthly/bi-monthly cadence. Cancel allowed via account portal. % of revenue: Unknown."
  • Lifecycle Proof Points:
      - Iterable case (2023): "[REDACTED] grew subscription revenue 38% in 6 months via journey orchestration" → maps to our CMO's stated retention mandate.

[value_selling].pov (3-5 sentences exemplar):
"You've publicly committed to consolidating retention spend and rebuilding lifecycle around CDP truth — but our audit shows three orchestration tools firing redundant journeys against the same segment. That fragmentation is the most likely root-cause of the 14% repeat-rate slide, not paid CAC. We've helped 4 mid-market subscription brands collapse this stack and recover 8–12 points of repeat-rate within 2 quarters. The conversation we'd like to have isn't 'is your stack broken' — it's 'which 90-day rebuild plan unlocks the fastest retention recovery.'"

[discovery_questions].questions (style):
  - "Your Q3 letter cited a 14% repeat-rate decline — is that across the full base or specific to non-subscription cohorts?"
  - "When the new CMO talks about 'consolidating retention,' which of the four lifecycle tools we observed (Klaviyo, Iterable, Yotpo, Ordergroove) are on the table?"
  (NOT generic: "What are your top priorities?")

[exit_criteria].meddpicc_status (style):
  - Metrics: "GAP — No $ disclosed for subscription program. Need % of revenue + LTV uplift."
  - Economic Buyer: "KNOWN — CMO [REDACTED], confirmed in Q3 letter as initiative owner."
  - Champion: "GAP — VP Lifecycle attended call but unclear if internal advocate. Validate via mutual action plan."
=== END EXEMPLAR ===`;
