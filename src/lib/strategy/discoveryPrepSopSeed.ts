/**
 * Discovery Prep SOP — seed text.
 *
 * Editable in Strategy Settings. This is the *initial* default; once the user
 * saves their own SOP it lives in localStorage via strategyConfig and this
 * constant is never read again.
 *
 * Phase 1 scope: this text is shown in the textarea and used to seed the
 * parsed-preview. It is NOT injected into any AI prompt.
 */
export const DISCOVERY_PREP_SOP_SEED = `DISCOVERY PREP — FULL MODE SOP

NON-NEGOTIABLES
- Page-1 cockpit always present (Headline, Hypothesis, Why-Now, POV, Must-Confirm).
- Every metric carries Value, Date, Source, Strategic Implication, Discovery Question.
- Unknowns become exact discovery questions — never invented numbers.
- Subscription / lifecycle / loyalty checks present when applicable.
- Lifecycle proof points cited from real case studies — no generic claims.
- Appendix is the intelligence layer; cockpit is the execution layer.

REQUIRED INPUTS
- Company name, website
- Opportunity, stage, scale
- Meeting participants (name, title, side)
- Rep name, desired next step
- Prior notes (optional)

REQUIRED OUTPUTS
- Page-1 cockpit
- Hypothesis + Why-Now + Executive POV
- Must-Confirm checklist
- Pain mapping (marketing pains × C-suite pains)
- Subscription analysis
- Lifecycle maturity + proof points
- Tech-stack teardown + consolidation angle
- ROI framework (M.A.T.H. + sensitivity)
- Competitive positioning
- 10 prepared discovery questions
- Value-selling block
- Customer examples
- Pivot statements (pain + FOMO)
- Objection handling (grounded in library)
- Appendix: 18-month signals, channel audit, business model, industry analysis

RESEARCH WORKFLOW
1. Business model + revenue + competitive set
2. CX & lifecycle marketing observable evidence
3. MarTech stack detection
4. Public case studies / vendor proof points
5. Subscription / loyalty / membership program check
6. 18-month dated signals (8–15 entries)

MANDATORY CHECKS
- Subscription model presence/absence stated explicitly.
- Lifecycle maturity level assigned with evidence.
- Tech-stack consolidation opportunity called out.
- ROI logic uses M.A.T.H. with sensitivity scenarios.
- Every claim traces to [S#] source or library IP.

METRICS PROTOCOL
Format: Metric | Value | Date | Source | Strategic Implication | Discovery Question
- Never invent AOV, LTV, CAC, churn, margin, conversion, subscription rates.
- Unknown metrics become exact discovery questions.

PAGE-1 COCKPIT RULES
- Headline ≤ 22 words.
- Max 5 bullets per quadrant; ≤ 22 words per bullet.
- Overflow → appendix.
- POV block 3–5 sentences (separate from headline).

FORMATTING RULES
- No long paragraphs in the cockpit.
- Bullets and tables for fast scanning.
- Page break before Appendix.
- Citations [S#] propagate from synthesis through document.

BUILD ORDER
1. Library retrieval (templates → playbooks → KIs)
2. External research synthesis with [S#] registry
3. Document authoring against locked schema
4. Self-review against rubric
5. Single self-correction pass if strict mode is on

QA CHECKLIST
- All required sections present and in order.
- Page-1 cockpit complete.
- Subscription + lifecycle checks present.
- Metrics table format correct.
- No invented numbers.
- Every section's grounded_by lists real KI/playbook ids (or [] if none).
- Discovery questions tied to specific facts (numbers, exec names, recent events).
`;
