// ════════════════════════════════════════════════════════════════
// Discovery Prep — TaskHandler implementation
//
// Plugs into the shared Strategy task orchestrator. Owns:
//   - research queries (Perplexity)
//   - library scopes (KIs + playbooks retrieval)
//   - synthesis prompt (OpenAI)
//   - locked template contract + few-shot (Claude)
//   - playbook-grounded review (Lovable AI)
// ════════════════════════════════════════════════════════════════

import type {
  LibraryRetrievalResult,
  ResearchBundle,
  TaskHandler,
  TaskInputs,
} from "../types.ts";
import {
  DISCOVERY_PREP_FEW_SHOT,
  DISCOVERY_PREP_SCHEMA,
  DISCOVERY_PREP_SECTIONS,
} from "./discoveryPrepTemplate.ts";

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
        prompt: `Find public case studies, proof points, or vendor announcements involving ${company} related to: marketing automation, lifecycle marketing, email/SMS personalization, customer engagement platforms, CDP, loyalty programs, subscription commerce. Search vendor case study libraries (Iterable, Braze, Klaviyo, Salesforce, Adobe). Extract: program/use case, result + timeframe, what it implies about maturity.`,
      },
      {
        key: "subscription",
        prompt: `Does ${company} have a subscription or auto-replenish program? Look for: subscribe & save, auto-delivery, replenishment programs. Check vendors: Ordergroove, Recharge, Skio, Shopify Subscriptions, Bold Subscriptions.${site} If found, capture: model type, discount structure, frequency options, cancel controls.`,
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
      "roi", "business case", "math", "value driver",
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

INTEGRATION RULE: The internal library IS the company's tested IP. When a KI or playbook
covers a topic in your synthesis (discovery questions, hypothesis frame, MEDDPICC, value
selling, objections, competitive), GROUND your synthesis in those KIs/playbooks rather than
generating generic advice. Reference the source by KI title or playbook title where useful.
` : ""}

YOUR TASK:
Synthesize ALL inputs into structured strategic intelligence. Connect evidence to action.

You must produce JSON with these fields:
{
  "hypothesis": "<connect business pain → exec initiative → solution value>",
  "why_now": "<timing triggers, catalysts, urgency drivers from evidence>",
  "pov": "<3-5 sentence executive POV — specific & grounded>",
  "must_confirm": ["<3-5 critical validations>"],
  "deal_risks": [{"risk": "<...>", "mitigation": "<...>"}],
  "pain_mapping": {"marketing_pains": ["..."], "csuite_pains": ["..."], "connection": "<bridge>"},
  "subscription_analysis": {"exists": true/false, "model_type": "...", "discount_structure": "...", "frequency_options": "...", "cancel_controls": "...", "vendors": "..."},
  "lifecycle_maturity": {"level": "early/developing/mature/advanced", "evidence": ["..."], "case_studies": [{"source": "...", "program": "...", "result": "...", "maturity_implication": "...", "talk_track": "...", "trap_question": "...", "validation_question": "..."}]},
  "tech_stack": [{"layer": "Commerce/ESP/SMS/CDP/Loyalty/Subscription/etc", "vendor": "...", "evidence": "...", "consolidation_opportunity": "..."}],
  "roi_framework": {"primary_logic": "...", "sensitivity": [{"scenario": "...", "impact": "...", "question": "..."}], "math": {"metric": "...", "actual": "...", "target": "...", "holding_back": "..."}},
  "competitive_positioning": [{"competitor": "...", "strengths": "...", "weaknesses": "...", "differentiation": "...", "trap_question": "..."}],
  "discovery_questions": ["<6 specific questions, each tied to a hypothesis or playbook KI>"],
  "value_selling": {"money": "...", "compete": "...", "current_state": "...", "industry_pressures": "...", "problems_and_pain": "...", "ideal_state": "...", "value_driver": "..."},
  "customer_examples": [{"customer": "...", "relevance": "...", "link": "..."}],
  "pivot_statements": {"pain": "...", "fomo": "..."},
  "objection_handling": [{"objection": "...", "response": "<grounded in library if available>"}],
  "executive_snapshot": {"company_overview": "...", "key_metrics": [{"metric": "...", "value": "...", "source": "..."}], "exec_priorities": ["..."]},
  "library_grounding": {"kis_used": ["<KI titles you leaned on>"], "playbooks_used": ["<playbook titles you leaned on>"]},
  "appendix": {"cx_audit_detail": "...", "subscription_teardown": "...", "business_model_detail": "...", "industry_analysis": "..."}
}

RULES:
- Every claim must trace to research evidence, library IP, or be labeled "Unknown — discovery question needed"
- No generic filler. Every bullet must be specific to THIS company.
- Include sensitivity model (e.g., +5–10% AOV, +5% frequency, -3% churn) with revenue direction
- Use M.A.T.H.: Metric, Actual, Target, Holding back
- Discovery questions: prepared-feeling, not generic
- Max 3 bullets per concept (overflow goes to appendix; Claude will structure it)

Return ONLY JSON. No markdown fences.`;
  },

  buildDocumentSystemPrompt() {
    return `You are the document author for the Mid-Market Discovery Prep template.

THE TEMPLATE IS A CONTRACT. Non-negotiable rules:
- Use the EXACT 19-section schema below — same ids, same names, same order, same field names.
- Do NOT add, remove, rename, reorder, or merge sections.
- Do NOT invent facts. Use only the provided synthesis + library.
- Where information is missing, write "Unknown" and (where relevant) include a discovery question.
- Bullets ≤ 18 words. Max 3 bullets per card/cell. Overflow → appendix.
- POV must be EXACTLY 3-5 sentences, specific, executive-grade.
- Discovery questions must sound prepared (tied to evidence/hypothesis), never generic.
- Every metric needs date + source, or labeled "Unknown".
- Use the few-shot exemplar to calibrate tone, scannability, and depth — not just headings.

LOCKED SCHEMA (return EXACTLY this shape):
${DISCOVERY_PREP_SCHEMA}

${DISCOVERY_PREP_FEW_SHOT}

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

SYNTHESIZED INTELLIGENCE:
${JSON.stringify(synthesis, null, 2)}

${library.contextString ? `INTERNAL LIBRARY (use to ground tactics, questions, objection responses, anti-patterns):
${library.contextString}
` : ""}

Produce JSON conforming exactly to the locked 19-section schema. Match the tone/depth of the few-shot exemplar.`;
  },

  buildReviewPrompt(inputs, draft, library) {
    return `You are a VP of Sales reviewing a Discovery Prep document for ${inputs.company_name}.

GROUND YOUR REVIEW IN THE INTERNAL PLAYBOOKS / KIs BELOW. Do NOT use generic best practices when the library covers the topic — cite the playbook/KI title in your rationale.

${library.contextString || "(No relevant library entries found — use general discovery, MEDDPICC, value-selling, executive-framing, and competitive positioning best practices, but flag this as a coverage gap.)"}

THE PREP DOCUMENT:
${JSON.stringify(draft.sections || draft, null, 2)}

COMPANY: ${inputs.company_name}
STAGE: ${inputs.stage || "Unknown"}

Produce ONE coherent review (not multiple frameworks):

1. "strengths" — max 2-3 genuinely strong, meeting-ready elements
2. "redlines" — max 3-5 specific section-level rewrites:
   - "id": "r1", "r2", ...
   - "section_id": one of [${DISCOVERY_PREP_SECTIONS.map(s => `"${s.id}"`).join(", ")}]
   - "section_name": human-readable name from the template
   - "current_text": quote (or summarize) the current text
   - "proposed_text": the improved version (drop-in replacement)
   - "rationale": why this matters — cite the playbook/KI grounding it
3. "library_coverage": {"used": ["<playbook/KI titles cited>"], "gaps": ["<topics where library was thin>"]}

Redlines must be specific drop-in rewrites, not generic advice. They REFINE the sacred draft — they do not replace it.

Return ONLY valid JSON:
{
  "strengths": ["..."],
  "redlines": [{"id": "r1", "section_id": "...", "section_name": "...", "current_text": "...", "proposed_text": "...", "rationale": "..."}],
  "library_coverage": {"used": ["..."], "gaps": ["..."]}
}

No markdown fences.`;
  },
};
