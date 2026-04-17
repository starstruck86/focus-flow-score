// ════════════════════════════════════════════════════════════════
// Discovery Prep — TaskHandler implementation (v2 quality pass)
//
// Calibrated against Museum of Science + ELF benchmarks.
// Locked template + few-shot + gold-standard rubric drive Claude.
// Library grounding is enforced at synthesis AND review stages.
// ════════════════════════════════════════════════════════════════

import type {
  LibraryRetrievalResult,
  ResearchBundle,
  TaskHandler,
  TaskInputs,
} from "../types.ts";
import {
  DISCOVERY_PREP_FEW_SHOT,
  DISCOVERY_PREP_RUBRIC,
  DISCOVERY_PREP_SCHEMA,
  DISCOVERY_PREP_SECTIONS,
} from "./discoveryPrepTemplate.ts";
// Strategy Core — shared reasoning + critique primitives.
// Discovery Prep composes its prompts from these so the same brain is
// available to chat and to every future task. Strings remain
// byte-identical to the previous inline versions.
import {
  ACCOUNT_SPECIFICITY_RULE,
  CRITIQUE_IDENTITY_INSTRUCTION,
  ECONOMIC_FRAMING_RULES,
  FACT_DISCIPLINE_RULES,
  STRATEGY_CORE_THINKING_ORDER,
  libraryGroundingHeader,
} from "../../strategy-core/index.ts";

export const discoveryPrepHandler: TaskHandler = {
  taskType: "discovery_prep",

  buildResearchQueries(inputs: TaskInputs) {
    const company = inputs.company_name || "the company";
    const site = inputs.website ? ` Website: ${inputs.website}.` : "";
    return [
      {
        key: "business",
        prompt: `Research ${company}: revenue model, channel mix, key products/lines, pricing position, stated exec priorities, recent earnings/investor info, press releases, product launches, M&A activity, and competitive set (direct + substitutes).${site} Be specific with numbers, dates, and sources.`,
      },
      {
        key: "cx_lifecycle",
        prompt: `Research ${company}'s customer experience and lifecycle marketing: signup/capture flows, browse/cart/checkout experience, post-purchase communications, cross-sell programs, reviews/UGC strategy, education content, replenishment signals, winback triggers, loyalty moments, subscription programs.${site} Focus on observable evidence.`,
      },
      {
        key: "tech_stack",
        prompt: `Research ${company}'s marketing technology stack. Look for evidence of: Commerce platform, ESP/email, SMS, Push notifications, CMS, CDP, Analytics, Experimentation, Reviews, Loyalty platform, Support tools, Attribution, AI tools, Subscription/auto-replenish vendors. Check job posts, partner pages, help center, app store integrations.${site}`,
      },
      {
        key: "case_studies",
        prompt: `Find public case studies, proof points, or vendor announcements involving ${company} related to: marketing automation, lifecycle marketing, email/SMS personalization, customer engagement platforms, CDP, loyalty programs, subscription commerce. Search vendor case study libraries (Iterable, Braze, Klaviyo, Salesforce, Adobe, Ordergroove). Extract: program/use case, result + timeframe, what it implies about maturity.`,
      },
      {
        key: "subscription",
        prompt: `Does ${company} have a subscription, auto-replenish, or membership/loyalty program? Look for: subscribe & save, auto-delivery, replenishment, member tiers, paid loyalty. Check vendors: Ordergroove, Recharge, Skio, Shopify Subscriptions, Bold, Yotpo, LoyaltyLion, Smile.io.${site} If found, capture: model type, discount structure, frequency options, cancel controls.`,
      },
      {
        key: "signals_18mo",
        prompt: `List 8-15 dated signals from the last 18 months for ${company}: leadership changes, earnings highlights, product launches, partnerships, M&A, hiring patterns, technology changes, marketing campaigns. Format each as: [YYYY-MM] short signal — implication.`,
      },
    ];
  },

  /** Library scopes — retrieved BEFORE synthesis so internal IP shapes the prep. */
  libraryScopes(_inputs: TaskInputs) {
    return [
      "discovery", "discovery questions", "qualification", "meddpicc", "meddicc",
      "hypothesis", "value selling", "executive framing", "executive",
      "objection handling", "objection", "competitive", "competition",
      "pain", "pain mapping", "champion", "deal progression",
      "lifecycle", "subscription", "retention", "consolidation",
      "roi", "business case", "math", "value driver", "next step", "exit criteria",
    ];
  },

  buildSynthesisPrompt(inputs, research, library) {
    const participantsText = (inputs.participants || [])
      .map((p) => `- ${p.name}${p.title ? ` (${p.title})` : ""}${p.role ? ` — ${p.role}` : ""} [${p.side || "prospect"}]`)
      .join("\n");

    const researchText = Object.entries(research.results)
      .filter(([_, v]) => v.text)
      .map(([key, v]) => `=== ${key.toUpperCase()} ===\n${v.text}\n\nSources: ${v.citations.join(", ") || "inline"}`)
      .join("\n\n---\n\n");

    return `You are a senior sales strategist synthesizing research + internal IP into actionable discovery strategy.

COMPANY: ${inputs.company_name}
REP: ${inputs.rep_name || "Corey"}
OPPORTUNITY: ${inputs.opportunity || "Unknown"}
STAGE: ${inputs.stage || "Unknown"}
PLATFORM SCALE: ${inputs.scale || "Unknown"}
DESIRED NEXT STEP: ${inputs.desired_next_step || "Unknown"}
PRIOR NOTES: ${inputs.prior_notes || "None"}

MEETING PARTICIPANTS:
${participantsText || "Unknown"}

--- EXTERNAL RESEARCH (Perplexity) ---
${researchText || "No research available."}
--- END RESEARCH ---

${library.contextString ? `--- INTERNAL LIBRARY (KIs + Playbooks) ---
${library.contextString}
--- END LIBRARY ---

INTEGRATION RULE — NON-NEGOTIABLE:
The internal library IS the company's tested IP. When a KI or playbook covers a topic
(discovery questions, hypothesis frame, MEDDPICC, value selling, objections, competitive,
pain mapping, next-step framing), GROUND your synthesis in those KIs/playbooks rather than
generating generic advice. For each major synthesis field, name the KI/playbook IDs you
leaned on in the "library_grounding" object.
` : ""}

YOUR TASK:
Synthesize ALL inputs into structured strategic intelligence with rich citations.

You MUST also produce a "sources" registry: every external fact you cite should be tagged
[S1], [S2], … in the synthesis prose, and registered in the sources array.

Return JSON with these fields:
{
  "sources": [{"id": "S1", "label": "<short>", "url": "<url>", "accessed": "<date>"}],
  "headline": "<single sentence — sharpest story in <=22 words>",
  "hypothesis": "<connect business pain → exec initiative → solution value, w/ [S#]>",
  "why_now": "<timing triggers, catalysts, urgency drivers from evidence w/ [S#]>",
  "pov": "<3-5 sentence executive POV — specific & grounded w/ [S#]>",
  "must_confirm": ["<3-5 critical validations>"],
  "deal_risks": [{"risk": "<...>", "level": "Low/Med/High", "mitigation": "<...>"}],
  "call_control": ["<3-4 bullets: timebox, micro-closes, no-demo rule, exit beats>"],
  "land_next_step": ["<3 bullets describing the technical/scoped next step>"],
  "pain_mapping": {"marketing_pains": ["..."], "csuite_pains": ["..."], "connection": "<bridge>"},
  "subscription_analysis": {"exists": true/false, "model_type": "...", "discount_structure": "...", "frequency_options": "...", "cancel_controls": "...", "vendors": "...", "source_ids": ["S#"]},
  "lifecycle_maturity": {"level": "early/developing/mature/advanced", "evidence": ["..."], "case_studies": [{"source": "...", "source_id": "S#", "program": "...", "result": "...", "maturity_implication": "...", "talk_track": "...", "trap_question": "...", "validation_question": "..."}]},
  "tech_stack": {"stack": [{"layer": "Commerce/ESP/SMS/CDP/Loyalty/Subscription/etc", "vendor": "...", "evidence": "...", "source_ids": ["S#"], "consolidation_opportunity": "..."}], "stack_limitation_impact": "<paragraph>"},
  "roi_framework": {"primary_logic": "...", "sensitivity": [{"scenario": "...", "revenue_impact": "...", "margin_impact": "...", "question": "..."}], "math": {"metric": "...", "actual": "...", "target": "...", "holding_back": "..."}, "strategic_implication": "<one sentence>"},
  "competitive_positioning": [{"competitor": "...", "strengths": "...", "weaknesses": "...", "differentiation": "...", "trap_question": "..."}],
  "discovery_questions": ["<6-10 specific questions, each tied to a hypothesis or KI>"],
  "value_selling": {"money": "...", "compete": "...", "current_state": "...", "industry_pressures": "...", "problems_and_pain": "...", "ideal_state": "...", "value_driver": "..."},
  "customer_examples": [{"customer": "...", "relevance": "...", "link": "..."}],
  "pivot_statements": {"pain": "...", "fomo": "..."},
  "objection_handling": [{"objection": "...", "response": "<grounded in library — name the KI/playbook>", "grounded_by_id": "<id or null>"}],
  "executive_snapshot": {"company_overview": "...", "key_metrics": [{"metric": "...", "value": "...", "date": "...", "source_id": "S#"}], "exec_priorities": ["..."], "strategic_implication": "<one sentence>"},
  "cx_audit": {"browse_signup": "...", "cart_checkout": "...", "post_purchase": "...", "lifecycle_gaps": ["..."], "signal_quality": "high/medium/low", "strategic_implication": "<one sentence>"},
  "loyalty_analysis": {"program_exists": true/false, "program_type": "...", "tiers": "...", "subscription_tie_in": "...", "key_observations": ["..."], "gaps": ["..."], "strategic_implication": "<one sentence>"},
  "appendix": {
    "eighteen_month_signals": [{"date": "YYYY-MM", "signal": "...", "implication": "...", "source_id": "S#"}],
    "channel_audit": [{"channel": "email/sms/push/app/social", "observation": "...", "discovery_angle": "...", "source_id": "S#"}],
    "cx_audit_detail": "...",
    "subscription_teardown": "...",
    "loyalty_teardown": "...",
    "business_model_detail": "...",
    "industry_analysis": "..."
  },
  "library_grounding": {
    "by_topic": {
      "discovery_questions": ["<KI/playbook ids w/ titles>"],
      "objection_handling": ["..."],
      "meddpicc": ["..."],
      "value_selling": ["..."],
      "competitive": ["..."]
    },
    "kis_used": ["<all KI titles leaned on>"],
    "playbooks_used": ["<all playbook titles leaned on>"]
  }
}

RULES:
- Every factual claim MUST trace to research evidence (with [S#]) or library IP, or be labeled "Unknown — discovery question needed".
- No generic filler. Every bullet must be specific to THIS company.
- Include sensitivity model (e.g., +5–10% AOV, +5% frequency, -3% churn) with revenue + margin direction.
- Use M.A.T.H.: Metric, Actual, Target, Holding back.
- Discovery questions must sound prepared and reference specific facts (numbers, exec names, recent events).
- Where the library has zero relevant coverage for a topic, leave that "by_topic" entry as [].

Return ONLY JSON. No markdown fences.`;
  },

  buildDocumentSystemPrompt() {
    return `You are the document author for the Mid-Market Discovery Prep template, executing the LOCKED Strategy Core production rules.

THIS IS NOT A RESEARCH MEMO. NOT A MARKETING BRIEF. It is an internal, executive-grade sales weapon.
The template is the execution layer. The appendix is the intelligence layer. Do NOT confuse them.

${STRATEGY_CORE_THINKING_ORDER}

${FACT_DISCIPLINE_RULES}

${ACCOUNT_SPECIFICITY_RULE}

${ECONOMIC_FRAMING_RULES}

TEMPLATE RULES:
- Use the EXACT 19-section schema below — same ids, names, order, field names.
- Do NOT add, remove, rename, reorder, or merge sections.
- Do NOT invent facts. Use only the provided synthesis + library + sources registry.
- Where information is missing, write "Unknown" and include a discovery question.
- Discovery questions: EXACTLY 10, prepared, tied to a named asset / leakage point / hypothesis.
- Bullets ≤ 22 words. Max 5 bullets per cockpit quadrant. Overflow → appendix.
- value_selling.pov is EXACTLY 3-5 sentences (separate from pov_block).
- Every factual claim carries a [S#] marker tied to the sources registry.
- Every section's "grounded_by" lists the KI/playbook IDs actually used; [] if none — never fabricated.
- Buying committee / blockers use role-first language ("Head of X", "Role TBD") when names unverified.
- After drafting, self-check against the rubric below. Fix any failures BEFORE returning.

LOCKED SCHEMA (return EXACTLY this shape):
${DISCOVERY_PREP_SCHEMA}

${DISCOVERY_PREP_FEW_SHOT}

${DISCOVERY_PREP_RUBRIC}

Return ONLY valid JSON matching the schema. No markdown fences. No preamble.`;
  },

  buildDocumentUserPrompt(inputs, synthesis, library) {
    const participants = (inputs.participants || [])
      .map((p) => `- ${p.name}${p.title ? ` (${p.title})` : ""} [${p.side || "prospect"}]`).join("\n");

    return `Author the Discovery Prep document for the inputs below.

COMPANY: ${inputs.company_name}
REP: ${inputs.rep_name || "Corey"}
OPPORTUNITY: ${inputs.opportunity || "Unknown"}
STAGE: ${inputs.stage || "Unknown"}
SCALE: ${inputs.scale || "Unknown"}
DESIRED NEXT STEP: ${inputs.desired_next_step || "Unknown"}

PARTICIPANTS:
${participants || "Unknown"}

SYNTHESIZED INTELLIGENCE (already cites [S#] — propagate citations through the document):
${JSON.stringify(synthesis, null, 2)}

${library.contextString ? `INTERNAL LIBRARY (use to ground tactics, questions, objection responses, anti-patterns; cite the 8-char id in each section's "grounded_by"):
${library.contextString}
` : ""}

Produce JSON conforming exactly to the locked 19-section schema. Match the depth + scannability + citation density of BOTH few-shot exemplars. Self-check against the rubric before returning.`;
  },

  buildReviewPrompt(inputs, draft, library) {
    return `You are a VP of Sales reviewing a Discovery Prep document for ${inputs.company_name}.

${CRITIQUE_IDENTITY_INSTRUCTION}

${libraryGroundingHeader(library)}

THE PREP DOCUMENT:
${JSON.stringify(draft.sections || draft, null, 2)}

COMPANY: ${inputs.company_name}
STAGE: ${inputs.stage || "Unknown"}

Produce ONE coherent review with these elements:

1. "strengths" — max 2-3 genuinely strong, meeting-ready elements
2. "redlines" — max 3-5 specific section-level rewrites:
   - "id": "r1", "r2", ...
   - "section_id": one of [${DISCOVERY_PREP_SECTIONS.map(s => `"${s.id}"`).join(", ")}]
   - "section_name": human-readable name from the template
   - "current_text": quote (or summarize) the current text
   - "proposed_text": the improved version (drop-in replacement)
   - "rationale": why this matters — cite the playbook/KI grounding it
   - "grounded_by_id": the 8-char id of the KI/playbook backing this redline (or null)
3. "library_coverage": {
     "used": [{"id": "<8-char>", "title": "<title>", "type": "KI|Playbook", "sections": ["<section_ids that cited it>"]}],
     "gaps": ["<topics where library was thin or missing>"],
     "score": 0-100  // qualitative grounding score
   }
4. "rubric_check": {
     "citation_density": "pass/warn/fail",
     "cockpit_completeness": "pass/warn/fail",
     "discovery_question_specificity": "pass/warn/fail",
     "library_grounding": "pass/warn/fail",
     "appendix_richness": "pass/warn/fail",
     "notes": ["<short notes on any warn/fail items>"]
   }

Redlines must be specific drop-in rewrites, not generic advice. They REFINE the sacred draft — they do not replace it.

Return ONLY valid JSON:
{
  "strengths": ["..."],
  "redlines": [{"id": "r1", "section_id": "...", "section_name": "...", "current_text": "...", "proposed_text": "...", "rationale": "...", "grounded_by_id": "..."}],
  "library_coverage": {"used": [...], "gaps": [...], "score": 0-100},
  "rubric_check": {...}
}

No markdown fences.`;
  },
};
