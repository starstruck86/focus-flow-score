// ════════════════════════════════════════════════════════════════
// Strategy Core — Reasoning Primitives
//
// THE ONE BRAIN. Every surface (Discovery Prep today, chat tomorrow,
// future tasks) composes its prompts from the named exports below.
//
// Rules:
//   • These are PROMPT FRAGMENTS and SCHEMA FRAGMENTS, not orchestration.
//   • Strings here are extracted VERBATIM from the original Discovery
//     Prep prompts so PR #1 produces byte-identical output.
//   • Do NOT add task-specific logic here. Tasks define WHAT to produce.
//     This module defines HOW the system thinks.
//   • Do NOT call providers from here. Pure strings + small helpers only.
// ════════════════════════════════════════════════════════════════

/**
 * The core thinking order every strategic deliverable must follow before
 * writing. Lifted verbatim from the Discovery Prep document system prompt.
 */
export const STRATEGY_CORE_THINKING_ORDER = `NON-NEGOTIABLE STRATEGY CORE THINKING ORDER (you must complete BEFORE writing):
  STEP 1 — ACCOUNT THESIS: define account_truth, primary_growth_lever, primary_value_leakage,
    biggest_risk, best_entry_point_motion, one_line_story. Account-specific. Opinionated. Business-first.
  STEP 2 — VALUE LEAKAGE MAP: 4-6 leakage points, each with evidence, grade (VALID/INFER/HYPO/UNKN),
    strategic_implication, economic_impact, discovery_angle.
  STEP 3 — SECTION POV: every required section starts with a pov_block (call/grade/economic_consequence/
    discovery_action). Each call MUST be DISTINCT — no copy-paste across sections.
  STEP 4 — ALIGNMENT: every section ties back to the thesis or the leakage map. No orphaned sections.`;

/**
 * Fact-discipline rules. Surface-agnostic — applies to any output that
 * makes claims about an account, a deal, or a market.
 */
export const FACT_DISCIPLINE_RULES = `FACT DISCIPLINE (CRITICAL):
- Use VALID / INFER / HYPO / UNKN. Do NOT overstate certainty. Do NOT hide it.
- Do NOT let fact discipline FLATTEN the point of view. State the strongest reasonable conclusion,
  THEN label it honestly. A graded HYPO is better than a generic safe statement.
- Use vendor names sparingly when evidence is thin — prefer "Most likely operating pattern".`;

/**
 * Account-specificity rule. Required for any artifact that names an account.
 */
export const ACCOUNT_SPECIFICITY_RULE = `ACCOUNT-SPECIFICITY RULE:
- Every major section must contain at least one detail unique to this account (named program, venue,
  audience, leader, surface, behavior). FAIL if a section could apply to any similar company.`;

/**
 * Economic / solution-discipline framing. Diagnose-before-prescribe.
 */
export const ECONOMIC_FRAMING_RULES = `SOLUTION DISCIPLINE:
- For tech_stack: DIAGNOSE business breakage BEFORE prescribing platform. Stack does not lead the call.
- Order: Diagnose → Quantify → Validate → Propose motion.`;

/**
 * Shared schema fragment for a single POV block. Used by Discovery Prep
 * sections today and intended for any future deliverable that needs an
 * opinionated, graded, economically-anchored stance.
 */
export const POV_BLOCK_SCHEMA = `{
  "call": "<one sharp account-specific conclusion — business breakage first, never stack-first>",
  "grade": "VALID|INFER|HYPO|UNKN",
  "economic_consequence": "<dollar / margin / retention consequence>",
  "discovery_action": "<single concrete thing seller does in the meeting>"
}`;

/**
 * Shared schema fragment for an account thesis. The "what is true about
 * this account" object that every strategic artifact should be able to
 * produce on demand.
 */
export const ACCOUNT_THESIS_SCHEMA = `{
  "account_truth": "<the one true thing about how this account makes money / where value moves>",
  "primary_growth_lever": "<the single biggest revenue lever to pull next>",
  "primary_value_leakage": "<the single biggest place value is leaking today>",
  "biggest_risk": "<deal or business risk that matters most>",
  "best_entry_point_motion": "<the smallest scoped motion that proves the thesis>",
  "one_line_story": "<a single sentence the AE would say to the EB>"
}`;

/**
 * Shared schema fragment for a value-leakage entry. A list of these forms
 * the Value Leakage Map.
 */
export const VALUE_LEAKAGE_ENTRY_SCHEMA = `{
  "point": "<leakage point>",
  "evidence": "<observed evidence w/ [S#] or 'Inferred from <pattern>'>",
  "grade": "VALID|INFER|HYPO|UNKN",
  "strategic_implication": "<what this means strategically>",
  "economic_impact": "<rough $ or % direction>",
  "discovery_angle": "<one question to validate or quantify>"
}`;
