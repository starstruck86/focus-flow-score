/**
 * Discovery Prep SOP — seed text (Branch expansion-AE edition).
 *
 * Editable in Strategy Settings. This is the *initial* default; once the user
 * saves their own SOP it lives in localStorage via strategyConfig and this
 * constant is never read again.
 *
 * Scope: shown in the settings textarea and used to seed the parsed-preview.
 * It is NOT injected into any AI prompt directly.
 *
 * Framed for a Branch.io Strategic Account Executive running EXPANSION on
 * existing customers (not net-new prospecting). The job is expansion-ARR:
 * new business units, new Branch products, competitive displacement (Adjust,
 * AppsFlyer, Kochava, Singular), and renewal/QBR motions.
 */
export const DISCOVERY_PREP_SOP_SEED = `DISCOVERY / EXPANSION PREP — FULL MODE SOP (Branch expansion AE)

NON-NEGOTIABLES
- Page-1 cockpit always present (Headline, Expansion Hypothesis, Why-Now, POV, Must-Confirm).
- Every metric carries Value, Date, Source, Strategic Implication, Discovery Question.
- Unknowns become exact discovery questions — never invented numbers.
- Branch footprint check present: which products are live vs whitespace.
- Proof points cited from real Branch case studies / KIs — no generic claims.
- Appendix is the intelligence layer; cockpit is the execution layer.

REQUIRED INPUTS
- Account name, website, current Branch footprint (products live)
- Opportunity / expansion motion, stage, scale
- Meeting participants (name, title, side)
- Rep name, desired next step
- Prior call notes / signals (optional)

REQUIRED OUTPUTS
- Page-1 cockpit
- Expansion Hypothesis + Why-Now + Executive POV
- Must-Confirm checklist
- Pain mapping (mobile growth pains × C-suite priorities)
- Branch footprint analysis (live products vs expansion whitespace)
- Measurement / attribution maturity + proof points
- Competitive posture (incumbent MMP: Adjust, AppsFlyer, Kochava, Singular — displacement angle)
- ROI framework (expansion-ARR + sensitivity)
- 10 prepared discovery questions
- Value-selling block (tied to Branch products)
- Customer expansion examples
- Pivot statements (pain + FOMO)
- Objection handling (grounded in library: build-internally, MMP-switch cost, privacy)
- Appendix: 18-month signals, channel/app audit, business model, industry analysis

RESEARCH WORKFLOW
1. Business model + mobile/app strategy + competitive set
2. App growth + deep linking + attribution observable evidence
3. Current MMP / measurement stack detection (Branch vs Adjust/AppsFlyer/Kochava/Singular)
4. Public Branch case studies / proof points relevant to this vertical
5. New business unit / sub-brand / app portfolio check (expansion whitespace)
6. 18-month dated signals (8–15 entries: app launches, funding, leadership, privacy changes)

MANDATORY CHECKS
- Branch footprint stated explicitly: which products live, which are whitespace.
- Measurement/attribution maturity assigned with evidence.
- Competitive MMP incumbent identified (or confirmed Branch-only).
- ROI logic uses expansion-ARR with sensitivity scenarios.
- Every claim traces to [S#] source or library IP.

METRICS PROTOCOL
Format: Metric | Value | Date | Source | Strategic Implication | Discovery Question
- Never invent install volume, MAU, conversion, attribution spend, ARR.
- Unknown metrics become exact discovery questions.

PAGE-1 COCKPIT RULES
- Headline <= 22 words.
- Max 5 bullets per quadrant; <= 22 words per bullet.
- Overflow -> appendix.
- POV block 3-5 sentences (separate from headline).

FORMATTING RULES
- No long paragraphs in the cockpit.
- Bullets and tables for fast scanning.
- Page break before Appendix.
- Citations [S#] propagate from synthesis through document.

BUILD ORDER
1. Library retrieval (playbooks -> KIs -> templates)
2. External research synthesis with [S#] registry
3. Document authoring against locked schema
4. Self-review against rubric
5. Single self-correction pass if strict mode is on

QA CHECKLIST
- All required sections present and in order.
- Page-1 cockpit complete.
- Branch footprint + measurement maturity checks present.
- Metrics table format correct.
- No invented numbers.
- Every section's grounded_by lists real KI/playbook ids (or [] if none).
- Discovery questions tied to specific facts (numbers, exec names, recent events).
`;
